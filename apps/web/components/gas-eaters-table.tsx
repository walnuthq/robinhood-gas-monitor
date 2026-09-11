import { BadgeCheck, Boxes } from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
import {
  Card,
  CardAction,
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

import { AddressLink } from "@/components/explorer-link"
import {
  formatBytes,
  formatCount,
  formatGasExact,
  formatPercent,
} from "@/lib/gas/format"
import type { GasConsumer } from "@/lib/gas/types"

/**
 * Rows are **code identities**, not addresses. A template deployed at 54
 * addresses is one row holding its combined gas; ranking per address would
 * scatter it into 54 rows too small to notice.
 *
 * The ranked quantity is exclusive self-gas. Inclusive `gas_used` would put
 * routers and entrypoints on top for merely passing gas through.
 */
export function GasEatersTable({ consumers }: { consumers: GasConsumer[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Biggest gas eaters</CardTitle>
        <CardDescription>
          Ranked by exclusive self-gas, grouped by code identity
        </CardDescription>
        <CardAction>
          <Badge variant="outline">{consumers.length} code identities</Badge>
        </CardAction>
      </CardHeader>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10 text-right">#</TableHead>
            <TableHead className="min-w-[16rem]">Contract</TableHead>
            <TableHead className="text-right">Self gas</TableHead>
            <TableHead className="w-32">Share</TableHead>
            <TableHead className="text-right">Calls</TableHead>
            <TableHead className="text-right">Gas / call</TableHead>
            <TableHead className="text-right">Size</TableHead>
            <TableHead className="text-center">Source</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {consumers.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={8}
                className="text-muted-foreground h-24 text-center text-sm"
              >
                No blocks sampled in this window
              </TableCell>
            </TableRow>
          ) : null}
          {consumers.map((c, index) => (
            <TableRow key={c.codeId}>
              <TableCell className="text-muted-foreground text-right tabular-nums">
                {index + 1}
              </TableCell>

              <TableCell>
                <div className="flex items-center gap-2">
                  <div className="min-w-0">
                    {c.name ? (
                      <>
                        {/* Verified: the name goes to the sources tab, which is
                            the page worth landing on when code is published. */}
                        <AddressLink
                          address={c.address}
                          verified={c.verified}
                          className="truncate font-medium"
                        >
                          {c.name}
                        </AddressLink>
                        <AddressLink
                          address={c.address}
                          truncate
                          className="text-muted-foreground block truncate font-mono text-xs"
                        />
                      </>
                    ) : (
                      /* Unverified: the address is all the identity there is. */
                      <AddressLink
                        address={c.address}
                        className="text-muted-foreground block truncate font-mono text-xs"
                      />
                    )}
                  </div>
                  {c.addresses > 1 ? (
                    <Badge
                      variant="secondary"
                      className="shrink-0 gap-1"
                      title={`One template deployed at ${c.addresses} addresses`}
                    >
                      <Boxes className="size-3" />
                      {c.addresses}
                    </Badge>
                  ) : null}
                </div>
              </TableCell>

              <TableCell className="text-right font-mono tabular-nums">
                {formatGasExact(c.selfGas)}
              </TableCell>

              <TableCell>
                <div className="flex items-center gap-2">
                  <div
                    className="bg-muted h-1.5 w-full max-w-16 overflow-hidden rounded-full"
                    aria-hidden
                  >
                    <div
                      className="bg-primary h-full rounded-full"
                      style={{
                        width: `${Math.min(100, (c.share / 0.1) * 100)}%`,
                      }}
                    />
                  </div>
                  <span className="text-muted-foreground shrink-0 tabular-nums">
                    {formatPercent(c.share, 2)}
                  </span>
                </div>
              </TableCell>

              <TableCell className="text-right tabular-nums">
                {formatCount(c.calls)}
              </TableCell>

              {/* Where inefficiency lives: total = calls x gas/call. */}
              <TableCell className="text-right tabular-nums">
                {formatCount(c.gasPerCall)}
              </TableCell>

              <TableCell className="text-muted-foreground text-right tabular-nums">
                {formatBytes(c.codeLen)}
              </TableCell>

              <TableCell className="text-center">
                {c.verified ? (
                  /* The badge is itself the affordance for "show me the source". */
                  <AddressLink address={c.address} verified>
                    <Badge
                      variant="outline"
                      className="hover:bg-muted gap-1 transition-colors"
                    >
                      <BadgeCheck className="size-3" />
                      Verified
                    </Badge>
                  </AddressLink>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  )
}
