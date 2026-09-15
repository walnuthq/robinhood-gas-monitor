/**
 * Types for the Chain health page, mirroring what `gasmon health` stores
 * (see `gasmon/src/gasmon/health.py`).
 *
 * Every time here is Unix **milliseconds**, the unit recharts' numeric time axis
 * and `Date` both take, so nothing converts on the way to a chart.
 */

/**
 * How loud a rule is, which is also what its colour means.
 *
 *   watch    a risk indicator, true for long stretches — no one should be woken
 *   context  something happening elsewhere that explains what follows
 *   warn     the operator's infrastructure is under strain
 *   page     users' transactions are being dropped
 *   impact   users are measurably affected (lagging, confirms a page)
 */
export type Severity = "watch" | "context" | "warn" | "page" | "impact"

export type RuleId =
  | "poster_underbid"
  | "poster_headroom"
  | "poster_silent"
  | "posting_backlog"
  | "l1_fee_spike"
  | "write_path"
  | "bundler_failures"
  | "user_impact"

/**
 * How far ahead of the damage a rule speaks, which is how the page is organised.
 *
 *   days     standing risks: true for long stretches before anything breaks
 *   minutes  live warnings: the chain's link to Ethereum is failing now
 *   during   confirmation: users are already affected
 */
export type Horizon = "days" | "minutes" | "during"

export interface RuleInfo {
  id: RuleId
  severity: Severity
  horizon: Horizon
  label: string
  /** Where the signal comes from, in the reader's terms. */
  source: string
  /** The rule as a sentence, thresholds included. */
  condition: string
  /** How to read the episode's `peak`. */
  peakLabel: (peak: number) => string
}

export interface AlertEpisode {
  rule: RuleId
  severity: Severity
  /** When a live monitor would have fired. */
  start: number
  /** When the condition last held. */
  end: number
  peak: number
}

/** A stretch with no batch reaching Ethereum. */
export interface Silence {
  from: number
  to: number
}

export interface TimePoint {
  t: number
}

export interface FeePoint extends TimePoint {
  /** Ethereum base fee, gwei. */
  gwei: number
}

export interface PostingPoint extends TimePoint {
  /** Age of the newest L2 block this batch carried when it reached Ethereum, seconds. */
  delay: number
}

export interface OraclePoint extends TimePoint {
  /** Block time minus the report's observation time, seconds. */
  delay: number
}

export interface OracleBin extends TimePoint {
  /** 90th percentile inclusion delay in the bin, seconds. */
  p90: number
  n: number
}

export interface TrafficPoint extends TimePoint {
  /** Successful user transactions per sampled block. */
  ok: number
  /** Failed ERC-4337 bundles per sampled block. */
  bundlesFailed: number
  /** Blocks behind the mean. */
  n: number
}

/**
 * What other rollups paid to get their blobs into Ethereum: priority-fee
 * percentiles of the blob transactions included in a bin, gwei. Robinhood's own
 * batches are excluded, so the band is the market it was bidding against.
 * `t` is the bin's start. The 25th percentile is the `poster_underbid` line: a
 * bid at or below it has at most a quarter of the market under it.
 */
export interface BidBand extends TimePoint {
  p25: number
  p50: number
  p75: number
  /** Blob transactions behind the percentiles. */
  n: number
}

export interface PosterBid extends TimePoint {
  /** The batch poster's priority fee cap, gwei. */
  gwei: number
}

export interface Annotation {
  t: number
  label: string
}

export interface ReplayWindow {
  id: string
  label: string
  summary: string
  from: number
  to: number
  annotations: Annotation[]
  fees: FeePoint[]
  bids: BidBand[]
  posterBids: PosterBid[]
  posting: PostingPoint[]
  silences: Silence[]
  oracle: OraclePoint[]
  oracleBins: OracleBin[]
  traffic: TrafficPoint[]
  alerts: AlertEpisode[]
}

export interface FortnightView {
  from: number
  to: number
  bids: BidBand[]
  posterBids: PosterBid[]
  posting: PostingPoint[]
  oracleBins: OracleBin[]
  fees: FeePoint[]
  traffic: TrafficPoint[]
  silences: (Silence & { seconds: number })[]
  alerts: AlertEpisode[]
}

/** Provenance: never show a signal without the sample behind it. */
export interface HealthMeta {
  collectedAt: number
  from: number
  to: number
  batches: number
  decodes: number
  ethereumBlocks: number
  /** Full Ethereum blocks read for blob-market bids, and the blob txs in them. */
  bidBlocks: number
  blobTxs: number
  transmissions: number
  robinhoodSamples: number
  l1Rpc: string
  l2Rpc: string
  decodeEverySeconds: number
  ethereumEverySeconds: number
  bidsEverySeconds: number
  robinhoodEverySeconds: number
}

export interface HealthSnapshot {
  replays: ReplayWindow[]
  fortnight: FortnightView
  meta: HealthMeta
  hasData: boolean
}

/**
 * The Overview's summary of Robinhood's link to Ethereum, as of the end of the
 * health collection — which is not the gas collection's window.
 */
export interface EthereumLink {
  asOf: number
  baseFeeGwei: number
  baseFeeMax24hGwei: number
  posterTipGwei: number
  /** Share of blob bids included over the past 24 h that were below the poster's. */
  shareBelowPoster: number
  marketP50Gwei: number
  /** The poster_underbid rule's condition holds at the latest decoded batch. */
  underbidding: boolean
  backlogSeconds: number
  longestGap24hSeconds: number
}
