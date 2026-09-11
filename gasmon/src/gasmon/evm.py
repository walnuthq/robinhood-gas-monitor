"""Pure EVM arithmetic: no I/O, no database.

Everything here is a function of data already fetched, which is what makes the
gas decomposition testable and the identity checks meaningful.
"""

import hashlib

from .rpc import h2i

# ArbOS internal transaction: opens every Nitro block, reports gasUsed 0 while
# its trace has children. Never a user transaction, always breaks the identity.
ARBOS_INTERNAL_TYPE = 0x6A
# Arbitrum deposit/retryable types: intrinsic gas does not follow the L1 formula.
ARB_NONSTANDARD = {0x64, 0x65, 0x66, 0x68, 0x69}


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

def delegate_of(code_hex):
    """EIP-7702 accounts carry a 23-byte designator, 0xef0100 || address, and
    execute the code at that address instead. The designator is what eth_getCode
    returns, so verification has to be looked up on the target."""
    c = (code_hex or "0x")[2:]
    return "0x" + c[6:46].lower() if len(c) == 46 and c[:6].lower() == "ef0100" else None

def is_precompile(addr):
    try:
        return addr is not None and 0 < int(addr, 16) < 0x10000
    except ValueError:
        return False

def walk(frame, tx_hash, rows, depth=0, parent=None):
    """Flatten a callTracer tree into frame rows, computing exclusive gas.

    self_gas_raw is exact for every non-root frame. For the root it still
    contains intrinsic gas and any refund; collect_block adjusts it."""
    gas_used = h2i(frame.get("gasUsed"))
    kids = frame.get("calls") or []
    children_gas = sum(h2i(k.get("gasUsed")) for k in kids)
    idx = len(rows)
    to = (frame.get("to") or "").lower() or None
    inp = frame.get("input") or "0x"
    out = frame.get("output") or "0x"
    ftype = frame.get("type") or "CALL"
    created = ftype in ("CREATE", "CREATE2")
    code_len = max(len(out) // 2 - 1, 0) if created else None

    rows.append(
        {
            "tx_hash": tx_hash,
            "idx": idx,
            "depth": depth,
            "parent": parent,
            "type": ftype,
            "caller": (frame.get("from") or "").lower() or None,
            "to": to,
            "gas_used": gas_used,
            "self_gas_raw": gas_used - children_gas,
            "self_gas": gas_used - children_gas,  # adjusted for root later
            "selector": inp[:10] if len(inp) >= 10 else None,
            "reverted": 1 if frame.get("error") else 0,
            "code_len": code_len,
            "deposit_gas": (code_len * 200) if created else None,
            "is_precompile": 1 if is_precompile(to) else 0,
            "is_root": 1 if depth == 0 else 0,
        }
    )
    for k in kids:
        walk(k, tx_hash, rows, depth + 1, idx)
    return rows
