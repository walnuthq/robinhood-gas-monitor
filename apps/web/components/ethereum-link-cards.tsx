import Link from "next/link"
import { ArrowRight } from "lucide-react"

import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"

import { SeverityIcon } from "@/components/health/severity-badge"
import { formatDayClock, formatDuration, formatGwei } from "@/lib/health/format"
import type { EthereumLink, Severity } from "@/lib/health/types"

interface LinkCard {
  label: string
  value: string
  /** Set when the matching Chain health rule's condition holds. */
  status?: { severity: Severity; text: string }
  detail: string
}

/**
 * Robinhood Chain settles on Ethereum through its batch poster, and on Sep 4 that
 * link was where the trouble started. This strip puts it next to the gas
 * figures; `/health` has the history and the rules behind each card.
 *
 * Status is an icon plus words, never colour alone, and only appears when a rule's
 * condition holds; a card without one is not claiming "healthy", just "no rule
 * fires".
 */
export function EthereumLinkCards({ link }: { link: EthereumLink }) {
  const cards: LinkCard[] = [
    {
      label: "Ethereum base fee",
      value: formatGwei(link.baseFeeGwei),
      detail: `24-hour high ${formatGwei(link.baseFeeMax24hGwei)} · what every rollup's batches pay to land`,
    },
    {
      label: "Poster's bid vs the blob market",
      value: formatGwei(link.posterTipGwei),
      status: link.underbidding
        ? { severity: "watch", text: "Bottom of the market" }
        : undefined,
      detail: `${Math.round(link.shareBelowPoster * 100)}% of blob bids in the past 24 h were lower · market median ${formatGwei(link.marketP50Gwei)} · watch when 25% or fewer`,
    },
    {
      label: "Posting backlog",
      value: formatDuration(link.backlogSeconds),
      status:
        link.backlogSeconds >= 600
          ? { severity: "warn", text: "Backlog ≥ 10 min" }
          : undefined,
      detail:
        "Age of the newest Robinhood block when the latest batch reached Ethereum · warn at 10 min",
    },
    {
      label: "Longest poster gap, 24 h",
      value: formatDuration(link.longestGap24hSeconds),
      status:
        link.longestGap24hSeconds >= 300
          ? { severity: "warn", text: "Poster went silent" }
          : undefined,
      detail: "Between consecutive batches on Ethereum · warn at 5 min",
    },
  ]

  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h2 className="text-sm font-medium">Ethereum settlement</h2>
          <p className="text-xs text-muted-foreground">
            As of {formatDayClock(link.asOf)} UTC, the end of the chain-health
            collection
          </p>
        </div>
        <Link
          href="/health"
          className="inline-flex items-center gap-1 text-xs font-medium underline-offset-4 hover:underline"
        >
          Chain health
          <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label} className="@container/card">
            <CardHeader>
              <CardDescription>{c.label}</CardDescription>
              <CardTitle className="text-2xl font-semibold tabular-nums @[16rem]/card:text-3xl">
                {c.value}
              </CardTitle>
            </CardHeader>
            <CardFooter className="flex-col items-start gap-1 text-sm">
              {c.status ? (
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <SeverityIcon
                    severity={c.status.severity}
                    className="size-3.5"
                  />
                  {c.status.text}
                </span>
              ) : (
                <span className="text-muted-foreground">No rule firing</span>
              )}
              <span className="text-xs text-muted-foreground">{c.detail}</span>
            </CardFooter>
          </Card>
        ))}
      </div>
    </section>
  )
}
