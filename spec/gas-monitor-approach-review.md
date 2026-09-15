# Chain gas monitor: review of the per-block attribution approach

**Status:** internal review — 2026-09-08
**Subject:** the aggregation pipeline proposed for the feasibility check in
[robinhood-chain-gas-monitor.md](robinhood-chain-gas-monitor.md)

The proposed pipeline is: fetch every transaction in a block, run `soldb
list-contracts` on each to get the contracts touched and their gas, aggregate per
contract to rank the block's biggest gas eaters, then sum blocks to cover a period.

The shape is right — trace, attribute, aggregate. Three of the four steps as
specified produce wrong numbers, and two of them do so silently. Flaws 1–6, 9 and
10 were measured on Gnosis, which answers `debug_*` keylessly; block
**48,146,688** (`0x2dea900`, 22 transactions, 4,333,320 gas) unless stated
otherwise. The commands are in [Reproducing this](#reproducing-this).

**Update, 2026-09-08.** Flaws 7 and 8 — the two that were gating — have since been
measured directly on Robinhood Chain. **Flaw 7 is withdrawn** and **flaw 8 is
resolved**; both sections below now record what was found. That work also
re-measured several of the remaining flaws on the target chain, where they are
generally *worse* than on Gnosis: naive-aggregation inflation is 4.79× rather than
2.75×, and the scale problem is roughly 2× larger than estimated here.
[robinhood-chain-recon.md](robinhood-chain-recon.md) has those numbers and the
chain's gas model in full; this document is otherwise unchanged.

**Update, 2026-09-14.** Flaw 7 briefly looked re-opened when L1 pricing appeared
to switch on on 09-11. Archive history shows it was a burst: L1 data gas is well
under 1% of gas sampled across 09-01 to 09-14, so the withdrawal stands. Flaw 8's
pay-as-you-go recommendation is now measured: drPC serves archive traces, and
GetBlock's public endpoint does not. Notes are inline under each.

## Summary

| # | Flaw | Measured impact | Severity |
| --- | --- | --- | --- |
| 1 | `list-contracts` reports gas *remaining*, not gas used | numbers are meaningless | blocker |
| 2 | Frame gas is inclusive; naive summing double-counts | 2.75× inflation, ranking inverts | blocker |
| 3 | Keying on address instead of code identity | 6,311 addresses → 3,366 code identities | blocker, confirmed |
| 4 | Proxy vs. implementation attribution undecided | proxy shows 26,537 of its app's gas | high |
| 5 | Refunds produce negative self-gas | one frame at −7,684 | high |
| 6 | Intrinsic gas attributed to a contract | 14.5% of the block belongs to no contract | high |
| 7 | ~~Arbitrum folds L1 data cost into `gasUsed`~~ | L1 data gas ≤ 0.12% of gas, usually 0 | **withdrawn** |
| 8 | ~~`debug_*` and verified sources on target chain~~ | both exist; 57.4% of gas is verified | **resolved** |
| 9 | Per-transaction tracing does not scale | 2.6 s/tx → ~331 days for 48 h | high |
| 10 | Total gas conflates popularity with inefficiency | — | design |

`soldb profile` is affected by #2 and reports inflated percentages today; see
[Knock-on: `soldb profile`](#knock-on-soldb-profile).

## 1. `soldb list-contracts` does not report gas used

This is the one that would have quietly poisoned every downstream number.

`crates/soldb-cli/src/main.rs:2425` walks the struct log, and for each `CALL`,
`DELEGATECALL` or `STATICCALL` step prints the target address and `step.gas` —
the gas **remaining in the frame at the moment the call is made**. It is not the
callee's cost. On the transaction from
[profiling-a-deployed-contract.md](profiling-a-deployed-contract.md):

```console
$ soldb list-contracts 0x014364c9... --rpc-url https://rpc.gnosischain.com
Contract Address: 0xda8151d903cd1d4f3572bb16794214b538f35607
Gas: 163026
Contract Address: 0x4e53245bec800e6fe13d20ebb85eaca7825cfaeb
Gas: 156492
...
Contract Address: 0x33b41fe18d3a39046ad672f8a0c8c415454f629c
Gas: 92460
```

The values descend in exact nesting order, because remaining gas falls with depth.
The entry contract `0x33b41fe1…` appears near the bottom, which no measure of
consumption would do. The receipt says the whole transaction used **96,052** gas;
those twelve rows sum to 1,543,183.

Two further problems with the same output: it emits one row per call *site*, so
loops and recursion duplicate an address (`0xda8151d9…` and `0xa5f5a394…` each
appear twice above), and it has no aggregation step at all.

**Fix.** Do not use `list-contracts` for attribution. It is a discovery tool —
"which addresses execute here" — and it is correct for that. Gas must come from a
call tracer's `gasUsed` per frame.

## 2. Frame gas is inclusive, so naive aggregation double-counts

A call frame's `gasUsed` includes everything its children spent. Summing every
frame in a block therefore counts the same gas once per level of nesting.

Aggregating block 48,146,688 (364 frames) three ways:

| aggregation | total | vs. block `gasUsed` |
| --- | --- | --- |
| sum of top-level frame `gasUsed` | 4,333,320 | 1.00× ✓ |
| sum of **exclusive** (self) gas | 4,333,320 | 1.00× ✓ |
| sum of every frame's `gasUsed` | 11,925,309 | **2.75× inflated** |

2.75× is this block. On the deep transaction from the profiling doc — seven
frames of alternating calls and delegatecalls — the same error is ~16×.

It is not a uniform inflation, so the **ranking inverts**. The ERC-4337 EntryPoint
`0x0000000071727de22e5e9d8baf0edac6f37da032` is first by naive count and third by
self-gas:

| contract | naive | exclusive |
| --- | --- | --- |
| `0x0000000071727de2…` (EntryPoint v0.7) | 1,567,279 (#1) | 464,734 (#3) |
| `0x1d4bceb37ba39517…` | 1,337,833 (#2) | 955,520 (#1) |
| `0x41675c099f32341b…` | 976,410 (#3) | 100,325 (#6) |

Routers, entrypoints and multicall aggregators rise to the top of a naive ranking
purely for passing gas through. `0x41675c09…` keeps 10% of what it is charged.

**Fix.** Compute `self = frame.gasUsed − Σ children.gasUsed` and rank on that.
Keep the inclusive number too — they answer different questions, and the report
wants both:

- **inclusive**, counted only at a contract's outermost frame: *which application
  is responsible for this traffic.* The right lens for "who is eating the chain".
- **exclusive**: *which code actually burned the gas.* The right lens for choosing
  what to optimize, and the only one that sums to the block.

Never mix them in one table.

Precompiles surface once self-gas is correct — `0x…05` (modexp) at 96,712 and
`0x…01` (ecrecover) at 93,000 are both top-8 in this block. They are real capacity
consumers but not Solidity, so they belong in the ranking and outside the
optimization scope. Label them.

## 3. Aggregate by code identity, not by address

Per-address ranking scatters a single template across every address it was
deployed to. In this one Gnosis block:

```
168 distinct addresses, 72 distinct codehashes, 12 codehashes shared by >1 address
  10,841 B code   4 addresses   combined self-gas 362,300
  14,954 B code  34 addresses   combined self-gas  98,362
   9,310 B code  23 addresses   combined self-gas  58,420
   9,079 B code  16 addresses   combined self-gas  40,272
```

The 34-address group contributes 2,893 gas per address — invisible in a
per-address top-50, and one row of 98,362 when grouped. Gnosis is a mild case.
On a chain whose traffic is memecoin launches, every token, pair and vault is a
clone of one factory template; per-address ranking is close to guaranteed to hide
the contract worth optimizing under ten thousand identical rows too small to
notice.

Grouping also **raises verified-source coverage for free**, because verification
is recorded per address while code identity is per codehash. In this block,
`0xe3322b06…` and `0xd8c91008…` run byte-identical 17,318 B code; the first is
verified on Sourcify, the second is not. Grouped, the second's 55,243 gas becomes
analyzable at source level. That alone lifts top-25 coverage from 54.1% to 55.7%
here — on a clone-heavy chain it is the difference between a report that can do
line-level analysis and one that cannot.

**Measured on the target chain — and the sample size decides the answer.** In a
single Robinhood block, clone density looked mild (122 addresses → 106 code
hashes) and no unverified address shared code with a verified one. Over 714
blocks it is a different picture entirely: **6,311 addresses collapse to 3,366
code identities**, with real templates deployed at 297, 54, 36 and 7 addresses.
Per-address ranking would have scattered every one of them.

Two things that sample also surfaced. The largest group of all — 1,812 addresses
— is *empty* code, i.e. plain EOAs, and must be excluded rather than reported as
a 1,812-instance contract. And several groups are exactly **23 bytes**, which is
the EIP-7702 designator `0xef0100 || address`: delegated EOAs, in active use on
this chain. Grouping by code identity handles them correctly for free, since all
accounts delegating to the same implementation share a designator — but the
designator should be resolved to the delegate address before anything is
published, or the report will name an opaque hash instead of a wallet.

**Fix.** Key the aggregate on a hash of the deployed runtime code. Carry the
address list as a secondary column, and resolve verification per codehash by
trying every address in the group.

## 4. Decide proxy vs. implementation explicitly

`callTracer` sets `to` to the **implementation** on a `DELEGATECALL`, so self-gas
lands on the implementation code. That is what the optimization work needs. It
also means the application everyone identifies by its proxy address reports almost
nothing: `0x420ca0f9…`, the proxy in the profiling doc, is 170 bytes of dispatch
and shows 26,537 self-gas, while its implementation carries the rest.

Left implicit, this produces a report whose top-ten addresses nobody recognizes.

**Fix.** Record both keys on every frame — the storage context (`from` of a
delegatecall chain, i.e. the proxy) and the code executed (`to`) — and pick per
table: proxy identity for the "biggest gas eaters" narrative, implementation
identity for the deep dives and the compiler work.

## 5. Refunds make self-gas go negative

A root frame's `gasUsed` is the receipt value, which is **after** EIP-3529
refunds. Child frames are not refunded. Subtract one from the other and the
arithmetic breaks:

```
tx 0x25c9e9ea7525…  root frame  to=0xc587664c…  type=CALL
  gasUsed  229,209
  children 236,893
  self      −7,684
```

One frame in 364. Unhandled it corrupts the aggregate, and it will read as a bug
in the aggregator rather than as a property of the chain.

**Fix.** Track the refund at transaction level from `receipt.gasUsed` versus the
pre-refund execution total, exclude it from per-contract attribution, and report
it as its own line. Assert `self >= 0` on every non-root frame so a genuine
tracer inconsistency still fails loudly.

## 6. Intrinsic gas belongs to no contract

Every transaction pays 21,000 plus calldata cost before any contract code runs.
`callTracer` folds that into the root frame, so it currently lands on whichever
contract the transaction happened to enter first — inflating routers and
entrypoints, the same contracts flaw #2 already inflates.

For block 48,146,688:

```
block gasUsed          4,333,320
intrinsic (21k + data)   628,064   = 14.5% of the block
execution gas          3,705,256
avg per tx: 196,969 gas, of which 28,548 intrinsic
```

**Fix.** Subtract intrinsic cost from the root frame's self-gas and report it as
its own category. On a chain of small, high-frequency swaps its share will be
considerably higher than 14.5%, and it is a capacity story that no amount of
compiler work addresses — which makes it worth stating plainly rather than
hiding inside a contract's row.

## 7. ~~Arbitrum gas accounting is not Ethereum gas accounting~~ — withdrawn

**This flaw does not apply to Robinhood Chain. Measured 2026-09-08.**

The concern was that on Nitro, `receipt.gasUsed` includes the L1 data-posting cost
converted into L2 gas units (surfaced separately as `gasUsedForL1`) — a component
that is not execution, is not attributable to any contract, and is not reducible
by better code generation. If that share were large it would break the
reconciliation test and materially weaken the memo's central claim.

It is zero. Across every transaction in a sampled block:

```
sum receipt gasUsed   13,408,679
gasUsedForL1                   0   = 0.00%
```

Confirmed at the source by the ArbGasInfo precompile: `getL1BaseFeeEstimate()`
returns 0 and the `perL1CalldataByte` price is 0. **L1 data pricing is switched
off on this chain, and 100% of the gas users pay for is L2 execution gas.**

Three consequences, all favourable:

1. The reconciliation in flaw #2 holds exactly on Nitro — verified across 15
   blocks and 9,435 frames, difference of 0 gas.
2. No L1 component has to be separated out. Per-contract numbers are execution
   gas by construction.
3. The memo's claim is *stronger* here than it would be on Arbitrum One: with no
   data-availability component to dilute it, every unit of execution gas saved
   converts one-for-one into chain capacity.

**What replaces this flaw.** Two Arbitrum properties that do matter, neither of
which is about L1 data:

- **Capacity is a rate, not a block budget.** The Nitro block gas limit is a
  placeholder (`0x4000000000000`). The real constraint is the ArbOS speed limit
  in gas per second, priced through a backlog. Every capacity claim in the report
  must be expressed per second; there is no block-fullness story to tell.
- **ArbOS transaction and frame shapes.** Every block opens with an internal
  transaction (type `0x6a`, from and to `0x…0a4b05`) that reports `gasUsed = 0`
  while its trace has children consuming ~8,500 gas — a negative self-gas frame
  under flaw #5's arithmetic. Filter type `0x6a` explicitly, and do not rely on
  `cumulativeGasUsed`, which was `0x0` on that receipt.

**Standing caveat.** L1 pricing being off is an operator setting, not a property
of the stack. Re-read `getL1BaseFeeEstimate()` on every run and alert if it goes
non-zero; the attribution model changes if it does.

> **Note, 2026-09-14.** "Switched off" was too strong, and so was the 09-11
> reading that it had switched on. The pricer bursts: it was non-zero in 37 of
> 264 hourly archive reads from 09-01 to 09-11, and zero in all 70 since. Receipts
> sampled every ~20 minutes (962 blocks) put L1 data gas at 0.18% of gas, nearly
> all of it one block at 38%, or 0.016% without that block. On average it remains
> a rounding error, so the withdrawal stands. Within a burst it is not, which is
> why the collector strips `gasUsedForL1` per transaction. Detail in the recon's
> [third §3 correction](robinhood-chain-recon.md#3-gasusedforl1-is-zero--l1-data-cost-is-not-charged).

See [robinhood-chain-recon.md](robinhood-chain-recon.md) for the full gas model.

## 8. ~~The two unknowns that gate everything~~ — resolved

**Both answered affirmatively. Measured 2026-09-08.**

- **Does Robinhood Chain expose `debug_traceBlockByNumber`?** Yes. The official
  endpoint (`rpc.mainnet.chain.robinhood.com`) and publicnode both refuse the
  `debug_*` namespace, but **`rpc.ordofi.network` serves both
  `debug_traceTransaction` and `debug_traceBlockByNumber` with `callTracer`,
  keylessly**. It rate-limits and is a third party we have no agreement with —
  adequate for prototyping, not for a 48-hour sweep. Sourcify's chain registry
  names drPC as the trace-capable provider for 4663; that or GetBlock is the
  pay-as-you-go route.
  *2026-09-14: measured. ordofi keeps only ~1.2M blocks (~1.4 days).
  `robinhood.drpc.org` traces any height back to launch, even keylessly, and its
  output passes the conservation checks. GetBlock's shared public endpoint has no
  historical state. drPC pay-as-you-go ($6 per million requests, flat across
  methods) is the route; see the
  [recon's endpoint correction](robinhood-chain-recon.md#rpc-endpoints-and-which-ones-trace).*
- **Is there a verified-source registry?** Yes. Sourcify marks chain 4663
  `"supported": true` (and `"etherscanAPI": false` — Etherscan does not index this
  chain). Lookups against `sourcify.dev/server/v2/contract/4663/<address>` work
  today. Blockscout at `robinhoodchain.blockscout.com` is the official explorer
  and a second, probably better-covered source, but its API returns **403 to
  scripted requests** behind Cloudflare. That is the one access question still
  open, and every point of coverage it adds is gas we can analyse at line level.

### Feasibility metric #1, measured on the target chain

Over a 15-block sample (297 transactions, 77,556,908 gas, 502 distinct contract
addresses):

| | |
| --- | --- |
| top-60 addresses cover | 79.9% of all gas |
| Sourcify-verified among them | 26 / 60 addresses |
| **share of all gas from verified contracts** | **57.4%** |

A majority of gas is attributable to published source before Blockscout is even
counted. The memo's feasibility question — *what share of gas comes from contracts
with published source* — is answered: enough.

Two caveats. In the single-block deep dive the largest consumer, at 20.2% of that
block by itself, was **unverified** — the biggest individual target may not be
analyzable at line level. And gas is extraordinarily concentrated: **top 10
addresses hold 51.9%** of all gas, top 25 hold 66.5%, top 100 hold 87.4%. That
concentration is the most operationally useful number of the whole exercise,
because it means the report does not need whole-chain coverage to be right about
who the gas eaters are — which is what makes the sampling strategy in flaw #9
defensible rather than a compromise.

## 9. Scale

The per-transaction loop does not survive contact with the target volume.

| approach | measured | 48 h at 5.5M tx/day (11M tx) |
| --- | --- | --- |
| `soldb list-contracts` per tx | 2.6 s | ~331 days, single-threaded |
| `debug_traceTransaction` + callTracer | 0.36 s | ~46 days, single-threaded |
| `debug_traceBlockByNumber` + callTracer | 0.65 s per 22-tx block | ~4 days, single-threaded |

Block-level tracing is the right primitive: one RPC round trip per block, and the
node does the work in bulk. The payload is the remaining problem — 334,203 bytes
for 22 transactions, about **15 KB/tx**, so 11M transactions is roughly **165 GB
of JSON** before aggregation.

**Fix.** A custom JS tracer returning only `(depth, address, gasUsed)` per frame
instead of full `callTracer` objects, and streaming aggregation that never
materializes a block's tree. Parallelise across block ranges.

Line-level profiling is unaffected, because it is a different phase.
`soldb profile --backend replay` at ~2m10s per transaction never runs chain-wide —
only on a handful of transactions per top-ten contract. Its cost is almost
entirely state fetching, so profiling several transactions from the same block
against a warm cache should amortize well.

## 10. Total gas conflates popularity with inefficiency

A contract can top the ranking because it is used 400,000 times at a perfectly
reasonable 60k gas. Nothing about that row suggests an optimization target, and
the memo's promise is savings, not a leaderboard.

**Fix.** Decompose every row as `total = calls × mean gas/call` from the start.
The opportunity lives in `gas/call`; the reportable saving is
`calls × (gas/call − achievable)`.

Add a fourth column for reverted transactions. Gas spent by a transaction that
reverts is pure waste — it bought nothing and still consumed capacity. On a chain
with heavy sniping-bot traffic this is likely both large and the most quotable
line in the report.

## Knock-on: `soldb profile`

`profile` sums per-step gas costs, and a `CALL` step's cost includes the callee's
entire execution. It therefore inherits flaw #2 in its denominator. On the
transaction in [profiling-a-deployed-contract.md](profiling-a-deployed-contract.md):

```
Program-attributed gas: 130089 (8.32%)
Unmapped execution gas: 1433198 (91.68%)
```

Total 1,563,287, against a receipt `gasUsed` of **96,052** — a 16× inflated base.
The gas *ordering* of source lines is still informative, and the doc's reading of
line 86 as call-site attribution is correct. The percentages are not: every share
`profile` prints is a fraction of a double-counted total, and none of them should
be quoted in the report until this is fixed.

Fixing it needs the same exclusive/inclusive distinction as the aggregator: a
`CALL` site should be attributed the callee's cost in the inclusive view and only
its own opcode cost in the exclusive one.

## Revised pipeline

1. `debug_traceBlockByNumber` with a minimal custom tracer — one call per block.
   Sample blocks rather than sweeping them; the concentration measured under
   flaw #8 is what makes that sound.
2. Per frame compute self-gas; key on **code hash**, with proxy/entrypoint as a
   secondary key. Track calls, reverts, deployments and transaction-level refunds
   separately, and drop ArbOS internal transactions (type `0x6a`).
3. Per block assert `Σ self + intrinsic + refunds == block gasUsed`, and fail
   loudly. This assertion is what makes the report defensible; it is also what
   would have caught flaws 1, 2, 5 and 6 on day one. It holds exactly on Nitro —
   no L1 term is needed, per flaw #7.
4. Aggregate blocks into periods. Weight by the block base fee for any figure
   expressed in currency (every transaction in a block pays the same
   `effectiveGasPrice` on this chain).
5. Resolve top-N codehashes to verified sources, trying every address in the
   group. The gas-weighted verified share is feasibility metric #1.
6. `soldb profile` for two or three line-level deep dives, with the
   recompile-equals-deployed check from the profiling doc.

Flaws 7 and 8 were the gating unknowns and are now closed, so this pipeline is
clear to build. The recon turned up one addition it should carry from the start:
**contract deployment is ~9.2% of all gas on this chain** — a flat 200 gas per
byte of code deposited, invisible to line-level profiling and reducible only by
smaller bytecode. Treat deployment as a first-class category alongside execution
gas rather than a row in the same table.

## Reproducing this

```bash
RPC=https://rpc.gnosischain.com
BLOCK=0x2dea900   # 48,146,688

# Flaw 1: gas remaining, not gas used
soldb list-contracts 0x014364c99728029e692d69d9d1f4fd498a7cf8fdf407215de131d830ecdbdfd0 --rpc-url $RPC
cast receipt 0x014364c99728029e692d69d9d1f4fd498a7cf8fdf407215de131d830ecdbdfd0 --rpc-url $RPC gasUsed

# Flaws 2, 5, 6: one call gets the whole block
curl -s -X POST $RPC -H 'Content-Type: application/json' \
  --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"debug_traceBlockByNumber\",\"params\":[\"$BLOCK\",{\"tracer\":\"callTracer\"}]}" \
  -o blk.json

python3 - <<'PY'
import json, collections
blk = json.load(open('blk.json'))['result']
naive, excl = collections.Counter(), collections.Counter()
frames = top = 0
def walk(f):
    global frames
    frames += 1
    g = int(f.get('gasUsed', '0x0'), 16)
    to = (f.get('to') or 'CREATE').lower()
    kids = f.get('calls') or []
    naive[to] += g
    excl[to] += g - sum(int(c.get('gasUsed', '0x0'), 16) for c in kids)
    for c in kids:
        walk(c)
for e in blk:
    top += int(e['result'].get('gasUsed', '0x0'), 16)
    walk(e['result'])
print(f"txs={len(blk)} frames={frames}")
print(f"top-level  {top:,}")
print(f"exclusive  {sum(excl.values()):,}")
print(f"naive      {sum(naive.values()):,}  ({sum(naive.values())/top:.2f}x)")
for label, c in (("naive", naive), ("exclusive", excl)):
    print(label)
    for a, g in c.most_common(5):
        print(f"  {g:>10,}  {a}")
PY

# Flaw 3: code identity — group the block's addresses by hash of eth_getCode
# Flaw 8: verification status (100 = Gnosis, 4663 = Robinhood Chain)
curl -s "https://sourcify.dev/server/v2/contract/100/<address>"    # 404 = unverified
curl -s "https://sourcify.dev/server/v2/contract/4663/<address>"
```
