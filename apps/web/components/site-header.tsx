// import { CircleDot } from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
import { Separator } from "@workspace/ui/components/separator"
import { SidebarTrigger } from "@workspace/ui/components/sidebar"

export function SiteHeader({
  title = "Overview",
  // traceWindow = true,
}: {
  title?: string
  // /** The trace-retention badge describes the gas collector; other pages opt out. */
  // traceWindow?: boolean
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4 lg:px-6">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-4" />
      <h1 className="text-base font-medium">{title}</h1>
      <div className="ml-auto flex items-center gap-2">
        {/* Commented out: the free trace window is ~1.4 days now, and drPC serves
            archive traces back to launch, so a hardcoded retention figure no
            longer describes a real limit.

            The single most load-bearing caveat on this project: the free trace
            endpoint keeps ~2-3 days, so anything older is already gone.
        {traceWindow ? (
        <Badge variant="outline" className="hidden gap-1.5 sm:flex">
          <CircleDot className="size-3 text-emerald-500" />
          Trace window 2.8d
        </Badge>
        ) : null} */}
        <Badge variant="secondary" className="font-mono text-xs">
          ArbOS 116
        </Badge>
      </div>
    </header>
  )
}
