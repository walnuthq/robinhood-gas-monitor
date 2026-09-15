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
