# Robinhood Chain reconnaissance: access, gas model, and what it changes

**Status:** internal — 2026-09-08, with dated corrections through 2026-09-14
**Companion to:** [gas-monitor-approach-review.md](gas-monitor-approach-review.md),
[robinhood-chain-gas-monitor.md](robinhood-chain-gas-monitor.md),
[robinhood-chain-2026-09-04-incident.md](robinhood-chain-2026-09-04-incident.md)

Everything below was measured against Robinhood Chain mainnet on 2026-09-08.
Sample sizes are stated per finding; where a number rests on a single block it
says so. The commands are in [Reproducing this](#reproducing-this).

## Headline

Four things decide the project, and all four now have answers.

| Question | Answer |
| --- | --- |
| Can we trace the chain? | **Yes.** `debug_traceBlockByNumber` works keylessly on a third-party endpoint today; paid endpoints exist for volume |
| Is there a verified-source registry? | **Yes.** Sourcify supports chain 4663 |
| What share of gas is analyzable at source level? | **57.4%** of all gas in the sample |
| Does Arbitrum's L1 data cost dilute the thesis? | **No — L1 data gas is 0.12% of gas at most, 0% most of the time.** ArbOS's L1 pricer flickers on briefly, then returns to zero |

Feasibility check #1 from the memo is essentially answered in the affirmative, and
the L1 risk raised as flaw #7 of the approach review is a rounding error on this
chain rather than the threat it would be on Arbitrum One.

Three findings change what the report should contain, covered in
[What this changes](#what-this-changes): capacity here is a **rate**, not a block
budget; **9.2% of all gas on this chain is contract code being deposited**, which
is a compiler problem the memo does not currently mention; and the congestion is
driven by **gas per transaction rising 1.70×**, not by transaction volume — which
puts the remedy Walnut sells directly on the causal path.

One finding changes the schedule: **the fee peak has already passed.** Revenue
topped out at $8.36M/day on 2026-09-04 and is down 74% since. See
[Cross-check: growthepie](#cross-check-growthepie).

> **Update, 2026-09-14.** Four findings from this week change the document below,
> each recorded as a dated correction where it applies. Their data is in
> [`data/recon-2026-09-14/`](data/recon-2026-09-14/) and
> [`data/incident-2026-09-04/`](data/incident-2026-09-04/).
>
> - **History is reachable after all.** `robinhood.drpc.org` serves archive
>   traces back to launch, keylessly, including the 09-04 peak.
>   [Endpoints](#rpc-endpoints-and-which-ones-trace).
> - **L1 data pricing never "switched on".** It bursts on and off, and has done
>   since at least 09-01. The 09-11 correction below over-read a burst.
>   Sampled across 09-01 to 09-14 it is well under 1% of gas.
>   [§3](#3-gasusedforl1-is-zero--l1-data-cost-is-not-charged).
> - **Revert waste is not low.** It is 6.55% of gas and 13.9% of transactions over
>   962 blocks, not the 0.5% of one block. [Revert waste](#revert-waste-is-low).
> - **The reported 09-04 block-production halt is not in the blocks.** The chain
>   kept producing blocks while throughput collapsed ~60% for 17 minutes. Traces
>   put the whole episode at 12:37–13:20. Ethereum and Chainlink data then traced
>   it to an Ethereum fee spike that stalled the batch poster, followed by dropped
>   transactions at ingress. It also likely explains the L1 pricing bursts. See
>   [robinhood-chain-2026-09-04-incident.md](robinhood-chain-2026-09-04-incident.md).

## Identity and access

| | |
| --- | --- |
| Chain ID | 4663 (`0x1237`); testnet 46630 |
| Stack | Arbitrum Nitro `v3.11.4-rc.3-7d5ac27`, **ArbOS 116** |
| Native currency | ETH |
| Explorer | Blockscout, `robinhoodchain.blockscout.com` — Etherscan does not index 4663 |
| Head at time of writing | block 57,926,381 |

### RPC endpoints, and which ones trace

| Endpoint | `debug_traceTransaction` | `debug_traceBlockByNumber` |
| --- | --- | --- |
| `rpc.mainnet.chain.robinhood.com` (official) | ✗ `does not exist/is not available` | ✗ |
| `robinhood-rpc.publicnode.com` | ✗ | ✗ |
| **`rpc.ordofi.network`** | **✓ callTracer** | **✓ callTracer** |
| `rpc.arrowrpc.com` | dead (Cloudflare 1033) | — |

`rpc.ordofi.network` answers both with full `callTracer` output, keylessly, and it
is what every measurement below is built on. It rate-limits, and it is a
third party we have no agreement with — fine for prototyping, not for a 48-hour
sweep. Sourcify's own chain registry lists drPC as the trace-capable provider for
4663 (`https://lb.drpc.org/ogrpc?network=robinhood&dkey={API_KEY}`), and GetBlock
documents Robinhood support; either is the natural pay-as-you-go choice. The
official and publicnode endpoints also rate-limit ordinary `eth_*` batches at 200
requests, so batch in 25–40 and back off.

> **Correction, 2026-09-14 — archive traces are reachable keylessly, and GetBlock's
> public endpoint is not a route to them.** `rpc.ordofi.network` now reports its
> own retention as "roughly the last 1.2M blocks — about a day and a half", so the
> 09-04 fee peak (~8.5M blocks back) is out of its reach. Every public 4663
> endpoint listed by [CompareNodes](https://www.comparenodes.com/library/public-endpoints/robinhood/)
> was asked to trace block 54,282,091 (2026-09-04 12:57 UTC):
>
> | Endpoint | `debug_traceBlockByNumber` (callTracer) at 54,282,091 |
> | --- | --- |
> | **`robinhood.drpc.org`** | **✓ 0.7 s, 384 KB; also traces block 100,000 (launch week)** |
> | `robinhood-mainnet.gateway.tatum.io`, `rpc-robinhood.blockmachine.io` | ✓ byte-identical response, presumably the same upstream |
> | `rpc.ordofi.network` | ✗ predates its ~1.2M-block retention |
> | `shared.us-east-1.getblock.io/…` (GetBlock shared) | ✗ `historical state is not available` |
> | publicnode, NodeFlare public, SolidRPC public, BlockReq | ✗ `debug_*` not served |
> | bloXroute / Tenderly | 403 / 429 |
>
> drPC's output passes all four conservation checks in `gasmon verify` (9 blocks,
> 73 transactions, 2,092 frames, 54,282,000–54,282,400). Archive `eth_getCode`,
> `eth_getBalance` and `eth_call` at old blocks also work. Keyless throughput was
> **~0.6 s/block serially and 2.6 blocks/s at 4 workers** (20-block runs), roughly
> 10× ordofi.
>
> Do not build on the keyless endpoint. drPC documents trace and debug methods as
> disabled on its free tier, so this access may be withdrawn. It already
> **returns HTTP 500 for any JSON-RPC batch of 5 or more** (3 always worked),
> and 2 of 11 trace calls failed once. drPC's pay-as-you-go plan is $6 per
> million requests at a flat 20 CU for any method, trace included
> ([dRPC, May 2025](https://blog.drpc.org/announcing-flat-pricing-simple-transparent-fair/)).
> Its paid rate and batch limits are not yet measured. Chainstack (paid plan,
> Global Node), Dwellir, QuickNode and SolidRPC (keyed) all document archive
> `debug_*` for 4663 but need keys and are untested; one of them is the natural
> cross-check.

### Verified sources

Sourcify's chain list marks 4663 **`"supported": true`** with
`traceSupportedRPCs: [debug_traceTransaction]` and **`"etherscanAPI": false`**.
Lookups work today:

```console
$ curl -s https://sourcify.dev/server/v2/contract/4663/0x8366a39cc670b4001a1121b8f6a443a643e40951
{"match":"match", ...}
```

The Blockscout instance is a second, independent source of verified code — likely
with better coverage, since it is where people actually verify — but its API sits
behind Cloudflare and returns **403 to scripted requests**. Getting at it needs a
browser-like client or an arrangement with the operator. Worth resolving, because
every point of coverage it adds is gas we can analyze at line level.

## How the gas model differs from an L1

### 1. There is no meaningful block gas limit

```
gasLimit  0x4000000000000  = 1,125,899,906,842,624
```

The Nitro block gas limit is a placeholder. **Capacity on this chain is a rate —
gas per second — enforced by the ArbOS speed limit and priced through a backlog**,
not a per-block budget. Every instinct carried over from Ethereum ("the block is
full", "N% of block space") is wrong here and must not appear in the report.

Measured over 1,200 consecutive blocks (121 s of chain time):

| | measured (121 s window) | daily average, 7 days ([growthepie](#cross-check-growthepie)) |
| --- | --- | --- |
| block rate | 9.92 blocks/s (~856,000 blocks/day; stable to 3 s.f. over a 281-hour window) | — |
| transaction rate | 194.8 tx/s | **130 tx/s → 11.2M tx/day** |
| gas rate | 48,990,379 gas/s | **39.2 Mgas/s** (range 29.4–51.1 over the fortnight) |
| gas per block | 4,939,863 | — |
| empty blocks | 0 / 1,200 | — |

**Correction.** The 121-second window landed in a busy period and overstates the
chain by roughly 50%. Independent daily figures put transactions at **11.2M/day
(7-day mean), 9.7M on the latest full day** — about **2× the memo's 5.5M**, not 3×
as first written. Use daily aggregates for anything published; a two-minute sample
is fine for pipeline work and useless for rates.

`ArbGasInfo.getGasAccountingParams()` returns
`(speedLimitPerSecond = 7,000,000, gasPoolMax = 32,000,000, maxTxGasLimit = 32,000,000)`.
The burst sample happened to sit at 7.00× that figure, which looked like a scaling
factor. **It was a coincidence** — daily throughput ranges from 12.9 to 51.1 Mgas/s
across the fortnight, so the chain is not pinned at any fixed multiple. What
survives is the simpler conclusion: **a chain that sustains 51.1 Mgas/s cannot have
a 7 Mgas/s speed limit**, so the precompile is not reporting the effective value.
Confirm the real limit with the operator or from ArbOS 116 source before quoting
any capacity-headroom figure.

### 2. The chain is congested, and the fee is almost entirely congestion

`ArbGasInfo.getPricesInWei()` decomposes the current price:

```
perArbGasBase        20,000,000 wei   (= 0.02 gwei, the minimum gas price)
perArbGasCongestion 230,246,000 wei
perArbGasTotal      250,246,000 wei   -> 92% of the gas price is congestion
```

Sampled hourly across 24 hours, the base fee **never returns to the floor**:

```
min 0.2378   mean 0.2726   max 0.3722 gwei      (floor 0.0200 gwei)
= 11.9x to 18.6x the minimum, mean 13.6x
```

This is the memo's central premise, measured rather than assumed: the chain is
sustainably saturated and the congestion mechanism is what users are paying for.
It also shows the trend the memo worries about — the fee drifted down from 0.30 to
0.24 gwei over the sampled day. **The window is closing slowly.**

Cross-check on fee revenue: the burst sample implied ~1,154 ETH/day; the actual
figure for the same day was **853.7 ETH ($2.15M)**, the gap being the burst
overstatement noted above. Reconstructing the gas price from independent daily
totals — `fees_eth ÷ (gas/s × 86,400)` — gives **0.336 gwei for 2026-09-07**
against the **0.2726 gwei** I measured directly by sampling the base fee hourly.
Two independent routes to the same quantity agree within 20% across a day on which
the fee was falling steadily. The measurement chain is sound; the sampling window
was not.

### 3. `gasUsedForL1` is zero — L1 data cost is not charged

This is the finding that most changes the outlook. Arbitrum receipts carry a
`gasUsedForL1` field for the L1 data-posting cost folded into `gasUsed`. On
Robinhood Chain, across every transaction in a sampled block:

```
sum receipt gasUsed   13,408,679
gasUsedForL1                   0   = 0.00%
```

Confirmed at the source by the precompiles:

```
getL1BaseFeeEstimate()   0
getPricesInWei()[perL1CalldataByte]   0
```

L1 pricing is off in this block. **Effectively all of the gas users pay for is L2
execution gas** — but see the correction below: it is not identically zero.

> **Correction, 2026-09-09.** A wider sample (714 blocks across two one-hour
> windows, 8,364 transactions) shows `gasUsedForL1` is **intermittent, not off**.
> It was non-zero for a 4,300-block span — about seven minutes of chain time —
> covering 655 transactions at up to 100,257 gas each, then returned to zero.
> Across that whole window it came to **0.122% of gas**, and in the recent window
> it was **exactly 0%**. This is ArbOS's L1 pricer briefly waking up, presumably
> as a batch-posting cost lands, before the surplus mechanism drives the estimate
> back to zero.
>
> The conclusion is unchanged in substance — L1 data cost is a rounding error
> here, and the memo's thesis holds — but two things follow. `gasUsedForL1` is
> part of `receipt.gasUsed` and is **not execution**, so it must be subtracted
> alongside intrinsic gas before the root frame is attributed to a contract;
> the collector (`../gasmon/`) now does this. And the pipeline's assertion cannot be
> `gasUsedForL1 == 0`, which fails on a large enough sample; it is a
> **share threshold** (below 1% of block gas) with the absolute figure reported
> every run.

> **Second correction, 2026-09-11 — L1 pricing has been switched ON.** The
> tripwire above fired on live data three days later. Four freshly traced blocks
> (290 transactions) show `gasUsedForL1` non-zero on **286 of 290 transactions**,
> totalling **8.87% of block gas** — up from 0.08% on 09-09 and 0% in the recent
> window that day. The precompiles confirm it is a parameter change, not a blip:
>
> ```
>                        2026-09-08        2026-09-11
> getL1BaseFeeEstimate()          0       264,924,236 wei
> perL1CalldataByte               0     4,238,787,776 wei
> perL2Tx                         0   593,430,288,640 wei
> ```
>
> **This partially re-opens flaw #7.** Roughly a tenth of gas is now L1 data
> posting: not execution, not attributable to any contract, and **not reducible
> by better code generation** — only by smaller calldata. The report must now
> quote execution gas net of the L1 term, and the savings case shrinks by
> whatever share L1 holds at the time of writing.
>
> It also changes what "optimisation" means here. With `perL1CalldataByte`
> priced, **calldata size becomes a first-class lever** alongside execution gas
> and code size — a different, and for the Argot collaboration a more novel,
> piece of compiler work.
>
> Congestion is easing in parallel: `perArbGasCongestion` is 86,250,000 of a
> 106,250,000 total (81%, down from 92%), and the total gas price is 0.106 gwei
> against 0.25 gwei on 09-08. Re-measure the L1 share before publishing any
> figure that depends on it.

> **Third correction, 2026-09-14 — it was a burst, not a switch-on.** The second
> correction rested on four blocks. Archive state makes it possible to read the
> pricer's history directly, and it shows no change of setting around 09-11. It
> shows the same intermittent behaviour the first correction described, on every
> day since at least 09-01.
>
> `getL1BaseFeeEstimate()`, read hourly from archive state (324 samples,
> 2026-08-31 23:18 → 09-14 11:09 UTC, via `robinhood.drpc.org`):
>
> ```
> day    hours non-zero   max estimate (wei)
> 09-01   4 / 24            10,765,376
> 09-02   2 / 24           135,680,011
> 09-03   3 / 24            57,129,582
> 09-04   2 / 24           143,995,461
> 09-05   2 / 24            11,064,709
> 09-06   5 / 24            12,309,173
> 09-07   1 / 24             1,010,775
> 09-08   5 / 24            25,535,027
> 09-09   5 / 24            16,212,330
> 09-10   5 / 24            11,398,167
> 09-11   3 / 24            14,159,807
> 09-12   0 / 23                     0
> 09-13   0 / 24                     0
> 09-14   0 / 12                     0
> ```
>
> The pricer was non-zero in **37 of 264 hourly samples** from 09-01 to 09-11, and
> zero in all **70** since 09-11 12:45 UTC. Minute-resolution reads on 09-04 show
> single bursts lasting 5–8 minutes. The 09-08 precompile reading of 0 and the
> 09-11 reading of 264,924,236 wei are both consistent with this: the first caught
> a quiet hour, the second a burst.
>
> What users actually paid, from receipts, one block every ~20 minutes (962 blocks,
> 12,805 transactions, 08-31 23:18 → 09-14 11:44 UTC):
>
> ```
> L1 data gas, all sampled blocks              0.182% of gas   (135 of 962 blocks non-zero)
>   of which one block (60,322,000, 09-11 14:19 UTC)   38.45% of that block's gas
> L1 data gas excluding that block             0.016%
> largest day                                  09-11, 2.58%
> blocks with L1 gas after 09-11 14:19 UTC     0 of 205
> ```
>
> Bursts are rare and occasionally heavy, so a 20-minute sample cannot pin the
> average tighter than **well under 1% of gas**. That is the figure to use, with
> the sample stated. Consequences:
>
> - **Flaw #7 goes back to where the first correction left it:** a rounding error
>   on average. `gasUsedForL1` still has to be stripped per transaction, because
>   inside a burst it can reach 38% of a block.
> - **The 1% gate in `gasmon verify` fires on burst blocks, not on a regime
>   change.** A failure means "this sample contains a burst". Report the share; do
>   not read it as a trend.
> - **The calldata-size argument above is weaker than stated.** With L1 data at
>   well under 1% of gas averaged, calldata matters mainly through the intrinsic
>   16-gas-per-byte charge, not through L1 pricing. Keep it as a secondary lever,
>   not a headline.

Consequences:

- Flaw #7 of the approach review — "Arbitrum folds L1 data cost into `gasUsed`,
  which may invalidate totals and weaken the thesis" — **does not apply here.**
  Delete it from the risk list.
- The memo's core claim strengthens: with no data-posting component to dilute it,
  **every unit of execution gas saved converts one-for-one into chain capacity.**
  That is a cleaner argument than it would be on Arbitrum One.
- Calldata size still matters for the 16-gas-per-nonzero-byte intrinsic charge,
  but not for data availability. Intrinsic gas measured at **6.2%** of a sampled
  block (vs 14.5% on Gnosis).

Do not assume this is permanent. It is an operator setting, and if Robinhood
turns L1 pricing on the attribution model has to change. Re-check
`getL1BaseFeeEstimate()` on every run and alert if it goes non-zero.

### 4. Arbitrum-specific transaction and frame shapes

- **Every block opens with an ArbOS internal transaction** (type `0x6a`, from and
  to `0x00000000000000000000000000000000000a4b05`). It reports `gasUsed = 0` while
  its trace has child frames consuming ~8,500 gas, so it produces a negative
  self-gas frame in the aggregator. Filter type `0x6a` explicitly.
- `cumulativeGasUsed` was `0x0` on that receipt. Do not rely on it; use `gasUsed`.
- Transaction types seen in one block: `0x6a` ×1 (internal), `0x0` ×8 (legacy),
  `0x2` ×16 (EIP-1559). Nitro adds several more (`0x64`–`0x69`) for retryables and
  deposits; the aggregator must not assume the L1 type set.
- `effectiveGasPrice` was **identical for every transaction in the block**
  (240,414,000 wei = the base fee). Priority fees appear not to be in play, which
  simplifies any conversion of gas to currency: gas × block base fee.

### 5. Call trees are much deeper than on an L1

| | Gnosis block 48,146,688 | Robinhood, 15-block sample |
| --- | --- | --- |
| frames per transaction | 16.5 | **31.8** (max depth 15) |
| naive-aggregation inflation | 2.75× | **4.79×** |
| callTracer bytes per transaction | ~15 KB | ~26 KB |

The double-counting error from flaw #2 of the review is roughly **twice as severe
here** as on the chain we prototyped against. Getting exclusive gas right is not a
refinement on this chain, it is the difference between a correct ranking and a
meaningless one.

The good news: **the reconciliation assertion holds exactly on Nitro.** Across 15
blocks and 9,435 frames, the sum of exclusive gas equalled the sum of block
`gasUsed` to the gas — difference 0. The invariant proposed as step 3 of the
revised pipeline works unchanged on this chain.

## Cross-check: growthepie

[growthepie](https://www.growthepie.com/chains/robinhood) tracks chain 4663 as
`robinhood` and exposes a public JSON API (`api.growthepie.com/v1/`, ~10 calls per
minute) with daily series back to launch. It is an independent second source for
everything in the previous section, and it carries three things RPC access cannot
give us: history, USD conversion, and per-application attribution.

Chain metadata worth recording: `chain_type: rollup`, **`da_layer: "Ethereum
(blobs)"`**, mainnet launch **2026-07-01**, public testnet 2026-02-10, 645.8M
lifetime transactions, 97 active applications.

### The fee spike has already peaked and is collapsing

| date | tx/day | Mgas/s | gas/tx | gas price | fees/day |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2026-08-17 | 7,494,658 | 13.37 | 154,182 | 0.0206 gwei | $52k |
| 2026-08-23 | 7,235,036 | 12.88 | 153,840 | 0.0207 gwei | $56k |
| 2026-08-27 | 9,491,404 | 22.27 | 202,683 | 0.0414 gwei | $199k |
| 2026-08-31 | 11,011,225 | 31.39 | 246,277 | 0.3276 gwei | $2.15M |
| 2026-09-02 | 11,469,221 | 42.05 | 316,797 | 0.5289 gwei | $4.65M |
| **2026-09-04** | **13,117,284** | **51.07** | **336,356** | **0.7556 gwei** | **$8.36M** |
| 2026-09-05 | 12,185,938 | 41.41 | 293,613 | 0.4545 gwei | $3.99M |
| 2026-09-06 | 10,659,272 | 33.51 | 271,608 | 0.4756 gwei | $3.41M |
| 2026-09-07 | 9,709,759 | 29.41 | 261,655 | 0.3360 gwei | $2.15M |

The memo's "$4.45M/day, the highest of any blockchain" corresponds to September 2.
The actual peak came two days later at **$8.36M**, and revenue has since fallen
**74% in three days**, to $2.15M. Throughput is down 42% from peak and
transaction count is back to late-August levels.

**This is the memo's "window may close" risk, in progress, measured.** It does not
invalidate the project — the chain is still the highest-revenue chain tracked and
its base fee is still ~17× its floor — but it does mean the report's framing
should not depend on fees continuing to rise, and publication speed matters more
than the memo already argued.

> **Note, 2026-09-14.** The peak day is also the day of the widely reported
> "14-minute block-production halt" at 12:57 UTC. Block data shows no halt. It
> shows a ~60% throughput collapse from 12:50 to 13:06, made up of missing
> *successful* transactions while reverting traffic continued. See
> [robinhood-chain-2026-09-04-incident.md](robinhood-chain-2026-09-04-incident.md).

### Congestion is a gas-per-transaction problem, not a volume problem

This is the most important thing in the dataset, and it strengthens the case for
the product considerably.

From 2026-08-17 to 2026-09-07:

| | change |
| --- | --- |
| transactions per day | 7.49M → 9.71M | **1.30×** |
| gas per transaction | 154,182 → 261,655 | **1.70×** |
| gas throughput | 13.37 → 29.41 Mgas/s | **2.20×** |
| fees per day | 23.9 → 853.7 ETH | **35.8×** |

Transaction *count* rose 30%. Gas *per transaction* rose 70%, and at the September
4 peak it was **2.18× the August baseline** (336,356 vs 154,182). Gas per
transaction was flat at ~154k for the whole week before the spike, so this is a
change in what transactions do, not a measurement artifact.

The memo attributes the congestion to "a wave of memecoin trading and token-launch
platforms, around 5.5 million transactions per day" — a **volume** story. The data
says the dominant term is **weight**: transactions became far more gas-hungry,
and that is precisely the variable a compiler optimization service moves. Had gas
per transaction stayed at its August level, September 4's 13.1M transactions would
have needed 23.4 Mgas/s instead of 51.1 — roughly the load of a week earlier, when
the chain was priced at its floor.

**Recommendation:** lead the report with gas per transaction, not transaction
count. It is the metric that connects the congestion to the remedy, and it is the
one that makes "we can give you capacity back" a quantified claim rather than a
hope.

### Robinhood absorbs the data-availability cost entirely

The chain posts to Ethereum blobs, but as established in §3 it charges users
nothing for L1 data. growthepie's `rent_paid` series shows what that costs:

| | lifetime | 2026-09-04 (peak day) |
| --- | ---: | ---: |
| fees collected | 17,405 ETH ($41.08M) | 3,333.8 ETH ($8.36M) |
| paid to L1 for DA | 24.4 ETH ($48k) | 0.288 ETH |
| **DA as share of revenue** | **0.140%** | **0.0086%** |

Robinhood keeps essentially 100% of what the chain earns. Two implications for
the memo:

- The "fees are revenue, not a cost" nuance is stronger than stated: this is
  near-pure margin, with no meaningful DA cost to offset it. The argument that
  Robinhood might *welcome* congestion has to be taken seriously.
- It also explains why `gasUsedForL1` is zero. At 0.14% of revenue, charging users
  for data availability is not worth the accounting. That setting is unlikely to
  change while blobs stay cheap, which makes the §3 finding more durable than the
  standing caveat there implies.

### The traffic is not obviously memecoins

Top applications by 7-day transaction count:

```
5,241,758  uniswap
4,749,290  reservoirprotocol          (NFT liquidity aggregator)
3,752,180  eth-infinitism-account-abstraction   (the ERC-4337 EntryPoint)
  698,676  paxosglobal
  670,705  opensea
  553,811  multicall
  509,085  robinhood                  (Robinhood's own products)
  502,707  1inch
```

By category: 48.8% of transactions are **unlabeled**, 30.1% finance, 8.3%
utility, 7.5% cross-chain, 5.0% token transfers, 0.24% collectibles.

The memo's causal story — memecoin trading and token-launch platforms — is not
visible here. What is visible is a DEX, an NFT aggregator, and account
abstraction. The memecoin activity may well be inside the 48.8% unlabeled bucket,
but **the claim is currently unverified and we should not publish it as fact.**
Our own per-contract attribution is the thing that would settle it, and doing so
would be a genuinely novel contribution: growthepie labels by application, we
would rank by gas.

One more number worth citing: growthepie ranks Robinhood Chain **24th of 24 on
transaction cost** — the most expensive chain it tracks — at a median of $0.115
per transaction.

### Using the API

```bash
curl -s https://api.growthepie.com/v1/master.json          # chain + metric registry
curl -s https://api.growthepie.com/v1/chains/robinhood/overview.json
curl -s https://api.growthepie.com/v1/export/txcount.json  # also: fees, profit,
                                                           # rent_paid, throughput, txcosts
```

`export/{metric}.json` returns flat rows of `{origin_key, metric_key, date,
value}`; filter on `origin_key == "robinhood"`. The `throughput` metric arrives as
`gas_per_second` **in Mgas/s** in the export but as raw gas/s in
`overview.json`'s ranking block — an easy unit trap. `fundamentals.json` and
`metrics/{id}.json` return 403; `chains/{chain}/overview.json` and
`export/{metric}.json` are the two that work unauthenticated.

## The finding that should change the report

**9.2% of all gas on Robinhood Chain is bytecode being written to state.**

From the 15-block sample (297 transactions, 77,556,908 gas):

```
contract deployments        4
deployment self-gas         8,136,552   = 10.5% of all gas
  of which code deposit     7,132,200   =  9.2% of all gas   (200 gas per byte)
```

In one individual block it was far higher — 22.1% of the block's gas was
deployment, 20.1% pure code deposit, from **two** `CREATE2` calls. The single
largest gas consumer in that block was a 10,229-byte contract being deployed:
2,095,153 gas, of which 2,045,800 — **98%** — was the flat per-byte deposit charge.

This matters because it is a completely different optimization axis from the one
the memo describes:

- It is **not visible to line-level profiling.** There are no hot lines. It is a
  flat 200 gas per byte of deployed code, so no source line will ever stand out.
- It is reduced by making the compiler emit **smaller** bytecode, not faster
  bytecode — a distinct body of solc work (and one where the via-IR pipeline
  currently regresses: the profiling doc's via-IR rebuild produced 26,444 bytes
  against a legacy 16,630, a 59% increase that on this chain would cost ~2M extra
  gas per deployment).
- On a chain whose traffic is token launches, deployment is not noise. It is a
  near-tenth of everything, and it is the most directly attributable savings we
  could offer: bytes removed × 200 × base fee, with no modelling assumptions.

At the measured rate this is ~106 ETH/day of code-deposit gas. A 20% code-size
reduction on the contracts being deployed is worth ~21 ETH/day, and the arithmetic
is arguably more defensible than any execution-gas estimate.

**Recommendation:** make deployment/code-size a first-class category in the report
alongside execution gas, and treat "gas paid to store bytecode" as its own headline
number.

## Feasibility metrics, measured

### Source-level coverage — memo metric #1

15-block sample, 297 transactions, 502 distinct contract addresses:

| | |
| --- | --- |
| top-60 addresses cover | 79.9% of all gas |
| Sourcify-verified among them | 26 / 60 addresses |
| their share of top-60 gas | 71.8% |
| **share of all gas in the sample** | **57.4%** |

A majority of gas is attributable to published source, before adding whatever
Blockscout covers that Sourcify does not. That is a workable answer to
"can we do this at all".

**Reproducible figure, 714-block sample.** `gasmon sources` (see [`../gasmon/`](../gasmon/)) now resolves this
automatically, at code-identity grain: **56.9% of attributed gas / 54.7% of all
block gas** comes from Sourcify-verified code, across the top 200 code identities
and 213 lookups.

The codehash-grouping uplift argued in flaw #3 of the review — which **did not
fire** in the earlier single-block sample — does fire at this size:
**18.9M gas across 59 addresses** is analyzable purely because a byte-identical
twin is verified, those addresses having never been verified themselves. One
lookup on `0xd0601ce157…` resolved a 54-address `BeaconProxy` group holding
12.8M gas. That is ~1.8% of verified gas here, and would be far larger on a
clone-heavy chain.

One caveat stands: in the single-block deep dive the largest consumer — 20.2% of
that block by itself — was **unverified**, so the biggest single target may not
be analyzable at line level.

### Gas is extremely concentrated

```
                 15-block sample    714-block sample
top 10                    51.9%               41.4%
top 25                    66.5%               52.7%
top 100                   87.4%               67.7%
```

**Ten contracts account for roughly 40% of the chain's gas**, and a hundred for
two thirds. The 714-block figures supersede the first column — a wider sample
sees more of the tail, so the earlier numbers were optimistic — but the
conclusion is unchanged in kind. This is the most
operationally useful number in this document: the report does not need whole-chain
coverage to be right about who the gas eaters are. A stratified block sample
identifies the top-N reliably, and only then do we need exhaustive tracing — if at
all.

### Revert waste is low

In the block examined in detail, 2 of 25 transactions reverted, burning 63,122 gas
— **0.5%** of the block. The "sniping bots burn a large share of capacity" angle
speculated in the approach review is **not supported** by this sample. Worth
re-measuring over a wider window before dropping it, but do not plan the report
around it.

> **Correction, 2026-09-14 — revert waste is material.** Re-measured from receipts,
> one block every ~20 minutes from 08-31 23:18 to 09-14 11:44 UTC (962 blocks,
> 12,805 transactions): **6.55% of gas and 13.94% of transactions reverted.** It
> varies widely by day, 3.0% to 13.7% of gas, and **40.4% of transactions on
> 09-10**. The single-block 0.5% was unrepresentative. Reverted gas buys nothing,
> so it deserves a section in the report, kept separate from the optimisation
> figures because it is not a codegen saving. Whether it is the sniping bots the
> approach review speculated about is for the per-contract ranking to say.

## Scale, with real numbers

At the corrected 11.2M tx/day (7-day mean), 48 hours is **22.5M transactions**.

| | measured | 48-hour sweep |
| --- | --- | --- |
| trace time | 7.3 s per block (25 txs) | 1.71M blocks → **~145 days single-threaded** |
| trace payload | 26 KB per transaction | **~585 GB of JSON** |

Block count drives the trace time and is unchanged (~856,000 blocks/day, stable
regardless of load), so the 145-day figure stands; only the payload estimate falls
with the corrected transaction count.

Exhaustive tracing of 48 hours is not affordable against a shared RPC endpoint at
any sane cost. Three ways out, in order of preference:

1. **Sample.** Given that ten contracts hold half the gas, a stratified sample of
   a few thousand blocks spread across the 48 hours identifies the top consumers
   with ample confidence, at ~0.2% of the cost. Report confidence intervals rather
   than pretending to a census.
2. **Shrink the payload.** A custom JS tracer emitting only `(depth, to, gasUsed,
   type)` should cut 26 KB/tx by an order of magnitude, and removes most of the
   parse cost.
3. **Self-host.** A Nitro archive node for 4663 removes the rate limits and the
   per-request cost entirely, and is the only route to genuinely continuous
   monitoring — which is what the memo's "what we build next" section describes
   anyway.

Start with (1) and (2) for the report; (3) is a product decision, not a report
decision.

> **Note, 2026-09-14.** The 7.3 s/block figure is ordofi's. drPC's archive endpoint
> traced at ~0.6 s/block serially and 2.6 blocks/s with 4 workers, so a 48-hour
> census is ~7.6 days at that rate rather than ~145. That is still not worth doing
> when sampling suffices, but it makes weeks-long stride samples cheap. At drPC's
> $6 per million requests, request cost is negligible next to bandwidth: payload
> was 246 KB/block in 20 blocks at 21 Mgas/s, and the 26 KB/transaction payload
> figure above still stands.

## What this changes

Against the approach review:

- **Flaw #7 (Arbitrum L1 gas) — withdrawn.** `gasUsedForL1` is 0. The thesis is
  cleaner than expected.
- **Flaw #8 (trace and verification access) — resolved.** Both exist. Budget for a
  paid endpoint; Blockscout's Cloudflare block is the one open access question.
- **Flaw #2 (inclusive-gas double counting) — worse than measured on Gnosis**,
  4.79× rather than 2.75×.
- **Flaw #3 (codehash grouping) — still correct, but no measured uplift yet** on
  this chain.
- **Flaw #9 (scale) — worse than estimated**, because traffic is ~2× the memo's
  figure and traces are deeper. Sampling moves from optimization to necessity.
- **New: capacity is gas/second.** Every capacity claim in the report must be
  expressed as a rate. There is no block-fullness story to tell.
- **New: code deposit is ~9.2% of all gas.** Add it as a first-class category.

Against the memo:

- The "unconfirmed assumption" that the chain is congested is now **measured**:
  92% of the gas price is the congestion component, and the base fee has not
  touched its floor in 24 hours.
- The traffic figure should be restated: **11.2M tx/day** (7-day mean), not 5.5M.
- **The peak has passed.** Fees topped out at $8.36M on 2026-09-04 and fell 74% to
  $2.15M by 09-07. The memo's $4.45M figure is September 2, on the way up. The
  "window may close" risk is no longer hypothetical — it is the current trend, and
  publication speed now dominates polish.
- **Reframe the cause.** The memo's volume story ("5.5M transactions per day" of
  memecoin traffic) is not what the data shows. Transaction count rose 1.30×
  between 08-17 and 09-07; **gas per transaction rose 1.70×**, and 2.18× at peak.
  Congestion here is a weight problem, which is exactly the problem Walnut solves.
  Lead with gas per transaction.
- **The memecoin attribution is unverified.** Top applications by transaction count
  are Uniswap, Reservoir and the ERC-4337 EntryPoint, with 48.8% of traffic
  unlabeled. Do not publish the memecoin claim as fact; our own per-contract
  ranking is what would settle it.
- **"Fees are revenue, not a cost" is stronger than stated.** DA costs Robinhood
  0.14% of revenue lifetime. This is near-pure margin, so the risk that Robinhood
  is content with congestion deserves more weight in the validation plan, not
  less.

## Open questions

1. What is the **effective ArbOS speed limit**? The precompile says 7M gas/s;
   the chain has sustained 51.1M over a full day. Needed for any headroom or
   capacity-gained claim.
2. Can we reach the **Blockscout verification API** without Cloudflare blocking?
   Determines the true source-coverage ceiling.
3. Is **L1 pricing off permanently**, or a launch-period setting?
   *Answered 2026-09-14: neither. It bursts on and off, and has done every day
   from 09-01 to 09-11. No burst has been sampled since 09-11 14:19 UTC. See the
   third correction in §3.*
4. What are the **top-10 contracts**? They are half the chain's gas and this
   sample already names them; identifying them by product is the next step and is
   most of the report's narrative.
5. Does the **deployment share hold** over 48 hours, or was this sample
   launch-heavy? A cheap check over a wider block sample, and it decides how
   prominent the code-size story becomes.
6. **What drove gas per transaction from 154k to 336k?** This is now the central
   question of the report. It is answerable with the pipeline we already have —
   rank contracts by self-gas on a day before the spike and a day at peak, and
   diff. Whatever appears in that diff is the story.
7. Is the **48.8% unlabeled** traffic the memecoin activity the memo assumes, or
   something else? Same pipeline answers it.

## Reproducing this

```bash
RH=https://rpc.mainnet.chain.robinhood.com     # eth_* only
TRACE=https://rpc.ordofi.network               # debug_* works here, last ~1.2M blocks
ARCHIVE=https://robinhood.drpc.org             # debug_* and state at any height (2026-09-14); batches <= 3

# L1 pricer at a historical block (hourly reads of this built the §3 table)
cast call 0x000000000000000000000000000000000000006c "getL1BaseFeeEstimate()(uint256)" \
  --block 54279200 --rpc-url $ARCHIVE

# Identity
curl -s -X POST $RH -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"web3_clientVersion","params":[]}'
cast call 0x0000000000000000000000000000000000000064 "arbOSVersion()" --rpc-url $RH

# Gas accounting parameters (ArbGasInfo, 0x6c)
for sig in "getGasAccountingParams()" "getPricesInWei()" "getL1BaseFeeEstimate()" \
           "getMinimumGasPrice()" "getGasBacklog()"; do
  echo -n "$sig  "; cast call 0x000000000000000000000000000000000000006c "$sig" --rpc-url $RH
done

# L1 component: zero on every transaction
cast receipt <txhash> --rpc-url $RH --json | jq '.gasUsedForL1, .gasUsed'

# Trace a block and reconcile (see gas-monitor-approach-review.md for the aggregator)
curl -s -X POST $TRACE -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"debug_traceBlockByNumber","params":["0x373d4c2",{"tracer":"callTracer"}]}' \
  -o rh_trace.json

# Verified sources
curl -s https://sourcify.dev/server/v2/contract/4663/<address>     # 404 = unverified
curl -s https://sourcify.dev/server/chains | jq '.[] | select(.chainId==4663)'
```

Deployment gas is isolated by filtering trace frames on
`type in ("CREATE","CREATE2")` and comparing frame self-gas against
`200 × len(output)`.
