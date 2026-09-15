# Robinhood Chain gas monitoring

Walnut project. Goal: measure gas usage on Robinhood Chain per contract, function
and source line, publish "The State of Gas on Robinhood Chain", and use it to sell
a compiler-optimisation engagement. Full brief in `spec/robinhood-chain-gas-monitor.md`.

## Layout

This is a mixed repo: a pnpm/Turborepo JS monorepo (the future live-monitoring web
app) plus a standalone Python collector. They share a root and nothing else.

```
spec/         analysis documents, written to be read by humans outside Walnut
spec/data/    the datasets behind them (CSV + a slim SQLite extract), each folder with a README
gasmon/       the collector: a stdlib-only Python package (pip install -e ./gasmon)
apps/web      Next.js app  ]  shadcn/ui monorepo template; pnpm workspaces are
packages/ui   components   ]  globbed as apps/* and packages/* only, so gasmon/
packages/*    tooling      ]  at the root is deliberately outside the workspace
```

`AGENTS.md` carries the Next.js rules for the JS side; this file covers the gas
work. Read `gasmon/README.md` before touching the collector, and
`spec/building-the-dashboard.md` before touching `apps/web` — it records the
traps hit building it, several of which fail silently rather than erroring.

- `spec/robinhood-chain-gas-monitor.md` — the original business memo (Roman Mazur)
- `spec/gas-monitor-approach-review.md` — 10 flaws in the first proposed pipeline, each measured
- `spec/robinhood-chain-recon.md` — Robinhood Chain's gas model; **read this first**
- `spec/robinhood-chain-2026-09-04-incident.md` — the reported 09-04 halt, which is
  not in the blocks; its cause as far as public data shows (§7) and the alert rules
  that would have caught it (§8)
- `spec/robinhood-chain-2026-09-04-incident-summary.md`: the same incident for a
  public audience (thread draft), covering what happened, proposed fixes and what
  the monitor showed. Keep its numbers in step with the full write-up.
- `spec/profiling.md`, `spec/profiling-a-deployed-contract.md` — soldb line-level profiling
- `spec/building-the-dashboard.md` — **read before editing `apps/web`**: Base UI vs
  Radix, recharts 3, Turbopack, static export, and how to talk about sampled data
- `gasmon/README.md` — data model, commands, invariants; "Chain health" covers
  `gasmon health`, which writes `apps/web/data/health.db` (refresh with
  `pnpm health:refresh`) for the dashboard's `/health` page. The alert rules live
  in `gasmon/src/gasmon/health.py`, and their labels in `apps/web/lib/health/rules.ts`;
  change both together.

Docs carry dated inline corrections rather than being silently rewritten, because
several conclusions have already reversed. Keep that convention.

## Chain facts (verify before quoting — this chain changes fast)

- Robinhood Chain = **chain ID 4663**, Arbitrum Nitro, **ArbOS 116**. Explorer is
  Blockscout (Etherscan does not index it). Sourcify **does** support 4663.
- **Endpoints are not interchangeable.** `rpc.mainnet.chain.robinhood.com` serves
  `eth_*` only — no `debug_*`, and no historical state past a few hours.
  `rpc.ordofi.network` serves `debug_traceBlockByNumber` + historical state,
  keylessly, for the last ~1.2M blocks (~1.4 days). `robinhood.drpc.org` serves
  **archive traces and state back to launch**, keylessly as of 2026-09-14, and its
  output passes `gasmon verify`. For volume, use drPC pay-as-you-go ($6/1M
  requests, flat across methods). GetBlock's shared public endpoint has no history.
- **The free trace window is ~1.4 days; archive is not.** ~856,000 blocks/day.
  The Sept 2026 fee peak *is* reachable via drPC (corrected 2026-09-14, it was
  written off as unreachable). Keep collecting continuously anyway: keyless drPC
  access may be withdrawn.
- **Capacity is a rate, not a block budget.** The Nitro block gas limit is a
  placeholder (`0x4000000000000`). Never write "% of block space".
- `ArbGasInfo.getGasAccountingParams()` reports a 7 Mgas/s speed limit, but the
  chain has sustained 51 Mgas/s. The precompile is not reporting the effective value.

## Things that reversed — do not re-derive from stale notes

- **L1 data pricing is bursty, not switched on** (reversed twice). 09-08 read 0%
  and 09-11 read 8.87%, and both were single snapshots. Hourly archive reads
  show the pricer non-zero in 37 of 264 reads from 09-01 to 09-11, in bursts of
  5–8 minutes, and zero in all 70 reads since. Receipts every ~20 min (962 blocks,
  09-01..09-14) give **0.18% of gas, or 0.016% without one 38% block**. Quote it
  as "well under 1%, bursty", with the sample. Still strip `gasUsedForL1` per tx.
  Calldata size is a secondary lever, not a headline.
- **The 09-04 "14-minute block-production halt" is not in the blocks.** Timestamps
  are continuous at 9.89 blocks/s. Traced (4,187 blocks): degraded 12:37–13:20
  UTC, right after a 72–80 Mgas/s surge, worst 12:50–13:06 (21 vs ~55 Mgas/s).
  The loss hit nearly every entry contract (median busy contract kept 19%) and
  every sender class, busy bots included (placebo-adjusted). The dominant 4337
  bundler went up to ~3 min without seeing its own ops land (AA25 re-sends,
  median gap 73 s vs 2.5 s normally).
  **Cause, as far as public data goes (spec §7):**
  - the US jobs report (12:30:00 UTC, 162k vs 53k expected) set off an arbitrage
    bidding war on Ethereum. Blocks ran ~80% full with 33× normal priority fees,
    and the base fee compounded 18× by 12:54;
  - Robinhood's batch poster, tipping **0.001 gwei** (bottom of the market, not
    the lowest: ~15% of blob bids are that low; fee caps were 10× base fee, so
    not stale), got nothing in for 516 s, the longest gap in 70,314 batches since
    Sep 1. The spike priced out *every* poster that stayed near 0.001 gwei,
    Arbitrum One's included (12:29–12:39). OP Mainnet's raised its tip to 2–4 gwei
    and kept posting. Robinhood raised the tip to 0.5 gwei at 20:06:47 that evening
    (0.25 from Sep 8). "Stuck at the old fee cap" and "lowest of any rollup" were
    both wrong (corrected 2026-09-15);
  - the poster was already at its ceiling (~1 three-blob batch per L1 block,
    standing 4.5-min backlog), so the backlog hit ~18 min;
  - ingress then dropped txs from 12:40 to 13:10: Chainlink OCR2 inclusion delay
    ran in 60 s re-broadcast steps.
  Sep 11 had the same trigger without failure, but with headroom *and* a 250×
  higher tip, which can't be separated. The backlog→drop link is inferred;
  Nitro's hard surplus throttle is ruled out. Don't claim more than that.
- **Revert waste is not low.** 6.55% of gas and 13.9% of txs (962 blocks,
  09-01..09-14), 40% of txs on 09-10. The recon's 0.5% was one block.
- **Congestion is easing.** Fees peaked at $8.36M/day on 2026-09-04 and fell 74%
  in three days. The memo's $4.45M figure is Sept 2, on the way up.
- **The congestion was a weight problem, not a volume problem** — transactions
  rose 1.30× while gas *per transaction* rose 1.70×. Lead reports with gas/tx.
- **The memecoin attribution in the memo is unverified.** Top apps by count are
  Uniswap, Reservoir and ERC-4337; 48.8% of traffic is unlabeled. Our own
  per-contract ranking is what would settle it (`PonsV2MemeHook` and a
  `LaunchToken` clone group are the first direct evidence).

## Measurement rules (these are the whole point)

- The measurement is **exclusive self-gas**: `frame.gasUsed − Σ children.gasUsed`.
  Frame gas is inclusive; naive summing inflates 4.79× and inverts the ranking.
- **Aggregate by code identity, not address.** 6,311 addresses → 3,366 code
  identities in one sample.
- Strip **intrinsic gas, L1 data gas and refunds** before attributing the root
  frame — `callTracer` reports the receipt value there, not execution gas.
- `Σ self_gas_raw == block.gasUsed` must hold exactly. It is a gate, not a report.
- Verification is a property of **code**, looked up by **address** — hence the
  `verification` table (address grain) plus the `code_verification` view (code grain).

## Gotchas

- Drop ArbOS internal transactions (type `0x6a`): `gasUsed = 0` with non-zero children.
- 23-byte code is an EIP-7702 designator `0xef0100||address`; verification must be
  looked up on the delegate. In active use here.
- `soldb profile` double-counts its denominator (same inclusive-gas bug) — do not
  quote its percentages until fixed. Its line *ordering* is still sound.
- Sourcify returns unverified as either HTTP 404 or 200 with `match: null`.
- **Serial beats parallel on the trace endpoint.** Measured: 3 blocks took 30s at
  1 worker and 59s at 2 — concurrent requests are throttled, not served. A block
  costs ~10s end to end, and latency is wildly variable (16s and 138s observed on
  adjacent blocks), so `pnpm gas:refresh` caps each block and the whole run.
- Route `eth_getCode` to the **official** endpoint, not the trace one: 40
  addresses took 2.6s there against 66.5s on the trace node. It has no state past
  a few hours, so fall back to `latest` before falling back to the archive node.
- `node:sqlite` must be reached via `process.getBuiltinModule`, not `import` —
  Turbopack's dev shim breaks both a static import and `createRequire`.
- Blockscout's API is behind Cloudflare and 403s scripted requests.
- **Ethereum history, keyless:** `eth.drpc.org` serves `eth_getLogs` in 100-block
  ranges with `blockTimestamp`; publicnode refuses. Robinhood's official RPC
  serves `eth_getLogs` over 50,000 blocks at any age. SequencerInbox
  `0xBd0D173EEb87D57A09521c24388a12789F33ba96`; batch poster `0xdaa52608…`.
- Keyless drPC returns **HTTP 500 for JSON-RPC batches of 5+** (3 works). The
  gasmon RPC client learns a per-endpoint batch ceiling (halves on refusal), so
  this is handled. Don't reintroduce fixed batch sizes. For windows older than a
  few hours, pass `collect --exact-code`, or code resolves at `latest`
  (`code.block_read = -1`).

## Style

Do not publish numbers without saying what sample they came from. Several early
figures here were wrong because they came from a 121-second window; daily
aggregates and independent cross-checks (growthepie API) caught them.
