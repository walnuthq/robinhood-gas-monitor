# Robinhood Chain gas monitoring

Walnut project. Goal: measure gas usage on Robinhood Chain per contract, function
and source line, publish "The State of Gas on Robinhood Chain", and use it to sell
a compiler-optimisation engagement. Full brief in `spec/robinhood-chain-gas-monitor.md`.

## Layout

This is a mixed repo: a pnpm/Turborepo JS monorepo (the future live-monitoring web
app) plus a standalone Python collector. They share a root and nothing else.

```
spec/         analysis documents, written to be read by humans outside Walnut
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
- `spec/profiling.md`, `spec/profiling-a-deployed-contract.md` — soldb line-level profiling
- `spec/building-the-dashboard.md` — **read before editing `apps/web`**: Base UI vs
  Radix, recharts 3, Turbopack, static export, and how to talk about sampled data
- `gasmon/README.md` — data model, commands, invariants

Docs carry dated inline corrections rather than being silently rewritten, because
several conclusions have already reversed. Keep that convention.

## Chain facts (verify before quoting — this chain changes fast)

- Robinhood Chain = **chain ID 4663**, Arbitrum Nitro, **ArbOS 116**. Explorer is
  Blockscout (Etherscan does not index it). Sourcify **does** support 4663.
- **Endpoints are not interchangeable.** `rpc.mainnet.chain.robinhood.com` serves
  `eth_*` only — no `debug_*`, and no historical state past a few hours.
  `rpc.ordofi.network` serves `debug_traceBlockByNumber` + historical state,
  keylessly. For volume, buy archive access (drPC, GetBlock).
- **Trace history is ~2–3 days.** ~856,000 blocks/day. The Sept 2026 fee peak is
  already unreachable. Collect continuously or pay for archive.
- **Capacity is a rate, not a block budget.** The Nitro block gas limit is a
  placeholder (`0x4000000000000`). Never write "% of block space".
- `ArbGasInfo.getGasAccountingParams()` reports a 7 Mgas/s speed limit, but the
  chain has sustained 51 Mgas/s. The precompile is not reporting the effective value.

## Things that reversed — do not re-derive from stale notes

- **L1 data pricing flipped ON around 2026-09-11.** It was 0% of gas on 09-08 and
  8.87% on 09-11 (`getL1BaseFeeEstimate()` 0 → 264,924,236 wei). L1 data gas is
  not execution and is not reducible by codegen. Re-measure before quoting any
  savings figure. This also makes **calldata size** a first-class optimisation
  lever alongside execution gas and code size.
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

## Style

Do not publish numbers without saying what sample they came from. Several early
figures here were wrong because they came from a 121-second window; daily
aggregates and independent cross-checks (growthepie API) caught them.
