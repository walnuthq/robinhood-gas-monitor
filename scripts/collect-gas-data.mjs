#!/usr/bin/env node
/**
 * Collect a fresh gas sample into apps/web/data/gas.db.
 *
 *   pnpm gas:refresh                default: 6 blocks, about a minute
 *   BLOCKS=20 TIME_BUDGET=240 pnpm gas:refresh    denser, proportionally slower
 *
 * The dashboard reads that database directly at build time, so this is the only
 * step between the chain and the UI.
 *
 * Why the sample is so small: measured on the public trace endpoint, a block
 * costs about 10s end to end and concurrency makes it worse, so a one-minute
 * budget buys roughly six blocks. That is a real statistical limit, not a
 * placeholder — every total the dashboard shows is an estimate scaled up from
 * this sample, and the UI states the sample it came from.
 *
 * Sampling is **log-spaced from the tip**, not uniform. The windows are nested
 * (1h ⊂ 6h ⊂ … ⊂ 72h), so a block sampled an hour back counts toward every
 * window; a block sampled 60 hours back counts only toward 72h. Spacing the
 * offsets geometrically therefore gives every window several blocks from one
 * small budget, where a uniform draw over 72h would leave the last hour empty.
 *
 * Blocks are collected one at a time so the budget is enforced between blocks,
 * and in **bisection order** rather than sequentially: nearest, deepest, then
 * successive midpoints. Any prefix of that order still spans the whole 72h, so
 * a run cut short by the budget thins every window evenly instead of losing the
 * deep ones entirely.
 */

import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const DB = process.env.GAS_DB ?? join(ROOT, "apps/web/data/gas.db")

const RPC = process.env.GAS_RPC ?? "https://rpc.mainnet.chain.robinhood.com"
const TRACE_RPC = process.env.GAS_TRACE_RPC ?? "https://rpc.ordofi.network"

/**
 * Total blocks to trace. The dominant cost knob at roughly 10s each.
 *
 * 200 is sized to the 60-minute budget. Block gas on this chain is highly
 * variable — measured CV 0.76 over a 714-block sample (median 2.2M, max 15.4M,
 * some empty) — and log spacing puts 48% of the sample in the 1h window, 87% in
 * 24h. That yields these 95% confidence intervals on throughput:
 *
 *      blocks     1h     6h    24h    72h      wall clock
 *          50   ±30%   ±25%   ±23%   ±21%       ~10 min
 *         100   ±22%   ±18%   ±16%   ±15%       ~19 min
 *         150   ±18%   ±15%   ±13%   ±12%       ~27 min
 *         200   ±15%   ±13%   ±11%   ±11%       ~35 min
 *         300   ±12%   ±10%    ±9%    ±9%       ~52 min
 *
 * Ratios converge faster than totals: gas per transaction is within ±9% at 200.
 */
const BLOCKS = Number(process.env.BLOCKS ?? 200)
/**
 * Concurrency. Measured: serial beats parallel on this endpoint — 3 blocks took
 * 30s at 1 worker and 59s at 2, because concurrent requests are throttled
 * rather than served. Raise only against a node you control.
 */
const WORKERS = Number(process.env.WORKERS ?? 1)
/**
 * Code identities to resolve against Sourcify, ranked by gas. Measured at ~6s
 * each, so this is the second-largest cost after tracing.
 *
 * A 195-block sample contained 1,948 distinct identities, far more than can be
 * checked; the dashboard therefore reports verified share *of the gas it
 * checked* and says so, rather than counting unchecked code as unverified.
 * Raising this widens that coverage.
 */
const SOURCES_LIMIT = Number(process.env.SOURCES_LIMIT ?? 200)
/** Hard wall-clock budget in seconds; remaining blocks are skipped. */
const BUDGET = Number(process.env.TIME_BUDGET ?? 3600)
/**
 * Per-block ceiling. The endpoint's latency is wildly variable — observed 16s
 * and 138s for adjacent blocks — so without this one pathological block spends
 * the entire budget. A block that overruns is abandoned, not retried.
 */
const BLOCK_TIMEOUT = Number(process.env.BLOCK_TIMEOUT ?? 45)

/** Measured on this chain; used to convert a window in hours to blocks. */
const BLOCKS_PER_SECOND = 9.9

/** Must match PERIODS in apps/web/lib/gas/types.ts. */
const WINDOW_HOURS = [1, 6, 24, 48, 72]
const DEEPEST_HOURS = WINDOW_HOURS[WINDOW_HOURS.length - 1]
/** Nearest sample offset; far enough back that the trace endpoint has the block. */
const NEAREST_HOURS = 0.02

/**
 * Offsets in hours, geometrically spaced from `NEAREST_HOURS` to the deepest
 * window. Newest first, so truncating the list by budget drops history, not
 * detail.
 */
function sampleOffsets(count) {
  if (count <= 1) return [NEAREST_HOURS]
  const ratio = (DEEPEST_HOURS / NEAREST_HOURS) ** (1 / (count - 1))
  // Pull every offset just inside its window: floating-point puts the last one
  // at 72.0000…1h, which falls outside the 72h window it is meant to populate.
  const spaced = Array.from({ length: count }, (_, i) =>
    Math.min(NEAREST_HOURS * ratio ** i, DEEPEST_HOURS * 0.985)
  )
  return bisectionOrder(spaced)
}

/**
 * Reorder so every prefix spans the range: ends first, then the midpoint of
 * each remaining gap, widening outward. Truncation then costs resolution
 * everywhere rather than all of the deep history.
 */
function bisectionOrder(items) {
  const out = []
  const seen = new Set()
  const take = (i) => {
    if (i >= 0 && i < items.length && !seen.has(i)) {
      seen.add(i)
      out.push(items[i])
    }
  }
  take(0)
  take(items.length - 1)
  const queue = [[0, items.length - 1]]
  while (queue.length) {
    const [lo, hi] = queue.shift()
    const mid = Math.floor((lo + hi) / 2)
    if (mid === lo || mid === hi) continue
    take(mid)
    queue.push([lo, mid], [mid, hi])
  }
  return out
}

function rpc(method, params = []) {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
  const out = execFileSync(
    "curl",
    ["-s", "-m", "20", "-X", "POST", RPC, "-H", "Content-Type: application/json",
     "-H", "User-Agent: gasmon-refresh/1.0", "--data", body],
    { encoding: "utf8" }
  )
  const parsed = JSON.parse(out)
  if (parsed.error) throw new Error(`${method}: ${parsed.error.message}`)
  return parsed.result
}

/** Prefer the installed console script; fall back to the source tree. */
function gasmonCommand() {
  const probe = spawnSync("gasmon", ["--help"], { stdio: "ignore" })
  if (probe.status === 0) return { cmd: "gasmon", pre: [] }
  return {
    cmd: "python3",
    pre: ["-m", "gasmon"],
    env: { ...process.env, PYTHONPATH: join(ROOT, "gasmon/src") },
  }
}

function run(gasmon, args, label, { timeoutSeconds, optional = false } = {}) {
  const result = spawnSync(gasmon.cmd, [...gasmon.pre, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    env: gasmon.env ?? process.env,
    ...(timeoutSeconds ? { timeout: timeoutSeconds * 1000 } : {}),
  })
  if (result.signal || result.status !== 0) {
    if (optional) return null
  }
  if (result.status !== 0) {
    process.stderr.write(result.stderr ?? "")
    throw new Error(`${label} failed (exit ${result.status})`)
  }
  return result.stdout ?? ""
}

const started = Date.now()
const elapsed = () => (Date.now() - started) / 1000

function main() {
  const gasmon = gasmonCommand()
  const head = Number(rpc("eth_blockNumber"))
  // Stay clear of the tip: the trace endpoint lags the head slightly.
  const tip = head - 50

  if (process.env.KEEP_DB !== "1") rmSync(DB, { force: true })
  mkdirSync(dirname(DB), { recursive: true })

  console.log(`head ${head.toLocaleString("en-US")} · ${BLOCKS} blocks, log-spaced over ${DEEPEST_HOURS}h · budget ${BUDGET}s`)

  const offsets = sampleOffsets(BLOCKS)
  let traced = 0
  for (const hours of offsets) {
    if (elapsed() > BUDGET) {
      console.log(`  stopped after ${traced} blocks — ${BUDGET}s budget spent`)
      break
    }
    const block = tip - Math.round(hours * 3600 * BLOCKS_PER_SECOND)
    const t0 = elapsed()
    const ok = run(
      gasmon,
      ["collect", "--from-block", String(block), "--to-block", String(block),
       "--workers", String(WORKERS), "--db", DB, "--rpc", RPC,
       "--trace-rpc", TRACE_RPC],
      `collect block ${block}`,
      { timeoutSeconds: Math.min(BLOCK_TIMEOUT, Math.max(5, BUDGET - elapsed())), optional: true }
    )
    const took = (elapsed() - t0).toFixed(0)
    const covers = WINDOW_HOURS.filter((h) => hours <= h).join(", ") || "none"
    if (ok === null) {
      console.log(`  -${hours.toFixed(2).padStart(5)}h  block ${block.toLocaleString("en-US")}  ${took}s  abandoned (too slow)`)
      continue
    }
    traced += 1
    console.log(`  -${hours.toFixed(2).padStart(5)}h  block ${block.toLocaleString("en-US")}  ${took}s  → ${covers}`)
  }

  if (elapsed() < BUDGET) {
    const t0 = elapsed()
    // Bound by what is left of the budget: lookups are cached, so a run cut
    // short here simply resolves fewer identities and the next run continues.
    const out = run(
      gasmon,
      ["sources", "--limit", String(SOURCES_LIMIT), "--db", DB, "--trace-rpc", TRACE_RPC],
      "sources",
      { timeoutSeconds: Math.max(30, BUDGET - elapsed()), optional: true }
    )
    const line = out
      ?.split("\n")
      .find((l) => l.includes("verified code covers"))
    console.log(
      `  sources ${(elapsed() - t0).toFixed(0)}s${
        out === null ? " · stopped at the budget, partially resolved" : ""
      }${line ? ` · ${line.trim()}` : ""}`
    )
  } else {
    console.log("  sources skipped — budget spent (verification will read as unresolved)")
  }

  const verify = run(gasmon, ["verify", "--db", DB], "verify")
  const failed = verify.split("\n").filter((l) => l.includes("[FAIL]"))
  for (const l of verify.split("\n").filter((l) => l.includes("[PASS]") || l.includes("[FAIL]"))) {
    console.log(`  ${l.trim()}`)
  }

  console.log(`\n${DB}`)
  console.log(`${traced} blocks traced · total ${elapsed().toFixed(0)}s`)

  // A failing identity check means the gas decomposition is wrong; the
  // dashboard must not present numbers derived from it as if they were sound.
  if (failed.length) {
    console.error("\nIdentity checks FAILED — do not trust this sample.")
    process.exit(1)
  }
}

try {
  main()
} catch (error) {
  console.error(`\ncollect-gas-data: ${error.message}`)
  if (!existsSync(DB)) console.error("no database written")
  process.exit(1)
}
