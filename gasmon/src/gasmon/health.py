"""Chain health: public, keyless signals that would have raised the alarm on the
2026-09-04 incident, collected so any window can be replayed.

Five sources, none needing traces:

  batches         every SequencerBatchDelivered on Ethereum - the batch poster's
                  heartbeat. Gaps are poster stalls.
  batch_decodes   a sample of those batches decoded to the newest L2 block they
                  carry. Block time vs Ethereum time is the posting delay: how far
                  the chain's data is from reaching L1.
  l1_blocks       sampled Ethereum headers - base fee and utilisation.
  oracle_tx       every Chainlink OCR2 NewTransmission on Robinhood Chain. Block
                  time minus the report's observationsTimestamp is how long a
                  finished transaction took to get in: the write-path clock.
  l2_samples      sampled Robinhood receipts - successful vs reverted, and ERC-4337
                  bundles that failed.

Alerts are evaluated from those tables using only what was known at each moment,
so a replay shows what a live monitor would have done and when. The rules and why
they are what they are: spec/robinhood-chain-2026-09-04-incident.md, sections 7-8.
"""

import bisect
import json
import statistics
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from .rpc import Rpc, RpcError, h2i

# Robinhood Chain (4663) on Ethereum mainnet, from docs.robinhood.com/chain/protocol-contracts
SEQUENCER_INBOX = "0xbd0d173eeb87d57a09521c24388a12789f33ba96"
TOPIC_BATCH_DELIVERED = "0x7394f4a19a13c7b92b5bb71033245305946ef78452f7b4986ac1390b5df4ebd7"
# Chainlink OCR2 NewTransmission(uint32,int192,address,uint32,int192[],bytes,int192,bytes32,uint40)
TOPIC_OCR_TRANSMISSION = "0xc797025feeeaf2cd924c99e9205acb8ec04d5cad21c41ce637a38fb6dee6016a"
ENTRYPOINTS = ("0x4337084d9e255ff0702461cf8895ce9e3b5ff108",   # ERC-4337 v0.8
               "0x0000000071727de22e5e9d8baf0edac6f37da032")   # v0.7
ARBOS_INTERNAL_TYPE = 0x6A

L1_RPC_DEFAULT = "https://eth.drpc.org"
L1_LOG_SPAN = 100        # keyless drPC refuses wider eth_getLogs ranges
L2_LOG_SPAN = 50_000     # the official Robinhood endpoint accepts this at any age
RECEIPTS_RPC_EXTRA = "https://robinhood.drpc.org"   # shares receipt sampling with --rpc
GAP_EDGE_SECONDS = 120   # batches either side of a gap this long are always decoded

SCHEMA = """
CREATE TABLE IF NOT EXISTS batches (
  seq INTEGER PRIMARY KEY, l1_block INTEGER, l1_ts INTEGER, tx_hash TEXT
);
CREATE INDEX IF NOT EXISTS ix_batches_ts ON batches(l1_ts);
CREATE TABLE IF NOT EXISTS batch_decodes (
  seq INTEGER PRIMARY KEY, selector TEXT, prev_count INTEGER, new_count INTEGER,
  newest_l2_block INTEGER, newest_l2_ts INTEGER, posting_delay_s INTEGER,
  blobs INTEGER, max_fee_per_gas INTEGER, max_fee_per_blob_gas INTEGER,
  reason TEXT                  -- sample | dense | gap_edge
);
CREATE TABLE IF NOT EXISTS l1_blocks (
  number INTEGER PRIMARY KEY, ts INTEGER, base_fee INTEGER, gas_used INTEGER,
  gas_limit INTEGER, blob_gas_used INTEGER, excess_blob_gas INTEGER
);
CREATE INDEX IF NOT EXISTS ix_l1_ts ON l1_blocks(ts);
CREATE TABLE IF NOT EXISTS oracle_tx (
  tx_hash TEXT, log_index INTEGER, block INTEGER, ts INTEGER, obs_ts INTEGER,
  delay_s INTEGER, aggregator TEXT, transmitter TEXT,
  PRIMARY KEY (tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS ix_oracle_ts ON oracle_tx(ts);
CREATE TABLE IF NOT EXISTS l2_samples (
  block INTEGER PRIMARY KEY, ts INTEGER, gas_used INTEGER, user_txs INTEGER,
  ok_txs INTEGER, reverted_txs INTEGER, reverted_gas INTEGER, l1_gas INTEGER,
  bundles_ok INTEGER, bundles_failed INTEGER
);
CREATE INDEX IF NOT EXISTS ix_l2_ts ON l2_samples(ts);
-- Which block ranges each log source has already fetched, so re-runs only ask
-- for what is missing.
CREATE TABLE IF NOT EXISTS coverage (source TEXT, from_block INTEGER, to_block INTEGER);
CREATE TABLE IF NOT EXISTS alerts (
  rule TEXT, severity TEXT, start_ts INTEGER, end_ts INTEGER, peak REAL,
  unit TEXT, detail TEXT, PRIMARY KEY (rule, start_ts)
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
"""


def parse_time(value):
    if value == "now":
        return int(time.time())
    return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp())


def iso(ts):
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def block_at(rpc, ts, lo, hi):
    """First block with timestamp >= ts, by binary search between lo and hi."""
    while lo < hi:
        mid = (lo + hi) // 2
        if h2i(rpc.call("eth_getBlockByNumber", [hex(mid), False])["timestamp"]) < ts:
            lo = mid + 1
        else:
            hi = mid
    return lo


def block_range(rpc, t_from, t_to):
    head = h2i(rpc.call("eth_blockNumber", []))
    head_ts = h2i(rpc.call("eth_getBlockByNumber", [hex(head), False])["timestamp"])
    t_to = min(t_to, head_ts)
    return block_at(rpc, t_from, 0, head), block_at(rpc, t_to, 0, head), t_to


def missing_ranges(con, source, lo, hi):
    """Sub-ranges of [lo, hi] not yet fetched for a log source."""
    covered = sorted(con.execute("SELECT from_block, to_block FROM coverage WHERE source = ?", (source,)))
    gaps, cursor = [], lo
    for a, b in covered:
        if b < cursor or a > hi:
            continue
        if a > cursor:
            gaps.append((cursor, a - 1))
        cursor = max(cursor, b + 1)
    if cursor <= hi:
        gaps.append((cursor, hi))
    return gaps


def fetch_logs(rpc, query, lo, hi, span, workers):
    """eth_getLogs over [lo, hi] in chunks, halving a chunk the endpoint refuses."""
    def chunk(bounds):
        a, b = bounds
        try:
            return rpc.call("eth_getLogs", [dict(query, fromBlock=hex(a), toBlock=hex(b))])
        except RpcError:
            if b - a < 10:
                raise
            mid = (a + b) // 2
            return chunk((a, mid)) + chunk((mid + 1, b))
    chunks = [(s, min(s + span - 1, hi)) for s in range(lo, hi + 1, span)]
    with ThreadPoolExecutor(max_workers=workers) as pool:
        return [lg for part in pool.map(chunk, chunks) for lg in part]


def block_timestamps(rpc, numbers, workers):
    """{block: timestamp} for many blocks, in batches. Blocks the node cannot
    return are left out rather than failing the run."""
    def get(chunk):
        try:
            return [(n, h2i(b["timestamp"])) for n, b in zip(chunk, rpc.batch([("eth_getBlockByNumber", [hex(n), False]) for n in chunk])) if b]
        except RpcError:
            return []
    chunks = [numbers[i:i + 25] for i in range(0, len(numbers), 25)]
    with ThreadPoolExecutor(max_workers=workers) as pool:
        return dict(pair for part in pool.map(get, chunks) for pair in part)


# ---------------------------------------------------------------- collection

def collect_batches(con, l1, t_from, t_to, workers):
    lo, hi, _ = block_range(l1, t_from, t_to)
    fetched = 0
    for a, b in missing_ranges(con, "batches", lo, hi):
        logs = fetch_logs(l1, {"address": SEQUENCER_INBOX, "topics": [TOPIC_BATCH_DELIVERED]}, a, b, L1_LOG_SPAN, workers)
        # Not every endpoint fills `blockTimestamp` (Robinhood's returns 0x0), so
        # never trust a zero: fetch those block times instead.
        stamps = block_timestamps(l1, sorted({h2i(lg["blockNumber"]) for lg in logs if not h2i(lg.get("blockTimestamp"))}), workers)
        rows = [(h2i(lg["topics"][1]), h2i(lg["blockNumber"]),
                 h2i(lg.get("blockTimestamp")) or stamps.get(h2i(lg["blockNumber"])), lg["transactionHash"]) for lg in logs]
        con.executemany("INSERT OR IGNORE INTO batches VALUES (?,?,?,?)", [r for r in rows if r[2]])
        if all(r[2] for r in rows):
            con.execute("INSERT INTO coverage VALUES ('batches', ?, ?)", (a, b))
        con.commit()
        fetched += len(logs)
    print(f"  batches: {fetched:,} new, {con.execute('SELECT COUNT(*) FROM batches').fetchone()[0]:,} stored")


def choose_decodes(con, t_from, t_to, every, dense):
    """Which batches to decode: one per `every` seconds, all of them inside dense
    windows, and the batches either side of every long gap - a backlog alert
    needs to know exactly what had been posted when the poster went quiet."""
    rows = con.execute("SELECT seq, l1_ts FROM batches WHERE l1_ts BETWEEN ? AND ? ORDER BY seq", (t_from, t_to)).fetchall()
    want = {}
    slot = None
    for seq, ts in rows:
        if any(a <= ts <= b for a, b in dense):
            want[seq] = "dense"
        elif slot is None or ts >= slot + every:
            want.setdefault(seq, "sample")
            slot = ts - ts % every
    for (s0, t0), (s1, t1) in zip(rows, rows[1:]):
        if t1 - t0 >= GAP_EDGE_SECONDS:
            want.setdefault(s0, "gap_edge")
            want.setdefault(s1, "gap_edge")
    have = {s for (s,) in con.execute("SELECT seq FROM batch_decodes")}
    return {s: r for s, r in want.items() if s not in have}


def collect_decodes(con, l1, l2, t_from, t_to, every, dense, workers):
    todo = choose_decodes(con, t_from, t_to, every, dense)
    txs = dict(con.execute("SELECT seq, tx_hash FROM batches"))
    seqs = sorted(todo)

    def decode(seq):
        tx = l1.call("eth_getTransactionByHash", [txs[seq]])
        data = bytes.fromhex(tx["input"][10:])
        # Both batch entry points seen on this chain start
        # (sequenceNumber, afterDelayedMessagesRead, gasRefunder, prevMessageCount, newMessageCount).
        prev_count = int.from_bytes(data[96:128], "big")
        new_count = int.from_bytes(data[128:160], "big")
        return seq, tx, prev_count, new_count

    done = 0
    for i in range(0, len(seqs), 200):
        with ThreadPoolExecutor(max_workers=workers) as pool:
            decoded = list(pool.map(decode, seqs[i:i + 200]))
        newest = [nc - 1 for _, _, _, nc in decoded]
        blocks = l2.batch([("eth_getBlockByNumber", [hex(n), False]) for n in newest])
        stamps = {n: h2i(b["timestamp"]) for n, b in zip(newest, blocks) if b}
        decoded = [d for d in decoded if d[3] - 1 in stamps]   # retried on the next run
        l1_ts = dict(con.execute(f"SELECT seq, l1_ts FROM batches WHERE seq IN ({','.join('?' * len(decoded))})",
                                 [d[0] for d in decoded]))
        con.executemany("INSERT OR REPLACE INTO batch_decodes VALUES (?,?,?,?,?,?,?,?,?,?,?)", [
            (seq, tx["input"][:10], pc, nc, nc - 1, stamps[nc - 1], l1_ts[seq] - stamps[nc - 1],
             len(tx.get("blobVersionedHashes") or []), h2i(tx.get("maxFeePerGas")), h2i(tx.get("maxFeePerBlobGas")), todo[seq])
            for seq, tx, pc, nc in decoded])
        con.commit()
        done += len(decoded)
    print(f"  batch decodes: {done:,} new, {con.execute('SELECT COUNT(*) FROM batch_decodes').fetchone()[0]:,} stored")


def sample_blocks(lo, hi, stride, dense_blocks, dense_stride):
    picks = set(range(lo - lo % stride + stride, hi + 1, stride))
    for a, b in dense_blocks:
        picks.update(range(max(a, lo), min(b, hi) + 1, dense_stride))
    return sorted(picks)


def collect_l1_blocks(con, l1, t_from, t_to, every, dense, workers):
    lo, hi, _ = block_range(l1, t_from, t_to)
    dense_blocks = [block_range(l1, a, b)[:2] for a, b in dense]
    have = {n for (n,) in con.execute("SELECT number FROM l1_blocks")}
    todo = [n for n in sample_blocks(lo, hi, max(1, every // 12), dense_blocks, 1) if n not in have]

    def get(n):
        b = l1.call("eth_getBlockByNumber", [hex(n), False])
        return (n, h2i(b["timestamp"]), h2i(b.get("baseFeePerGas")), h2i(b["gasUsed"]), h2i(b["gasLimit"]),
                h2i(b.get("blobGasUsed")), h2i(b.get("excessBlobGas")))
    for i in range(0, len(todo), 500):
        with ThreadPoolExecutor(max_workers=workers) as pool:
            con.executemany("INSERT OR IGNORE INTO l1_blocks VALUES (?,?,?,?,?,?,?)", list(pool.map(get, todo[i:i + 500])))
        con.commit()
    print(f"  ethereum blocks: {len(todo):,} new, {con.execute('SELECT COUNT(*) FROM l1_blocks').fetchone()[0]:,} stored")


def collect_oracles(con, l2, t_from, t_to, workers):
    lo, hi, _ = block_range(l2, t_from, t_to)
    fetched = 0
    for a, b in missing_ranges(con, "oracle_tx", lo, hi):
        logs = fetch_logs(l2, {"topics": [TOPIC_OCR_TRANSMISSION]}, a, b, L2_LOG_SPAN, workers)
        # The official endpoint returns `blockTimestamp` on every log but as 0x0
        # for history, so block times are fetched rather than trusted.
        stamps = block_timestamps(l2, sorted({h2i(lg["blockNumber"]) for lg in logs if not h2i(lg.get("blockTimestamp"))}), workers)
        rows = []
        for lg in logs:
            data = bytes.fromhex(lg["data"][2:])
            # data words: answer, transmitter, observationsTimestamp, ...
            obs = int.from_bytes(data[64:96], "big")
            ts = h2i(lg.get("blockTimestamp")) or stamps.get(h2i(lg["blockNumber"]))
            if not ts:
                continue   # block time unavailable; the range stays uncovered below
            rows.append((lg["transactionHash"], h2i(lg["logIndex"]), h2i(lg["blockNumber"]), ts, obs, ts - obs,
                         lg["address"].lower(), "0x" + data[44:64].hex()))
        con.executemany("INSERT OR IGNORE INTO oracle_tx VALUES (?,?,?,?,?,?,?,?)", rows)
        if len(rows) == len(logs):
            con.execute("INSERT INTO coverage VALUES ('oracle_tx', ?, ?)", (a, b))
        con.commit()
        fetched += len(rows)
    print(f"  chainlink transmissions: {fetched:,} new, {con.execute('SELECT COUNT(*) FROM oracle_tx').fetchone()[0]:,} stored")


def collect_l2_samples(con, l2, receipts_rpc, t_from, t_to, every, dense, dense_every, workers):
    lo, hi, t_to = block_range(l2, t_from, t_to)
    rate = (hi - lo) / max(t_to - t_from, 1)
    dense_blocks = [block_range(l2, a, b)[:2] for a, b in dense]
    have = {n for (n,) in con.execute("SELECT block FROM l2_samples")}
    todo = [n for n in sample_blocks(lo, hi, max(1, round(every * rate)), dense_blocks, max(1, round(dense_every * rate)))
            if n not in have]

    def get(chunk):
        try:
            res = receipts_rpc.batch([c for n in chunk for c in (("eth_getBlockByNumber", [hex(n), False]), ("eth_getBlockReceipts", [hex(n)]))])
        except RpcError:
            return []   # throttled past the retry budget; the next run fills it
        rows = []
        for k, n in enumerate(chunk):
            block, receipts = res[2 * k], res[2 * k + 1]
            if not block or receipts is None:
                continue   # the node could not answer; the next run retries it
            user = [r for r in receipts if h2i(r.get("type")) != ARBOS_INTERNAL_TYPE]
            ok = [r for r in user if h2i(r.get("status")) == 1]
            to_ep = [r for r in user if (r.get("to") or "").lower() in ENTRYPOINTS]
            rows.append((n, h2i(block["timestamp"]), h2i(block["gasUsed"]), len(user), len(ok), len(user) - len(ok),
                         sum(h2i(r["gasUsed"]) for r in user if h2i(r.get("status")) == 0),
                         sum(h2i(r.get("gasUsedForL1")) for r in user),
                         sum(1 for r in to_ep if h2i(r.get("status")) == 1), sum(1 for r in to_ep if h2i(r.get("status")) == 0)))
        return rows
    # One block per request, spread over every receipts endpoint. Measured on
    # 2026-09-14: batches of 8 blocks to the official endpoint alone managed ~1
    # block/s under its 429s. Single-block requests (two calls, within keyless
    # drPC's batch limit) round-robined over both managed ~5-6.
    chunks = [[n] for n in todo]
    started = time.time()
    for i in range(0, len(chunks), 400):
        with ThreadPoolExecutor(max_workers=workers) as pool:
            con.executemany("INSERT OR IGNORE INTO l2_samples VALUES (?,?,?,?,?,?,?,?,?,?)",
                            [r for part in pool.map(get, chunks[i:i + 400]) for r in part])
        con.commit()
        done = min(i + 400, len(chunks))
        print(f"    {done:,}/{len(chunks):,} blocks, {done / max(time.time() - started, 1):.1f}/s", flush=True)
    stored = con.execute('SELECT COUNT(*) FROM l2_samples').fetchone()[0]
    print(f"  robinhood samples: {len(todo):,} wanted, {stored:,} stored")


# ---------------------------------------------------------------- alerts

def p90(values):
    v = sorted(values)
    return v[int(0.9 * (len(v) - 1))]


def episodes(fires, merge_gap, worst=max):
    """Merge (fire_ts, end_ts, peak) tuples of one rule into episodes when a new
    fire starts within `merge_gap` seconds of the previous episode's end. `worst`
    picks the episode's peak: the largest delay, or the smallest traffic ratio."""
    out = []
    for start, end, peak in sorted(fires):
        if out and start <= out[-1][1] + merge_gap:
            s, e, p = out[-1]
            out[-1] = (s, max(e, end), worst(peak, p))
        else:
            out.append((start, end, peak))
    return out


def rule_poster_silent(con, threshold=300):
    """No batch reached Ethereum for `threshold` seconds. Fires the moment the
    silence crosses the threshold, not when the next batch finally lands."""
    ts = [t for (t,) in con.execute("SELECT DISTINCT l1_ts FROM batches ORDER BY l1_ts")]
    fires = [(a + threshold, b, b - a) for a, b in zip(ts, ts[1:]) if b - a >= threshold]
    return episodes(fires, 0)


def rule_posting_backlog(con, threshold=600):
    """The newest L2 block that has reached Ethereum is `threshold` seconds old.
    Known exactly at every decoded batch, and - because the batches either side
    of every long gap are decoded - it keeps growing through a stall, so it fires
    during the stall rather than after it."""
    rows = con.execute("""SELECT b.l1_ts, d.newest_l2_ts, n.next_ts FROM batch_decodes d JOIN batches b USING (seq)
                          LEFT JOIN (SELECT seq, LEAD(l1_ts) OVER (ORDER BY seq) AS next_ts FROM batches) n USING (seq)
                          ORDER BY b.l1_ts, d.seq""").fetchall()
    fires = []
    for l1_ts, newest, next_ts in rows:
        age_now = l1_ts - newest
        if age_now >= threshold:
            fires.append((l1_ts, l1_ts, age_now))
        if next_ts and next_ts - l1_ts >= GAP_EDGE_SECONDS and next_ts - newest >= threshold:
            fires.append((max(l1_ts, newest + threshold), next_ts, next_ts - newest))
    return episodes(fires, 600)


def rule_poster_headroom(con, threshold=240, window=7200, slot=1200):
    """The poster has no slack: the median posting delay over the past two hours
    is `threshold` seconds or more. A standing condition, not an alarm: over
    Sep 1-14 it held most US afternoons with nothing following, and on Sep 4 it
    lapsed from 10:40 and re-armed only at 12:40, after the stall. (The incident
    analysis used a six-hour window, which held continuously from Sep 3 12:00.)"""
    rows = con.execute("""SELECT b.l1_ts, d.posting_delay_s FROM batch_decodes d JOIN batches b USING (seq)
                          ORDER BY b.l1_ts""").fetchall()
    slots = {}
    for ts, delay in rows:
        slots.setdefault(ts - ts % slot, delay)          # first decoded batch per slot, so dense windows don't dominate
    keys = sorted(slots)
    fires = []
    for k in keys:
        trailing = [slots[x] for x in keys[bisect.bisect_left(keys, k - window + slot):bisect.bisect_right(keys, k)]]
        if len(trailing) >= window // slot // 2:
            med = statistics.median(trailing)
            if med >= threshold:
                fires.append((k + slot, k + slot, med))
    return episodes(fires, slot)


def rule_l1_fee_spike(con, ratio=5.0):
    """Ethereum's base fee is `ratio` times its level 5-15 minutes earlier.
    Context rather than an alert: Sep 11 had the same spike and nothing broke."""
    rows = con.execute("SELECT ts, base_fee FROM l1_blocks WHERE base_fee > 0 ORDER BY ts").fetchall()
    ts = [r[0] for r in rows]
    fires = []
    for t, fee in rows:
        ref = [f for _, f in rows[bisect.bisect_left(ts, t - 900):bisect.bisect_right(ts, t - 300)]]
        if len(ref) >= 2 and fee >= ratio * statistics.median(ref):
            fires.append((t, t, fee / statistics.median(ref)))
    return episodes(fires, 900)


def rule_write_path(con, threshold=120, min_n=5, bin_s=300):
    """Transactions are being dropped at ingress: in a five-minute bin, the 90th
    percentile Chainlink inclusion delay is `threshold` seconds or more. Normal is
    ~13 s; a dropped transmission lands on a later re-broadcast, 60 s steps apart.
    Fires when the bin closes."""
    bins = {}
    for ts, delay in con.execute("SELECT ts, delay_s FROM oracle_tx"):
        bins.setdefault(ts - ts % bin_s, []).append(delay)
    fires = [(k + bin_s, k + bin_s, p90(v)) for k, v in bins.items() if len(v) >= min_n and p90(v) >= threshold]
    return episodes(fires, 2 * bin_s)


def rule_user_impact(con, drop=0.5, bin_s=300, baseline_bins=24, min_n=5, sustained=2):
    """Users are affected: successful transactions per sampled block stay below
    `drop` of their median over the previous two hours for `sustained`
    consecutive five-minute bins.

    One bin is not enough. With a receipt sample per minute a bin holds five
    blocks, and per-block counts swing so much that a single bin fell below half
    the median 53 times across Sep 1-14, on 12 days other than Sep 4. Two bins in
    a row happened only during the incident. That persistence requirement was set
    after looking at that fortnight, so it still needs checking on data it has
    not seen."""
    bins = {}
    for ts, ok in con.execute("SELECT ts, ok_txs FROM l2_samples"):
        bins.setdefault(ts - ts % bin_s, []).append(ok)
    means = {k: statistics.mean(v) for k, v in bins.items() if len(v) >= min_n}
    keys = sorted(means)
    ratio = {}
    for i, k in enumerate(keys):
        prior = [means[x] for x in keys[max(0, i - baseline_bins):i] if x >= k - baseline_bins * bin_s]
        if len(prior) >= baseline_bins // 2:
            base = statistics.median(prior)
            if base > 0:
                ratio[k] = means[k] / base
    fires = []
    for k in keys:
        run = [k - j * bin_s for j in range(sustained)]
        if all(r in ratio and ratio[r] < drop for r in run):
            fires.append((k + bin_s, k + bin_s, max(ratio[r] for r in run)))
    return episodes(fires, 2 * bin_s, worst=min)


def rule_bundler_failures(con, threshold=1.0, bin_s=300, min_n=5):
    """ERC-4337 bundles are failing at scale: at least `threshold` failed bundle
    per sampled block over five minutes (normal is ~0.1). On Sep 4 every failure
    sampled was AA25 - a bundler re-sending an operation that had already landed."""
    bins = {}
    for ts, failed in con.execute("SELECT ts, bundles_failed FROM l2_samples"):
        bins.setdefault(ts - ts % bin_s, []).append(failed)
    fires = [(k + bin_s, k + bin_s, statistics.mean(v)) for k, v in bins.items()
             if len(v) >= min_n and statistics.mean(v) >= threshold]
    return episodes(fires, 2 * bin_s)


RULES = [
    # name, severity, unit, function
    ("poster_headroom", "watch", "s", rule_poster_headroom),
    ("poster_silent", "warn", "s", rule_poster_silent),
    ("posting_backlog", "warn", "s", rule_posting_backlog),
    ("l1_fee_spike", "context", "x", rule_l1_fee_spike),
    ("write_path", "page", "s", rule_write_path),
    ("bundler_failures", "impact", "per block", rule_bundler_failures),
    ("user_impact", "impact", "x", rule_user_impact),
]


def evaluate_alerts(con):
    con.execute("DELETE FROM alerts")
    for name, severity, unit, fn in RULES:
        eps = fn(con)
        con.executemany("INSERT OR REPLACE INTO alerts VALUES (?,?,?,?,?,?,?)",
                        [(name, severity, s, e, round(p, 2), unit, None) for s, e, p in eps])
        print(f"  {name:17} {severity:8} {len(eps):3d} episodes" +
              (f", first {iso(eps[0][0])}" if eps else ""))
    con.commit()


# ---------------------------------------------------------------- command

def cmd_health(args):
    import sqlite3
    con = sqlite3.connect(args.db, timeout=60)
    con.executescript(SCHEMA)

    t_to = parse_time(args.to_time)
    t_from = parse_time(args.from_time) if args.from_time else t_to - 86400
    dense = [tuple(parse_time(x) for x in w.split("/")) for w in (args.dense or [])]
    l1 = Rpc([args.l1_rpc], tries=10)
    l2 = Rpc([args.rpc], tries=12)
    receipts_rpc = Rpc([args.rpc] + [u for u in (args.receipts_rpc or [RECEIPTS_RPC_EXTRA]) if u != args.rpc], tries=12)
    started = time.time()

    if not args.alerts_only:
        print(f"collecting {iso(t_from)} .. {iso(t_to)} into {args.db}"
              + (f", dense windows: {', '.join(iso(a) + '/' + iso(b) for a, b in dense)}" if dense else ""))
        steps = {
            "batches": lambda: collect_batches(con, l1, t_from, t_to, args.workers),
            "decodes": lambda: collect_decodes(con, l1, l2, t_from, t_to, args.decode_every, dense, args.workers),
            "l1": lambda: collect_l1_blocks(con, l1, t_from, t_to, args.l1_every, dense, args.workers),
            "oracles": lambda: collect_oracles(con, l2, t_from, t_to, args.workers),
            "l2": lambda: collect_l2_samples(con, l2, receipts_rpc, t_from, t_to, args.l2_every, dense,
                                             args.dense_l2_every, args.receipt_workers),
        }
        for name, step in steps.items():
            if name in (args.skip or []):
                continue
            t0 = time.time()
            step()
            print(f"    ({time.time() - t0:.0f}s)")

        # Describes the last collection, so --alerts-only must leave it alone: the
        # page prints collected_at as the data's freshness.
        meta = {
            "collected_at": str(int(time.time())),
            "chain_id": "4663",
            "l1_rpc": args.l1_rpc, "l2_rpc": args.rpc,
            "requested_from": str(t_from), "requested_to": str(t_to),
            "dense_windows": json.dumps(dense),
            "decode_every_s": str(args.decode_every), "l1_every_s": str(args.l1_every),
            "l2_every_s": str(args.l2_every), "dense_l2_every_s": str(args.dense_l2_every),
        }
        con.executemany("INSERT OR REPLACE INTO meta VALUES (?,?)", list(meta.items()))
    con.execute("INSERT OR REPLACE INTO meta VALUES ('alerts_evaluated_at', ?)", (str(int(time.time())),))
    print("evaluating alerts...")
    evaluate_alerts(con)
    con.commit()
    print(f"done in {time.time() - started:.0f}s")
