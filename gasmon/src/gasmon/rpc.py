"""JSON-RPC plumbing.

Robinhood Chain's endpoints differ in what they serve, and the difference
matters: the official node answers eth_* but no debug_*, and keeps no historical
state beyond a few hours. The trace endpoint answers debug_* and serves state
across the whole window it can trace. Callers pick deliberately.
"""

import json
import threading
import time
import urllib.error
import urllib.request

RPC_DEFAULT = "https://rpc.mainnet.chain.robinhood.com"
TRACE_DEFAULT = "https://rpc.ordofi.network"
HEADERS = {"Content-Type": "application/json", "User-Agent": "gasmon/1.0"}


class RpcError(Exception):
    pass


class _Transient(Exception):
    """Worth retrying: throttled, timed out, reset, or a gateway error."""


class _Refused(Exception):
    """The endpoint rejected a multi-call batch as a whole - a fact about the
    endpoint's batch ceiling, not about the calls in it."""


class Rpc:
    """Round-robin JSON-RPC client with backoff.

    Endpoints differ in how large a batch they accept, and they do not all say
    so politely: the official node throttles batches over ~40 with 429s, and
    keyless drPC answers any batch of 5 or more with a bare HTTP 500. So each
    endpoint keeps its own batch ceiling, halved whenever it refuses a batch,
    and every batch is cut to fit whichever endpoint each piece lands on.
    Without this, round-robining eth_* onto drPC fails every block whose
    receipt batch happens to land there."""

    def __init__(self, urls, tries=6, max_batch=40):
        self.urls = urls if isinstance(urls, list) else [urls]
        self.tries = tries
        self.max_batch = dict.fromkeys(self.urls, max_batch)
        self._i = 0
        self._lock = threading.Lock()

    def _next(self):
        with self._lock:
            u = self.urls[self._i % len(self.urls)]
            self._i += 1
            return u

    def call(self, method, params, timeout=120):
        body = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
        last = None
        for attempt in range(self.tries):
            try:
                resp = self._post(self._next(), body, timeout)
            except _Transient as e:
                last = str(e)
                time.sleep(1.5 * (attempt + 1))
                continue
            if "error" in resp:
                raise RpcError(resp["error"].get("message", str(resp["error"])))
            return resp.get("result")
        raise RpcError(f"exhausted {self.tries} attempts: {last}")

    def batch(self, calls, timeout=120):
        """calls: list of (method, params). Returns results in input order; a
        call the node could not answer comes back as None."""
        results = [None] * len(calls)
        done = failures = 0
        last = None
        while done < len(calls):
            url = self._next()
            n = min(self.max_batch[url], len(calls) - done)
            body = [{"jsonrpc": "2.0", "id": done + k, "method": m, "params": p}
                    for k, (m, p) in enumerate(calls[done:done + n])]
            try:
                out = self._post(url, body, timeout)
            except _Refused:
                with self._lock:
                    self.max_batch[url] = min(self.max_batch[url], max(n // 2, 1))
                continue
            except _Transient as e:
                failures, last = failures + 1, str(e)
                if failures >= self.tries:
                    raise RpcError(f"exhausted {self.tries} attempts: {last}")
                time.sleep(1.5 * failures)
                continue
            if isinstance(out, dict):  # a lone call rejected with an error object
                raise RpcError(out.get("error", {}).get("message", str(out)))
            for r in out:
                results[r["id"]] = r.get("result")
            done += n
            failures = 0
        return results

    def _post(self, url, body, timeout):
        """One round trip. Raises _Refused when a batch of several calls is
        rejected whole, _Transient for anything worth retrying elsewhere."""
        batched = isinstance(body, list) and len(body) > 1
        req = urllib.request.Request(url, json.dumps(body).encode(), HEADERS)
        try:
            resp = json.load(urllib.request.urlopen(req, timeout=timeout))
        except urllib.error.HTTPError as e:
            if e.code == 500 and batched:
                raise _Refused(f"HTTP 500 for a batch of {len(body)}")
            if e.code in (408, 429, 500, 502, 503, 504):
                raise _Transient(f"HTTP {e.code}")
            raise RpcError(f"HTTP {e.code} from {url}")
        except Exception as e:  # timeouts, connection resets, truncated JSON
            raise _Transient(str(e)[:120])
        if batched and isinstance(resp, dict):
            raise _Refused(f"error object for a batch of {len(body)}")
        return resp


def h2i(x, default=0):
    if x is None:
        return default
    return int(x, 16) if isinstance(x, str) else int(x)


def code_id(code_bytes):
    """Local grouping key for identical runtime code. Not the EVM keccak
    codehash - it only has to be stable and collision-free enough to group
    clones, and this avoids a keccak dependency."""
    return hashlib.blake2b(code_bytes, digest_size=16).hexdigest()


def intrinsic_gas(tx):
    """21,000 + calldata + creation + access list. Returns (gas, standard?)."""
    ttype = h2i(tx.get("type"))
    data = bytes.fromhex((tx.get("input") or "0x")[2:])
    gas = 21000 + sum(4 if b == 0 else 16 for b in data)
    if not tx.get("to"):
        gas += 32000 + 2 * ((len(data) + 31) // 32)  # EIP-3860 initcode word cost
    for entry in tx.get("accessList") or []:
        gas += 2400 + 1900 * len(entry.get("storageKeys") or [])
    return gas, ttype not in ARB_NONSTANDARD
