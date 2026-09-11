/**
 * Data access for the dashboard — reads the collector's SQLite database.
 *
 * Server-only, and under `output: "export"` these run once during `next build`,
 * so the database is a build input, not a runtime dependency. Nothing here ever
 * reaches the browser.
 *
 * Refresh the data with `pnpm gas:refresh` (see `scripts/collect-gas-data.mjs`).
 *
 * ## Sampling, and why most figures are estimates
 *
 * The public trace endpoint answers roughly one block per second at best, so a
 * one-minute collection samples a handful of blocks per window rather than all
 * ~35,600 of them. That makes two classes of quantity behave differently:
 *
 *   - **Ratios** — gas per transaction, a contract's share, verified coverage,
 *     gas per call — are unbiased as-is. Numerator and denominator are sampled
 *     together, so the sampling rate cancels.
 *   - **Totals** — window gas, a contract's self-gas, call counts — are scaled
 *     up by `scale` (blocks in the window ÷ blocks sampled). They are estimates,
 *     and the UI labels them as such.
 *
 * Throughput is derived as mean gas per block × the chain's block rate, which
 * needs no scaling at all and is the quantity capacity is actually measured in
 * on this chain.
 */

import { existsSync, statSync } from "node:fs"
import { join } from "node:path"

/**
 * `node:sqlite` is fetched with `process.getBuiltinModule` rather than imported.
 *
 * Turbopack externalises the builtin, but its dev shim resolves it through
 * `require` inside an ESM module ("require is not defined"), and routing that
 * through `createRequire` instead just moves the failure to resolution
 * ("Unsupported external type Url for commonjs reference"). `next build`
 * succeeds either way, so a static import would work in production and break
 * `next dev`. `process.getBuiltinModule` is a plain method call that no bundler
 * rewrites, and it exists precisely for this case.
 */
const { DatabaseSync } = process.getBuiltinModule(
  "node:sqlite"
) as typeof import("node:sqlite")
type DatabaseSync = InstanceType<typeof DatabaseSync>

import type {
  GasConsumer,
  GasKpis,
  GasPoint,
  Period,
  SampleMeta,
} from "./types"
import { PERIOD_HOURS, PERIODS } from "./types"

const DB_PATH = process.env.GAS_DB ?? join(process.cwd(), "data/gas.db")

let db: DatabaseSync | null = null
let openedMtime = 0

/**
 * A build opens this once, but `next dev` keeps the module alive across
 * requests — and `pnpm gas:refresh` replaces the file rather than editing it.
 * A cached handle would then keep reading the deleted inode and serve the
 * previous collection forever, so the handle is keyed to the file's mtime.
 */
function open(): DatabaseSync {
  if (!existsSync(DB_PATH)) {
    throw new Error(
      `No gas database at ${DB_PATH}. Run \`pnpm gas:refresh\` to collect one.`
    )
  }
  const mtime = statSync(DB_PATH).mtimeMs
  if (db && mtime === openedMtime) return db
  db?.close()
  db = new DatabaseSync(DB_PATH, { readOnly: true })
  openedMtime = mtime
  return db
}

function query<T = Record<string, unknown>>(
  sql: string,
  ...params: (string | number)[]
): T[] {
  return open().prepare(sql).all(...params) as T[]
}

function one<T = Record<string, unknown>>(
  sql: string,
  ...params: (string | number)[]
): T | undefined {
  return open().prepare(sql).get(...params) as T | undefined
}

/**
 * The chain's block rate, measured from the collected sample itself rather than
 * hard-coded: the widest block/timestamp span available gives a good estimate
 * even when the sample in between is sparse.
 */
function blocksPerSecond(): number {
  const row = one<{ lo: number; hi: number; t0: number; t1: number }>(
    "SELECT MIN(number) lo, MAX(number) hi, MIN(timestamp) t0, MAX(timestamp) t1 FROM blocks"
  )
  if (!row || row.t1 === row.t0) return 9.9 // documented fallback
  return (row.hi - row.lo) / (row.t1 - row.t0)
}

/** The snapshot's "now": the newest block collected, not wall-clock time. */
function tipTimestamp(): number {
  return one<{ t: number }>("SELECT MAX(timestamp) t FROM blocks")?.t ?? 0
}

function windowBounds(period: Period, offset = 0) {
  const tip = tipTimestamp()
  const seconds = PERIOD_HOURS[period] * 3600
  const to = tip - offset * seconds
  return { from: to - seconds, to, seconds }
}

interface WindowStats {
  blocks: number
  gasSum: number
  txSum: number
  gasMean: number
}

function windowStats(from: number, to: number): WindowStats {
  const row = one<{ n: number; gas: number | null; tx: number | null }>(
    "SELECT COUNT(*) n, SUM(gas_used) gas, SUM(tx_count) tx FROM blocks WHERE timestamp BETWEEN ? AND ?",
    from,
    to
  )
  const blocks = row?.n ?? 0
  const gasSum = row?.gas ?? 0
  return {
    blocks,
    gasSum,
    txSum: row?.tx ?? 0,
    gasMean: blocks ? gasSum / blocks : 0,
  }
}

/**
 * The preceding window needs enough blocks for a comparison to mean anything.
 * At this sampling density it often has one or two, which produces deltas like
 * "+673%" that are entirely sampling noise. Below the threshold the honest
 * answer is "no comparable prior window", which is what `null` renders as.
 */
const MIN_COMPARISON_BLOCKS = 4

function ratio(
  current: number,
  previous: number,
  previousBlocks: number
): number | null {
  if (!previous || previousBlocks < MIN_COMPARISON_BLOCKS) return null
  return (current - previous) / previous
}

/**
 * Per-block gas split into the three disjoint components of the identity.
 * Returned as gas/second so the y-axis does not depend on sampling density.
 */
export async function getGasSeries(period: Period): Promise<GasPoint[]> {
  const { from, to } = windowBounds(period)
  const rate = blocksPerSecond()
  const rows = query<{
    number: number
    timestamp: number
    gas_used: number
    intrinsic: number
    l1: number
  }>(
    `SELECT b.number, b.timestamp, b.gas_used,
            COALESCE((SELECT SUM(t.intrinsic)        FROM txs t WHERE t.block = b.number), 0) AS intrinsic,
            COALESCE((SELECT SUM(t.gas_used_for_l1)  FROM txs t WHERE t.block = b.number), 0) AS l1
       FROM blocks b
      WHERE b.timestamp BETWEEN ? AND ?
      ORDER BY b.timestamp, b.number`,
    from,
    to
  )
  return rows.map((r) => ({
    t: new Date(r.timestamp * 1000).toISOString(),
    block: r.number,
    execution: Math.max(0, (r.gas_used - r.intrinsic - r.l1) * rate),
    intrinsic: r.intrinsic * rate,
    l1Data: r.l1 * rate,
  }))
}

/**
 * Verified share of attributed gas — over the gas whose sources were actually
 * *checked*, not over all of it.
 *
 * The collector resolves only the top N code identities against Sourcify
 * (1,948 distinct identities appeared in a 195-block sample; each lookup costs
 * seconds). Treating everything else as "unverified" would conflate three
 * different things: verified, genuinely unverified, and never asked. A registry
 * error is likewise not evidence of anything, so it is excluded too.
 *
 * `checked` is returned alongside so the UI can say what the share is *of*.
 */
function verifiedShare(
  from: number,
  to: number
): { verified: number; checked: number } {
  const row = one<{
    verified: number | null
    checked: number | null
    total: number | null
  }>(
    `SELECT SUM(CASE WHEN r.verified = 1 THEN g.gas ELSE 0 END) AS verified,
            SUM(CASE WHEN r.checked  = 1 THEN g.gas ELSE 0 END) AS checked,
            SUM(g.gas)                                          AS total
       FROM (SELECT f.code_id, SUM(f.self_gas) gas
               FROM frames f
              WHERE f.is_precompile = 0 AND f.code_id IS NOT NULL
                AND f.block IN (SELECT number FROM blocks WHERE timestamp BETWEEN ? AND ?)
              GROUP BY f.code_id) g
       LEFT JOIN (
            SELECT c.code_id,
                   MAX(CASE WHEN v.status = 'verified' THEN 1 ELSE 0 END) AS verified,
                   -- 'error' means the registry did not answer: not a result.
                   MAX(CASE WHEN v.status IN ('verified','none') THEN 1 ELSE 0 END) AS checked
              FROM code c
              JOIN verification v ON v.addr = c.addr OR v.addr = c.delegate
             GROUP BY c.code_id
       ) r ON r.code_id = g.code_id`,
    from,
    to
  )
  const checkedGas = row?.checked ?? 0
  const totalGas = row?.total ?? 0
  return {
    verified: checkedGas ? (row?.verified ?? 0) / checkedGas : 0,
    checked: totalGas ? checkedGas / totalGas : 0,
  }
}

export async function getKpis(period: Period): Promise<GasKpis> {
  const { from, to, seconds } = windowBounds(period)
  const prev = windowBounds(period, 1)
  const rate = blocksPerSecond()

  const cur = windowStats(from, to)
  const before = windowStats(prev.from, prev.to)

  const throughput = cur.gasMean * rate
  const prevThroughput = before.gasMean * rate
  const gasPerTx = cur.txSum ? cur.gasSum / cur.txSum : 0
  const prevGasPerTx = before.txSum ? before.gasSum / before.txSum : 0
  const verified = verifiedShare(from, to)
  const prevVerified = before.blocks
    ? verifiedShare(prev.from, prev.to).verified
    : 0

  const n = before.blocks
  return {
    totalGas: {
      value: throughput * seconds,
      delta: ratio(throughput, prevThroughput, n),
    },
    gasPerTx: { value: gasPerTx, delta: ratio(gasPerTx, prevGasPerTx, n) },
    throughputMgas: {
      value: throughput / 1e6,
      delta: ratio(throughput, prevThroughput, n),
    },
    verifiedShare: {
      value: verified.verified,
      delta: ratio(verified.verified, prevVerified, n),
    },
    /** What fraction of the window's gas had its sources looked up at all. */
    verifiedCoverage: verified.checked,
  }
}

/**
 * Biggest gas eaters, ranked by **exclusive** self-gas and grouped by **code
 * identity** rather than address — a template deployed at 54 addresses is one
 * row, not 54 invisible ones. Precompiles are excluded: real consumers, but not
 * Solidity, so nothing a compiler can touch.
 */
export async function getTopConsumers(
  period: Period,
  limit = 15
): Promise<GasConsumer[]> {
  const { from, to } = windowBounds(period)
  const stats = windowStats(from, to)
  if (!stats.blocks) return []
  const meta = await getSampleMeta(period)

  const rows = query<{
    code_id: string
    self_gas: number
    calls: number
    addresses: number
    address: string
    code_len: number | null
    verified: number | null
    name: string | null
  }>(
    `SELECT f.code_id,
            SUM(f.self_gas)                     AS self_gas,
            COUNT(*)                            AS calls,
            COUNT(DISTINCT f.addr)              AS addresses,
            MAX(f.addr)                         AS address,
            MAX(c.code_len)                     AS code_len,
            MAX(COALESCE(cv.verified, 0))       AS verified,
            MAX(cv.name)                        AS name
       FROM frames f
       LEFT JOIN code c               ON c.addr    = f.addr
       LEFT JOIN code_verification cv ON cv.code_id = f.code_id
      WHERE f.is_precompile = 0 AND f.code_id IS NOT NULL
        AND f.block IN (SELECT number FROM blocks WHERE timestamp BETWEEN ? AND ?)
      GROUP BY f.code_id
      ORDER BY self_gas DESC
      LIMIT ?`,
    from,
    to,
    limit
  )

  return rows.map((r) => ({
    codeId: r.code_id,
    name: r.name,
    address: r.address,
    // Share is a ratio of sampled quantities, so it needs no scaling; self_gas
    // and calls are totals, so they are scaled to the whole window.
    share: stats.gasSum ? r.self_gas / stats.gasSum : 0,
    selfGas: Math.round(r.self_gas * meta.scale),
    calls: Math.round(r.calls * meta.scale),
    gasPerCall: r.calls ? Math.round(r.self_gas / r.calls) : 0,
    codeLen: r.code_len ?? null,
    verified: Boolean(r.verified),
    addresses: r.addresses,
  }))
}

export async function getSampleMeta(period: Period): Promise<SampleMeta> {
  const { from, to, seconds } = windowBounds(period)
  const rate = blocksPerSecond()
  const row = one<{
    lo: number | null
    hi: number | null
    n: number
    tx: number | null
  }>(
    "SELECT MIN(number) lo, MAX(number) hi, COUNT(*) n, SUM(tx_count) tx FROM blocks WHERE timestamp BETWEEN ? AND ?",
    from,
    to
  )
  const collected = one<{ at: number | null }>(
    "SELECT MAX(collected_at) at FROM blocks"
  )
  const sampled = row?.n ?? 0
  const blocksInWindow = seconds * rate

  return {
    firstBlock: row?.lo ?? 0,
    lastBlock: row?.hi ?? 0,
    blocksSampled: sampled,
    stride: sampled ? Math.round(blocksInWindow / sampled) : 0,
    transactions: Math.round((row?.tx ?? 0) * (sampled ? blocksInWindow / sampled : 0)),
    collectedAt: new Date((collected?.at ?? 0) * 1000).toISOString(),
    scale: sampled ? blocksInWindow / sampled : 0,
    hasData: sampled > 0,
  }
}

export interface DashboardSnapshot {
  kpis: Record<Period, GasKpis>
  series: Record<Period, GasPoint[]>
  consumers: Record<Period, GasConsumer[]>
  meta: Record<Period, SampleMeta>
}

/**
 * Everything the dashboard needs, for every window, read once at build time and
 * passed down. A static export cannot fetch on demand, so switching periods in
 * the browser is a client-side selection over data already in the page.
 */
export async function getDashboardSnapshot(): Promise<DashboardSnapshot> {
  const snapshot: DashboardSnapshot = {
    kpis: {} as Record<Period, GasKpis>,
    series: {} as Record<Period, GasPoint[]>,
    consumers: {} as Record<Period, GasConsumer[]>,
    meta: {} as Record<Period, SampleMeta>,
  }

  for (const { value: period } of PERIODS) {
    snapshot.kpis[period] = await getKpis(period)
    snapshot.series[period] = await getGasSeries(period)
    snapshot.consumers[period] = await getTopConsumers(period)
    snapshot.meta[period] = await getSampleMeta(period)
  }
  return snapshot
}
