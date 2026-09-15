"use client"

import * as React from "react"
import { Flag } from "lucide-react"

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/toggle-group"

import { AlertLog } from "@/components/health/alert-log"
import { RulesTable } from "@/components/health/rules-table"
import { SeverityBadge, SeverityIcon } from "@/components/health/severity-badge"
import { SignalChart, type Marker } from "@/components/health/signal-chart"
import {
  formatClock,
  formatDay,
  formatDayClock,
  formatDuration,
  formatNumber,
} from "@/lib/health/format"
import { RULE_BY_ID, SEVERITY } from "@/lib/health/rules"
import type {
  AlertEpisode,
  Annotation,
  HealthSnapshot,
  ReplayWindow,
  RuleId,
  Severity,
} from "@/lib/health/types"

const MINUTE = 60_000
const DAY = 86_400_000

/** The reported start of the "halt", which every lead time is measured against. */
export const REPORTED_HALT = Date.parse("2026-09-04T12:57:00Z")
/** When users actually started failing, from the traced sample — 20 min earlier. */
const USERS_FAILING = Date.parse("2026-09-04T12:37:00Z")
/**
 * The incident, from the fee spike to the last ingress drops of the afternoon
 * (spec/robinhood-chain-2026-09-04-incident.md §7). An alert that starts outside
 * it is a false alarm as far as this incident is concerned.
 */
const INCIDENT_PERIOD = {
  from: Date.parse("2026-09-04T12:30:00Z"),
  to: Date.parse("2026-09-04T17:15:00Z"),
}

/** "3 min before" / "8 min after", rounded to the minute. */
function relativeTo(t: number, reference: number): string {
  const minutes = Math.round((reference - t) / MINUTE)
  return minutes >= 0 ? `${minutes} min before` : `${-minutes} min after`
}

/** Axis and tooltip format for delays: seconds below two minutes, minutes above. */
const delay = (v: number) =>
  v < 120 ? `${Math.round(v)} s` : `${Number((v / 60).toFixed(1))} min`
const POSTING_TICKS = [0, 300, 600, 900, 1200]
const INCLUSION_TICKS = [0, 60, 120, 180, 240, 300]

function Section({
  title,
  detail,
  children,
}: {
  title: string
  detail: string
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-1">
      <div className="flex flex-wrap items-baseline gap-x-2 px-1">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
      {children}
    </div>
  )
}

interface Event {
  tag: string
  t: number
  alert?: AlertEpisode
  annotation?: Annotation
}

/** Alerts numbered in time order, annotations lettered: the tags the charts draw. */
function eventsFor(replay: ReplayWindow): Event[] {
  const alerts = replay.alerts.filter(
    (a) => a.start >= replay.from && a.start <= replay.to
  )
  return [
    ...alerts.map((a, i) => ({ tag: String(i + 1), t: a.start, alert: a })),
    ...replay.annotations.map((a, i) => ({
      tag: String.fromCharCode(65 + i),
      t: a.t,
      annotation: a,
    })),
  ].sort((a, b) => a.t - b.t)
}

function markersFor(events: Event[]): Marker[] {
  return events.map((e) => ({
    t: e.t,
    tag: e.tag,
    color: e.alert ? SEVERITY[e.alert.severity].color : "var(--foreground)",
  }))
}

function EventList({
  events,
  reportedHalt,
}: {
  events: Event[]
  reportedHalt?: number
}) {
  if (!events.length) {
    return (
      <p className="px-1 text-sm text-muted-foreground">
        No alert fired in this window.
      </p>
    )
  }
  return (
    <ol className="grid gap-3">
      {events.map((e) => {
        const rule = e.alert ? RULE_BY_ID[e.alert.rule] : null
        const lead =
          reportedHalt !== undefined
            ? Math.round((reportedHalt - e.t) / MINUTE)
            : null
        return (
          <li
            key={`${e.tag}${e.t}`}
            className="grid grid-cols-[1.5rem_1fr] gap-x-2"
          >
            <span className="flex size-6 items-center justify-center rounded-full bg-muted font-mono text-xs font-semibold text-foreground">
              {e.tag}
            </span>
            <div className="grid gap-0.5">
              <div className="flex flex-wrap items-center gap-x-2">
                <span className="font-mono text-xs tabular-nums">
                  {formatClock(e.t)}
                </span>
                {e.alert ? (
                  <SeverityBadge severity={e.alert.severity} />
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium">
                    <Flag aria-hidden className="size-3.5" />
                    Event
                  </span>
                )}
              </div>
              <span className="text-sm leading-snug">
                {rule ? rule.label : e.annotation?.label}
              </span>
              {e.alert && rule ? (
                <span className="text-xs text-muted-foreground">
                  {rule.peakLabel(e.alert.peak)}
                  {/* A lead time only means something for rules that notify: watch and
                      context episodes describe conditions, not warnings. */}
                  {lead !== null &&
                  lead > 0 &&
                  SEVERITY[e.alert.severity].order >= SEVERITY.warn.order
                    ? ` · ${lead} min before the reported halt`
                    : ""}
                </span>
              ) : null}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function Tiles({ snapshot }: { snapshot: HealthSnapshot }) {
  const incident = snapshot.replays.find((r) => r.id === "2026-09-04")
  const all = snapshot.fortnight.alerts
  const firstOf = (rules: RuleId[]) =>
    incident?.alerts
      .filter((a) => rules.includes(a.rule) && a.start >= incident.from)
      .sort((a, b) => a.start - b.start)[0]
  const warn = firstOf(["poster_silent", "posting_backlog"])
  const page = firstOf(["write_path"])
  const pageDays = new Set(
    all.filter((a) => a.rule === "write_path").map((a) => formatDay(a.start))
  )
  const spanDays = Math.max(
    1,
    Math.round((snapshot.fortnight.to - snapshot.fortnight.from) / DAY)
  )
  const stalls = snapshot.fortnight.silences
  const longest = stalls.reduce(
    (m, s) => (s.seconds > (m?.seconds ?? 0) ? s : m),
    stalls[0]
  )

  const tiles = [
    {
      // The replay window, not the whole day: Sep 4 also warned at 09:20, with no impact.
      label: "First warning, Sep 4 incident",
      value: warn ? formatClock(warn.start) : "—",
      severity: "warn" as Severity,
      detail: warn
        ? `${relativeTo(warn.start, REPORTED_HALT)} the reported halt, ${relativeTo(warn.start, USERS_FAILING)} users started failing — ${RULE_BY_ID[warn.rule].label.toLowerCase()}`
        : "No warning in the collected data",
    },
    {
      label: "Page: transactions dropped",
      value: page ? formatClock(page.start) : "—",
      severity: "page" as Severity,
      detail: page
        ? `${relativeTo(page.start, REPORTED_HALT)} the reported halt, ${relativeTo(page.start, USERS_FAILING)} users started failing · fired on ${pageDays.size} of ${spanDays} days`
        : "Did not fire",
    },
    {
      label: "Batch poster stalls ≥ 5 min",
      value: formatNumber(stalls.length),
      severity: "warn" as Severity,
      detail: longest
        ? `Longest ${formatDuration(longest.seconds)}, ${formatDayClock(longest.from)} · over ${spanDays} days`
        : `None in ${spanDays} days`,
    },
    {
      label: "Chainlink transmissions checked",
      value: formatNumber(snapshot.meta.transmissions),
      severity: "context" as Severity,
      detail: `Every one since ${formatDay(snapshot.meta.from)}, the clock that shows dropped transactions`,
    },
  ]

  return (
    <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
      {tiles.map((t) => (
        <Card key={t.label} className="@container/card">
          <CardHeader>
            <CardDescription className="flex items-center gap-1.5">
              <SeverityIcon severity={t.severity} className="size-3.5" />
              {t.label}
            </CardDescription>
            <CardTitle className="text-2xl font-semibold @[16rem]/card:text-3xl">
              {t.value}
            </CardTitle>
          </CardHeader>
          <CardFooter className="text-xs text-muted-foreground">
            {t.detail}
          </CardFooter>
        </Card>
      ))}
    </div>
  )
}

function Replay({ snapshot }: { snapshot: HealthSnapshot }) {
  const [id, setId] = React.useState(snapshot.replays[0]?.id ?? "")
  const replay =
    snapshot.replays.find((r) => r.id === id) ?? snapshot.replays[0]
  if (!replay) return null

  const events = eventsFor(replay)
  const markers = markersFor(events)
  const reportedHalt = replay.annotations.find((a) => a.t === REPORTED_HALT)?.t
  const common = {
    from: replay.from,
    to: replay.to,
    markers,
    tickStepMs: 10 * MINUTE,
  }

  return (
    <Card className="@container/replay">
      <CardHeader>
        <CardTitle>Replay</CardTitle>
        <CardDescription>{replay.summary}</CardDescription>
        <CardAction>
          {/* Base UI toggle groups are array-valued; one selection is a one-item array. */}
          <ToggleGroup
            value={[replay.id]}
            onValueChange={(value) => value[0] && setId(value[0])}
            variant="outline"
          >
            {snapshot.replays.map((r) => (
              <ToggleGroupItem key={r.id} value={r.id} className="px-3">
                {r.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-6 @5xl/replay:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="grid gap-4">
          <Section
            title="Ethereum base fee"
            detail="Every Ethereum block · gwei"
          >
            <SignalChart
              {...common}
              line={replay.fees.map((p) => ({ t: p.t, v: p.gwei }))}
              yFormat={(v) => v.toFixed(v < 1 ? 2 : 1)}
              valueLabel="Base fee (gwei)"
            />
          </Section>
          <Section
            title="Batch posting backlog"
            detail="Age of the newest L2 block when each batch reached Ethereum · shaded: no batch for ≥ 2 min"
          >
            <SignalChart
              {...common}
              line={replay.posting.map((p) => ({ t: p.t, v: p.delay }))}
              shaded={replay.silences}
              threshold={{ value: 600, label: "backlog alert · 10 min" }}
              yFormat={delay}
              yTicks={POSTING_TICKS}
              valueLabel="Posting delay"
            />
          </Section>
          <Section
            title="Chainlink inclusion delay"
            detail="Dots: each price update, block time − observation time · line: 5-min p90"
          >
            <SignalChart
              {...common}
              line={replay.oracleBins.map((b) => ({ t: b.t, v: b.p90 }))}
              dots={replay.oracle.map((p) => ({ t: p.t, v: p.delay }))}
              step
              threshold={{ value: 120, label: "page · p90 120 s" }}
              yFormat={delay}
              yTicks={INCLUSION_TICKS}
              valueLabel="p90 inclusion delay"
            />
          </Section>
          <Section
            title="Successful transactions"
            detail="Per sampled block, 1-min mean"
          >
            <SignalChart
              {...common}
              line={replay.traffic.map((p) => ({ t: p.t, v: p.ok }))}
              yFormat={(v) => v.toFixed(0)}
              valueLabel="Successful tx per block"
            />
          </Section>
          <Section
            title="Failed ERC-4337 bundles"
            detail="Per sampled block, 1-min mean"
          >
            <SignalChart
              {...common}
              line={replay.traffic.map((p) => ({ t: p.t, v: p.bundlesFailed }))}
              threshold={{ value: 1, label: "impact · 1 per block" }}
              yFormat={(v) => v.toFixed(1)}
              valueLabel="Failed bundles per block"
            />
          </Section>
        </div>
        <div className="grid content-start gap-3">
          <h3 className="px-1 text-sm font-medium">
            What a monitor would have said
          </h3>
          <EventList events={events} reportedHalt={reportedHalt} />
        </div>
      </CardContent>
      <CardFooter className="flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          {formatDay(replay.from)}, {formatClock(replay.from)}–
          {formatClock(replay.to)} UTC · every Ethereum block, every batch and
          every Chainlink transmission in the window; Robinhood receipts every
          ~10 s
        </span>
        <span>
          Alerts are evaluated only on data available at the time they fire
        </span>
      </CardFooter>
    </Card>
  )
}

/** "Sep 4" or "Sep 2, Sep 4 and Sep 11": the days a severity fired on. */
function daysFiring(alerts: AlertEpisode[], severity: Severity): string {
  const days = [
    ...new Set(
      alerts
        .filter((a) => a.severity === severity)
        .map((a) => formatDay(a.start - (a.start % DAY)))
    ),
  ]
  if (days.length <= 1) return days[0] ?? "no day"
  return `${days.slice(0, -1).join(", ")} and ${days.at(-1)}`
}

function Fortnight({ snapshot }: { snapshot: HealthSnapshot }) {
  const f = snapshot.fortnight
  const markersOf = (rules: RuleId[]): Marker[] =>
    f.alerts
      .filter((a) => rules.includes(a.rule))
      .map((a) => ({ t: a.start, tag: "", color: SEVERITY[a.severity].color }))
  const common = {
    from: f.from,
    to: f.to,
    tickStepMs: DAY,
    withDate: true,
    height: 140,
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {formatDay(f.from)} – {formatDay(f.to)}
        </CardTitle>
        <CardDescription>
          The same signals across the whole collection, with every alert that
          fired. Pages fired on {daysFiring(f.alerts, "page")}; warnings on{" "}
          {daysFiring(f.alerts, "warn")}.
        </CardDescription>
        <CardAction className="hidden flex-wrap justify-end gap-3 sm:flex">
          {(["warn", "page", "impact", "context"] as Severity[]).map((s) => (
            <SeverityBadge key={s} severity={s} />
          ))}
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Section
          title="Batch posting delay"
          detail="One batch every 10 min · warn markers: poster silent ≥ 5 min, backlog ≥ 10 min"
        >
          <SignalChart
            {...common}
            line={f.posting.map((p) => ({ t: p.t, v: p.delay }))}
            threshold={{ value: 240, label: "headroom watch · 4 min" }}
            markers={markersOf(["poster_silent", "posting_backlog"])}
            yFormat={delay}
            yTicks={POSTING_TICKS}
            valueLabel="Posting delay"
          />
        </Section>
        <Section
          title="Chainlink inclusion delay, 5-min p90"
          detail="Every transmission · page markers"
        >
          <SignalChart
            {...common}
            line={[]}
            dots={f.oracleBins.map((b) => ({ t: b.t, v: b.p90 }))}
            threshold={{ value: 120, label: "page · 120 s" }}
            markers={markersOf(["write_path"])}
            yFormat={delay}
            yTicks={INCLUSION_TICKS}
            valueLabel="p90 inclusion delay"
          />
        </Section>
        <Section
          title="Ethereum base fee"
          detail="30-min median · context markers: fee ≥ 5× in 15 min"
        >
          <SignalChart
            {...common}
            line={f.fees.map((p) => ({ t: p.t, v: p.gwei }))}
            markers={markersOf(["l1_fee_spike"])}
            yFormat={(v) => v.toFixed(v < 1 ? 2 : 1)}
            valueLabel="Base fee (gwei)"
          />
        </Section>
        <Section
          title="Successful transactions"
          detail="Per sampled block, 30-min mean · impact markers"
        >
          <SignalChart
            {...common}
            line={f.traffic.map((p) => ({ t: p.t, v: p.ok }))}
            markers={markersOf(["user_impact", "bundler_failures"])}
            yFormat={(v) => v.toFixed(0)}
            valueLabel="Successful tx per block"
          />
        </Section>
      </CardContent>
    </Card>
  )
}

export function HealthView({ snapshot }: { snapshot: HealthSnapshot }) {
  const m = snapshot.meta
  if (!snapshot.hasData) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1 p-6 text-center text-sm text-muted-foreground">
        <p className="font-medium text-foreground">
          No chain-health data collected yet
        </p>
        <p className="text-xs">
          Run <code className="font-mono">pnpm health:refresh</code> to collect
          it.
        </p>
      </div>
    )
  }

  return (
    <div className="@container/main flex flex-1 flex-col gap-4 p-4 lg:gap-6 lg:p-6">
      <Tiles snapshot={snapshot} />
      <Replay snapshot={snapshot} />
      <RulesTable
        snapshot={snapshot}
        reportedHalt={REPORTED_HALT}
        incidentPeriod={INCIDENT_PERIOD}
      />
      <Fortnight snapshot={snapshot} />
      <AlertLog alerts={snapshot.fortnight.alerts} />

      {/* Provenance, on screen: a signal without its sample is not a finding. */}
      <p className="text-xs text-muted-foreground">
        {formatDay(m.from)} – {formatDayClock(m.to)} UTC · Ethereum:{" "}
        {formatNumber(m.batches)} batch deliveries (all),{" "}
        {formatNumber(m.decodes)} decoded (1 per {m.decodeEverySeconds / 60}{" "}
        min, plus every batch in the replay windows and either side of every
        stall), {formatNumber(m.ethereumBlocks)} blocks (1 per{" "}
        {m.ethereumEverySeconds / 60} min, every block in the replay windows) ·
        Robinhood Chain: {formatNumber(m.transmissions)} Chainlink transmissions
        (all), {formatNumber(m.robinhoodSamples)} receipt samples (1 per{" "}
        {m.robinhoodEverySeconds} s) · collected {formatDayClock(m.collectedAt)}{" "}
        UTC from {m.l1Rpc.replace("https://", "")} and{" "}
        {m.l2Rpc.replace("https://", "")}
      </p>
    </div>
  )
}
