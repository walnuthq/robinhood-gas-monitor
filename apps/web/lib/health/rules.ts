/**
 * The alert rules, as the page describes them. The evaluation itself lives in the
 * collector (`gasmon/src/gasmon/health.py`), which writes finished episodes to
 * `alerts`; this module only names and explains them, so change both together.
 *
 * Imported by client components directly rather than passed through the
 * snapshot: it carries formatting functions, which cannot cross the server →
 * client boundary.
 */

import type { Horizon, RuleId, RuleInfo, Severity } from "./types"

const seconds = (s: number) =>
  s >= 90 ? `${(s / 60).toFixed(1)} min` : `${Math.round(s)} s`

export const RULES: RuleInfo[] = [
  {
    id: "poster_underbid",
    severity: "watch",
    horizon: "days",
    label: "Poster bids at the bottom of the market",
    source: "Batch and blob transactions on Ethereum",
    condition:
      "At most 25% of the blob bids included over the past 24 hours were below the poster's priority fee",
    peakLabel: (p) =>
      `market median ${p >= 10 ? Math.round(p).toLocaleString("en-US") : p.toFixed(1)}× its bid`,
  },
  {
    id: "poster_headroom",
    severity: "watch",
    horizon: "days",
    label: "Poster has no headroom",
    source: "Batch calldata on Ethereum",
    condition: "Median posting delay over the past 2 hours ≥ 4 min",
    peakLabel: (p) => `median ${seconds(p)}`,
  },
  {
    id: "l1_fee_spike",
    severity: "context",
    horizon: "minutes",
    label: "Ethereum fee spike",
    source: "Ethereum block headers",
    condition: "Base fee ≥ 5× its level 5–15 minutes earlier",
    peakLabel: (p) => `${p.toFixed(1)}×`,
  },
  {
    id: "poster_silent",
    severity: "warn",
    horizon: "minutes",
    label: "Batch poster silent",
    source: "SequencerBatchDelivered on Ethereum",
    condition: "No batch reaches Ethereum for 300 s",
    peakLabel: (p) => `silent ${seconds(p)}`,
  },
  {
    id: "posting_backlog",
    severity: "warn",
    horizon: "minutes",
    label: "Posting backlog",
    source: "Batch calldata on Ethereum",
    condition: "Newest L2 block on Ethereum is ≥ 600 s old",
    peakLabel: (p) => `${seconds(p)} behind`,
  },
  {
    id: "write_path",
    severity: "page",
    horizon: "during",
    label: "Transactions dropped at ingress",
    source: "Chainlink OCR2 transmissions",
    condition: "5-min p90 inclusion delay ≥ 120 s over ≥ 5 transmissions",
    peakLabel: (p) => `p90 ${seconds(p)}`,
  },
  {
    id: "bundler_failures",
    severity: "impact",
    horizon: "during",
    label: "ERC-4337 bundles failing",
    source: "EntryPoint receipts",
    condition: "≥ 1 failed bundle per sampled block over 5 min",
    peakLabel: (p) => `${p.toFixed(1)} per block`,
  },
  {
    id: "user_impact",
    severity: "impact",
    horizon: "during",
    label: "Successful traffic collapsed",
    source: "Robinhood receipts",
    condition:
      "Successful tx per block < 50% of the 2-hour median for two 5-min bins in a row",
    peakLabel: (p) => `${Math.round(p * 100)}% of normal`,
  },
]

export const RULE_BY_ID = Object.fromEntries(
  RULES.map((r) => [r.id, r])
) as Record<RuleId, RuleInfo>

/** The page's sections, in reading order. */
export const HORIZONS: { id: Horizon; label: string; detail: string }[] = [
  {
    id: "days",
    label: "Days before",
    detail: "standing risks in the chain's link to Ethereum",
  },
  {
    id: "minutes",
    label: "Minutes before",
    detail: "the link is failing now; users are not yet affected",
  },
  {
    id: "during",
    label: "During",
    detail: "users are affected; these confirm and track the damage",
  },
]

export const HORIZON_LABEL = Object.fromEntries(
  HORIZONS.map((h) => [h.id, h.label])
) as Record<Horizon, string>

/**
 * Status colours, not series colours: each means a state and always ships with
 * an icon and a label. Warning sits below 3:1 on the light card by design — the
 * label is what carries it there.
 */
export const SEVERITY: Record<
  Severity,
  { label: string; color: string; order: number }
> = {
  watch: { label: "Watch", color: "var(--muted-foreground)", order: 0 },
  context: { label: "Context", color: "var(--muted-foreground)", order: 1 },
  warn: { label: "Warn", color: "#fab219", order: 2 },
  page: { label: "Page", color: "#d03b3b", order: 3 },
  impact: { label: "Impact", color: "#ec835a", order: 4 },
}
