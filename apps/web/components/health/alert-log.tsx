"use client"

import * as React from "react"

import {
  Card,
  CardAction,
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
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/toggle-group"

import { SeverityBadge } from "@/components/health/severity-badge"
import { formatDayClock, formatDuration } from "@/lib/health/format"
import { RULE_BY_ID, SEVERITY } from "@/lib/health/rules"
import type { AlertEpisode } from "@/lib/health/types"

type Filter = "alerts" | "all"

/**
 * Every episode the rules produced, as the table twin of the charts' markers.
 * Watch and context episodes are long-running and frequent by nature, so the
 * default view shows what would actually notify someone.
 */
export function AlertLog({ alerts }: { alerts: AlertEpisode[] }) {
  const [filter, setFilter] = React.useState<Filter>("alerts")
  const rows = alerts
    .filter(
      (a) =>
        filter === "all" || SEVERITY[a.severity].order >= SEVERITY.warn.order
    )
    .sort((a, b) => b.start - a.start)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Alert log</CardTitle>
        <CardDescription>
          {rows.length} episode{rows.length === 1 ? "" : "s"}, newest first.
          Consecutive fires of one rule merge into an episode.
        </CardDescription>
        <CardAction>
          <ToggleGroup
            value={[filter]}
            onValueChange={(value) => value[0] && setFilter(value[0] as Filter)}
            variant="outline"
          >
            <ToggleGroupItem value="alerts" className="px-3">
              Warn · page · impact
            </ToggleGroupItem>
            <ToggleGroupItem value="all" className="px-3">
              All
            </ToggleGroupItem>
          </ToggleGroup>
        </CardAction>
      </CardHeader>
      <CardContent className="max-h-[28rem] overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Severity</TableHead>
              <TableHead>Alert</TableHead>
              <TableHead>Fired (UTC)</TableHead>
              <TableHead className="text-right">Lasted</TableHead>
              <TableHead className="text-right">Worst</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((a) => {
              const rule = RULE_BY_ID[a.rule]
              return (
                <TableRow key={`${a.rule}${a.start}`}>
                  <TableCell>
                    <SeverityBadge severity={a.severity} />
                  </TableCell>
                  <TableCell className="font-medium">{rule.label}</TableCell>
                  <TableCell className="font-mono text-xs tabular-nums">
                    {formatDayClock(a.start)}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {a.end > a.start
                      ? formatDuration((a.end - a.start) / 1000)
                      : "one check"}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {rule.peakLabel(a.peak)}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
