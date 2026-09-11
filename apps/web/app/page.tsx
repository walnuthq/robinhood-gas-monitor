import { AppSidebar } from "@/components/app-sidebar"
import { DashboardView } from "@/components/dashboard-view"
import { SiteHeader } from "@/components/site-header"
import { getDashboardSnapshot } from "@/lib/gas/data"
import {
  SidebarInset,
  SidebarProvider,
} from "@workspace/ui/components/sidebar"

export const metadata = {
  title: "Gas Monitor · Robinhood Chain",
  description:
    "Gas usage on Robinhood Chain by contract, code identity and source line.",
}

/**
 * Server Component. Under `output: "export"` this runs once at build time, so
 * `getDashboardSnapshot()` is where a SQLite extract will be read — no client
 * data fetching, no runtime, nothing to wire.
 */
export default async function Page() {
  const snapshot = await getDashboardSnapshot()

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <SiteHeader />
        <DashboardView snapshot={snapshot} />
      </SidebarInset>
    </SidebarProvider>
  )
}
