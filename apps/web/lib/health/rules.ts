/**
 * The alert rules, as the page describes them. The evaluation itself lives in the
 * collector (`gasmon/src/gasmon/health.py`), which writes finished episodes to
 * `alerts`; this module only names and explains them, so change both together.
 *
 * Imported by client components directly rather than passed through the
 * snapshot: it carries formatting functions, which cannot cross the server →
 * client boundary.
 */

import type { RuleId, RuleInfo, Severity } from "./types"

const seconds = (s: number) =>
  s >= 90 ? `${(s / 60).toFixed(1)} min` : `${Math.round(s)} s`

export const RULES: RuleInfo[] = [
  {
    id: "poster_headroom",
    severity: "watch",
    label: "Poster has no headroom",
    source: "Batch calldata on Ethereum",
    condition: "Median posting delay over the past 2 hours ≥ 4 min",
    peakLabel: (p) => `median ${seconds(p)}`,
  },
  {
    id: "l1_fee_spike",
    severity: "context",
    label: "Ethereum fee spike",
    source: "Ethereum block headers",
    condition: "Base fee ≥ 5× its level 5–15 minutes earlier",
    peakLabel: (p) => `${p.toFixed(1)}×`,
  },
  {
    id: "poster_silent",
    severity: "warn",
    label: "Batch poster silent",
    source: "SequencerBatchDelivered on Ethereum",
    condition: "No batch reaches Ethereum for 300 s",
    peakLabel: (p) => `silent ${seconds(p)}`,
  },
  {
    id: "posting_backlog",
    severity: "warn",
    label: "Posting backlog",
    source: "Batch calldata on Ethereum",
    condition: "Newest L2 block on Ethereum is ≥ 600 s old",
    peakLabel: (p) => `${seconds(p)} behind`,
  },
  {
    id: "write_path",
    severity: "page",
    label: "Transactions dropped at ingress",
    source: "Chainlink OCR2 transmissions",
    condition: "5-min p90 inclusion delay ≥ 120 s over ≥ 5 transmissions",
    peakLabel: (p) => `p90 ${seconds(p)}`,
  },
  {
    id: "bundler_failures",
    severity: "impact",
    label: "ERC-4337 bundles failing",
    source: "EntryPoint receipts",
    condition: "≥ 1 failed bundle per sampled block over 5 min",
    peakLabel: (p) => `${p.toFixed(1)} per block`,
  },
  {
    id: "user_impact",
    severity: "impact",
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
