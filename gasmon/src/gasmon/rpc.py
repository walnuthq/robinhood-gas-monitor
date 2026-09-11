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


class Rpc:
    """Round-robin JSON-RPC client with backoff. Endpoints rate-limit; batches
    over ~40 get 429s on the official node."""

    def __init__(self, urls, tries=6):
        self.urls = urls if isinstance(urls, list) else [urls]
        self.tries = tries
        self._i = 0
        self._lock = threading.Lock()

    def _next(self):
        with self._lock:
            u = self.urls[self._i % len(self.urls)]
            self._i += 1
            return u

    def call(self, method, params, timeout=120):
        return self._send({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, timeout)

    def batch(self, calls, timeout=120):
        """calls: list of (method, params). Returns results in input order."""
        body = [{"jsonrpc": "2.0", "id": i, "method": m, "params": p} for i, (m, p) in enumerate(calls)]
        out = self._send(body, timeout)
        by_id = {r["id"]: r for r in out}
        return [by_id[i].get("result") for i in range(len(calls))]

    def _send(self, body, timeout):
        last = None
        for attempt in range(self.tries):
            url = self._next()
            try:
                req = urllib.request.Request(url, json.dumps(body).encode(), HEADERS)
                resp = json.load(urllib.request.urlopen(req, timeout=timeout))
            except urllib.error.HTTPError as e:
                last = f"HTTP {e.code}"
                if e.code in (429, 502, 503, 504):
                    time.sleep(1.5 * (attempt + 1))
                    continue
                raise
            except Exception as e:  # timeouts, connection resets
                last = str(e)[:120]
                time.sleep(1.0 * (attempt + 1))
                continue
            if isinstance(resp, dict) and "error" in resp:
                raise RpcError(resp["error"].get("message", str(resp["error"])))
            return resp["result"] if isinstance(resp, dict) else resp
        raise RpcError(f"exhausted {self.tries} attempts: {last}")


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
