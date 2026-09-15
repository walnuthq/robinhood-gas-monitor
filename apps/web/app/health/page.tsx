import { AppSidebar } from "@/components/app-sidebar"
import { HealthView } from "@/components/health/health-view"
import { SiteHeader } from "@/components/site-header"
import { getHealthSnapshot } from "@/lib/health/data"
import { SidebarInset, SidebarProvider } from "@workspace/ui/components/sidebar"

export const metadata = {
  title: "Chain health · Robinhood Chain",
  description:
    "Public on-chain signals that would have alerted on the 2026-09-04 incident: batch posting to Ethereum, Chainlink inclusion delay, fees and failed transactions.",
}

/**
 * Server Component, rendered once at build time: `getHealthSnapshot()` reads
 * `data/health.db` and everything the page can show is embedded in the HTML.
 */
export default async function HealthPage() {
  const snapshot = await getHealthSnapshot()

  return (
    <SidebarProvider>
      <AppSidebar active="health" />
      <SidebarInset>
        <SiteHeader title="Chain health" /* traceWindow={false} */ />
        <HealthView snapshot={snapshot} />
      </SidebarInset>
    </SidebarProvider>
  )
}
