import { Minus, TrendingDown, TrendingUp } from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { cn } from "@workspace/ui/lib/utils"

import {
  formatDelta,
  formatGas,
  formatMgas,
  formatPercent,
} from "@/lib/gas/format"
import type { GasKpis, Kpi, SampleMeta } from "@/lib/gas/types"

/**
 * On a gas dashboard "up" is not automatically good: rising gas per transaction
 * is congestion, rising verified coverage is progress. Each card declares which
 * direction is favourable so the trend is coloured by meaning, not by sign.
 */
type Favourable = "up" | "down" | "neutral"

function TrendBadge({ kpi, favourable }: { kpi: Kpi; favourable: Favourable }) {
  if (kpi.delta === null) {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        <Minus />
        no prior window
      </Badge>
    )
  }
  const rising = kpi.delta >= 0
  const good =
    favourable === "neutral" ? null : rising === (favourable === "up")
  return (
    <Badge
      variant="outline"
      className={cn(
        good === true && "text-emerald-600 dark:text-emerald-500",
        good === false && "text-amber-600 dark:text-amber-500"
      )}
    >
      {rising ? <TrendingUp /> : <TrendingDown />}
      {formatDelta(kpi.delta)}
    </Badge>
  )
}

function KpiCard({
  label,
  value,
  unit,
  kpi,
  favourable,
  headline,
  detail,
}: {
  label: string
  value: string
  unit?: string
  kpi: Kpi
  favourable: Favourable
  headline: string
  detail: string
}) {
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums @[16rem]/card:text-3xl">
          {value}
          {unit ? (
            <span className="text-muted-foreground ml-1 text-base font-normal">
              {unit}
            </span>
          ) : null}
        </CardTitle>
        <CardAction>
          <TrendBadge kpi={kpi} favourable={favourable} />
        </CardAction>
      </CardHeader>
      <CardFooter className="flex-col items-start gap-1 text-sm">
        <div className="line-clamp-1 font-medium">{headline}</div>
        <div className="text-muted-foreground text-xs">{detail}</div>
      </CardFooter>
    </Card>
  )
}

export function KpiCards({
  kpis,
  meta,
}: {
  kpis: GasKpis
  meta: SampleMeta
}) {
  return (
    <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
      <KpiCard
        label="Total gas"
        value={formatGas(kpis.totalGas.value)}
        kpi={kpis.totalGas}
        favourable="neutral"
        headline="Block gas over the window"
        detail={`Σ blocks.gas_used across ${meta.blocksSampled.toLocaleString("en-US")} sampled blocks`}
      />
      <KpiCard
        label="Gas per transaction"
        value={formatGas(kpis.gasPerTx.value)}
        kpi={kpis.gasPerTx}
        favourable="down"
        headline="Weight, not volume"
        detail="The metric that drove the September spike — transactions got heavier, not just more numerous"
      />
      <KpiCard
        label="Throughput"
        value={formatMgas(kpis.throughputMgas.value)}
        unit="Mgas/s"
        kpi={kpis.throughputMgas}
        favourable="neutral"
        headline="Capacity is a rate here"
        detail="Nitro's block gas limit is a placeholder; the real constraint is gas per second"
      />
      <KpiCard
        label="Source-verified gas"
        value={formatPercent(kpis.verifiedShare.value)}
        kpi={kpis.verifiedShare}
        favourable="up"
        headline="Analyzable at line level"
        // The share is of gas whose sources were actually looked up; saying so
        // stops it reading as "the rest is unverified" when it is unchecked.
        detail={`Of the ${formatPercent(kpis.verifiedCoverage, 0)} of gas whose code identity was checked against Sourcify`}
      />
    </div>
  )
}
