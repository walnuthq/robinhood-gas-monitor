/**
 * Types mirroring the `gasmon` SQLite schema (see `gasmon/README.md`).
 *
 * These deliberately match what the collector already stores, so swapping
 * placeholder data for a real extract is a change of source, not of shape.
 */

/**
 * Windows the dashboard can aggregate over.
 *
 * Capped at 72h because that is the trace endpoint's retention — roughly 2.8
 * days, rounded down. Offering 7d would invite questions the data cannot answer.
 */
export type Period = "1h" | "6h" | "24h" | "48h" | "72h"

export const PERIODS: { value: Period; label: string; short: string; hours: number }[] = [
  { value: "1h", label: "Last hour", short: "1h", hours: 1 },
  { value: "6h", label: "Last 6 hours", short: "6h", hours: 6 },
  { value: "24h", label: "Last 24 hours", short: "24h", hours: 24 },
  { value: "48h", label: "Last 48 hours", short: "48h", hours: 48 },
  { value: "72h", label: "Last 72 hours", short: "72h", hours: 72 },
]

export const PERIOD_HOURS: Record<Period, number> = Object.fromEntries(
  PERIODS.map((p) => [p.value, p.hours])
) as Record<Period, number>

export const DEFAULT_PERIOD: Period = "24h"

/**
 * A headline metric with its change against the preceding window of equal
 * length. `delta` is a ratio (0.042 = +4.2%), null when there is no comparable
 * prior window — which is the honest answer near the edge of trace retention.
 */
export interface Kpi {
  value: number
  delta: number | null
}

export interface GasKpis {
  /** Σ blocks.gas_used over the window. */
  totalGas: Kpi
  /** Σ blocks.gas_used / Σ blocks.tx_count. The weight metric, not the volume one. */
  gasPerTx: Kpi
  /** Σ blocks.gas_used / elapsed seconds, in Mgas/s. Capacity here is a rate. */
  throughputMgas: Kpi
  /**
   * Share of *checked* attributed self-gas that is verified on Sourcify (0–1).
   * Identities the collector never looked up are excluded rather than counted
   * as unverified — see `verifiedCoverage` for how much was checked.
   */
  verifiedShare: Kpi
  /** Fraction of attributed gas whose sources were looked up at all (0–1). */
  verifiedCoverage: number
}

/**
 * One sampled block, expressed as a **rate** rather than a total.
 *
 * The sample is sparse and evenly spaced, so plotting per-block totals would
 * make the y-axis depend on how densely we happened to sample. Gas per second
 * does not: it is comparable across windows and across runs, and it is the
 * quantity that actually describes capacity on this chain.
 *
 * The three components are disjoint and sum to the block's gas, which is the
 * invariant `gasmon verify` enforces:
 *   Σ self_gas + intrinsic + L1 data == block.gasUsed
 */
export interface GasPoint {
  /** Block timestamp, ISO 8601. */
  t: string
  /** The sampled block, so a point can link out to the explorer. */
  block: number
  /** Attributed contract execution, gas/second. */
  execution: number
  /** 21,000 + calldata. Belongs to no contract. */
  intrinsic: number
  /** ArbOS L1 data posting. Not execution, not reducible by codegen. */
  l1Data: number
}

/**
 * A row of the gas-eaters table: one **code identity**, not one address.
 * Templates deployed at many addresses collapse to a single row — ranking by
 * address would scatter a memecoin factory across thousands of them.
 */
export interface GasConsumer {
  /** `frames.code_id` — blake2b-128 of runtime code, the grouping key. */
  codeId: string
  /** Contract name from Sourcify, null when unverified. */
  name: string | null
  /** A representative address from the group, for linking out. */
  address: string
  /** Σ frames.self_gas — exclusive gas. Never the inclusive `gas_used`. */
  selfGas: number
  /** selfGas as a share of block gas over the window (0–1). */
  share: number
  /** Number of frames entering this code. */
  calls: number
  /** selfGas / calls. Separates "expensive because popular" from "inefficient". */
  gasPerCall: number
  /** Deployed runtime size in bytes, null for EOAs and precompiles. */
  codeLen: number | null
  /** Verified in its own right, or via a byte-identical twin. */
  verified: boolean
  /** Addresses sharing this code identity. */
  addresses: number
}

/** Provenance for every figure on screen. Never show numbers without it. */
export interface SampleMeta {
  firstBlock: number
  lastBlock: number
  blocksSampled: number
  /** Mean blocks between samples: the window's span divided by what we traced. */
  stride: number
  transactions: number
  collectedAt: string
  /**
   * Blocks in the window divided by blocks sampled. Extensive quantities —
   * total gas, a contract's self-gas, call counts — are estimates scaled by
   * this. Ratios (shares, gas per call, verified coverage) need no scaling.
   */
  scale: number
  /** False when the collector wrote nothing for this window. */
  hasData: boolean
}
