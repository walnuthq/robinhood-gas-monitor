"use client"

import * as React from "react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"

import { SeverityBadge } from "@/components/health/severity-badge"
import { formatClock, formatDay } from "@/lib/health/format"
import { HORIZONS, RULES, SEVERITY } from "@/lib/health/rules"
import type { HealthSnapshot } from "@/lib/health/types"

/**
 * The rules, grouped by how far ahead of the damage they speak, and how each did:
 * when it first fired in the incident replay, how far ahead of the reported halt,
 * and how often it fired outside the incident. The last column is what separates
 * an alarm from noise. It counts episodes, not days, so a false alarm on the
 * incident's own date (Sep 4, 09:20) still shows.
 */
export function RulesTable({
  snapshot,
  reportedHalt,
  incidentPeriod,
}: {
  snapshot: HealthSnapshot
  reportedHalt: number
  incidentPeriod: { from: number; to: number }
}) {
  const incident = snapshot.replays.find((r) => r.id === "2026-09-04")
  const alerts = snapshot.fortnight.alerts

  return (
    <Card>
      <CardHeader>
        <CardTitle>Alert rules</CardTitle>
        <CardDescription>
          Each rule reads public data only. Lead times are measured against
          12:57 UTC, when the press reported the halt began. Outside the
          incident means starting before {formatClock(incidentPeriod.from)} or
          after {formatClock(incidentPeriod.to)} on{" "}
          {formatDay(incidentPeriod.from)}, from the fee spike to the last
          dropped transactions of the afternoon.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Severity</TableHead>
              <TableHead>Rule</TableHead>
              <TableHead className="hidden lg:table-cell">Source</TableHead>
              <TableHead className="text-right">First fire, incident</TableHead>
              <TableHead className="text-right">Ahead of report</TableHead>
              <TableHead className="text-right">Episodes</TableHead>
              <TableHead className="text-right">Outside the incident</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {HORIZONS.map((horizon) => (
              <React.Fragment key={horizon.id}>
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={7} className="bg-muted/40 py-1.5">
                    <span className="text-xs font-semibold">
                      {horizon.label}
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {horizon.detail}
                    </span>
                  </TableCell>
                </TableRow>
                {RULES.filter((r) => r.horizon === horizon.id).map((rule) => {
                  const own = alerts.filter((a) => a.rule === rule.id)
                  // A standing risk may already be firing when the replay opens,
                  // so it counts as "in the incident" if it was active then.
                  const onIncident = incident
                    ? own
                        .filter((a) =>
                          rule.horizon === "days"
                            ? a.start <= incident.to && a.end >= incident.from
                            : a.start >= incident.from && a.start <= incident.to
                        )
                        .sort((a, b) => a.start - b.start)[0]
                    : undefined
                  const outside = own.filter(
                    (a) =>
                      (a.start < incidentPeriod.from ||
                        a.start > incidentPeriod.to) &&
                      !(a === onIncident && rule.horizon === "days")
                  )
                  const outsideDays = new Set(
                    outside.map((a) => formatDay(a.start))
                  )
                  // Watch and context rules describe conditions rather than warn anyone,
                  // so a lead time would overstate them.
                  const notifies =
                    SEVERITY[rule.severity].order >= SEVERITY.warn.order
                  const lead =
                    onIncident && notifies
                      ? Math.round((reportedHalt - onIncident.start) / 60_000)
                      : null
                  return (
                    <TableRow key={rule.id}>
                      <TableCell>
                        <SeverityBadge severity={rule.severity} />
                      </TableCell>
                      <TableCell>
                        <div className="grid gap-0.5">
                          <span className="font-medium">{rule.label}</span>
                          <span className="text-xs whitespace-normal text-muted-foreground">
                            {rule.condition}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                        {rule.source}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums">
                        {onIncident
                          ? onIncident.start < (incident?.from ?? 0)
                            ? `since ${formatDay(onIncident.start)}`
                            : formatClock(onIncident.start)
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {lead === null
                          ? onIncident
                            ? "n/a"
                            : "—"
                          : lead > 0
                            ? `${lead} min`
                            : lead === 0
                              ? "same minute"
                              : `${-lead} min after`}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {own.length}
                      </TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {outside.length === 0
                          ? "none"
                          : `${outside.length} on ${outsideDays.size} day${outsideDays.size === 1 ? "" : "s"}`}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </React.Fragment>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
