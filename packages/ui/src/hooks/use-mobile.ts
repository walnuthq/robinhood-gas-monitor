import * as React from "react"

const MOBILE_BREAKPOINT = 768
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

/**
 * Required by `sidebar.tsx`, which switches to a Sheet on small viewports.
 *
 * Implemented with `useSyncExternalStore` rather than the usual
 * `useState` + `useEffect`: a media query *is* an external store, and setting
 * state synchronously inside an effect triggers the cascading render the
 * `react-hooks/set-state-in-effect` rule flags.
 *
 * The server snapshot is `false` because a static export is rendered with no
 * viewport at all; React reconciles to the real value on hydration.
 */
function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false
  )
}
