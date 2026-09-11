"""Tracing a block and decomposing its gas."""

import time
from concurrent.futures import ThreadPoolExecutor

from .db import db_open
from .evm import (ARBOS_INTERNAL_TYPE, code_id, delegate_of, intrinsic_gas,
                  is_precompile, walk)
from .report import cmd_verify
from .rpc import Rpc, RpcError, h2i


def collect_block(rpc, trace_rpc, number):
    """Fetch, trace and decompose one block. Returns a dict ready for insert,
    or raises. Pure function of the node - no DB access."""
    blk = rpc.call("eth_getBlockByNumber", [hex(number), True])
    if blk is None:
        raise RpcError(f"block {number} not found")
    txs = blk["transactions"]
    block_gas = h2i(blk["gasUsed"])

    if not txs:
        return {"block": {"number": number, "timestamp": h2i(blk["timestamp"]),
                          "base_fee": h2i(blk.get("baseFeePerGas")), "gas_used": block_gas,
                          "tx_count": 0, "sum_receipt_gas": 0, "sum_root_gas": 0,
                          "sum_self_raw": 0, "sum_intrinsic": 0, "neg_self_frames": 0,
                          "neg_root_residual": 0},
                "txs": [], "frames": []}

    traced = trace_rpc.call("debug_traceBlockByNumber", [hex(number), {"tracer": "callTracer"}])
    receipts = rpc.batch([("eth_getTransactionReceipt", [t["hash"]]) for t in txs])

    by_hash = {t["hash"]: t for t in txs}
    rcpt_by_hash = {r["transactionHash"]: r for r in receipts if r}
    trace_by_hash = {e.get("txHash"): e.get("result") for e in traced}

    tx_rows, frame_rows = [], []
    sum_receipt = sum_root = sum_self_raw = sum_intrinsic = 0
    neg_self = neg_root = 0

    for i, tx in enumerate(txs):
        h = tx["hash"]
        ttype = h2i(tx.get("type"))
        rcpt = rcpt_by_hash.get(h)
        root = trace_by_hash.get(h)
        if rcpt is None or root is None:
            raise RpcError(f"missing receipt or trace for {h}")

        receipt_gas = h2i(rcpt["gasUsed"])
        sum_receipt += receipt_gas

        # ArbOS internal transaction: gasUsed 0 with non-zero children. Recorded
        # for completeness, never attributed.
        if ttype == ARBOS_INTERNAL_TYPE:
            tx_rows.append({"hash": h, "block": number, "idx": i, "type": ttype,
                            "sender": (tx.get("from") or "").lower(),
                            "recipient": (tx.get("to") or "").lower() or None,
                            "status": h2i(rcpt.get("status")), "receipt_gas": receipt_gas,
                            "gas_used_for_l1": h2i(rcpt.get("gasUsedForL1")),
                            "gas_price": h2i(rcpt.get("effectiveGasPrice")),
                            "calldata_len": max(len(tx.get("input", "0x")) // 2 - 1, 0),
                            "intrinsic": None, "intrinsic_standard": 0, "root_residual": None,
                            "refund_lb": 0})
            sum_root += h2i(root.get("gasUsed"))
            continue

        rows = walk(root, h, [])
        intrinsic, standard = intrinsic_gas(tx)
        l1_gas = h2i(rcpt.get("gasUsedForL1"))

        # The root frame carries intrinsic gas and any refund. Strip intrinsic so
        # the entry contract is charged for its own execution only. What remains
        # is (root's own execution - refund); callTracer cannot separate those two,
        # so a negative value means refunds exceeded the root's own opcodes.
        # receipt.gasUsed = intrinsic + L1 data + execution - refunds. Strip the
        # two non-execution terms before the root frame is attributed to anyone.
        root_residual = rows[0]["self_gas_raw"] - intrinsic - l1_gas
        # A negative residual means EIP-3529 refunds exceeded the entry
        # contract's own opcodes. Attributing a negative number would let a
        # contract subtract from its own ranking, so clamp at zero and carry the
        # refund as its own quantity. self_gas_raw keeps the exact arithmetic.
        refund_lb = max(-root_residual, 0)
        rows[0]["self_gas"] = max(root_residual, 0)
        if root_residual < 0:
            neg_root += 1

        neg_self += sum(1 for r in rows[1:] if r["self_gas_raw"] < 0)
        sum_root += h2i(root.get("gasUsed"))
        sum_self_raw += sum(r["self_gas_raw"] for r in rows)
        sum_intrinsic += intrinsic

        for r in rows:
            r["block"] = number
        frame_rows.extend(rows)
        tx_rows.append({"hash": h, "block": number, "idx": i, "type": ttype,
                        "sender": (tx.get("from") or "").lower(),
                        "recipient": (tx.get("to") or "").lower() or None,
                        "status": h2i(rcpt.get("status")), "receipt_gas": receipt_gas,
                        "gas_used_for_l1": h2i(rcpt.get("gasUsedForL1")),
                        "gas_price": h2i(rcpt.get("effectiveGasPrice")),
                        "calldata_len": max(len(tx.get("input", "0x")) // 2 - 1, 0),
                        "intrinsic": intrinsic, "intrinsic_standard": 1 if standard else 0,
                        "root_residual": root_residual, "refund_lb": refund_lb})

    return {
        "block": {"number": number, "timestamp": h2i(blk["timestamp"]),
                  "base_fee": h2i(blk.get("baseFeePerGas")), "gas_used": block_gas,
                  "tx_count": len(txs), "sum_receipt_gas": sum_receipt,
                  "sum_root_gas": sum_root, "sum_self_raw": sum_self_raw,
                  "sum_intrinsic": sum_intrinsic, "neg_self_frames": neg_self,
                  "neg_root_residual": neg_root},
        "txs": tx_rows, "frames": frame_rows,
    }

CODE_BATCH = 50


def resolve_code(fast_rpc, archive_rpc, con, addrs, block):
    """Populate the code cache. Code is read AT the analysed block where
    possible - CREATE2 redeploys and EIP-7702 delegations make 'latest' wrong
    for history.

    Endpoint choice dominates collection time. Measured on one block of 40
    addresses: the trace endpoint answered `eth_getCode` in 16.5s for a batch of
    25 and 66.5s for 40, while the official endpoint answered all 40 in 2.6s.
    But the official node keeps no state beyond a few hours, so the order is:
    fast node at the block, fast node at `latest`, archive node at the block.
    Only the last is correct *and* slow, so it is the last resort."""
    have = {r[0] for r in con.execute("SELECT addr FROM code")}
    todo = sorted(a for a in addrs if a and a not in have and not is_precompile(a))
    stale = 0
    for i in range(0, len(todo), CODE_BATCH):
        chunk = todo[i:i + CODE_BATCH]
        read_at = block
        codes = _get_code(fast_rpc, chunk, hex(block))
        if codes is None:
            # No state at that height on the fast node. `latest` is very nearly
            # always the same bytecode and costs a fraction of the archive read.
            codes = _get_code(fast_rpc, chunk, "latest")
            if codes is not None:
                read_at = -1
                stale += len(chunk)
        if codes is None:
            codes = _get_code(archive_rpc, chunk, hex(block))
        if codes is None:
            raise RpcError(f"could not resolve code for {len(chunk)} addresses")
        con.executemany(
            "INSERT OR REPLACE INTO code VALUES (?,?,?,?,?)",
            [(a, code_id(bytes.fromhex((c or "0x")[2:])), max(len(c or "0x") // 2 - 1, 0),
              read_at, delegate_of(c))
             for a, c in zip(chunk, codes)])
        con.commit()
    if stale:
        print(f"  note: {stale} addresses resolved at 'latest' rather than block "
              f"{block} (no state at that height on the fast node)")


def _get_code(rpc, chunk, block_tag):
    """A batch of eth_getCode, or None if this node cannot answer it."""
    try:
        codes = rpc.batch([("eth_getCode", [a, block_tag]) for a in chunk])
    except RpcError:
        return None
    return None if any(c is None for c in codes) else codes

def cmd_collect(args):
    rpc = Rpc([args.rpc] + ([args.trace_rpc] if args.trace_rpc != args.rpc else []))
    trace_rpc = Rpc([args.trace_rpc])
    con = db_open(args.db)

    if args.last:
        head = h2i(rpc.call("eth_blockNumber", []))
        end = head - 10  # stay clear of the tip
        blocks = list(range(end - args.last + 1, end + 1))
    else:
        blocks = list(range(args.from_block, args.to_block + 1))
    if args.stride > 1:
        blocks = blocks[:: args.stride]

    done = {r[0] for r in con.execute("SELECT number FROM blocks")}
    blocks = [b for b in blocks if b not in done]
    if not blocks:
        print("nothing to do - all requested blocks already collected")
        return
    print(f"collecting {len(blocks)} blocks ({blocks[0]}..{blocks[-1]}, stride {args.stride}) "
          f"into {args.db}")

    t0 = time.time()
    ok = failed = 0
    addrs = set()
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(collect_block, rpc, trace_rpc, b): b for b in blocks}
        for fut, bn in list(futures.items()):
            try:
                res = fut.result()
            except Exception as e:
                failed += 1
                print(f"  block {bn}: FAILED {str(e)[:110]}")
                continue
            b = res["block"]
            con.execute(
                "INSERT OR REPLACE INTO blocks VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                (b["number"], b["timestamp"], b["base_fee"], b["gas_used"], b["tx_count"],
                 b["sum_receipt_gas"], b["sum_root_gas"], b["sum_self_raw"], b["sum_intrinsic"],
                 b["neg_self_frames"], b["neg_root_residual"], int(time.time())))
            con.executemany(
                "INSERT OR REPLACE INTO txs VALUES (:hash,:block,:idx,:type,:sender,:recipient,"
                ":status,:receipt_gas,:gas_used_for_l1,:gas_price,:calldata_len,:intrinsic,"
                ":intrinsic_standard,:root_residual,:refund_lb)", res["txs"])
            con.executemany(
                "INSERT OR REPLACE INTO frames (block,tx_hash,idx,depth,parent,type,caller,addr,"
                "gas_used,self_gas_raw,self_gas,selector,reverted,code_len,deposit_gas,"
                "is_precompile,is_root) VALUES (:block,:tx_hash,:idx,:depth,:parent,:type,:caller,"
                ":to,:gas_used,:self_gas_raw,:self_gas,:selector,:reverted,:code_len,:deposit_gas,"
                ":is_precompile,:is_root)", res["frames"])
            con.commit()
            addrs.update(f["to"] for f in res["frames"])
            ok += 1
            if ok % 25 == 0:
                print(f"  {ok}/{len(blocks)} blocks, {time.time()-t0:.0f}s")

    print(f"collected {ok} blocks, {failed} failed, {time.time()-t0:.0f}s")
    print("resolving code identity...")
    # Fast node first, archive only where it has to be - see resolve_code.
    resolve_code(Rpc([args.rpc]), trace_rpc, con, addrs, max(blocks))
    con.execute("UPDATE frames SET code_id = (SELECT c.code_id FROM code c WHERE c.addr = frames.addr) "
                "WHERE code_id IS NULL")
    con.commit()
    n = con.execute("SELECT COUNT(*) FROM code").fetchone()[0]
    print(f"code cache: {n} addresses")
    cmd_verify(args, con)
