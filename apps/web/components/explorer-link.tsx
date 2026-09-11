import { ArrowUpRight } from "lucide-react"

import { cn } from "@workspace/ui/lib/utils"

import {
  addressUrl,
  blockUrl,
  EXPLORER_NAME,
  txUrl,
} from "@/lib/gas/explorer"
import { truncateAddress } from "@/lib/gas/format"

/**
 * One styled outbound link to the block explorer, so every reference to an
 * on-chain entity looks and behaves the same.
 *
 * `rel="noreferrer"` implies noopener in modern browsers, but both are set
 * explicitly — this opens a third-party page in a new tab.
 */
function ExplorerAnchor({
  href,
  title,
  className,
  showIcon = false,
  children,
  ...props
}: React.ComponentProps<"a"> & {
  href: string
  title: string
  showIcon?: boolean
}) {
  return (
    <a
      {...props}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      className={cn(
        "hover:text-foreground focus-visible:ring-ring/50 inline-flex items-center gap-1 rounded-sm underline-offset-4 transition-colors hover:underline focus-visible:ring-[3px] focus-visible:outline-none",
        className
      )}
    >
      {children}
      {showIcon ? (
        <ArrowUpRight className="size-3 shrink-0 opacity-60" aria-hidden />
      ) : null}
    </a>
  )
}

/**
 * An address. `verified` deep-links to the sources tab instead of the overview,
 * which is the page you actually want when the code is published.
 */
export function AddressLink({
  address,
  verified = false,
  truncate = false,
  className,
  showIcon,
  children,
  ...props
}: React.ComponentProps<"a"> & {
  address: string
  verified?: boolean
  truncate?: boolean
  showIcon?: boolean
}) {
  return (
    <ExplorerAnchor
      href={addressUrl(address, verified ? { tab: "contract" } : undefined)}
      title={
        verified
          ? `${address} — verified sources on ${EXPLORER_NAME}`
          : `${address} on ${EXPLORER_NAME}`
      }
      className={className}
      showIcon={showIcon}
      {...props}
    >
      {children ?? (truncate ? truncateAddress(address) : address)}
    </ExplorerAnchor>
  )
}

export function TxLink({
  hash,
  truncate = true,
  className,
  showIcon,
  children,
  ...props
}: React.ComponentProps<"a"> & {
  hash: string
  truncate?: boolean
  showIcon?: boolean
}) {
  return (
    <ExplorerAnchor
      href={txUrl(hash)}
      title={`${hash} on ${EXPLORER_NAME}`}
      className={className}
      showIcon={showIcon}
      {...props}
    >
      {children ?? (truncate ? truncateAddress(hash) : hash)}
    </ExplorerAnchor>
  )
}

export function BlockLink({
  blockNumber,
  className,
  showIcon,
  children,
  ...props
}: React.ComponentProps<"a"> & {
  blockNumber: number
  showIcon?: boolean
}) {
  return (
    <ExplorerAnchor
      href={blockUrl(blockNumber)}
      title={`Block ${blockNumber.toLocaleString("en-US")} on ${EXPLORER_NAME}`}
      className={className}
      showIcon={showIcon}
      {...props}
    >
      {children ?? `#${blockNumber.toLocaleString("en-US")}`}
    </ExplorerAnchor>
  )
}
