/**
 * Robinscan URL construction.
 *
 * Patterns verified against the live explorer rather than assumed — several
 * explorers use `/transaction/` or `/blocks/`, and Robinscan 404s both:
 *
 *   /address/{address}                 200
 *   /address/{address}?tab=contract    200   (verified sources tab)
 *   /tx/{hash}                         200
 *   /block/{number}                    200
 *
 * Kept in one module so pointing the dashboard at a different explorer — the
 * chain also has a Blockscout instance — is a one-file change.
 */

export const EXPLORER_NAME = "Robinscan"
export const EXPLORER_BASE = "https://robinscan.io"

/**
 * `tab: "contract"` deep-links to published sources. Only meaningful for a
 * verified contract; on an unverified address the tab loads but is empty, so
 * callers should pass it only when verification is known.
 */
export function addressUrl(
  address: string,
  options?: { tab?: "contract" }
): string {
  const base = `${EXPLORER_BASE}/address/${address}`
  return options?.tab ? `${base}?tab=${options.tab}` : base
}

export function txUrl(hash: string): string {
  return `${EXPLORER_BASE}/tx/${hash}`
}

export function blockUrl(blockNumber: number | string): string {
  return `${EXPLORER_BASE}/block/${blockNumber}`
}
