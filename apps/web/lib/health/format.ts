/**
 * Formatters for the health page. Like `lib/gas/format.ts`, every one pins the
 * `en-US` locale and UTC, because the page renders at build time and hydrates
 * somewhere else.
 */

const LOCALE = "en-US"

const clock = new Intl.DateTimeFormat(LOCALE, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZone: "UTC",
})
const clockShort = new Intl.DateTimeFormat(LOCALE, {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
})
const day = new Intl.DateTimeFormat(LOCALE, {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
})

/** 12:34:47 */
export const formatClock = (ms: number) => clock.format(ms)
/** 12:34 */
export const formatClockShort = (ms: number) => clockShort.format(ms)
/** Sep 4 */
export const formatDay = (ms: number) => day.format(ms)
/** Sep 4, 12:34:47 */
export const formatDayClock = (ms: number) =>
  `${formatDay(ms)}, ${formatClock(ms)}`

/** 45 s, 8.6 min, 3.2 h */
export function formatDuration(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)} s`
  if (seconds < 5400) return `${(seconds / 60).toFixed(1)} min`
  return `${(seconds / 3600).toFixed(1)} h`
}

/**
 * Bids are drawn on a log axis, which has no zero. Priority fees of 0 exist, so
 * anything below this is drawn at it; the chart's caption says so.
 */
export const TIP_FLOOR_GWEI = 0.0005

/** Log-axis ticks for bids, gwei. */
export const TIP_TICKS = [0.001, 0.01, 0.1, 1, 10]

/** A bid on an axis or in a tooltip, unit implied: 0.001, 0.25, 2.5, 10. */
export function formatGweiValue(gwei: number): string {
  if (gwei >= 10) return gwei.toFixed(0)
  if (gwei >= 1) return gwei.toFixed(1)
  return String(Number(gwei.toPrecision(2)))
}

/** 0.001 gwei, 0.25 gwei, 2.5 gwei: enough digits to tell bids three orders apart. */
export function formatGwei(gwei: number): string {
  if (gwei >= 10) return `${Math.round(gwei)} gwei`
  if (gwei >= 1) return `${gwei.toFixed(1)} gwei`
  if (gwei >= 0.01) return `${Number(gwei.toFixed(2))} gwei`
  return `${Number(gwei.toPrecision(2))} gwei`
}

export function formatNumber(value: number, digits = 0): string {
  return new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value)
}

/** Round tick positions every `stepMs` inside [from, to]. */
export function ticksEvery(from: number, to: number, stepMs: number): number[] {
  const out: number[] = []
  for (let t = Math.ceil(from / stepMs) * stepMs; t <= to; t += stepMs)
    out.push(t)
  return out
}
