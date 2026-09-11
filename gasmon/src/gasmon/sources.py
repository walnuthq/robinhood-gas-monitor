"""Resolving published source code.

Sourcify answers per ADDRESS; the fact is per CODE. This module does the lookups
at address grain and lets the `code_verification` view do the propagation, so one
verified instance settles a whole clone group.
"""

import json
import time
import urllib.error
import urllib.request

from .db import db_open
from .evm import delegate_of
from .rpc import Rpc


def sourcify_lookup(chain_id, addr, timeout=30, tries=3):
    """One address, one answer. Unverified comes back either as HTTP 404 or as
    200 with match:null depending on the deployment, so both are handled.

    Retried on transient failure: the registry answers in ~0.2s warm but can
    take ~10s cold or throttle a burst, and a run of 200 lookups saw a third of
    them fail that way. `status: "error"` means "no answer", which the caller
    must not cache as "unverified"."""
    url = f"https://sourcify.dev/server/v2/contract/{chain_id}/{addr}?fields=compilation"
    d = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "gasmon/1.0"})
            d = json.load(urllib.request.urlopen(req, timeout=timeout))
            break
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return {"status": "none"}
            if e.code not in (429, 502, 503, 504) or attempt == tries - 1:
                return {"status": "error"}
            time.sleep(1.5 * (attempt + 1))
        except Exception:
            if attempt == tries - 1:
                return {"status": "error"}
            time.sleep(1.0 * (attempt + 1))
    if d is None:
        return {"status": "error"}
    if not d.get("match"):
        return {"status": "none"}
    comp = d.get("compilation") or {}
    return {
        "status": "verified",
        "match_type": d.get("match"),
        "name": comp.get("name"),
        "compiler": " ".join(x for x in (comp.get("compiler"), comp.get("compilerVersion")) if x),
        "settings": json.dumps(comp.get("compilerSettings") or {}, separators=(",", ":")),
        "verified_at": d.get("verifiedAt"),
    }

def backfill_delegates(rpc, con):
    """Fill c.delegate for 23-byte codes recorded before the column existed, or
    missed for any other reason. Re-reads at the block the code was read at, so
    a delegation that changed later cannot corrupt history."""
    todo = con.execute("SELECT addr, block_read FROM code "
                       "WHERE code_len = 23 AND delegate IS NULL").fetchall()
    if not todo:
        return
    by_block = {}
    for addr, blk in todo:
        by_block.setdefault(blk, []).append(addr)
    filled = 0
    for blk, addrs in by_block.items():
        tag = hex(blk) if blk and blk > 0 else "latest"
        for i in range(0, len(addrs), 25):
            chunk = addrs[i:i + 25]
            codes = rpc.batch([("eth_getCode", [a, tag]) for a in chunk])
            rows = [(delegate_of(c), a) for a, c in zip(chunk, codes) if delegate_of(c)]
            con.executemany("UPDATE code SET delegate = ? WHERE addr = ?", rows)
            con.commit()
            filled += len(rows)
    print(f"backfilled {filled} EIP-7702 delegate pointers")

def cmd_sources(args):
    """Resolve verification for the code that matters, in gas order.

    The API is per-address but the fact is per-code, so this queries at most
    --per-group addresses from each code_id group and stops at the first hit:
    one verified instance proves the template. Answers are cached in the
    verification table, negatives included, so re-runs are cheap."""
    con = db_open(args.db)
    backfill_delegates(Rpc([args.trace_rpc]), con)
    groups = con.execute(
        "SELECT f.code_id, SUM(f.self_gas) g FROM frames f "
        "WHERE f.is_precompile = 0 AND f.code_id IS NOT NULL "
        "GROUP BY f.code_id ORDER BY g DESC LIMIT ?", (args.limit,)).fetchall()
    total = con.execute("SELECT SUM(gas_used) FROM blocks").fetchone()[0] or 1
    ttl = args.recheck_days * 86400
    now = int(time.time())

    looked_up = hits = skipped = 0
    for code, gas in groups:
        # Already settled for this group? Nothing to do.
        settled = con.execute(
            "SELECT verified, checked_addrs FROM code_verification WHERE code_id = ?",
            (code,)).fetchone()
        if settled and settled[0]:
            skipped += 1
            continue
        cands = con.execute(
            "SELECT c.addr, c.code_len, c.delegate, COALESCE(SUM(f.self_gas), 0) g "
            "FROM code c LEFT JOIN frames f ON f.addr = c.addr "
            "WHERE c.code_id = ? GROUP BY c.addr ORDER BY g DESC LIMIT ?",
            (code, args.per_group)).fetchall()
        for addr, code_len, delegate, _g in cands:
            if not code_len:            # EOA, nothing to verify
                continue
            target = delegate or addr   # EIP-7702: ask about the implementation
            prev = con.execute(
                "SELECT status, checked_at FROM verification WHERE addr = ? AND source = 'sourcify'",
                (target,)).fetchone()
            # 'error' is the absence of an answer, not a negative one - always
            # retry it, or one throttled burst poisons the cache for `ttl`.
            if prev and prev[0] in ("verified", "none"):
                if prev[0] == "verified":
                    break
                if now - prev[1] < ttl:
                    continue
            r = sourcify_lookup(args.chain_id, target)
            looked_up += 1
            con.execute(
                "INSERT OR REPLACE INTO verification VALUES (?,?,?,?,?,?,?,?,?)",
                (target, "sourcify", r["status"], r.get("match_type"), r.get("name"),
                 r.get("compiler"), r.get("settings"), r.get("verified_at"), now))
            con.commit()
            time.sleep(args.delay)
            if r["status"] == "verified":
                hits += 1
                break

    print(f"looked up {looked_up} addresses, {hits} verified, {skipped} groups already known")
    cov = con.execute(
        "SELECT COALESCE(SUM(CASE WHEN cv.verified = 1 THEN g.gas ELSE 0 END), 0), "
        "       COALESCE(SUM(g.gas), 0), "
        "       SUM(CASE WHEN cv.verified = 1 THEN 1 ELSE 0 END), COUNT(*) "
        "FROM (SELECT code_id, SUM(self_gas) gas FROM frames "
        "      WHERE is_precompile = 0 AND code_id IS NOT NULL GROUP BY code_id) g "
        "LEFT JOIN code_verification cv ON cv.code_id = g.code_id").fetchone()
    vgas, allgas, vgroups, ngroups = cov
    print(f"\nverified code covers {vgas:,} of {allgas:,} attributed gas "
          f"({vgas/max(allgas,1):.1%}), {vgas/total:.1%} of all block gas")
    print(f"{vgroups or 0} of {ngroups} code identities verified")
