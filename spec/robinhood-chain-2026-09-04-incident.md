# The 2026-09-04 Robinhood Chain incident, as recorded on-chain

**Status:** internal — 2026-09-14, updated 2026-09-15
**Companion to:** [robinhood-chain-recon.md](robinhood-chain-recon.md)
**Public summary:** [robinhood-chain-2026-09-04-incident-summary.md](robinhood-chain-2026-09-04-incident-summary.md)

On 2026-09-04, at the chain's all-time fee peak, the press reported that Robinhood
Chain **stopped producing blocks for more than 14 minutes** from about 12:57 UTC.
Robinhood has not published a cause.

This document records what the chain's own data shows about that window, in two
passes. The first uses block headers, receipts and archive state; the second, call
traces of every 10th block from 12:30 to 13:40 UTC. Everything was measured on
2026-09-14. Sample sizes are given with each finding, and the commands are in
[Reproducing this](#reproducing-this). The datasets are saved in
[`data/incident-2026-09-04/`](data/incident-2026-09-04/), and every figure here can
be recomputed from them.

> **Note, 2026-09-14.** The first, untraced version of this document put the
> collapse at 12:50–13:06. It also read reverting traffic as reaching the
> sequencer through routes other users lacked. Tracing reversed both, and each is
> marked where it occurs. A third pass the same day, using Ethereum's batch
> records and Chainlink's timestamps, answered the question §6 had left open
> (read path or write path): it was the write path. See §7–§8.

> **Note, 2026-09-15.** A fourth pass, over every Ethereum receipt from 12:20 to
> 12:50 and the batch poster's own transactions, answered two questions §7 had
> left open. It also corrected one explanation:
>
> - **What set off Ethereum's fee spike:** the US jobs report, released at
>   12:30:00 UTC.
> - **Why the poster stalled:** its fee caps were not stale, as §7 first
>   suggested. It bid a 0.001 gwei priority fee, the lowest of any rollup, and was
>   passed over while other rollups kept posting.
> - **Robinhood's response:** it raised that tip 500× at 20:06:47 the same evening.
>
> See §7, "What set off the spike" and "Why the poster could not get in".

> **Correction, 2026-09-15 (later).** "The lowest of any rollup" was wrong.
>
> - **In quiet blocks, 0.001 gwei is a common bid.** Before the stall, 10 of 61
>   other blob transactions bid 0.001 gwei or less, from five posters, one at
>   0.0001. In a 60-block sample across the fortnight, 13–18% did.
> - **The spike priced out every bid that low.** Posters that stayed at 0.001 gwei
>   were shut out, Arbitrum One's batch poster among them. Those that raised their
>   tip got in, OP Mainnet's among them.
>
> Robinhood bid at the bottom of the market and did not raise its bid, rather than
> bidding the least. Details in §7.

## Headline

| Question | Answer |
| --- | --- |
| Did block production stop? | **No.** Blocks arrived at 9.89 per second throughout, and no two sampled blocks 10 apart were more than 3 s apart |
| What happened instead? | **Throughput collapsed for about 43 minutes**, 12:37–13:20 UTC. It was worst at 12:50–13:06: 21.2 Mgas/s against 55.6 just after. It began right after a surge to 72–80 Mgas/s |
| Who was affected? | **Nearly everyone.** The median busy entry contract kept 19% of its successful traffic, and none kept 80%. Wallets, trading terminals, routers and a bridge fell alike, and busy bots were cut as hard as occasional users |
| Where did it fail? | **In transaction ingress.** From 12:40 to 13:10, Chainlink price updates landed only on their 2nd–5th broadcast, a minute apart. Submissions were being dropped, not blocks |
| What triggered it? | **An Ethereum fee spike at 12:30** (base fee 18× within 20 minutes) **stalled Robinhood's batch poster** for 8½ minutes, the longest stall in 13.8 days. The poster had no spare capacity, so its backlog of unposted blocks grew to ~18 minutes |
| What set off the spike, and why did the poster stall? *(added 2026-09-15)* | **The US jobs report**, released at 12:30:00 UTC, set off an arbitrage rush. The first full block after it paid 12.6 ETH in priority fees. **The poster was outbid:** it tipped 0.001 gwei while 22 other rollups kept posting at mostly 1–5 gwei. Its fee caps were not the constraint. *(Later the same day: every poster that stayed near 0.001 gwei was priced out, Arbitrum One's included. Robinhood was at the bottom of the market, not alone there.)* Robinhood raised the tip to 0.5 gwei at 20:06:47 that evening (§7) |
| Is that the whole cause? | **No.** On Sep 11 the same Ethereum trigger and a 5-minute poster stall caused no ingress failure. How the backlog turned into dropped transactions inside Robinhood's infrastructure is not visible on-chain (§7). *(2026-09-15: by Sep 11 the poster was also tipping 250× more.)* |
| Could it have been caught? | **Yes, from public data.** A poster-silence alert fires at 12:34:47, and a write-path alert that stayed quiet on every other day of the fortnight fires by 12:45. The press reported the start as 12:57 (§8) |
| Is it a daily pattern? | **No.** The same clock window on 09-03 and 09-05 shows no dip |
| Did L1 pricing or Robinhood's own fee spike cause it? | **Neither fits the timing.** Both turn out to be downstream of the Ethereum spike (§7) |

The reported "~8,400 missed blocks" is arithmetic (14 minutes × 10 blocks/s), not
an observation. The reports cite explorer data. An explorer that stopped indexing
would show exactly the reported halt while the chain kept going.

## What was reported

Press coverage ([crypto.news](https://crypto.news/robinhood-chain-suffers-14-minute-network-outage/),
[CryptoSlate](https://cryptoslate.com/a-major-outage-and-corporate-backlash-hit-robinhood-chain-at-the-peak-of-its-growth/),
Gate, CoinLaw and others) agrees on these points:

- block production stopped at about 12:57 UTC on 2026-09-04 for more than 14
  minutes, "according to block explorer data";
- submitted transactions went unconfirmed;
- no funds were lost;
- recovery was "uneven";
- the cause was not disclosed.

## 1. Blocks did not stop

Block **54,282,091** carries timestamp 2026-09-04 12:57:00 UTC, the reported start.

Every 10th block from 12:29:45 to 13:40:32 (4,201 headers, blocks
54,266,000–54,308,000) gives a mean of **9.89 blocks/s**. The largest timestamp gap
between consecutive samples, which are 10 blocks apart, is **3 seconds**. A
14-minute halt would put an 840-second gap between two samples. There is none, and
no block in that range is empty.

A coarser sweep over the whole of 09-04 (one block every 4,000) shows every
4,000-block interval taking 400–408 s, all day.

Nitro's sequencer stamps blocks as it sequences them, so a continuous timestamp
series means the sequencer was producing blocks throughout. Whatever failed, it was
not block production on the canonical chain.

## 2. Throughput collapsed from 12:37 to 13:20

Every column below comes from the traced sample (every 10th block, see
[How it was traced](#how-it-was-traced)), except the congestion price. That is
`ArbGasInfo.getPricesInWei()`, read from archive state once a minute.

| phase (UTC) | first block | Mgas/s | tx/s | successful tx/block | reverted tx/block | reverted gas | L1 data gas | failed 4337 bundles/block | congestion price |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 12:30–12:33 before | 54,266,140 | 58.8 | 234 | 19.2 | 4.44 | 11.6% | 0.00% | 0.07 | 0.35–0.52 gwei |
| 12:34–12:38 surge | 54,268,500 | 68.6 | 194 | 14.8 | 4.77 | 11.2% | 0.00% | 1.04 | 0.53–**3.53** gwei |
| 12:39–12:49 | 54,271,440 | 40.9 | 153 | 10.0 | 5.50 | 25.3% | 0.00% | 1.25 | 0.34–0.92 gwei |
| **12:50–13:06 trough** | **54,277,930** | **21.2** | **84** | **4.6** | 3.87 | **32.2%** | 1.13% | **1.34** | 0.33–0.34 gwei |
| 13:07–13:13 | 54,288,100 | 37.7 | 146 | 11.8 | 2.88 | 14.2% | 1.56% | 0.11 | 0.33–0.34 gwei |
| 13:14–13:19 | 54,292,250 | 32.6 | 126 | 11.3 | 1.36 | 8.2% | 0.00% | 0.00 | 0.33–0.34 gwei |
| 13:20–13:40 after | 54,295,830 | 55.6 | 188 | 15.4 | 3.55 | 11.3% | 0.00% | 0.15 | 0.34–0.63 gwei |

The phases hold 236, 294, 649, 1,017, 415, 358 and 1,218 sampled blocks, and their
boundaries are accurate to ±10 blocks. The trough is ~10,170 blocks,
54,277,930–54,288,099.

**The onset was 12:37.**

- **12:34–12:36:** gas throughput reached 72–80 Mgas/s, the heaviest load in the
  window. The congestion price spiked 10×, peaking at 3.53 gwei at 12:37:57.
- **12:37:** failed ERC-4337 bundles went from ~0 to 2.2 per block, and
  successful transactions started falling: 16–17 per block at 12:34–12:36, 13.9
  at 12:37, 10.4 at 12:38.
- **12:39–13:07:** throughput dropped to 25 Mgas/s at 12:39 and hovered at
  32–57 until 12:49. It sat at **12.5–27.7 Mgas/s from 12:50 to 13:05**, then
  jumped back to 47 at 13:07.

The surge coming first does not make it the cause, but it is the obvious trigger to
test.

> **Note, 2026-09-14 (later).** Tested in §7: it was not the trigger. Robinhood's
> batch poster had already stalled at 12:29:47, when Ethereum's fees spiked.

One block distorts the 12:39–12:49 row. Block 54,277,260 (12:48) carries 670
transactions, 660 of them plain ETH transfers from 660 accounts to one address, a
consolidation sweep. It adds about one successful transaction per block to that
row and is otherwise unrelated.

Gas per transaction in the trough (253k) sat between the windows either side (251k
before, 296k after). The collapse was a loss of transactions, not a change in what
they did.

**Controls.** The same clock window on the neighbouring days, from block headers.
Those days use 1-in-30 headers; 09-04 is the 1-in-10 sample:

| day | 12:30–12:50 | 12:51–13:07 | 13:10–13:30 |
| --- | ---: | ---: | ---: |
| 2026-09-03 | 39.3 Mgas/s | 38.5 | 48.6 |
| **2026-09-04** | **51.4** | **20.9** | **44.1** |
| 2026-09-05 | 29.5 | 36.4 | 33.8 |

The 09-04 collapse is specific to that day.

> **Correction, 2026-09-14.** Before tracing, this section was titled "Throughput
> collapsed for ~17 minutes" and dated the event 12:50–13:06, from block headers
> and a 1-in-30 receipt sample. That is the trough: traces put the onset at 12:37
> and full recovery at 13:20. The receipt sample's figures differ slightly from
> the table above, for example 32.9% reverted gas in the trough against 32.2%.
> The table now uses the larger traced sample throughout.

## 3. Nearly every application and sender lost traffic

Below, "baseline" means before plus after, 1,454 sampled blocks, and "trough" means
1,017 sampled blocks. Ratios compare successful transactions per sampled block,
trough ÷ baseline.

The number of people transacting fell with the traffic. In 236 consecutive sampled
blocks there were 2,874 distinct senders before, 1,047–1,074 in the trough, and
2,075–2,551 after.

### Entry contracts

No single application disappeared. Of the 32 entry contracts with at least 100
successful baseline transactions (63% of baseline traffic), **the median kept 19%
of its traffic, the best kept 68%, and none kept 80%.** The largest:

| entry point (`tx.to`) | what it is | baseline | trough | trough ÷ baseline |
| --- | --- | ---: | ---: | ---: |
| `0x65050a9b…` | proxy; every call is a multi-hop `swap((uint8,address,address,address,uint24,int24,address,bytes,address,bytes32)[],…)` over Uniswap v3/v4 pools | 4,080 | 398 | 0.14 |
| `0xccc88a9d…` | RelayApprovalProxyV3, Relay's cross-chain bridge | 1,443 | 75 | 0.07 |
| `0x4337084d…` | ERC-4337 EntryPoint v0.8, successful bundles | 1,365 | 403 | 0.42 |
| `0x4a86009a…` | proxy; every call is `axiomTrade(bytes,bytes[],uint256)` (the Axiom trading terminal) | 950 | 122 | 0.18 |
| `0x88767899…` | Uniswap UniversalRouter | 824 | 180 | 0.31 |
| 903 token contracts | ERC-20 `approve` on 3,248-byte tokens | 3,438 | 443 | 0.18 |
| externally owned accounts | plain ETH transfers | 948 | 199 | 0.30 |

Contract names come from Sourcify. The swap and Axiom implementations are
unverified, so their functions are identified from the selectors' registered
signatures.

Wallet actions (approvals, plain transfers) fell as hard as trading terminals and
routers.

Relay was hit longest. It fell from ~0.9 transactions per block to near zero from
12:40, with brief blips (12:46–12:49, 12:59). It was at zero from 13:07 to 13:16
and returned from 13:17.

Measured in gas instead of transactions, against 13:20–13:40 (`gasmon diff --per
block`), gas per block fell to 0.38× and every large consumer fell with it:

- USDG 0.25×
- aeWETH 0.32×
- Uniswap v4 PoolManager 0.37×
- RelayRouterV3 0.17×
- PonsV2MemeHook 0.19×

### Senders

Senders are grouped by how many transactions they sent in the baseline. A sender
picked for being active in one sample looks less active in any other purely from
sampling, so each ratio is set against a placebo: the same measure between two
halves of normal traffic.

| baseline activity | trough ÷ baseline | placebo | trough ÷ placebo |
| --- | ---: | ---: | ---: |
| 1 transaction | 0.12 | 0.43 | 0.29 |
| 2–4 | 0.09 | 0.47 | 0.20 |
| 5–20 | 0.22 | 0.68 | 0.32 |
| more than 20 (bots, relayers, bundlers) | 0.10 | 0.64 | **0.16** |

Every group lost 68–84% beyond what sampling explains, and the busiest senders lost
the most.

One tempting finding did not survive its placebo. 54% of the trough's successful
transactions came from senders never seen in the baseline, but 44–48% do in
ordinary windows too. Those placebos use smaller reference samples, which inflates
the figure, so the difference is modest at most and no evidence of a different
population transacting.

> **Correction, 2026-09-14.** Before tracing, this section was titled "What
> disappeared was successful transactions". It noted that reverted transactions
> held at ~4 per block while successful ones fell, and read that as automated
> traffic (arbitrage, sniping, liquidations) reaching the sequencer by routes
> ordinary users lacked. Traces reverse it:
>
> - **The flat count was a coincidence of opposite moves.** Reverts against one
>   busy bot target, `0x520ed467…`, stopped at 12:32 and resumed around 13:33 on
>   their own schedule, while failed ERC-4337 bundles rose from 0.07 to 1.34 per
>   block.
> - **The busiest senders were cut hardest of all** (table above).

## 4. The dominant bundler could not see its own transactions land

EntryPoint v0.8 bundles on this chain come from one service: 100 EOAs sharing a
`0x4337…` prefix, and essentially no one else. 13% of its bundles reverted in the
baseline, and 77% in the trough.

All 12 failures decoded reverted with `FailedOp(0, "AA25 invalid account nonce")`:
the bundler re-submitted a user operation that was already on-chain. All 115
failures sampled for timing, across the phases that had failures, have an earlier
inclusion of the same operation.

Finding that original inclusion (the `UserOperationEvent` with the same account and
nonce) gives how long the bundler went without noticing it:

```
re-sent at    12:36 12:38 12:40 12:42 12:44 12:46 12:48 12:50 12:52 12:54 12:56 12:58 13:00 13:02 13:04 13:06 13:08
median gap s      5     5     9     7    15    22    98   116    76   169    19     4    13    12    11     3     2
```

That is three failed bundles per two-minute bin, 51 in all. Twelve sampled after
the incident, at 13:20–13:40, gave a median of 2.5 s.

Normally the bundler notices an inclusion within seconds. From 12:44 the gap grows,
reaches 1–3 minutes at 12:48–12:55, is back to seconds by 12:58, and is fully
normal by 13:06. Its re-submissions were landing on-chain the whole time.

The identical values at 12:54 (166, 169 and 169 s) look like a retry timer. Read
the gaps as lower bounds on how long the bundler was blind, not as exact lag.

> **Note, 2026-09-14 (later).** "Blind" is the wrong word. Chainlink's
> transmissions (§7) show submissions being dropped and landing only on
> re-broadcast. That produces the same pattern: the bundler's original bundle
> lands late, after it has already re-bundled the operation. The gaps measure
> how long the original took to get in, not how stale the bundler's view was.

## 5. What does not explain it

**L1 data pricing.** ArbOS's L1 pricer is bursty on this chain; see the third
correction in [recon §3](robinhood-chain-recon.md#3-gasusedforl1-is-zero--l1-data-cost-is-not-charged).
Read once a minute from archive state, `getL1BaseFeeEstimate()` was:

```
12:51:08  0
12:52:07  143,995,461 wei   burst 1 (perL1CalldataByte 2,303,927,376)
12:58:11  143,995,461
12:59:09  0
13:04:15  0
13:05:08  321,536,672 wei   burst 2 (perL1CalldataByte 5,144,586,752), highest in any sample, 09-01..09-14
13:10:13  321,536,672
13:11:11  0
```

That timing cannot drive the collapse:

- burst 1 starts 15 minutes after the onset and two minutes into the trough;
- the trough continues through 12:59–13:04 with L1 pricing off;
- throughput recovers at 13:07, *during* burst 2, the larger one.

L1 data gas was 1.13% of gas in the trough.

**The fee spike.** The congestion price spiked 10× to 3.53 gwei at 12:35–12:38,
coinciding with the onset. It was back at 0.34 gwei by 12:40, though, and stayed
at 0.33–0.34 gwei through the trough. Successful traffic meanwhile stayed low,
around 8–12 transactions per block, and fell further from 12:49 to 12:52. A
collapse in demand caused by price would have recovered with the price. The fee also did not *fall* while load halved, which is worth
understanding but is not evidence of a cause.

**The 13:14–13:19 second dip** is a separate, milder event with a different
signature. Successful traffic was only ~27% down, and the bundler was barely
submitting (0.12 successful bundles per block, none failing) rather than failing
blind.

## 6. What it points to

Taken together:

- the sequencer produced blocks throughout;
- almost every application and every class of sender got ~70–80% fewer successful
  transactions on-chain;
- the one operator whose view can be measured was blind to its own inclusions for
  up to ~3 minutes, while its transactions kept landing.

That places the failure **between clients and the sequencer**. It was not block
production, not one application, and not fees. Two mechanisms fit, and this data
does not separate them:

1. **Nodes serving the chain fell behind the sequencer.** RPC nodes and explorer
   indexers follow the sequencer's feed. If they lagged after the 72–80 Mgas/s
   surge, clients would read stale nonces, balances and quotes, see no
   confirmations, and back off. The explorer would show no new blocks, which is
   what was reported.
2. **The transaction ingress path backed up.** If forwarding to the sequencer
   queued, transactions would land late and clients would time out and retry.
   AA25 is exactly what a retrying bundler produces, and throughput would drop.

Both fit the surge as trigger. Separating them needs one of two things:

- **Operator telemetry:** Robinhood's post-mortem, RPC providers' node-lag
  metrics, or the bundler's own send logs.
- **An on-chain clock.** Oracle price updates carry their publish time in
  calldata. If publish time minus block time jumped in the trough, transactions
  were delayed on the way in (2). If it stayed flat while throughput collapsed, the
  problem was on the read side (1).

A cheap test of the trigger itself: find other minutes that reached 72–80 Mgas/s in
the fortnight, and check whether each was followed by the same collapse.

> **Update, 2026-09-14 (later).** The on-chain clock was run (§7): it was
> mechanism 2, the write path. Chainlink transmissions needed extra broadcasts in
> exactly the window where clients failed. The surge was not the trigger either:
> Robinhood's batch poster had already stalled at 12:29:47, before the surge, when
> Ethereum's fees spiked.

## 7. What caused it: the on-chain evidence

*Added 2026-09-14. The sources are Ethereum mainnet (Robinhood's SequencerInbox,
`0xBd0D173EEb87D57A09521c24388a12789F33ba96`, and its batch poster), Robinhood
Chain archive state, and Chainlink OCR2 events. Contract addresses are from
[Robinhood's docs](https://docs.robinhood.com/chain/protocol-contracts/).*

### The trigger: Ethereum's fees spiked at 12:30

Robinhood Chain posts its blocks to Ethereum in batches. At 12:30 UTC, Ethereum
execution blocks jumped from about half full to 83–84% full, and the base fee took
off:

```
UTC (3-min median)  12:24  12:27  12:30  12:33  12:36  12:39  12:42  12:45  12:48  12:54  13:00  13:06  13:15
base fee (gwei)     0.091  0.099  0.161  0.395  0.785  0.941  1.017  1.437  1.779  1.842  1.427  0.927  0.770
```

At the 12:54 peak that is 18× its 12:00–12:27 level (0.09–0.12 gwei). In most
blocks at 12:30–12:32 no blobs were included at all. Every Ethereum block from
12:00 to 13:30 was read.

### What set off the spike: the US jobs report

*Added 2026-09-15.*

The US Bureau of Labor Statistics released the August employment report at
8:30 a.m. ET on Friday Sep 4, which is 12:30:00 UTC
([BLS](https://www.bls.gov/news.release/empsit.nr0.htm)). Payrolls rose 162,000
against a Dow Jones consensus of 53,000, and rate-hike odds rose. Coverage of the
market reaction agrees on the rest:

- Bitcoin fell more than 2% "within minutes of the release"
  ([Yahoo Finance](https://finance.yahoo.com/markets/crypto/articles/bitcoin-slides-blowout-jobs-report-151328014.html)).
- The crypto market lost roughly $50–70 billion in under half an hour
  ([KuCoin](https://www.kucoin.com/news/flash/crypto-market-loses-50-billion-in-30-minutes-amid-jobs-report-shockwave)).

The measurement below covers every receipt in the 150 Ethereum blocks from 12:20 to
12:50: 45,431 transactions, whose gas adds up to each block's `gasUsed` in all 150.

| per block | 12:20–12:29 (50 blocks) | **12:30–12:35 (30)** | 12:36–12:50 (70) |
| --- | ---: | ---: | ---: |
| gas used ÷ gas limit | 49% | **79%** | 57% |
| transactions | 311 | 284 | 304 |
| failed transactions | 0.9% | **6.7%** | 2.0% |
| Uniswap v2/v3/v4 swaps | 48 | **162** | 76 |
| Chainlink `AnswerUpdated` | 0.3 | **4.9** | 0.8 |
| Aave v3 liquidations | 0 in 50 blocks | 4 in 30 | 1 in 70 |
| priority fees | 0.018 ETH | **0.597 ETH** | 0.060 ETH |

- **The first full block after the release was a bidding war.** Block 25,903,966
  (12:30:23) used 59.9M of its 60M gas and carried 320 swaps. One transaction to
  the unverified contract `0xbdb3ba9f…` used 10.2M gas and paid 12.61 ETH in
  priority fees, against 0.1 ETH for the whole previous block. From 12:30 to 12:35
  that contract took 50 transactions from 18 senders and paid 15.64 of the 17.92
  ETH in priority fees (87%). Its calls use vanity selectors (`0x000000c3`,
  `0xa0000000`), as MEV searcher contracts do.
- **It was a trading rush, not a liquidation cascade.** Swaps tripled and
  Chainlink feeds updated 16× as often. The transaction count did not rise, but
  transactions got heavier and more of them failed, as competing arbitrage does.
  Liquidations stayed near zero.
- **The base fee then compounded.** Ethereum raises the base fee after any block
  more than half full. Blocks ran 77–100% full for five minutes and 50–64% for the
  quarter hour after, which took it from 0.09 gwei to 1.8 gwei by 12:54.

The same news reached Robinhood Chain directly. Its Chainlink feeds logged 82
transmissions in the 12:30 bin against 20 in the half hour before (table below), and
its own load surged to 72–80 Mgas/s at 12:34–12:36 (§2).

As of 2026-09-15 we found no public source connecting the jobs report to Ethereum's
fee spike or to this incident. The link rests on the timing and on what filled the
blocks.

### The batch poster stalled, with no spare capacity

All 872 batches between 11:30 and 14:30 came from one poster, `0xdaa52608…`.
After its batch at 12:29:47, **it got no transaction of any kind mined until
12:38:23**: its Ethereum nonce stayed at 190,818 through 12:36:59. That fits
batches signed at the old price getting stuck, since a blob transaction must also
clear the execution base fee. It stalled again from 12:42:47 to 12:48:11.

> **Correction, 2026-09-15.** The old price was not the problem.
>
> - **Fee cap:** every batch from 12:20 to the stall allowed up to ~1.0 gwei, 10×
>   the base fee at the time. The base fee only passed 1 gwei around 12:40.
> - **Blob fee cap:** 0.055–0.062 gwei, against a blob base fee of 0.006–0.015 gwei
>   through the stall.
>
> What was low was the priority fee. See "Why the poster could not get in" below.

Across the fortnight (70,314 batches, Sep 1–14, none missing from the sequence),
consecutive batches arrive a median 12 s apart, and 99% within 48 s:

- gaps of 300 s or more happened five times;
- **516 s is the longest**;
- Sep 4 is the only day with two long stalls back to back.

Each batch's calldata names the newest L2 block it contains (`newMessageCount − 1`),
so its posting delay is how long that block waited to reach Ethereum:

| Ethereum time (5-min bin) | batches | posting delay of newest block | blob gas price paid | execution gas price paid |
| --- | ---: | ---: | ---: | ---: |
| 12:20 | 28 | 268 s | 0.0057 gwei | 0.098 gwei |
| 12:25 | 30 | 245 s | 0.0051 | 0.097 |
| 12:30 | **0** | — | — | — |
| 12:35 | 1 | 736 s | 0.0152 | 0.987 |
| 12:40 | 21 | 828 s | 0.0378 | 1.059 |
| **12:45** | 25 | **1,041 s** (oldest block 1,091 s) | 0.1052 | 1.743 |
| 12:50 | 55 | 916 s | 0.1190 | 1.721 |
| 12:55 | 27 | 600 s | 0.1104 | 1.817 |
| 13:00 | 16 | 485 s | 0.0834 | 1.386 |
| 13:05 | 18 | 306 s | 0.0570 | 0.934 |
| 13:10 | 24 | 246 s | 0.0525 | 0.867 |

Two things made it worse than a stall:

- **The poster was already behind.** In busy hours it posts about one three-blob
  batch per Ethereum block and does not appear to go faster. Sampled every 20
  minutes over the fortnight, its median posting delay was ~20–40 s off-peak, but
  **~250–280 s from Sep 3 12:00 until 20:24 on Sep 4**: a standing 4½-minute
  backlog. It drained only as load fell after the US market close at 20:00 UTC.
  The delay fell steadily from 238 s at 20:08 to ~20 s at 20:24 while the poster
  kept sending about one batch per Ethereum block.
- **So the stall had nowhere to go.** The backlog peaked at ~18 minutes at 12:45.
  It took until ~13:10 just to return to its standing 4½ minutes.

### Why the poster could not get in: a bottom-of-market tip it did not raise

*Added 2026-09-15. The heading first read "the lowest tip on Ethereum"; see the
correction below.* The sources are the poster's own batch transactions
(`eth_getTransactionByHash`) and every blob transaction in the receipts above:

- all 410 batch transactions from 12:00 to 13:30 on Sep 4;
- all 205 from 13:30 to 14:10 on Sep 11;
- the first batch of every hour from Sep 1 to Sep 14 (333).

**It bid 0.001 gwei.** All 58 Robinhood batches from 12:20 to 12:29:47 carried
exactly that priority fee. The other blob transactions in those minutes averaged
1.15 gwei. They came from 52 different posters over 12:20–12:50.

> **Correction, 2026-09-15 (later).** The average hides a wide spread, and
> Robinhood was not the lowest bidder. Across the 61 other blob transactions from
> 12:20 to 12:29:47:
>
> - **The spread:** the minimum was 0.0001 gwei, the 25th percentile 0.012 and the
>   median 1.0.
> - **Bids as low as Robinhood's:** 10 of them (16%) bid 0.001 gwei or less, from
>   five posters.
> - **A wider sample:** 60 full blocks spread over Sep 1–14 give the same picture.
>   13–18% of other blob transactions bid 0.001 gwei or less; the 25th percentile is
>   0.012 gwei and the median 0.4–1 gwei.
>
> A sample of 60 blocks is small, and the collector's sampled blocks will replace it.
> What the spike did to those five cheap bidders is the more telling result:
>
> | poster | inbox → chain | tip before | during the stall | gap |
> | --- | --- | --- | --- | --- |
> | `0xc1b63485…` | SequencerInbox `0x1c479675…` → **Arbitrum One** (its rollup reports `chainId()` 42161) | 0.001 gwei | none landed | 12:29:11 → 12:39:35 |
> | `0x0c5911d5…` | `0x211e1c4c…` | 0.001 | none landed | 12:24:47 → 12:38:59 |
> | `0xf8ff3e62…` | `0xe28cac16…` | 0.001–0.002 | none landed | 12:25:11 → 12:42:11 |
> | `0x68872466…` | `0xff00…0010` → **OP Mainnet** | 0.001 | **raised to 2.0–4.0 gwei**, 7 landed | 12:28:11 → 12:34:23 |
> | `0x2f40d796…` | `0xffeedd…` | 0.0001 | raised to 0.0032 gwei, 1 landed | 12:22:23 → 12:35:35 |
>
> - **Cheap bids stopped landing.** Every poster that stayed near 0.001 gwei stopped
>   landing until 12:38–12:42, including Arbitrum One's poster, which runs the same
>   Nitro software as Robinhood's. The two that raised their tips got in.
> - **What set Robinhood apart** was not the stall. It was what the stall did to a
>   chain with no spare posting capacity.
> - **Arbitrum One's own health that afternoon** is not examined here.

**Everyone else kept posting.** From 12:29:48 to 12:38:22, Ethereum included 75
blob transactions from 22 other posters, and none from Robinhood. 88% of them
tipped 1 gwei or more, and the lowest tip was 0.0032 gwei, 3× Robinhood's. The
largest are OP Stack chains, whose batch inbox address ends in their chain ID:

| poster | inbox | chain | blob transactions in the stall | lowest tip |
| --- | --- | --- | ---: | ---: |
| `0x5050f69a…` | `0xff00…8453` | Base | 32 | 2.51 gwei |
| `0x68872466…` | `0xff00…0010` | OP Mainnet | 7 | 2.0 gwei |
| `0x2f60a518…` | `0xff00…0130` | Unichain | 5 | 2.0 gwei |
| `0xdbbe3d8c…` | `0xff00…0480` | World Chain | 3 | 5.01 gwei |

**It got in only by re-signing with higher fees:**

- **First stall:** nonce 190,818 finally landed at 12:38:23. Its fee cap had been
  raised to 8.89 gwei (8.5×) and its tip to 0.004 gwei (4×), which reads as a
  replacement transaction.
- **Second stall:** by 12:41:47 the tips were back at 0.001 gwei, and the fee caps
  were ~10× base fee again. Nothing landed from 12:42:47 until 12:48:11, when
  batches arrived with fee caps of 21.2 gwei and tips of 0.002–0.01 gwei.

Both times, the fee cap rose far more than the tip, even though the cap was not
what held the batches back. By 12:48 it was 20× its level before 12:30, while the
tip had risen at most 10×, to 0.01 gwei.

**What this cannot show** is why builders passed over a 0.001 gwei transaction even
in the blocks at 12:36–12:38 that were only 50–65% full. The mechanism inside the
builders is not on-chain. What is on-chain is that Robinhood bid the least, and
paid for it in the one window where that mattered.

> **Correction, 2026-09-15 (later).** It bid at the bottom of the market and did not
> raise its bid, rather than bidding the least; see the table above. The same
> window priced out every poster that stayed near 0.001 gwei.

**Robinhood raised the tip that evening.** Bisecting the poster's batches gives
two changes to its priority fee cap:

| from batch | time (UTC) | tip cap |
| --- | --- | ---: |
| (start of the fortnight) | Sep 1 00:00 | 0.001 gwei, in all 93 hourly samples up to the first change |
| 193,012 | **Sep 4, 20:06:47**, ~7½ h after the stall | **0.5 gwei** (500×) |
| 213,722 | Sep 8, 19:27:23 | 0.25 gwei |

What the change did and did not do:

- **It did not raise posting throughput.** The poster sent 22–26 batches per 4
  minutes on either side of 20:06:47.
- **The backlog drained at that same rate.** It cleared over 20:08–20:28 as US
  trading closed, as described above. Posting did not speed up to clear it.
- **It is cheap.** At 144,456 gas per batch, 0.25 gwei is 0.000036 ETH per batch,
  about 0.18 ETH a day at the fortnight's ~5,100 batches a day. Even 2 gwei would
  be 0.0003 ETH per batch.

**Stalls since the change.** Batch gaps of 300 s or more:

- **On the 0.001 gwei tip:** four in 3.8 days (Sep 2 13:41, Sep 4 09:15, 12:29 and
  12:42).
- **Since the change:** one in 10 days (Sep 11 13:48, exactly 300 s).
- **Through Ethereum fee spikes:** seven spikes of 5× or more hit from Sep 6 to
  Sep 14 (§8). None stalled the poster beyond that one 300 s gap, and a 21.5× spike
  on Sep 6 left its longest gap at 36 s.

The poster also had headroom before every one of those spikes: a backlog of 10–76 s,
against 250 s on Sep 4. So this does not separate the effect of the tip from that of
the load.

### Robinhood's L1 pricer lost its cost data, with no buffer

ArbOS learns what batches cost from batch posting reports.
`ArbGasInfo.getLastL1PricingUpdateTime()`, read from archive state every ~2
minutes, normally advances about every 6 minutes. It stood still from 12:29:47 to
12:38:23, exactly the stall.

The L1 pricing surplus (`getL1PricingSurplus()`) was only 0.0002–0.0033 ETH before
and during the stall. When the expensive batches were finally reported it went
negative (−0.0036 ETH at 12:52), and the pricer switched L1 data fees on: 2.3 gwei
per byte at 12:52, 5.1 gwei per byte at 13:06.

That is where the L1 pricing bursts in §5 come from. It is likely the explanation
for the daily bursts in
[recon §3](robinhood-chain-recon.md#3-gasusedforl1-is-zero--l1-data-cost-is-not-charged)
too: the pricer catching up with batches that cost more than it charged.

### Transactions were dropped on the way in

Chainlink's OCR2 price feeds carry a clock of their own. Each `NewTransmission`
event records `observationsTimestamp`, when the oracle network observed the price.
Block time minus that is how long a finished report took to land.

| Sep 4, 5-min bin | transmissions | inclusion delay: median / p90 / max |
| --- | ---: | --- |
| 12:00–12:29 | 20 | 12–13 / 13 / 73 s |
| 12:30 (price volatility burst) | 82 | 13 / 13 / 16 s |
| 12:35 | 25 | 13 / 13 / 73 s |
| 12:40 | 34 | 13 / **132** / 133 s |
| 12:45 | 72 | 13 / **132** / 133 s |
| **12:50** | 33 | **132 / 193 / 253 s** |
| 12:55 | 25 | 72 / 226 / 298 s |
| 13:00 | 24 | 106 / 193 / 252 s |
| 13:05 | 9 | 73 / 193 / 193 s |
| 13:10–13:24 | 14 | 12–13 / 13 / 72 s |

**The delays come in steps a minute apart:** 13, 72, 132, 193 and 253 s. That is
the transmitter re-broadcasting every 60 seconds. A queued transaction would land
after a continuous spread of delays. These landed only on their 2nd–5th broadcast,
so the earlier broadcasts were dropped.

From 12:40 to 13:10, 111 of 197 transmissions were late. 106 of those landed within
5 s of a 60-second step. They span 28 of the 30 aggregators and all 9 transmitter
addresses active in that window, so this is not one operator's node.

Controls with the same measure:

| window | Ethereum | poster | Chainlink p90 | users |
| --- | --- | --- | --- | --- |
| Sep 3, 12:00–14:00 (307 transmissions) | calm | normal | 13 s | normal |
| **Sep 4, 12:40–13:10** | 9.6× fee spike | 516 s + 324 s stalls, ~18-minute backlog | **132–226 s** | collapse |
| Sep 11, 13:15–14:45 (476 transmissions) | 9.2× fee spike | 300 s stall; delay peaked at ~5 min from a ~25 s norm | 13 s | normal; tx/block rose |

Across the whole fortnight the median inclusion delay is 13 s and the p90 14 s.
That covers 12,339 transmissions (through 20:02 UTC on Sep 14), with block times interpolated between anchors
every 5,000 blocks. **The only 5-minute bins with a p90 of 120 s or more, over at
least 5 transmissions, are on Sep 4.**

After the acute phase they recur intermittently from 14:25 to 16:30 (p90 131–192
s), with lower-grade single retries from 13:25 to 17:15. Ingress stayed degraded,
at a lower level, for most of the afternoon.

Header-level traffic agrees but is not conclusive. Sep 4 ran above the previous
day all morning, then at 0.78–0.83× of it in four of the six half-hours from 15:00
to 17:30. Those counts include reverted transactions, and traffic swings a lot from
one day to the next.

### What it was not

- **A block-production halt.** See §1.
- **A hard throttle.** Nitro's sequencer can refuse every incoming transaction
  ("currently not accepting transactions due to expected surplus being below
  threshold") when its expected surplus falls below a configured hard threshold.
  Expected surplus is the L1 pricing surplus minus the backlog of unposted data at
  the current L1 price, exactly the quantities above, re-evaluated every 5 s
  ([`sequencer.go`](https://github.com/OffchainLabs/nitro/blob/master/execution/gethexec/sequencer.go)).
  But every block from 12:46 to 12:56 was read (5,941 blocks), and there is no
  second without a block and no block without a user transaction. The chain never
  refused everything, even for five seconds.
- **Unhealthy block production.** Blocks per second varied by 3–6% through the
  incident, as at any other time. The occasional catch-up bursts (22–75 blocks in
  one second) also appear at 12:20, before anything started.
- **The Ethereum spike alone, or the stall alone.** Sep 11 had both, without the
  ingress failure.
- **Robinhood's own fee spike, or the 12:34–12:36 load surge.** Both came after
  the poster had already stalled.

### The causal chain, and the link that is not on-chain

What the data supports, in order:

1. **From 12:30:** Ethereum fees spike, from 0.10 to 1.8 gwei by 12:54.
2. **12:29:47–12:38:23:** Robinhood's batch poster gets nothing mined after its
   last batch, and stalls again from 12:42 to 12:48. It was already at its
   capacity ceiling with a 4½-minute backlog.
3. **12:38–13:05:** the backlog peaks at ~18 minutes. The L1 pricer, blind and
   holding ~0.001 ETH of surplus, goes negative and switches L1 fees on.
4. **12:40–13:10:** transactions are dropped at ingress and land only on
   re-broadcast. Successful traffic collapses from 12:37 to 13:20 across nearly
   every application and sender.
5. **13:10–17:15:** the backlog returns to its standing level. Ingress recovers,
   but drops intermittently all afternoon while the poster stays at its ceiling.
6. **20:08–20:24:** load falls after the US close and the backlog drains.

The link from step 3 to step 4 is inferred, not observed:

- **What supports it:** the timing matches, and Nitro's own accounting ties
  unposted backlog and L1 price to transaction admission.
- **What limits it:** the hard form of that throttle is ruled out. Whatever
  dropped the transactions left no on-chain trace, whether a softer path, the
  sequencer's 12-second queue timeout, or Robinhood's RPC and forwarding tier.
- **The counterexample:** on Sep 11 the chain survived the same trigger while the
  poster had headroom.

The most public data supports is this: **the incident happened when an Ethereum fee
spike stalled a batch poster that was already at its capacity ceiling, and
transaction ingress failed while the resulting backlog was at its worst.** Only
Robinhood can close the last link.

> **Update, 2026-09-15.** Steps 1 and 2 are now explained.
>
> - **Step 1** was set off by the US jobs report at 12:30:00, which started an
>   arbitrage bidding war on Ethereum.
> - **Step 2** happened because the poster bid a 0.001 gwei priority fee and was
>   passed over while 22 other rollups kept posting at mostly 1–5 gwei. Its fee
>   caps were not binding.
> - **The counterexample** has a second difference. By Sep 11 the poster's tip was
>   0.25 gwei, after Robinhood raised it at 20:06:47 on Sep 4, so Sep 11 differed
>   in tip as well as headroom. The data cannot say which mattered.
>
> The supported sentence becomes: **an Ethereum fee spike, set off by the US jobs
> report, stalled a batch poster that was bidding the lowest priority fee of any
> rollup and was already at its capacity ceiling. Transaction ingress failed while
> the resulting backlog was at its worst.**
>
> **Correction, 2026-09-15 (later).** Two parts of that update overreach.
>
> - **"The lowest priority fee of any rollup"** should read "a bottom-of-market
>   priority fee it did not raise". Arbitrum One's poster bid the same and stalled
>   longer.
> - **"While 22 other rollups kept posting"** is true, but none of the 22 was bidding
>   near 0.001 gwei by then.
>
> The sentence becomes: **an Ethereum fee spike, set off by the US jobs report,
> priced out every batch poster bidding near 0.001 gwei, Robinhood's among them. On
> Robinhood, which was already at its posting capacity ceiling, the stall turned
> into an 18-minute backlog. Transaction ingress failed while that backlog was at
> its worst.**

## 8. What a monitor would have seen

Every signal below comes from public data: Ethereum logs and headers, and Robinhood
Chain logs, receipts and archive state. The times are when a live monitor running
the rule would have fired. The last column counts fires on other occasions between
Sep 1 and Sep 14. User-facing failures began at 12:37; the press put the start at
12:57.

| signal | source | rule | fires on Sep 4 | ahead of the press report | fires elsewhere, Sep 1–14 |
| --- | --- | --- | --- | ---: | --- |
| **Poster headroom** | batch calldata + L2 block times | 6-hour median posting delay ≥ 4 min | from Sep 3 12:00, continuously | ~25 h | Sep 2 12:00–24:00, no collapse (sampled every 20 min) |
| **Poster silent** | `SequencerBatchDelivered` on Ethereum | no batch for 300 s | **12:34:47** | 22 min | 3: Sep 2 13:41, Sep 4 09:15 and Sep 11 13:48. None was followed by a collapse; after Sep 4 09:15 traffic drifted to 0.6–0.8× for 40 minutes, with Chainlink delays normal |
| **Posting backlog** | batch calldata + L2 block times | newest posted L2 block ≥ 600 s old | **12:35:55** | 21 min | 1 in the samples: Sep 4 morning (677 s). Sampled every 20 min, so short excursions could be missed |
| **Ethereum fee spike** | Ethereum headers | base fee ≥ 5× its level 15 minutes earlier | ~12:35 | ~22 min | at least Sep 11 13:48, no collapse; context, not an alert |
| **Write path** | Chainlink `NewTransmission` | 5-min p90 inclusion delay ≥ 120 s over ≥ 5 transmissions | **12:45** | 12 min | **none** in 1,285 active 5-min bins |
| **Bundler re-sends** | EntryPoint v0.8 receipts | failed (AA25) bundles ≥ 1 per sampled block | 12:37 | 20 min | not yet measured across the fortnight |

Read as a two-stage alarm:

- **Warn** when the poster loses headroom or goes silent. These signals need
  Ethereum data alone. The silence and backlog rules fired 21–22 minutes before
  the press report, and the headroom rule a day earlier. On their own they also
  fired on other days with no user impact.
- **Page** when the write path confirms that submissions are being dropped. In the
  fortnight that fired only during this incident, 12 minutes before the reported
  "halt" began.

Each rule is a time series that can be collected continuously, and replayed for any
past window whose data is still reachable.

### Replayed by the collector (2026-09-15)

> **Update 2026-09-15.** The table above came from the analysis samples. The rules
> are now implemented in `gasmon health` (`gasmon/src/gasmon/health.py`), run over
> the whole fortnight, and shown on the web app's **Chain health** page
> (`apps/web/app/health`). The replay confirms the warn and page timings above.
> Three rows change: the headroom rule does **not** give a day's notice as
> implemented, bundler failures cross their threshold at 12:50 rather than 12:37,
> and a seventh rule (traffic collapse) was added. The table above is kept as it
> was.

**Sample.** Sep 1 00:00 to Sep 14 20:32 UTC, collected on Sep 14:

- **Batches:** every `SequencerBatchDelivered` log, 70,838 of them.
- **Batch decodes:** 3,507 batches' calldata. One every 10 minutes, every batch in
  the two dense windows (Sep 4 11:30–14:30, Sep 11 13:15–14:45), and both edges of
  every gap of 120 s or more.
- **Ethereum headers:** 5,270. One every 25 blocks (~5 minutes), and every block
  in the dense windows.
- **Chainlink:** every `NewTransmission`, 12,292 of them, with real block
  timestamps instead of interpolated ones.
- **Robinhood receipts:** 21,572 blocks. One per minute, and one per ~10 s in the
  dense windows.

Every rule fires only on data available at its fire time.

| rule | severity | as implemented | fires in the incident | vs 12:57 report | vs 12:37 user failures | outside the incident (Sep 4 12:30–17:15) |
| --- | --- | --- | --- | ---: | ---: | --- |
| Poster headroom | watch | trailing 2-hour median, over ≥ 3 slots, of the posting delay at the first decoded batch in each 20-min slot ≥ 240 s | 12:40 to 21:00 | — | — | 7 episodes: Sep 1 21:40, Sep 2 15:00 to Sep 3 01:20, Sep 3 15:20 and 23:40, Sep 4 05:00–10:40, Sep 11 15:20, Sep 12 15:40 |
| Ethereum fee spike | context | base fee ≥ 5× the median of the headers 5–15 min earlier | **12:35:11** (11.2×) | 22 min | 2 min before | 7: Sep 6 16:02 (21.5×), Sep 7 03:49, Sep 9 06:48, Sep 10 12:40, Sep 11 13:51 (7.3×), Sep 12 05:20, Sep 14 15:04 |
| Poster silent | warn | 300 s since the last batch; fires at last batch + 300 s | **12:34:47** (516 s), again 12:47:47 (324 s) | 22 min | 2 min before | 3: Sep 2 13:46:11, Sep 4 09:20:59, Sep 11 13:53:35 |
| Posting backlog | warn | newest posted L2 block ≥ 600 s old, at a decoded batch or during a gap of ≥ 120 s | **12:35:55** to 13:02:47, peak 1,091 s | 21 min | 1 min before | 1: Sep 4 09:20:44, 687 s |
| Write path | page | 5-min p90 inclusion delay ≥ 120 s over ≥ 5 transmissions; fires at bin close | **12:45** to 13:10 (peak 226 s) | 12 min | 8 min after | **none**. The three later Sep 4 episodes (14:30, 15:00–15:55, 16:35) are the afternoon recurrences described in §7 |
| Bundler failures | impact | mean failed bundles per sampled block ≥ 1.0 over 5 min, ≥ 5 samples | **12:50** to 12:55 (3.1 per block) | 7 min | 13 min after | 1: Sep 3 17:10. That bin held 5 sampled blocks with 8 failed bundles |
| Traffic collapse | impact | successful tx per sampled block < 50% of the prior 2-hour median for two consecutive 5-min bins | **13:00** to 13:05 (32% of normal) | 3 min after | 23 min after | none |

The headroom rule uses a 2-hour window where the analysis used 6 hours, so it
tracks the afternoon cycle. It fired most US afternoons from Sep 1 to 4. On Sep 4 it
lapsed at 10:40 and re-armed at 12:40, after the stall. The "~25 h ahead" in the
table above belongs to the 6-hour version. As implemented this is a standing
capacity condition, which is how the page presents it, not a lead indicator.

Bundler failures sit close to the threshold in the first minutes, so the fire time
depends on which blocks are sampled. At one block per ~10 s, the 12:35 and 12:40
bins average 0.74 and 0.57 failed bundles per block (34 and 35 blocks). 12:45
averages 1.6, so the rule fires at that bin's close, 12:50. An earlier smoke run
over a different set of blocks fired at 12:40. The traced sample's 12:37 is when
the failures begin, not when this rule would cross 1.0.

A single 5-min bin below 50% is not a usable alert. At one receipt per minute, the
traffic rule fired 53 times on 12 days other than Sep 4. Requiring two bins in a row
left only the incident. **That persistence requirement was chosen after seeing this
fortnight**, so it still needs checking on data it has not seen.

What it adds up to, as a live monitor on Sep 4:

- **Warn at 12:34:47, two minutes before users started failing.** Ethereum data
  alone is enough. At warn level the poster rules also fired on three other
  occasions in 14 days, none with user impact: Sep 2 13:46, Sep 4 09:20 and Sep 11
  13:53.
- **Page at 12:45, eight minutes into the user failures and 12 minutes before the
  press report.** Across 12,292 transmissions over 14 days, the page fired only on
  Sep 4, during the incident and its afternoon recurrences.
- **Impact confirmed at 12:50 and 13:00.** These rules measure harm rather than
  predict it. They are what an operator would watch to tell when it is over.
  The collapse ended by 13:20 (§2), and the last ingress page fired at 16:35.

The Sep 11 control replays as expected: a fee spike at 13:51:35 (7.3×) and a
poster-silent warning at 13:53:35. No page and no impact alert followed, and the
Chainlink delay stayed flat.

### A risk the rules miss: the poster's bid (2026-09-15)

None of the seven rules looks at *how* the poster bids, and the biggest avoidable
risk on Sep 4 was visible there for days:

- **The poster's tip was 0.001 gwei from at least Sep 1.** The other rollups whose
  blobs were included beside it paid about a thousand times more.
  *(Correction, 2026-09-15 later: a thousand times the **median**. About 15% of
  other blob transactions bid as low, and the spike priced them all out. The
  risk is bidding in the bottom of the market without raising the bid when blocks
  get competitive, not being the only low bidder.)*
- **That data is public.** The poster's batch transactions and every other blob
  transaction are on Ethereum.

A **"poster underbidding"** watch would compare the poster's priority fee with the
fees of the blob transactions actually included, per block. It would have fired
continuously from Sep 1 to 20:06:47 on Sep 4, then gone quiet. Its most useful
message would have come days ahead: *your batches are the first thing a builder
drops when Ethereum gets busy*.

It is not implemented in `gasmon health`. Because it would have fired
continuously before the incident, it describes a standing risk and gives no lead
time.

> **Update, 2026-09-15 (later): implemented and replayed.** `gasmon health`
> implements it as `poster_underbid` (watch). The Chain health page and the
> Overview's Ethereum strip show it.
>
> **Sample.** One full Ethereum block per 20 minutes from Sep 1 to Sep 14, plus every
> block in the two replay windows: 2,311 blocks and 5,747 blob transactions. Plus
> the poster's priority fee on all 3,507 decoded batches. The bids match the
> receipt-derived `blob-txs-2026-09-04-1220_1250.csv` exactly (391 of 391), and the
> poster fees match `batch-poster-fees-2026-09-01_14.csv` (945 of 945).
>
> **Rule.** At most 25% of other rollups' blob bids included over the past 24 hours
> (regular samples only) were below the poster's priority fee.
>
> **Result.**
>
> - **One continuous episode from Sep 1 11:30:23 to Sep 4 20:00:23.** It starts
>   once enough bids had been sampled, and ends at the last batch before the tip
>   change. The market median ran 1,000× the poster's bid.
> - **It was active through the whole incident**, not as a countdown but as the
>   condition every live warning then built on.
> - **After the fix it fired twice more, both weakly.** On Sep 5–7, at 0.5 gwei, the
>   median was 2× the bid. On Sep 11 08:00–19:10, at 0.25 gwei, it was 4×. The
>   Sep 11 stretch covers that day's 300 s stall. The market's 25th percentile rose
>   from 0.012 to 0.1 gwei after Sep 4.
>
> **Caveats.**
>
> - **In-sample choices.** At 10% the rule yields only the Sep 1–4 episode, and at
>   50% it fires all fortnight. The 25% threshold was fixed before these results, on
>   a 60-block look. The 24 h window replaced 6 h after measuring that 6 h seldom
>   held the 30 bids required. Both were chosen on this fortnight.
> - **"Days before" is literal for this collection only.** The data starts on Sep 1,
>   so the rule cannot show how long before that the bid had been 0.001 gwei.

## How it was traced

**Sample.** Every 10th block from 54,266,140 to 54,308,000 (12:30–13:40 UTC):
4,187 blocks, 63,803 user transactions and 2.35M call frames. They were traced with
`gasmon collect --exact-code` against `robinhood.drpc.org`. All four conservation
checks pass. All 22,207 addresses resolved to the code they had at the analysed
block, none at `latest`.

**Access.** These blocks are ~8.5M behind head, well past the ~1.2M blocks the free
trace endpoint keeps. drPC's keyless endpoint is the only one found that serves
them, as of 2026-09-14; see the
[endpoint correction in the recon](robinhood-chain-recon.md#rpc-endpoints-and-which-ones-trace).

**Cost.** The run took about 75 minutes end to end, keyless, at 1.0–1.5 blocks/s
including receipts and code resolution. Two blocks failed with HTTP 408 and a
re-run filled them. The database is 620 MB. By estimate, about 20,000 requests
reach the trace endpoint: one trace per block, about half the block and receipt
reads, and code reads two addresses at a time. That is well under $1 on drPC's
pay-as-you-go plan ($6 per million requests, flat across methods).

**Collector fixes.** Two `gasmon` changes made this possible, both on 2026-09-14:

- **Batch size.** Keyless drPC answers any JSON-RPC batch of 5 or more with HTTP
  500, which failed every block whose receipt batch landed on it. The RPC client
  now learns a batch ceiling per endpoint, and receipts come from one
  `eth_getBlockReceipts` per block.
- **Code at the right block.** For a days-old window the collector resolved code
  at `latest`, which misattributes EIP-7702 re-delegations made since.
  `collect --exact-code` reads it from the archive at the analysed block first.

**Evidence for §7–§8.** None of it needs a key:

- **Ethereum logs:** `eth.drpc.org` serves `eth_getLogs` over 100-block ranges,
  and its logs include `blockTimestamp`. This gave all 70,314 batch deliveries
  from Sep 1 to Sep 14. Publicnode refuses historical logs without a token.
- **Ethereum blocks and receipts:** every Ethereum block from 12:00 to 13:30, the
  receipts of all 872 batches from 11:30 to 14:30, and the poster's nonce at 13
  blocks around the stall.
- **Batch calldata:** decoded for those 872 batches, for one batch every 20
  minutes across the fortnight, and for every batch around 20:08–20:36.
- **Robinhood logs:** the official endpoint serves `eth_getLogs` over 50,000-block
  ranges. This gave all 12,339 Chainlink transmissions from Sep 1 to 20:02 UTC on Sep 14.
- **Archive state:** `ArbGasInfo` read every ~2 minutes from 11:59 to 13:43
  through `robinhood.drpc.org`.
- **Every L2 block** from 12:46 to 12:56 and from 13:24 to 13:30, plus 2-minute
  windows of consecutive blocks from 12:20 to 13:34.

**Added 2026-09-15** (all keyless, through `eth.drpc.org`):

- **Ethereum receipts and blocks:** every receipt in the 150 Ethereum blocks
  12:20–12:50, 45,431 transactions. Each block's receipts sum exactly to its
  header `gasUsed`. The full blocks came along for selectors, builder tags and
  proposer payments.
- **The poster's bids:** 948 batch transactions, read with
  `eth_getTransactionByHash` and their receipts for fee caps and tips. The tip
  changes were found by bisecting batch sequence numbers.
- **The jobs report:** the release time and figures come from the BLS release, and
  the market reaction from press coverage, both cited in §7.

## Reproducing this

```bash
RH=https://rpc.mainnet.chain.robinhood.com     # headers, receipts and logs: fine at any age
ARCHIVE=https://robinhood.drpc.org             # historical state and traces

# The reported start, and the absence of a gap
cast block 54282091 --rpc-url $RH -f timestamp                       # 1788526620 = 12:57:00 UTC
for b in 54276000 54280000 54284000 54288000; do
  cast block $b --rpc-url $RH -f timestamp; done                    # ~404 s per 4,000 blocks

# Throughput: gasUsed and tx count per block; subtract the ArbOS 0x6a tx
cast block 54282091 --rpc-url $RH --json | jq '{gasUsed, n: (.transactions|length)}'

# Revert and L1 shares: receipts carry status and gasUsedForL1
curl -s $RH -H 'content-type: application/json' --data \
  '{"jsonrpc":"2.0","id":1,"method":"eth_getBlockReceipts","params":["0x33c476b"]}' \
  | jq '[.result[] | select(.type!="0x6a") | {gasUsed, gasUsedForL1, status}]'

# L1 pricer and congestion price at a historical block (archive state)
cast call 0x000000000000000000000000000000000000006c "getL1BaseFeeEstimate()(uint256)" \
  --block 54279200 --rpc-url $ARCHIVE                                # 143995461 (burst 1)
cast call 0x000000000000000000000000000000000000006c \
  "getPricesInWei()(uint256,uint256,uint256,uint256,uint256,uint256)" \
  --block 54270800 --rpc-url $ARCHIVE                                # congestion 3.53 gwei

# Trace the window, name the code, and compare the trough with the hour after
cd gasmon
PYTHONPATH=src python3 -m gasmon collect --from-block 54266140 --to-block 54308000 --stride 10 \
  --rpc $RH --trace-rpc $ARCHIVE --exact-code --workers 4 --db incident.db
PYTHONPATH=src python3 -m gasmon sources --limit 80 --trace-rpc $ARCHIVE --db incident.db
PYTHONPATH=src python3 -m gasmon diff --a 54295830-54308000 --b 54277930-54288099 --per block --db incident.db

# Why a bundle failed: the callTracer output is FailedOp(uint256,string), selector 0x220266b6
curl -s $ARCHIVE -H 'content-type: application/json' --data \
  '{"jsonrpc":"2.0","id":1,"method":"debug_traceTransaction","params":["<tx hash>",{"tracer":"callTracer"}]}' \
  | jq -r .result.output

# When the operation first landed: UserOperationEvent, topic2 = the account from handleOps calldata,
# nonce = first data word. Use the official endpoint; keyless drPC refuses eth_getLogs past ~100 blocks.
curl -s $RH -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_getLogs","params":[{
  "address":"0x4337084d9e255ff0702461cf8895ce9e3b5ff108","fromBlock":"<block-2000>","toBlock":"<block>",
  "topics":["0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f",null,"<account, 32-byte>"]}]}'
```

For §7–§8:

```bash
L1=https://eth.drpc.org
INBOX=0xbd0d173eeb87d57a09521c24388a12789f33ba96
BATCH=0x7394f4a19a13c7b92b5bb71033245305946ef78452f7b4986ac1390b5df4ebd7   # SequencerBatchDelivered

# Batch deliveries: 100-block ranges on keyless drPC; blockTimestamp is in each log
curl -s $L1 -H 'content-type: application/json' --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getLogs\",\"params\":[{
  \"address\":\"$INBOX\",\"topics\":[\"$BATCH\"],\"fromBlock\":\"0x18b4353\",\"toBlock\":\"0x18b43b6\"}]}"   # 12:28–12:48 UTC

# Newest L2 block in a batch: addSequencerL2BatchFromBlobs(seq, delayedRead, refunder, prevCount, newCount)
cast tx <batch tx hash> input --rpc-url $L1 | cut -c 267-330   # newMessageCount (5th word); newest block = it − 1

# The stalled poster: its nonce does not move from 12:29:47 to 12:36:59
cast nonce 0xdaa526086787d9debe1d7f3ffdb1fe50cf8687f4 --block 25903963 --rpc-url $L1   # 12:29:47 → 190818
cast nonce 0xdaa526086787d9debe1d7f3ffdb1fe50cf8687f4 --block 25903999 --rpc-url $L1   # 12:36:59 → 190818

# Robinhood's L1 pricer: last cost update and surplus, from archive state
cast call 0x000000000000000000000000000000000000006c "getLastL1PricingUpdateTime()(uint256)" --block 54277400 --rpc-url $ARCHIVE
cast call 0x000000000000000000000000000000000000006c "getL1PricingSurplus()(int256)" --block 54279200 --rpc-url $ARCHIVE

# Chainlink write-path clock: NewTransmission; observationsTimestamp is the 3rd data word
curl -s $RH -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_getLogs","params":[{
  "topics":["0xc797025feeeaf2cd924c99e9205acb8ec04d5cad21c41ce637a38fb6dee6016a"],"fromBlock":"0x33bc240","toBlock":"0x33c858f"}]}'   # 12:00–13:24, ≤ 50,000 blocks
# inclusion delay = block timestamp − observationsTimestamp

# (added 2026-09-15) The bidding war in the first full block after the jobs report (12:30:23).
# Priority fees paid = (effectiveGasPrice − the block's baseFeePerGas) × gasUsed
cast block 25903966 -f baseFeePerGas --rpc-url $L1                  # 88283617
curl -s $L1 -H 'content-type: application/json' --data \
  '{"jsonrpc":"2.0","id":1,"method":"eth_getBlockReceipts","params":["0x18b435e"]}' \
  | jq -c '.result[] | select(.to=="0xbdb3ba9ffe392549e1f8658dd2630c141fdf47b6") | {gasUsed, effectiveGasPrice}'
# → 0x9b6ac1 at 0x12055d01c06 wei: 12.61 ETH in priority fees

# The poster's bid: priority fee and fee cap on a batch transaction (hex wei)
cast tx <batch tx hash> --json --rpc-url $L1 | jq -r '.maxPriorityFeePerGas, .maxFeePerGas'   # 0xf4240 = 0.001 gwei before 20:06:47 on Sep 4
cast tx 0xf67acc8b08845ca109f64eaeb79f9fe8ccc934dc5f3ad161ebbac42d60adbd61 --json --rpc-url $L1 \
  | jq -r .maxPriorityFeePerGas                                     # batch 193,012: 0x1dcd6500 = 0.5 gwei
```

The phase tables are `GROUP BY`s over `txs` (`recipient`, `sender`, `status`) joined
to `code` for code length. The sender placebo compares before plus the first half of
after against the second half of after.

Keep batches to 3 or fewer against the keyless drPC endpoint. Against the official
one, keep them to 25–40 and back off on 429, which it returns readily once requests
run in parallel.
