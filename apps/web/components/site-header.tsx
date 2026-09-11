import { CircleDot } from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
import { Separator } from "@workspace/ui/components/separator"
import { SidebarTrigger } from "@workspace/ui/components/sidebar"

export function SiteHeader() {
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4 lg:px-6">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-4" />
      <h1 className="text-base font-medium">Overview</h1>
      <div className="ml-auto flex items-center gap-2">
        {/* The single most load-bearing caveat on this project: the free trace
            endpoint keeps ~2-3 days, so anything older is already gone. */}
        <Badge variant="outline" className="hidden gap-1.5 sm:flex">
          <CircleDot className="size-3 text-emerald-500" />
          Trace window 2.8d
        </Badge>
        <Badge variant="secondary" className="font-mono text-xs">
          ArbOS 116
        </Badge>
      </div>
    </header>
  )
}
