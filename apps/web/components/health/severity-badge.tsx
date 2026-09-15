import { Eye, Fuel, Siren, TriangleAlert, Users } from "lucide-react"

import type { Severity } from "@/lib/health/types"
import { SEVERITY } from "@/lib/health/rules"

const ICONS = {
  watch: Eye,
  context: Fuel,
  warn: TriangleAlert,
  page: Siren,
  impact: Users,
} satisfies Record<Severity, unknown>

/**
 * Severity as icon + label, with the status colour on the icon only. The text
 * stays in text tokens: warning's amber is below 3:1 on the light card, so it
 * may mark but never spell.
 */
export function SeverityBadge({ severity }: { severity: Severity }) {
  const Icon = ICONS[severity]
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium">
      <Icon
        aria-hidden
        className="size-3.5 shrink-0"
        style={{ color: SEVERITY[severity].color }}
      />
      {SEVERITY[severity].label}
    </span>
  )
}

export function SeverityIcon({
  severity,
  className,
}: {
  severity: Severity
  className?: string
}) {
  const Icon = ICONS[severity]
  return (
    <Icon
      aria-label={SEVERITY[severity].label}
      className={className}
      style={{ color: SEVERITY[severity].color }}
    />
  )
}
