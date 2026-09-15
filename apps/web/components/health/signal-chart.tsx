"use client"

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  Scatter,
  XAxis,
  YAxis,
} from "recharts"

import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from "@workspace/ui/components/chart"

import {
  formatClock,
  formatClockShort,
  formatDay,
  formatDayClock,
  ticksEvery,
} from "@/lib/health/format"

export interface SignalPoint {
  t: number
  v: number
}

export interface Marker {
  t: number
  color: string
  /** Short text drawn at the top of the line — the number that keys it to the timeline list. */
  tag: string
}

export interface BandPoint {
  t: number
  lo: number
  hi: number
}

/** A chart row: the line's value and/or the band's range at one time. */
interface Row {
  t: number
  v?: number
  range?: [number, number]
}

/**
 * One measure over time, on its own y-axis. Charts of different quantities are
 * stacked as separate instances sharing the same x-domain rather than overlaid
 * on two scales, which would invent correlations.
 *
 * - `line` is the signal itself, in the accent colour.
 * - `dots` is optional context (individual observations behind the line), drawn
 *   recessive so the line stays the thing to read.
 * - `threshold` is the rule's limit: a dashed line with its value as a label.
 * - `shaded` marks stretches (poster silences) as a light wash.
 * - `markers` are alert fire times in their status colour; their meaning lives in
 *   the timeline list the tags refer to, never in the colour alone.
 * - `band` is the range the line is judged against (a market, a normal range),
 *   drawn as a recessive wash in the same unit — never a second scale.
 *
 * recharts 3 gives neither `Line` nor `Area` per-series data, so the band and the
 * line are merged into one row set by time; `connectNulls` bridges the rows where
 * only the other one has a value.
 */
export function SignalChart({
  from,
  to,
  line,
  dots,
  band,
  bandLabel,
  step = false,
  threshold,
  shaded = [],
  markers = [],
  yFormat,
  valueLabel,
  tickStepMs,
  withDate = false,
  height = 150,
  emptyText,
  yTicks,
  yScale = "linear",
  yDomain,
}: {
  from: number
  to: number
  line: SignalPoint[]
  dots?: SignalPoint[]
  band?: BandPoint[]
  /** Names the band in the tooltip, e.g. "Other rollups, middle half". */
  bandLabel?: string
  /** `true` draws a bin's value up to its close; `"after"` holds each value until the next (a setting). */
  step?: boolean | "after"
  threshold?: { value: number; label: string }
  shaded?: { from: number; to: number }[]
  markers?: Marker[]
  yFormat: (v: number) => string
  /** Names the value in the tooltip, e.g. "p90 inclusion delay". */
  valueLabel: string
  tickStepMs: number
  withDate?: boolean
  height?: number
  emptyText?: string
  /** Explicit y ticks, for quantities whose natural steps are not recharts' (minutes, not 400 s). */
  yTicks?: number[]
  /** "log" for quantities spanning orders of magnitude; it has no zero, so pass `yDomain`. */
  yScale?: "linear" | "log"
  yDomain?: [number, number]
}) {
  if (
    line.length === 0 &&
    (!dots || dots.length === 0) &&
    (!band || band.length === 0)
  ) {
    return (
      <div
        className="flex items-center justify-center text-xs text-muted-foreground"
        style={{ height }}
      >
        {emptyText ?? "No data collected for this window"}
      </div>
    )
  }

  // The accent follows the theme: the olive ramp is identical in light and dark,
  // so a single step would vanish on one of the two cards. Step 4 measures 9.4:1
  // on the light card, step 1 11.8:1 on the dark one.
  const config = {
    v: { label: valueLabel, color: "var(--health-accent)" },
  } satisfies ChartConfig

  const rows: Row[] = band?.length
    ? [
        ...line.map((p) => ({ t: p.t, v: p.v })),
        ...band.map((b) => ({
          t: b.t,
          range: [b.lo, b.hi] as [number, number],
        })),
      ].sort((a, b) => a.t - b.t)
    : line

  const ticks = ticksEvery(from, to, tickStepMs)

  // Tags of markers that fall close together would print on top of each other,
  // so each one takes the first row whose previous tag is far enough away.
  const minGap = (to - from) * 0.025
  const lastInRow: number[] = []
  const tagRow = new Map<Marker, number>()
  for (const m of [...markers].sort((a, b) => a.t - b.t)) {
    if (!m.tag) continue
    let row = lastInRow.findIndex((t) => m.t - t >= minGap)
    if (row === -1) row = Math.min(lastInRow.length, 3)
    lastInRow[row] = m.t
    tagRow.set(m, row)
  }
  const tagRows = Math.max(0, ...tagRow.values()) + 1

  return (
    <ChartContainer
      config={config}
      className="aspect-auto w-full [--health-accent:var(--chart-4)] dark:[--health-accent:var(--chart-1)]"
      style={{ height }}
    >
      <ComposedChart
        data={rows}
        margin={{
          left: 4,
          right: 12,
          top: 4 + (tagRow.size ? tagRows * 11 : 0),
          bottom: 0,
        }}
      >
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="t"
          type="number"
          domain={[from, to]}
          allowDataOverflow
          ticks={ticks}
          interval={0}
          tickLine={false}
          axisLine={false}
          tickMargin={6}
          fontSize={11}
          tickFormatter={(t: number) =>
            withDate ? formatDay(t) : formatClockShort(t)
          }
        />
        <YAxis
          dataKey="v"
          tickLine={false}
          axisLine={false}
          width={52}
          fontSize={11}
          tickCount={4}
          ticks={yTicks}
          // Explicit ticks are chosen to all show; recharts otherwise thins them.
          interval={yTicks ? 0 : undefined}
          scale={yScale}
          allowDataOverflow={Boolean(yDomain)}
          domain={
            yDomain ??
            (yTicks
              ? [
                  0,
                  (dataMax: number) =>
                    Math.max(dataMax, yTicks[yTicks.length - 1] ?? dataMax),
                ]
              : undefined)
          }
          tickFormatter={yFormat}
        />

        {shaded.map((s) => (
          <ReferenceArea
            key={`s${s.from}`}
            x1={s.from}
            x2={s.to}
            fill="var(--muted-foreground)"
            fillOpacity={0.14}
            stroke="none"
            ifOverflow="hidden"
          />
        ))}

        {threshold ? (
          <ReferenceLine
            y={threshold.value}
            stroke="var(--muted-foreground)"
            strokeDasharray="4 4"
            ifOverflow="extendDomain"
            label={{
              value: threshold.label,
              position: "insideTopLeft",
              fill: "var(--muted-foreground)",
              fontSize: 10,
            }}
          />
        ) : null}

        {markers.map((m) => (
          <ReferenceLine
            key={`m${m.t}${m.tag}`}
            x={m.t}
            stroke={m.color}
            strokeWidth={1.5}
            ifOverflow="hidden"
            label={
              m.tag
                ? ({ viewBox }: { viewBox?: { x?: number; y?: number } }) => (
                    <text
                      x={viewBox?.x ?? 0}
                      y={(viewBox?.y ?? 0) - 3 - (tagRow.get(m) ?? 0) * 11}
                      textAnchor="middle"
                      fill="var(--foreground)"
                      fontSize={10}
                      fontWeight={600}
                    >
                      {m.tag}
                    </text>
                  )
                : undefined
            }
          />
        ))}

        {band?.length ? (
          <Area
            dataKey="range"
            // Band rows are bins keyed by their start: each holds for its width.
            type="stepAfter"
            stroke="none"
            fill="var(--muted-foreground)"
            fillOpacity={0.22}
            connectNulls
            isAnimationActive={false}
            activeDot={false}
          />
        ) : null}

        {dots ? (
          <Scatter
            data={dots}
            fill="var(--chart-2)"
            fillOpacity={0.45}
            isAnimationActive={false}
            shape={(props: { cx?: number; cy?: number }) => (
              <circle
                cx={props.cx}
                cy={props.cy}
                r={2.5}
                fill="var(--chart-2)"
                fillOpacity={0.45}
              />
            )}
          />
        ) : null}

        {line.length ? (
          <Line
            dataKey="v"
            type={
              step === "after" ? "stepAfter" : step ? "stepBefore" : "linear"
            }
            stroke="var(--color-v)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            dot={false}
            activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2 }}
            isAnimationActive={false}
            connectNulls
          />
        ) : null}

        <ChartTooltip
          cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
          content={({ active, payload }) => {
            const point = payload?.[0]?.payload as Row | undefined
            if (!active || !point) return null
            return (
              <div className="grid min-w-40 gap-1 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
                <span className="text-muted-foreground">
                  {withDate ? formatDayClock(point.t) : formatClock(point.t)}{" "}
                  UTC
                </span>
                {point.v !== undefined ? (
                  <span className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">{valueLabel}</span>
                    <span className="font-mono font-medium tabular-nums">
                      {yFormat(point.v)}
                    </span>
                  </span>
                ) : null}
                {point.range ? (
                  <span className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">
                      {bandLabel ?? "Range"}
                    </span>
                    <span className="font-mono font-medium tabular-nums">
                      {yFormat(point.range[0])}–{yFormat(point.range[1])}
                    </span>
                  </span>
                ) : null}
              </div>
            )
          }}
        />
      </ComposedChart>
    </ChartContainer>
  )
}
