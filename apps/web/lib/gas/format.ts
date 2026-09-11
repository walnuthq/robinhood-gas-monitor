/**
 * Formatters.
 *
 * Every one pins an explicit `en-US` locale and UTC where a timezone applies.
 * Under static export the server renders at build time and the browser rehydrates
 * elsewhere, so an implicit locale or timezone is a hydration mismatch waiting
 * to happen — and the chain's own data is UTC anyway.
 */

const LOCALE = "en-US"

/** Compact gas for headline figures: 1.97B, 181.5M, 11.1K. */
export function formatGas(value: number): string {
  return new Intl.NumberFormat(LOCALE, {
    notation: "compact",
    maximumFractionDigits: value < 1_000_000 ? 1 : 2,
  }).format(value)
}

/** Exact gas with separators, for table cells where the digits matter. */
export function formatGasExact(value: number): string {
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 }).format(
    value
  )
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 }).format(
    value
  )
}

export function formatPercent(ratio: number, digits = 1): string {
  return new Intl.NumberFormat(LOCALE, {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(ratio)
}

/** Signed ratio for trend badges: +4.2%, -12.3%. */
export function formatDelta(ratio: number): string {
  return new Intl.NumberFormat(LOCALE, {
    style: "percent",
    signDisplay: "exceptZero",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(ratio)
}

export function formatMgas(value: number): string {
  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value)
}

/** Runtime code size. Contracts cap at 24,576 bytes so kB reads naturally. */
export function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—"
  if (bytes < 1024) return `${bytes} B`
  return `${new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 }).format(bytes / 1024)} kB`
}

/** `0x68184c44…` — enough to recognise, short enough for a table. */
export function truncateAddress(address: string, lead = 10): string {
  return `${address.slice(0, lead)}…`
}

/**
 * Axis tick labels. Points are individual sampled blocks, so windows longer
 * than a day need the date to disambiguate a time of day that recurs.
 */
export function formatBucketLabel(iso: string, period: string): string {
  const date = new Date(iso)
  const time = new Intl.DateTimeFormat(LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(date)
  if (period === "1h" || period === "6h" || period === "24h") return time
  const day = new Intl.DateTimeFormat(LOCALE, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date)
  return `${day} ${time}`
}

/** Gas rates read as "29.4 Mgas/s"; the compact suffix alone is ambiguous. */
export function formatGasRate(gasPerSecond: number): string {
  return `${formatMgas(gasPerSecond / 1e6)} Mgas/s`
}

export function formatTimestamp(iso: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(iso))
}
