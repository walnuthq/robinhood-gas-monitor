"use client"

import * as React from "react"

import { EthereumLinkCards } from "@/components/ethereum-link-cards"
import { BlockLink } from "@/components/explorer-link"
import { GasChart } from "@/components/gas-chart"
import { GasEatersTable } from "@/components/gas-eaters-table"
import { KpiCards } from "@/components/kpi-cards"
import type { DashboardSnapshot } from "@/lib/gas/data"
import { formatTimestamp } from "@/lib/gas/format"
import { DEFAULT_PERIOD, type Period } from "@/lib/gas/types"
import type { EthereumLink } from "@/lib/health/types"

/**
 * Owns the selected window and slices the pre-materialised snapshot with it, so
 * changing period drives the KPIs, the chart and the table together rather than
 * the chart alone.
 *
 * Every window is embedded in the page because a static export cannot fetch on
 * demand. That is fine at this size, but once real extracts arrive and windows
 * get large, this should become a route segment — `app/[period]/page.tsx` with
 * `generateStaticParams()` — so each window is its own pre-rendered HTML page
 * and the payload stays proportional to what is on screen.
 */
export function DashboardView({
  snapshot,
  ethereumLink,
}: {
  snapshot: DashboardSnapshot
  /** From the chain-health collection, which has its own window; null without one. */
  ethereumLink: EthereumLink | null
}) {
  const [period, setPeriod] = React.useState<Period>(DEFAULT_PERIOD)

  const kpis = snapshot.kpis[period]
  const series = snapshot.series[period]
  const consumers = snapshot.consumers[period]
  const meta = snapshot.meta[period]

  return (
    <div className="@container/main flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      {ethereumLink ? <EthereumLinkCards link={ethereumLink} /> : null}

      <KpiCards kpis={kpis} meta={meta} />

      <GasChart
        data={series}
        period={period}
        onPeriodChange={setPeriod}
        meta={meta}
      />

      <GasEatersTable consumers={consumers} />

      {/* Provenance, deliberately on screen: a gas figure without its sample is
          not a finding. */}
      <p className="text-muted-foreground text-xs">
        Blocks{" "}
        <BlockLink blockNumber={meta.firstBlock}>
          {meta.firstBlock.toLocaleString("en-US")}
        </BlockLink>
        –
        <BlockLink blockNumber={meta.lastBlock}>
          {meta.lastBlock.toLocaleString("en-US")}
        </BlockLink>{" "}
        ·{" "}
        {meta.blocksSampled.toLocaleString("en-US")} sampled
        {meta.stride > 1 ? ` (1 in ${meta.stride})` : ""} ·{" "}
        ~{meta.transactions.toLocaleString("en-US")} transactions · collected{" "}
        {formatTimestamp(meta.collectedAt)} UTC
      </p>
    </div>
  )
}
