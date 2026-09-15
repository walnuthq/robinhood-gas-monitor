# gasmon

Per-block gas attribution for Robinhood Chain, and any Nitro/EVM chain whose RPC
serves `debug_traceBlockByNumber` with `callTracer`.

It answers: **which code burned the chain's gas, how much, and can we read its
source?** The background and the findings are in [`../spec/`](../spec/) —
start with [`robinhood-chain-recon.md`](../spec/robinhood-chain-recon.md).

## The idea in one paragraph

A call frame's `gasUsed` is *inclusive* — it contains everything its children
spent — so summing frames double-counts the same gas once per level of nesting
(4.79× on a 714-block Robinhood sample). The measurement that matters is
**exclusive self-gas**: `frame.gasUsed − Σ children.gasUsed`. gasmon computes
that for every frame, subtracts the terms that belong to no contract (intrinsic
gas, L1 data gas, refunds), and stores one row per frame. Everything else —
ranking, hourly rollups, spike-vs-baseline diffs — is a `GROUP BY` over that
table, so nothing needs re-tracing, which is the expensive part.

Because exclusive gas must re-sum to `block.gasUsed` exactly, the database is
self-checking. `gasmon verify` is a gate, not a report.

## Install

Python ≥ 3.9, no third-party dependencies (stdlib only: `urllib`, `sqlite3`,
`hashlib`, `concurrent.futures`).

```bash
cd gasmon
pip install -e .          # provides the `gasmon` command
```

Or run it without installing:

```bash
PYTHONPATH=src python3 -m gasmon --help
```

## Quickstart

```bash
# 1. Trace some blocks. Defaults target Robinhood Chain (4663).
gasmon collect --last 200 --db gas.db

# 2. The identity checks run automatically after collect; re-run any time.
gasmon verify --db gas.db

# 3. Resolve published sources for the code that actually matters, in gas order.
gasmon sources --limit 200 --db gas.db

# 4. Rank it.
gasmon top --limit 20 --db gas.db
```

```
     self gas   share    calls   gas/call  addrs    size  src  contract
  181,498,799   9.23%   16,417     11,055      1  18644B  yes  USDG (0x68184c44…)
  176,114,654   8.96%   27,283      6,455      1  24009B  yes  PoolManager (0x8366a39c…)
  116,459,490   5.93%   12,235      9,518      1   6961B  yes  aeWETH (0xc6b81b42…)
   91,374,311   4.65%    9,228      9,901      1  11614B  yes  Stock (0xb35490d6…)
```

## Commands

| | |
| --- | --- |
| `collect` | Trace blocks and decompose their gas. `--last N`, or `--from-block`/`--to-block` with optional `--stride` to sample. Re-running skips blocks already stored. `--exact-code` reads code from the archive at the analysed block before falling back to `latest` — use it for windows older than a few hours. |
| `verify` | Run the five identity checks and print the gas decomposition. |
| `sources` | Resolve Sourcify verification for the top `--limit` code identities, by gas. |
| `top` | Rank code identities by self-gas. `--range LO-HI` to scope. |
| `diff` | Compare two block ranges — the spike-vs-baseline view. `--per tx` (default) shows what changed in the mix; `--per block` shows whose volume came or went, which a proportional loss of traffic leaves invisible per transaction. |
| `health` | Collect chain-health signals into a separate database and evaluate alert rules on them. Needs no traces; see [Chain health](#chain-health). |

Sampling is the intended mode for anything longer than a few minutes of chain
time. An hour of Robinhood Chain is ~35,600 blocks at ~7 s/block to trace; gas is
concentrated enough (top 10 code identities ≈ 41% of gas) that a stride sample
ranks the leaders correctly at a fraction of the cost.

```bash
gasmon collect --from-block 58380817 --to-block 58416417 --stride 100
```

## Chain health

`gasmon health` collects the public signals that would have alerted on the
2026-09-04 incident, and evaluates alert rules on them. It shares nothing with the
gas tables and writes its own database (default `health.db`). It needs no trace
endpoint: every source is logs, headers or receipts, all keyless. The evidence for
each rule is in
[`../spec/robinhood-chain-2026-09-04-incident.md`](../spec/robinhood-chain-2026-09-04-incident.md),
sections 7 and 8.

```bash
gasmon health --db health.db --from 2026-09-01T00:00:00Z --to now \
  --dense 2026-09-04T11:30:00Z/2026-09-04T14:30:00Z
```

| Table | Source | Collected |
| --- | --- | --- |
| `batches` | `SequencerBatchDelivered` on Ethereum (SequencerInbox `0xBd0D…ba96`) | every one |
| `batch_decodes` | batch calldata → newest L2 block → posting delay | one per `--decode-every` s, every batch in `--dense` windows, and the batches either side of every gap ≥ 120 s |
| `l1_blocks` | Ethereum headers: base fee, utilisation, blob gas | one per `--l1-every` s, every block in dense windows |
| `oracle_tx` | Chainlink OCR2 `NewTransmission`: block time − `observationsTimestamp` | every one |
| `l2_samples` | Robinhood receipts: successful, reverted, failed ERC-4337 bundles | one block per `--l2-every` s, per `--dense-l2-every` s in dense windows |
| `alerts` | the rules below, evaluated over everything stored | recomputed every run |

Rules, in order of loudness. Each fires only on data available at the moment it
fires, so a replay is what a live monitor would have done:

The last two columns come from the Sep 1 00:00 – Sep 14 20:32 UTC backfill. Its
samples are listed in the incident spec's §8. "Outside" means starting outside Sep 4
12:30–17:15:

| Rule | Severity | Fires when | Sep 4 incident | Outside, Sep 1–14 |
| --- | --- | --- | --- | --- |
| `poster_headroom` | watch | median posting delay over the past 2 h ≥ 240 s (first decoded batch per 20-min slot) | 12:40 (lapsed 10:40–12:40) | 7 episodes on 6 days |
| `l1_fee_spike` | context | Ethereum base fee ≥ 5× the median 5–15 min earlier | 12:35:11 | 7 |
| `poster_silent` | warn | no batch reaches Ethereum for 300 s (fires at the 300th second) | 12:34:47 | 3 |
| `posting_backlog` | warn | the newest L2 block on Ethereum is ≥ 600 s old | 12:35:55 | 1 (Sep 4 09:20) |
| `write_path` | page | 5-min p90 Chainlink inclusion delay ≥ 120 s over ≥ 5 transmissions (fires as the bin closes) | 12:45 | none |
| `bundler_failures` | impact | ≥ 1 failed EntryPoint bundle per sampled block over 5 min | 12:50 | 1 |
| `user_impact` | impact | successful tx per block < 50% of the previous 2 h median, two 5-min bins running | 13:00 | none |

`bundler_failures` sits near its threshold in the first minutes, so its fire time
moves with the sampled blocks (a smoke run over other blocks fired at 12:40).
`user_impact` needs two bins in a row because one bin alone fired 53 times on 12
other days. That choice was made on this same fortnight and is untested
out of sample.

Re-runs are incremental: log sources record the block ranges they have fetched
(`coverage`), sampled sources skip rows already stored, and `--alerts-only`
re-evaluates without touching the network. It also leaves `meta` describing the
last collection (`collected_at` is what the page prints as freshness) and records
`alerts_evaluated_at` instead. `pnpm health:refresh` wraps this for the dashboard.

Endpoint facts this relies on, all measured 2026-09-14:

- Keyless `eth.drpc.org` serves Ethereum `eth_getLogs` over ≤ 100-block ranges,
  with a real `blockTimestamp`.
- Robinhood's official endpoint serves `eth_getLogs` over 50,000-block ranges at any
  age. It includes `blockTimestamp` too, but **as `0x0` for history**, so the
  collector fetches block times rather than trusting a zero.
- The official endpoint also answers parallel batches with 429s. Receipt sampling
  therefore sends single-block `eth_getBlockReceipts` requests round-robin over
  the official endpoint and `robinhood.drpc.org` (`--receipts-rpc`), six workers,
  with a larger retry budget. Batched requests to the official endpoint alone
  managed ~1 block/s. This layout sustained 5.8 blocks/s over 20,780 blocks on
  2026-09-14. A block that still fails is skipped and filled on the next run.

## Data model

Five tables and one view, at three grains.

**`frames` — one row per EVM execution context. The measurement.**

| column | meaning |
| --- | --- |
| `idx`, `depth`, `parent` | position in the call tree, preserved so it can be walked in SQL after flattening |
| `type` | `CALL` / `DELEGATECALL` / `STATICCALL` / `CREATE` / `CREATE2` |
| `caller` | storage context — the proxy, under `DELEGATECALL` |
| `addr` | **code that executed** — the implementation. What you optimise. |
| `gas_used` | inclusive, as the tracer reports it |
| `self_gas_raw` | exact exclusive arithmetic; what the checks run on |
| `self_gas` | attributable value, root-adjusted; what rankings use |
| `selector` | first 4 bytes of input — turns "expensive contract" into "expensive function" |
| `reverted`, `is_precompile`, `is_root` | flags |
| `code_len`, `deposit_gas` | `CREATE`/`CREATE2` only: bytes deployed and the flat 200/byte charge |
| `code_id` | back-filled join key to `code` |

**`txs` — one row per transaction.** Holds the non-execution terms that must not
be charged to a contract: `intrinsic`, `gas_used_for_l1`, `refund_lb`, plus
`root_residual` (the root frame's gas after those are stripped).

**`blocks` — one row per block.** Control totals the checks compare against.

**`code` — address → the code it ran, at the block it ran there.** Includes
`delegate`, the target of an EIP-7702 designator.

**`verification` — address grain, one row per `(addr, source)`.** Sourcify and
Blockscout can disagree without overwriting each other. Negative answers are
cached with `checked_at` so re-runs are cheap.

**`code_verification` — a VIEW at code grain.** Verification is really a property
of *code*: byte-identical runtime bytecode implies identical sources, settings
and immutables (immutables are baked into the bytecode, so differing values give
a different `code_id`). So one verified address proves the whole group, and this
view does the propagation — including across EIP-7702 designators to the
delegate. On a 714-block sample this made 18.9M gas across 59 never-verified
addresses analyzable; one lookup resolved a 54-address `BeaconProxy` group.

## What the checks mean

```
[PASS] receipts sum to block.gasUsed            receipts agree with the header
[PASS] root frames sum to block.gasUsed         the tracer agrees with the header
[PASS] exclusive gas re-sums to block.gasUsed   the frame walk conserves gas
[PASS] no negative self-gas below the root      no frame spent negative gas
[PASS] L1 data gas below 1% of block gas        L1 posting is not a major term
```

The first four are conservation laws and should never fail; a failure means the
frame walk or the tracer is wrong, and every number downstream is void.

**The fifth is a live tripwire, and it has fired.** On 2026-09-08 the chain
charged no L1 data gas at all; by 2026-09-11 it was 8.87% of gas on essentially
every transaction. L1 data gas is not execution and is not reducible by better
codegen, so a rising share directly weakens the case for compiler optimisation.
Watch it.

> **Correction, 2026-09-14.** That was a burst, not a trend. ArbOS's L1 pricer
> switches on for minutes at a time, several times a day, and 09-11 caught one.
> Sampled every ~20 minutes across 09-01 to 09-14 (962 blocks), L1 data gas is
> 0.18% of gas, and 0.016% without a single 38% block. A failure of this check
> means the sample contains a burst. Read the reported share; don't read it as a
> regime change. See the third §3 correction in
> [`robinhood-chain-recon.md`](../spec/robinhood-chain-recon.md).

## Operational notes

**Endpoints are not interchangeable.** The official Robinhood RPC serves `eth_*`
but **no `debug_*`**, and keeps **no historical state** beyond a few hours
(`eth_getCode` at ~14h back fails with "metadata is not found"). Tracing and
historical code reads both go to `--trace-rpc`.

```bash
gasmon collect --last 200 \
  --rpc https://rpc.mainnet.chain.robinhood.com \
  --trace-rpc https://rpc.ordofi.network
```

**History evaporates.** The free trace endpoint keeps roughly the last 2–3 days
(it advertises ~1.2M blocks). At ~856,000 blocks/day, anything older is
unreachable without a paid archive node — the September 2026 fee peak already is.
Collect continuously, or pay for archive.

> **Correction, 2026-09-14.** ordofi's retention is ~1.2M blocks, which is ~1.4
> days, not 2–3. The fee peak is **not** unreachable: `https://robinhood.drpc.org`
> traces any height back to launch, keylessly as of today, and its output passes
> `verify`. It is ~10× faster than ordofi (2.6 blocks/s at 4 workers). Two traps
> when using it as `--trace-rpc`:
>
> - **It returns HTTP 500 for any JSON-RPC batch of 5 or more.** `collect`
>   round-robins its `eth_*` batches (one receipt request per transaction) across
>   `--rpc` and `--trace-rpc`, so blocks whose batch lands on drPC report
>   `FAILED`. Re-run to fill them, since stored blocks are skipped. A paid drPC
>   key, or keeping batches off the trace endpoint, avoids this.
> - **Code resolves at `latest` for old windows.** The official `--rpc` has no
>   state at a days-old block, so `resolve_code` falls back to `latest` before
>   trying the archive. For a historical window, check `code.block_read = -1` and
>   prefer the archive read.
>
> For volume, use drPC's paid plan ($6 per million requests, flat across methods).
>
> *Later on 2026-09-14: both traps are fixed in the collector.* The RPC client now
> keeps a batch ceiling per endpoint, halving it whenever a batch is refused, so
> round-robined batches fit drPC's limit. Receipts come from one
> `eth_getBlockReceipts` per block where the node supports it. `--exact-code`
> reads the archive before `latest`. Re-collecting 11 blocks at 54,282,000–400
> went from 2 of 11 failed to 11 of 11 with identical gas totals, and 0 of 244
> addresses read at `latest`.

**Rate limits.** Both endpoints throttle; batches over ~40 get 429s. The client
round-robins and backs off. `--workers 4` is comfortable. Batch ceilings are
per endpoint and learned: a batch refused whole (HTTP 500, or an error object in
place of a result list) halves that endpoint's ceiling and is re-cut, so an
endpoint that only takes small batches still works in the rotation.

## Known limitations

- **Refunds cannot be separated from the root frame's own execution.**
  `callTracer` reports the post-refund receipt value at the root, so when EIP-3529
  refunds exceed the entry contract's own opcodes the residual goes negative. It
  is clamped to zero and the excess recorded as `refund_lb` rather than letting a
  contract subtract from its own ranking — 8.34% of gas on the 714-block sample.
  Exact arithmetic survives in `self_gas_raw`.
- **`code_id` is not the EVM keccak codehash.** It is a blake2b-128 of the runtime
  code, used purely as a grouping key, which avoids a keccak dependency. Don't
  expect it to match a block explorer.
- **Code is read at the analysed block**, not `latest`, so CREATE2 redeploys and
  7702 re-delegations can't corrupt history. If the node has no state at that
  height it falls back to `latest` and prints a warning. By default `latest` is
  tried before the archive, because the free archive answers `eth_getCode` slowly;
  `--exact-code` reverses that, and is the right choice against a fast archive.
  Rows read at `latest` carry `code.block_read = -1`.
- **Arbitrum deposit/retryable transaction types** (`0x64`–`0x69`) don't follow
  the L1 intrinsic-gas formula; they're flagged via `txs.intrinsic_standard = 0`.
  ArbOS internal transactions (`0x6a`) are recorded but never attributed.
- **Sourcify only.** Blockscout would likely add coverage but its API sits behind
  Cloudflare and returns 403 to scripted requests. The `verification` table is
  keyed by `(addr, source)` so adding it needs no migration.

## Layout

```
gasmon/
├── pyproject.toml
├── README.md
└── src/gasmon/
    ├── rpc.py        JSON-RPC client, endpoint selection
    ├── evm.py        pure arithmetic: intrinsic gas, the frame walk, code identity
    ├── db.py         schema and connection
    ├── collect.py    tracing and decomposition
    ├── sources.py    Sourcify resolution, EIP-7702 delegates
    ├── report.py     verify / top / diff
    ├── health.py     chain-health sources, alert rules
    └── cli.py        argument parsing
```

`evm.py` does no I/O, which is what makes the gas decomposition testable
independently of the network.
