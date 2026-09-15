#!/usr/bin/env node
/**
 * Refresh the Chain health database, apps/web/data/health.db.
 *
 *   pnpm health:refresh                              from the newest data stored to now
 *   FROM=2026-09-01T00:00:00Z pnpm health:refresh     backfill from a date
 *
 * Unlike `gas:refresh`, this keeps the database and adds to it: every source is
 * public and cheap enough to collect continuously, and history is the point —
 * the replay windows only exist because their blocks were collected. The
 * collector skips whatever is already stored, so overlapping runs are safe.
 *
 * The replay windows are always passed as dense windows, so a fresh database
 * rebuilds them at full resolution.
 */

import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const DB = process.env.HEALTH_DB ?? join(ROOT, "apps/web/data/health.db")

/** Must match REPLAYS in apps/web/lib/health/data.ts (with margin either side). */
const DENSE = [
  "2026-09-04T11:30:00Z/2026-09-04T14:30:00Z",
  "2026-09-11T13:15:00Z/2026-09-11T14:45:00Z",
]

/** Where a fresh database starts. */
const DEFAULT_FROM = "2026-09-01T00:00:00Z"

/** Re-read this much before the newest stored batch, so a run cut short leaves no hole. */
const OVERLAP_SECONDS = 3600

function newestStored() {
  if (!existsSync(DB)) return null
  // Reached through getBuiltinModule for the same reason as in apps/web.
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite")
  const db = new DatabaseSync(DB, { readOnly: true })
  try {
    const row = db.prepare("SELECT MAX(l1_ts) AS t FROM batches").get()
    return row?.t ?? null
  } catch {
    return null
  } finally {
    db.close()
  }
}

function gasmonCommand() {
  const probe = spawnSync("gasmon", ["--help"], { stdio: "ignore" })
  if (probe.status === 0) return { cmd: "gasmon", pre: [], env: process.env }
  return {
    cmd: "python3",
    pre: ["-m", "gasmon"],
    env: { ...process.env, PYTHONPATH: join(ROOT, "gasmon/src"), PYTHONUNBUFFERED: "1" },
  }
}

const newest = newestStored()
const from =
  process.env.FROM ??
  (newest ? new Date((newest - OVERLAP_SECONDS) * 1000).toISOString().replace(/\.\d+Z$/, "Z") : DEFAULT_FROM)

mkdirSync(dirname(DB), { recursive: true })
const gasmon = gasmonCommand()
const args = [
  ...gasmon.pre,
  "health",
  "--db", DB,
  "--from", from,
  "--to", process.env.TO ?? "now",
  ...DENSE.flatMap((w) => ["--dense", w]),
]
console.log(`gasmon health from ${from}${newest ? " (incremental)" : ""} into ${DB}`)
const result = spawnSync(gasmon.cmd, args, { stdio: "inherit", env: gasmon.env })
process.exit(result.status ?? 1)
