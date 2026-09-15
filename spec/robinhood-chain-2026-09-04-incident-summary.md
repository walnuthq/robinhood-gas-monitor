# Robinhood Chain didn't halt on Sep 4. Here's what actually happened.

**Status:** public summary, draft for a thread — 2026-09-15
**Full analysis:** [robinhood-chain-2026-09-04-incident.md](robinhood-chain-2026-09-04-incident.md)
(every number below is sourced and reproducible there, with the datasets in
[`data/incident-2026-09-04/`](data/incident-2026-09-04/))

## TL;DR

- **The report:** block production stopped for 14+ minutes from ~12:57 UTC,
  at the chain's all-time fee peak. Robinhood has not published a cause.
- **The chain:** it never stopped. Blocks kept coming at ~9.9 per second the
  whole time.
- **What broke:** getting transactions *in*. For ~40 minutes (12:37–13:20),
  submissions were silently dropped and users got 70–80% fewer successful
  transactions.
- **The trigger:** the US jobs report at 12:30 UTC set off a bidding war for
  Ethereum block space. Robinhood's batch poster posts the chain's data to
  Ethereum. It was bidding the lowest tip of any rollup, and it got nothing in for
  8½ minutes while other rollups kept posting. It had no spare capacity either,
  so its backlog grew to 18 minutes.
- **Could it have been caught?** Yes, from public data. A monitor would have
  warned at 12:34:47 and paged at 12:45, 12 minutes before the first "halt"
  headline.

## 1. Blocks never stopped

Robinhood Chain is an Arbitrum Nitro L2. Its sequencer timestamps every block it
produces. Across 12:30–13:40 UTC (4,200 blocks sampled, one in every 10), the
largest gap between samples is 3 seconds. A 14-minute halt would leave an
840-second hole, and there isn't one.

The "~8,400 missed blocks" in the coverage is arithmetic (14 min × 10 blocks/s),
not an observation. The reports cited block explorer data. An explorer that
stops indexing looks exactly like a halted chain.

## 2. What users actually hit

From 12:37, nearly everything lost traffic at once:

- **Throughput:** at the worst point (12:50–13:06), gas throughput fell to 21
  Mgas/s, against ~56 right after.
- **Apps:** the median busy app kept only 19% of its successful transactions. None
  kept 80%. Swaps, bridges, trading terminals, wallets and bots all fell together.
- **Account abstraction:** the main ERC-4337 bundler's failure rate went from 13%
  to 77%. It was re-sending user operations that had already landed, because its
  originals were landing minutes late.

## 3. Proof that transactions were dropped on the way in

Chainlink price updates carry the time the oracles observed the price. Block time
minus that is how long an update took to get on-chain.

Normally that's 13 seconds. From 12:40 to 13:10, 111 of 197 updates were late,
and the delays came in clean one-minute steps: 72, 132, 193 and 253 s. That's the
transmitter re-broadcasting every 60 seconds. Its earlier attempts weren't slow,
they were dropped. This hit all 9 transmitters and 28 of 30 feeds, so it wasn't
one operator's problem.

## 4. The trigger: a jobs report, a bidding war, and the lowest bid on Ethereum

An L2 has to post its transaction data to Ethereum. On Robinhood Chain one batch
poster does this, and it competes for block space like everyone else.

- **12:30:00, the US jobs report.** Payrolls came in at 162,000 against 53,000
  expected, and Bitcoin fell 2% within minutes. Bots raced to reprice DEX pools on
  Ethereum:
  - the first full block after the release (12:30:23) carried a single
    transaction paying **12.6 ETH in priority fees**;
  - for five minutes blocks ran ~80% full, with swaps up 3× and priority fees 33×
    normal;
  - the base fee compounded from ~0.1 to 1.8 gwei by 12:54.
- **12:29:47–12:38:23: Robinhood's batches stop landing.** Its fee cap wasn't the
  problem: it allowed 10× the base fee. Its **tip was 0.001 gwei, the lowest of any
  rollup.** During the stall Ethereum still included 75 blob transactions from 22
  other rollups, among them Base, OP Mainnet, Unichain and World Chain, mostly
  tipping 1–5 gwei. Robinhood got none in until it re-signed with higher fees.
  The same thing happened again from 12:42 to 12:48.
- **It was already at its limit.** In busy hours it was posting about one
  3-blob batch per Ethereum block. That left a standing 4½-minute backlog from
  Sep 3 midday until the Sep 4 evening close.
- **So the stall had nowhere to go.** The backlog of blocks not yet on Ethereum
  peaked at **~18 minutes** at 12:45. Transactions were being dropped while it was
  at its worst.
- **Robinhood raised the tip 500× that evening:** from 0.001 to 0.5 gwei at 20:06:47
  UTC, and to 0.25 gwei on Sep 8. At ~145k gas per batch, 0.25 gwei costs about
  0.00004 ETH per batch.

**The control case:** on Sep 11, Ethereum spiked about as hard (9.2× vs 9.6× on
the same measure) and the poster stalled for 5 minutes. Nothing broke. By then the
poster had slack *and* a 250× higher tip, and the data can't say which of the two
saved it.

**The limit of the evidence:** Nitro's sequencer has logic that ties unposted
backlog and L1 prices to accepting transactions. Its hard "stop everything" mode
is ruled out: in the worst ten minutes, every second still had blocks with user
transactions. Two things aren't visible on-chain:

- how the backlog turned into dropped submissions inside Robinhood's
  infrastructure;
- why builders skipped a 0.001 gwei batch even in blocks that weren't full.

Only Robinhood and the builders can confirm those.

## 5. What would have kept it from getting this bad

1. **Bid like it matters.** A batch poster competes with MEV bots for block space.
   Robinhood's bid the minimum, and when its batches stuck it raised the fee cap,
   the setting that wasn't holding them back, far more than its tip. The rollups
   that kept posting through the spike tipped 1–5 gwei. Even a 2 gwei tip costs
   about 0.0003 ETH per batch. Set a competitive tip by default, and raise it fast
   when batches stop landing. Robinhood raised its tip the same evening.
2. **Give the batch poster headroom.** A poster running at its ceiling for days
   turns any Ethereum hiccup into a long backlog. Posting capacity should cover
   peak hours with room to spare.
3. **Fail loudly, not silently.** When ingress can't keep up, a clear "retry
   later" error or a higher fee beats dropping submissions. Silent drops make every
   wallet, bot and bundler retry blind, which is how the bundler ended up
   re-sending operations that had already landed.
4. **Say what's actually happening.** The chain never halted, but the "halt"
   story is what stuck. A public status signal would have changed that: "blocks
   are fine, submissions are being dropped, retry".

## 6. How a monitoring dashboard would have helped

We rebuilt this as a live-style monitor on public data only: Ethereum logs and
headers, Robinhood Chain receipts, and Chainlink events. We replayed Sep 1–14 with
each alert firing only on data available at that moment. You can explore the
replay on the
[Chain health dashboard](https://walnuthq.github.io/robinhood-gas-monitor/health/).

| When (UTC) | What the dashboard showed | What it enables |
| --- | --- | --- |
| **Sep 1–4, every hour sampled** | Poster tipping 0.001 gwei, when the rollups beside it on Sep 4 paid ~1 gwei. *Public data, not yet a dashboard rule* | Fix the bid days ahead (fix 1) |
| **Sep 1–3, every US afternoon** | *Watch:* poster has no headroom (median posting delay ≥ 4 min) | Capacity planning days ahead (fix 2) |
| **Sep 4, 09:20** | *Warn:* 6-min poster stall, 11-min backlog; ingress stayed healthy | A dress rehearsal, 3 hours early |
| **12:34:47** | *Warn:* batch poster silent for 5 min | Re-bid stuck batches with a real tip (fix 1), 2 min before users start failing |
| **12:35:55** | *Warn:* posting backlog ≥ 10 min | Same, confirmed |
| **12:45** | *Page:* Chainlink updates delayed, so transactions are being dropped | Shed load loudly, alert integrators, post a status (fixes 3–4). 12 min before the headlines |
| **12:50 / 13:00** | *Impact:* bundles failing, successful traffic at 32% of normal | Gauge the damage, track recovery |

**Noise check across 14 days:**

- **The page** fired only on Sep 4: during the incident and when drops briefly
  recurred that afternoon. It stayed quiet on the other 13 days, across 12,292
  Chainlink updates.
- **Warnings** fired 3 other times, and no collapse followed any of them.

**Caveats:** the rules were designed with Sep 4 in view and have been checked on
14 days of data, not years. Keep it running and the thresholds get tested on
incidents they haven't seen.

*Revised 2026-09-15, the day it was drafted: added the jobs-report trigger, and
corrected why the poster stalled (its tip, not its fee cap).*
