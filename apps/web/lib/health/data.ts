/**
 * Data access for the Chain health page — reads `gasmon health`'s SQLite
 * database. Server-only, and under `output: "export"` it runs once at build
 * time, so the database is a build input and nothing here reaches the browser.
 *
 * Refresh with `pnpm health:refresh` (see `scripts/collect-health-data.mjs`).
 *
 * The page embeds everything it can show, because a static export cannot fetch
 * on demand. The shaping below keeps that small: replay windows keep full
 * resolution only where the collector sampled densely, and the fortnight view
 * is binned. Bins are rates (per sampled block, p90 per bin), never totals, so
 * their height does not depend on how densely a stretch was sampled.
 */

import { existsSync, statSync } from "node:fs"
import { join } from "node:path"

// Why `process.getBuiltinModule` and not an import: see `lib/gas/data.ts`.
const { DatabaseSync } = process.getBuiltinModule(
  "node:sqlite"
) as typeof import("node:sqlite")
type DatabaseSync = InstanceType<typeof DatabaseSync>

import type {
  AlertEpisode,
  FeePoint,
  FortnightView,
  HealthMeta,
  HealthSnapshot,
  OracleBin,
  OraclePoint,
  PostingPoint,
  ReplayWindow,
  RuleId,
  Severity,
  Silence,
  TrafficPoint,
} from "./types"

const DB_PATH = process.env.HEALTH_DB ?? join(process.cwd(), "data/health.db")

let db: DatabaseSync | null = null
let openedMtime = 0

/** Keyed to the file's mtime, because the collector keeps writing to it under `next dev`. */
function open(): DatabaseSync | null {
  if (!existsSync(DB_PATH)) return null
  const mtime = statSync(DB_PATH).mtimeMs
  if (db && mtime === openedMtime) return db
  db?.close()
  db = new DatabaseSync(DB_PATH, { readOnly: true })
  openedMtime = mtime
  return db
}

function query<T>(sql: string, ...params: number[]): T[] {
  const handle = open()
  return handle ? (handle.prepare(sql).all(...params) as T[]) : []
}

const ms = (seconds: number) => seconds * 1000
const at = (iso: string) => Date.parse(iso)

/**
 * The windows worth replaying. Both were collected at full resolution
 * (`--dense`), and the Sep 11 window is the control: the same Ethereum trigger,
 * without the failure. Annotations say where each came from.
 */
const REPLAYS = [
  {
    id: "2026-09-04",
    label: "Sep 4 · incident",
    summary:
      "The US jobs report sets off a bidding war on Ethereum at 12:30. The batch poster, tipping 0.001 gwei, stalls, and from 12:40 transactions are dropped at ingress.",
    from: "2026-09-04T12:10:00Z",
    to: "2026-09-04T13:40:00Z",
    annotations: [
      // BLS release time; the Ethereum blocks that follow are in spec §7.
      { t: "2026-09-04T12:30:00Z", label: "US jobs report released" },
      // From the traced sample in spec/data/incident-2026-09-04.
      { t: "2026-09-04T12:37:00Z", label: "Users start failing" },
      // As reported by the press, citing explorer data.
      { t: "2026-09-04T12:57:00Z", label: "Reported “halt”" },
    ],
  },
  {
    id: "2026-09-11",
    label: "Sep 11 · control",
    summary:
      "The same kind of Ethereum spike and a five-minute poster stall. The poster now has headroom and a 250× higher tip, and ingress holds.",
    from: "2026-09-11T13:30:00Z",
    to: "2026-09-11T14:40:00Z",
    annotations: [],
  },
]

function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b)
  const mid = Math.floor(v.length / 2)
  return v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2
}

/** Same definition as the collector's rule, so the chart and the alert agree. */
function p90(values: number[]): number {
  const v = [...values].sort((a, b) => a - b)
  return v[Math.floor(0.9 * (v.length - 1))]!
}

function bin<T extends { t: number }>(rows: T[], widthMs: number) {
  const bins = new Map<number, T[]>()
  for (const row of rows) {
    const key = row.t - (row.t % widthMs)
    const list = bins.get(key)
    if (list) list.push(row)
    else bins.set(key, [row])
  }
  return [...bins.entries()].sort((a, b) => a[0] - b[0])
}

function fees(from: number, to: number, widthMs?: number): FeePoint[] {
  const rows = query<{ ts: number; base_fee: number }>(
    "SELECT ts, base_fee FROM l1_blocks WHERE ts BETWEEN ? AND ? AND base_fee > 0 ORDER BY ts",
    from / 1000,
    to / 1000
  ).map((r) => ({ t: ms(r.ts), gwei: r.base_fee / 1e9 }))
  if (!widthMs) return rows
  return bin(rows, widthMs).map(([t, v]) => ({
    t,
    gwei: median(v.map((p) => p.gwei)),
  }))
}

function posting(from: number, to: number, reasons?: string[]): PostingPoint[] {
  const filter = reasons
    ? `AND d.reason IN (${reasons.map((r) => `'${r}'`).join(",")})`
    : ""
  return query<{ l1_ts: number; posting_delay_s: number }>(
    `SELECT b.l1_ts, d.posting_delay_s FROM batch_decodes d JOIN batches b USING (seq)
      WHERE b.l1_ts BETWEEN ? AND ? ${filter} ORDER BY b.l1_ts, d.seq`,
    from / 1000,
    to / 1000
  ).map((r) => ({ t: ms(r.l1_ts), delay: r.posting_delay_s }))
}

function silences(from: number, to: number, minSeconds: number) {
  const times = query<{ l1_ts: number }>(
    // One row either side of the window, so a stall that straddles an edge shows.
    `SELECT DISTINCT l1_ts FROM batches
      WHERE l1_ts BETWEEN (SELECT COALESCE(MAX(l1_ts), 0) FROM batches WHERE l1_ts < ?)
                      AND (SELECT COALESCE(MIN(l1_ts), 1e12) FROM batches WHERE l1_ts > ?)
      ORDER BY l1_ts`,
    from / 1000,
    to / 1000
  ).map((r) => r.l1_ts)
  const out: (Silence & { seconds: number })[] = []
  for (let i = 1; i < times.length; i++) {
    const gap = times[i]! - times[i - 1]!
    if (gap >= minSeconds)
      out.push({ from: ms(times[i - 1]!), to: ms(times[i]!), seconds: gap })
  }
  return out
}

function oracle(from: number, to: number): OraclePoint[] {
  return query<{ ts: number; delay_s: number }>(
    "SELECT ts, delay_s FROM oracle_tx WHERE ts BETWEEN ? AND ? ORDER BY ts",
    from / 1000,
    to / 1000
  ).map((r) => ({ t: ms(r.ts), delay: r.delay_s }))
}

function oracleBins(points: OraclePoint[], minN: number): OracleBin[] {
  // Five minutes, the bin the write-path rule evaluates. The point sits at the
  // bin's close, which is when the rule could first have fired.
  return bin(points, 300_000)
    .filter(([, v]) => v.length >= minN)
    .map(([t, v]) => ({
      t: t + 300_000,
      p90: p90(v.map((p) => p.delay)),
      n: v.length,
    }))
}

function traffic(from: number, to: number, widthMs: number): TrafficPoint[] {
  const rows = query<{ ts: number; ok_txs: number; bundles_failed: number }>(
    "SELECT ts, ok_txs, bundles_failed FROM l2_samples WHERE ts BETWEEN ? AND ? ORDER BY ts",
    from / 1000,
    to / 1000
  ).map((r) => ({ t: ms(r.ts), ok: r.ok_txs, failed: r.bundles_failed }))
  return bin(rows, widthMs).map(([t, v]) => ({
    t: t + widthMs / 2,
    ok: v.reduce((s, p) => s + p.ok, 0) / v.length,
    bundlesFailed: v.reduce((s, p) => s + p.failed, 0) / v.length,
    n: v.length,
  }))
}

function alerts(from: number, to: number): AlertEpisode[] {
  return query<{
    rule: RuleId
    severity: Severity
    start_ts: number
    end_ts: number
    peak: number
  }>(
    "SELECT rule, severity, start_ts, end_ts, peak FROM alerts WHERE start_ts <= ? AND end_ts >= ? ORDER BY start_ts",
    to / 1000,
    from / 1000
  ).map((r) => ({
    rule: r.rule,
    severity: r.severity,
    start: ms(r.start_ts),
    end: ms(r.end_ts),
    peak: r.peak,
  }))
}

function meta(): HealthMeta {
  const kv = Object.fromEntries(
    query<{ key: string; value: string }>("SELECT key, value FROM meta").map(
      (r) => [r.key, r.value]
    )
  )
  const count = (table: string) =>
    query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)[0]?.n ?? 0
  const span = query<{ lo: number | null; hi: number | null }>(
    "SELECT MIN(l1_ts) AS lo, MAX(l1_ts) AS hi FROM batches"
  )[0]
  return {
    collectedAt: ms(Number(kv.collected_at ?? 0)),
    from: ms(span?.lo ?? 0),
    to: ms(span?.hi ?? 0),
    batches: count("batches"),
    decodes: count("batch_decodes"),
    ethereumBlocks: count("l1_blocks"),
    transmissions: count("oracle_tx"),
    robinhoodSamples: count("l2_samples"),
    l1Rpc: kv.l1_rpc ?? "",
    l2Rpc: kv.l2_rpc ?? "",
    decodeEverySeconds: Number(kv.decode_every_s ?? 0),
    ethereumEverySeconds: Number(kv.l1_every_s ?? 0),
    robinhoodEverySeconds: Number(kv.l2_every_s ?? 0),
  }
}

export async function getHealthSnapshot(): Promise<HealthSnapshot> {
  const m = meta()
  const hasData = m.batches > 0

  const replays: ReplayWindow[] = REPLAYS.map((w) => {
    const from = at(w.from)
    const to = at(w.to)
    const points = oracle(from, to)
    return {
      id: w.id,
      label: w.label,
      summary: w.summary,
      from,
      to,
      annotations: w.annotations.map((a) => ({ t: at(a.t), label: a.label })),
      fees: fees(from, to),
      posting: posting(from, to),
      silences: silences(from, to, 120),
      oracle: points,
      oracleBins: oracleBins(points, 3),
      traffic: traffic(from, to, 60_000),
      alerts: alerts(from, to),
    }
  })

  const fortnight: FortnightView = {
    from: m.from,
    to: m.to,
    // Sampled decodes only: dense windows and gap edges would over-represent the
    // stretches they cover.
    posting: posting(m.from, m.to, ["sample"]),
    oracleBins: oracleBins(oracle(m.from, m.to), 3),
    fees: fees(m.from, m.to, 1_800_000),
    traffic: traffic(m.from, m.to, 1_800_000),
    silences: silences(m.from, m.to, 300),
    alerts: alerts(m.from, m.to),
  }

  return { replays, fortnight, meta: m, hasData }
}
