import Link from "next/link"

import { BlockLink } from "@/components/explorer-link"
import {
  Activity,
  BadgeCheck,
  Boxes,
  Braces,
  Database,
  Fuel,
  Gauge,
  HeartPulse,
  Layers,
  PackagePlus,
  Settings2,
  ShieldCheck,
} from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@workspace/ui/components/sidebar"

/**
 * Navigation mirrors the grains the collector actually stores: code identities,
 * selectors, deployments, blocks — plus verification coverage, which is the
 * feasibility metric the whole report hangs on.
 *
 * Only Overview is built. The rest are deliberately visible-but-inert so the
 * shape of the product is legible in the prototype.
 */
const analysis = [
  { id: "overview", title: "Overview", icon: Gauge, href: "/" },
  { id: "health", title: "Chain health", icon: HeartPulse, href: "/health" },
  { title: "Contracts", icon: Boxes, href: "#", badge: "3.4k" },
  { title: "Functions", icon: Braces, href: "#" },
  { title: "Deployments", icon: PackagePlus, href: "#" },
  { title: "Blocks", icon: Layers, href: "#" },
  { title: "Sources", icon: BadgeCheck, href: "#", badge: "57%" },
]

/** Head of the collected range; also the sidebar's link out to the explorer. */
const LAST_COLLECTED_BLOCK = 60_271_574

const collector = [
  { title: "Runs", icon: Database, href: "#" },
  { title: "Identity checks", icon: ShieldCheck, href: "#", badge: "5/5" },
  { title: "Settings", icon: Settings2, href: "#" },
]

/** Which page is showing. Passed by each page rather than read from the URL, so
 *  the sidebar stays a Server Component. */
export type SidebarPage = "overview" | "health"

export function AppSidebar({ active = "overview" }: { active?: SidebarPage }) {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/" />}>
              <>
                <div className="bg-primary text-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                  <Fuel className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">Gas Monitor</span>
                  <span className="text-muted-foreground truncate text-xs">
                    Robinhood Chain · 4663
                  </span>
                </div>
              </>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Analysis</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {analysis.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    isActive={"id" in item && item.id === active}
                    tooltip={item.title}
                    render={<Link href={item.href} />}
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                  {item.badge ? (
                    <SidebarMenuBadge>{item.badge}</SidebarMenuBadge>
                  ) : null}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Collector</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {collector.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    tooltip={item.title}
                    render={<Link href={item.href} />}
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                  {item.badge ? (
                    <SidebarMenuBadge>{item.badge}</SidebarMenuBadge>
                  ) : null}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              tooltip="Collector status"
              render={
                <BlockLink blockNumber={LAST_COLLECTED_BLOCK}>
                  <span className="sr-only">
                    Last collected block on the explorer
                  </span>
                </BlockLink>
              }
            >
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg border">
                <Activity className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-xs leading-tight">
                <span className="truncate font-medium">Last collected</span>
                <span className="text-muted-foreground truncate font-mono">
                  #{LAST_COLLECTED_BLOCK.toLocaleString("en-US")}
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
