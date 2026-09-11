"use client"

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"

import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@workspace/ui/components/chart"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/toggle-group"

import {
  formatBucketLabel,
  formatGas,
  formatGasRate,
  formatTimestamp,
} from "@/lib/gas/format"
import { PERIODS, type GasPoint, type Period, type SampleMeta } from "@/lib/gas/types"

/**
 * The three series are disjoint and stack to block gas, which is exactly the
 * identity `gasmon verify` asserts:
 *   Σ self_gas + intrinsic + L1 data == block.gasUsed
 * So the chart doubles as a decomposition: the top edge is total gas, and the
 * bands show how much of it no amount of compiler work could ever reduce.
 */
/**
 * A sequential ramp, not a categorical one: these are parts of a whole, so one
 * hue stepped light-to-dark is the correct encoding.
 *
 * Steps 1/2/4 rather than 1/2/3 — the theme's adjacent steps 2 and 3 sit at
 * ΔE 11.4 for normal vision, below the readable floor, and the two upper bands
 * are the thin ones that most need separating. Steps 2 and 4 measure ΔE 17.6
 * (17.5 under protanopia). Bands are additionally separated by a 2px gap in the
 * surface colour rather than by an outline.
 */
const chartConfig = {
  execution: { label: "Execution", color: "var(--chart-1)" },
  intrinsic: { label: "Intrinsic", color: "var(--chart-2)" },
  l1Data: { label: "L1 data", color: "var(--chart-4)" },
} satisfies ChartConfig

export function GasChart({
  data,
  period,
  onPeriodChange,
  meta,
}: {
  data: GasPoint[]
  period: Period
  onPeriodChange: (period: Period) => void
  meta: SampleMeta
}) {
  // Points are rates, so the window total is the mean rate times its duration
  // — summing the points would depend on how densely we sampled.
  const meanRate = data.length
    ? data.reduce((sum, p) => sum + p.execution + p.intrinsic + p.l1Data, 0) /
      data.length
    : 0
  const total = data.reduce(
    (sum, p) => sum + p.execution + p.intrinsic + p.l1Data,
    0
  )
  const seriesTotals: Record<keyof typeof chartConfig, number> = {
    execution: data.reduce((sum, p) => sum + p.execution, 0),
    intrinsic: data.reduce((sum, p) => sum + p.intrinsic, 0),
    l1Data: data.reduce((sum, p) => sum + p.l1Data, 0),
  }

  return (
    <Card className="@container/chart">
      <CardHeader>
        <CardTitle>Gas usage over time</CardTitle>
        <CardDescription>
          Gas per second at each sampled block, split into execution, intrinsic
          and L1 data posting
        </CardDescription>
        <CardAction>
          {/* Toggle on wide viewports, select on narrow — same state either way. */}
          {/* Base UI toggle groups are array-valued and single-select by
              default, so the one selected period arrives as a one-item array. */}
          <ToggleGroup
            value={[period]}
            onValueChange={(value) => {
              const next = value[0]
              if (next) onPeriodChange(next as Period)
            }}
            variant="outline"
            className="hidden @3xl/chart:flex"
          >
            {PERIODS.map((p) => (
              <ToggleGroupItem key={p.value} value={p.value} className="px-3">
                {p.short}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Select
            value={period}
            onValueChange={(value) => onPeriodChange(value as Period)}
          >
            <SelectTrigger
              className="w-36 @3xl/chart:hidden"
              aria-label="Select a time period"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIODS.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>

      {data.length === 0 ? (
        <div className="text-muted-foreground flex h-[260px] flex-col items-center justify-center gap-1 px-6 text-center text-sm">
          <p className="font-medium">No blocks sampled in this window</p>
          <p className="text-xs">
            The collector stopped before reaching this far back. Run{" "}
            <code className="font-mono">BLOCKS=14 TIME_BUDGET=900 pnpm gas:refresh</code>{" "}
            for deeper history.
          </p>
        </div>
      ) : (
      <ChartContainer
        config={chartConfig}
        className="aspect-auto h-[260px] w-full px-4 sm:px-6"
      >
        <AreaChart data={data} margin={{ left: 4, right: 4, top: 4 }}>
          <CartesianGrid vertical={false} />
          {/* One point per sampled block, so there are few enough ticks that
              recharts can space them itself. */}
          <XAxis
            dataKey="t"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={32}
            interval="preserveStartEnd"
            tickFormatter={(value: string) => formatBucketLabel(value, period)}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            width={48}
            tickFormatter={(value: number) => formatGas(value)}
          />
          <ChartTooltip
            cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
            content={
              <ChartTooltipContent
                labelFormatter={(value, payload) => {
                  const block = payload?.[0]?.payload?.block as
                    | number
                    | undefined
                  return `${formatTimestamp(String(value))}${
                    block ? ` · block ${block.toLocaleString("en-US")}` : ""
                  }`
                }}
                formatter={(value, name) => (
                  <>
                    <div
                      className="size-2.5 shrink-0 rounded-[2px]"
                      style={{
                        backgroundColor: `var(--color-${String(name)})`,
                      }}
                    />
                    <span className="text-muted-foreground">
                      {chartConfig[name as keyof typeof chartConfig]?.label ??
                        name}
                    </span>
                    <span className="ml-auto font-mono font-medium tabular-nums">
                      {formatGasRate(Number(value))}
                    </span>
                  </>
                )}
              />
            }
          />
          {/* Painted bottom-up so execution sits at the base of the stack.
              Animation is off: periods switch in place, and re-animating three
              stacked areas on every toggle reads as a wobble, not as feedback. */}
          <Area
            dataKey="execution"
            type="natural"
            stackId="gas"
            fill="var(--color-execution)"
            fillOpacity={1}
            stroke="var(--card)"
            strokeWidth={2}
            isAnimationActive={false}
          />
          <Area
            dataKey="intrinsic"
            type="natural"
            stackId="gas"
            fill="var(--color-intrinsic)"
            fillOpacity={1}
            stroke="var(--card)"
            strokeWidth={2}
            isAnimationActive={false}
          />
          <Area
            dataKey="l1Data"
            type="natural"
            stackId="gas"
            fill="var(--color-l1Data)"
            fillOpacity={1}
            stroke="var(--card)"
            strokeWidth={2}
            isAnimationActive={false}
          />
        </AreaChart>
      </ChartContainer>
      )}

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 pt-3 text-xs sm:px-6">
        {data.length > 0 &&
          Object.entries(chartConfig).map(([key, cfg]) => (
          <div key={key} className="flex items-center gap-2">
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-[2px]"
              style={{ backgroundColor: cfg.color }}
            />
            <span className="text-muted-foreground">{cfg.label}</span>
            <span className="font-medium tabular-nums">
              {(
                (seriesTotals[key as keyof typeof chartConfig] / total) *
                100
              ).toFixed(1)}
              %
            </span>
            </div>
          ))}
      </div>

      <CardFooter className="text-muted-foreground flex-wrap gap-x-4 gap-y-1 text-xs">
        <span>
          mean{" "}
          <span className="text-foreground font-medium">
            {formatGasRate(meanRate)}
          </span>{" "}
          across {meta.blocksSampled.toLocaleString("en-US")} sampled block
          {meta.blocksSampled === 1 ? "" : "s"}
          {meta.stride > 1
            ? `, 1 in ${meta.stride.toLocaleString("en-US")}`
            : ""}
        </span>
        {/* The legend above carries the L1 share; this says what it means. */}
        <span>
          L1 data posting is not execution — no amount of codegen reduces it
        </span>
      </CardFooter>
    </Card>
  )
}
