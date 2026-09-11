"""Reading the database back out: identity checks, rankings, and diffs."""

from .db import db_open


def cmd_verify(args, con=None):
    con = con or db_open(args.db)
    nb, ntx, nf = (con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
                   for t in ("blocks", "txs", "frames"))
    if nb == 0:
        print("no blocks collected")
        return
    print(f"\n=== identity checks over {nb} blocks / {ntx} txs / {nf} frames ===")

    checks = []
    # 1. Receipts agree with the block header.
    bad = con.execute("SELECT COUNT(*) FROM blocks WHERE sum_receipt_gas != gas_used").fetchone()[0]
    checks.append(("receipts sum to block.gasUsed", bad))
    # 2. The tracer agrees with the header (catches dropped/extra txs in the trace).
    bad = con.execute("SELECT COUNT(*) FROM blocks WHERE sum_root_gas != gas_used").fetchone()[0]
    checks.append(("root frames sum to block.gasUsed", bad))
    # 3. The frame walk conserves gas: exclusive gas re-sums to the block.
    bad = con.execute("SELECT COUNT(*) FROM blocks WHERE sum_self_raw != gas_used").fetchone()[0]
    checks.append(("exclusive gas re-sums to block.gasUsed", bad))
    # 4. No non-root frame may spend negative gas.
    bad = con.execute("SELECT COUNT(*) FROM frames WHERE is_root=0 AND self_gas_raw < 0").fetchone()[0]
    checks.append(("no negative self-gas below the root", bad))
    # 5. ArbOS's L1 pricer flickers on for short spans. Small is fine and is
    # subtracted from attribution; large would mean the thesis needs rework.
    l1_gas, l1_txs = con.execute(
        "SELECT COALESCE(SUM(gas_used_for_l1),0), SUM(gas_used_for_l1 != 0) FROM txs").fetchone()
    _tot = con.execute("SELECT SUM(gas_used) FROM blocks").fetchone()[0] or 1
    checks.append((f"L1 data gas below 1% of block gas "
                   f"({l1_gas:,} in {l1_txs or 0} txs = {l1_gas/_tot:.3%})",
                   0 if l1_gas / _tot < 0.01 else 1))

    for name, failures in checks:
        print(f"  [{'PASS' if failures == 0 else 'FAIL'}] {name}" + (f"  ({failures} violations)" if failures else ""))

    tot_gas, tot_intr = con.execute(
        "SELECT SUM(gas_used), SUM(sum_intrinsic) FROM blocks").fetchone()
    neg_r, tot_tx = con.execute(
        "SELECT SUM(neg_root_residual), SUM(tx_count) FROM blocks").fetchone()
    refund_lb = con.execute("SELECT COALESCE(SUM(refund_lb),0) FROM txs").fetchone()[0]
    dep = con.execute("SELECT COALESCE(SUM(deposit_gas),0) FROM frames").fetchone()[0]
    pre = con.execute("SELECT COALESCE(SUM(self_gas),0) FROM frames WHERE is_precompile=1").fetchone()[0]
    rev = con.execute("SELECT COALESCE(SUM(receipt_gas),0) FROM txs WHERE status=0").fetchone()[0]

    print(f"\n  block gas total       {tot_gas:>15,}")
    print(f"  intrinsic             {tot_intr:>15,}  {tot_intr/tot_gas:6.2%}  (not attributable)")
    print(f"  L1 data gas           {l1_gas:>15,}  {l1_gas/tot_gas:6.2%}  (not execution)")
    print(f"  code deposit          {dep:>15,}  {dep/tot_gas:6.2%}  (200/byte, CREATE frames)")
    print(f"  precompiles           {pre:>15,}  {pre/tot_gas:6.2%}  (not Solidity)")
    print(f"  reverted tx gas       {rev:>15,}  {rev/tot_gas:6.2%}")
    attributable = con.execute("SELECT COALESCE(SUM(self_gas),0) FROM frames").fetchone()[0]
    print(f"  attributable self-gas {attributable:>15,}  {attributable/tot_gas:6.2%}  (what `top` ranks)")
    print(f"\n  refunds (lower bound) {refund_lb:>15,}  {refund_lb/tot_gas:6.2%} of gas, in "
          f"{neg_r or 0} of {tot_tx} txs")
    print("    ^ EIP-3529 refunds that exceeded the entry contract's own opcodes.")
    print("      callTracer cannot split refund from root execution, so these frames are")
    print("      clamped to zero rather than attributed negative gas. Exact arithmetic")
    print("      is preserved in frames.self_gas_raw, which the checks above use.")

def _range(expr):
    a, _, b = expr.partition("-")
    return int(a), int(b or a)


AGG_SQL = """
SELECT COALESCE(f.code_id,'unknown') AS code,
       COUNT(*) AS calls,
       SUM(f.self_gas) AS self_gas,
       SUM(f.reverted) AS reverts,
       COALESCE(SUM(f.deposit_gas),0) AS deposit,
       COUNT(DISTINCT f.addr) AS addrs,
       MAX(f.addr) AS sample_addr,
       MAX(c.code_len) AS code_len,
       MAX(COALESCE(cv.verified,0)) AS verified,
       MAX(cv.name) AS name
FROM frames f LEFT JOIN code c ON c.addr = f.addr
              LEFT JOIN code_verification cv ON cv.code_id = f.code_id
WHERE f.block BETWEEN ? AND ? AND f.is_precompile = 0
GROUP BY code
"""

AGG_SQL = """
SELECT COALESCE(f.code_id,'unknown') AS code,
       COUNT(*) AS calls,
       SUM(f.self_gas) AS self_gas,
       SUM(f.reverted) AS reverts,
       COALESCE(SUM(f.deposit_gas),0) AS deposit,
       COUNT(DISTINCT f.addr) AS addrs,
       MAX(f.addr) AS sample_addr,
       MAX(c.code_len) AS code_len,
       MAX(COALESCE(cv.verified,0)) AS verified,
       MAX(cv.name) AS name
FROM frames f LEFT JOIN code c ON c.addr = f.addr
              LEFT JOIN code_verification cv ON cv.code_id = f.code_id
WHERE f.block BETWEEN ? AND ? AND f.is_precompile = 0
GROUP BY code
"""

def cmd_top(args):
    con = db_open(args.db)
    lo, hi = _range(args.range) if args.range else con.execute(
        "SELECT MIN(number), MAX(number) FROM blocks").fetchone()
    total = con.execute("SELECT SUM(gas_used) FROM blocks WHERE number BETWEEN ? AND ?",
                        (lo, hi)).fetchone()[0] or 0
    rows = con.execute(AGG_SQL + " ORDER BY self_gas DESC LIMIT ?", (lo, hi, args.limit)).fetchall()
    print(f"\nblocks {lo}..{hi}   block gas {total:,}\n")
    print(f"{'self gas':>13} {'share':>7} {'calls':>8} {'gas/call':>10} {'addrs':>6} "
          f"{'size':>7} {'src':>4}  {'contract':<44}")
    for code, calls, self_gas, reverts, deposit, addrs, sample, code_len, verified, name in rows:
        share = self_gas / total if total else 0
        label = f"{name} ({sample[:10]}…)" if name else (sample or code)
        print(f"{self_gas:>13,} {share:>7.2%} {calls:>8,} {self_gas//max(calls,1):>10,} "
              f"{addrs:>6} {(code_len or 0):>6}B {'yes' if verified else '-':>4}  {label:<44}")

def cmd_diff(args):
    con = db_open(args.db)
    alo, ahi = _range(args.a)
    blo, bhi = _range(args.b)

    def load(lo, hi):
        gas = con.execute("SELECT SUM(gas_used), SUM(tx_count) FROM blocks WHERE number BETWEEN ? AND ?",
                          (lo, hi)).fetchone()
        agg = {r[0]: r for r in con.execute(AGG_SQL, (lo, hi))}
        return gas, agg

    (agas, atx), aagg = load(alo, ahi)
    (bgas, btx), bagg = load(blo, bhi)
    if not agas or not bgas:
        print("one of the ranges has no collected blocks")
        return
    print(f"\nA: blocks {alo}..{ahi}  {agas:,} gas over {atx:,} txs  = {agas/max(atx,1):,.0f} gas/tx")
    print(f"B: blocks {blo}..{bhi}  {bgas:,} gas over {btx:,} txs  = {bgas/max(btx,1):,.0f} gas/tx")
    print(f"   gas/tx change: {(bgas/max(btx,1))/(agas/max(atx,1)):.2f}x\n")

    keys = set(aagg) | set(bagg)
    rows = []
    for k in keys:
        # Normalise by transaction count so a busier range does not dominate.
        a = (aagg[k][2] / atx) if k in aagg and atx else 0
        b = (bagg[k][2] / btx) if k in bagg and btx else 0
        sample = (bagg.get(k) or aagg.get(k))[6]
        rows.append((b - a, a, b, sample, k))
    rows.sort(key=lambda r: -abs(r[0]))
    print(f"{'delta gas/tx':>13} {'A gas/tx':>11} {'B gas/tx':>11}  contract")
    for d, a, b, sample, k in rows[: args.limit]:
        print(f"{d:>+13,.0f} {a:>11,.0f} {b:>11,.0f}  {sample or k}")
