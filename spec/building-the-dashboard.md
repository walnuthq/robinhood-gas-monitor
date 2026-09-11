# Building the dashboard: traps, measurements and decisions

**Status:** internal — 2026-09-11
**Subject:** `apps/web`, the gas dashboard, and the pipeline that feeds it
**Companion to:** [robinhood-chain-recon.md](robinhood-chain-recon.md),
[`../gasmon/README.md`](../gasmon/README.md)

Every item here cost time to discover. Most are things the surrounding
documentation does not say, several contradict what the same library did a major
version ago, and a few are bugs that produce **plausible wrong output** rather
than an error — those are flagged **silent**.

Read this before touching `apps/web`. If you are changing the collector instead,
read `gasmon/README.md`.

---

## 1. The shadcn in this repo is Base UI, not Radix

`packages/ui` depends on `@base-ui/react`, not `@radix-ui/*`. Almost every
shadcn snippet on the internet is written for the Radix build and will not
compile here.

| Radix idiom | Base UI equivalent |
| --- | --- |
| `<SidebarMenuButton asChild><Link/></SidebarMenuButton>` | `<SidebarMenuButton render={<Link/>}>` |
| `<ToggleGroup type="single" value={x} onValueChange={(v: string) => …}>` | `<ToggleGroup value={[x]} onValueChange={(v: string[]) => …}>` |

`asChild` does not exist — Base UI uses `useRender` and a `render` prop.
`ToggleGroup` is array-valued and single-select by default (`toggleMultiple`
opts into multi), so a single selection arrives as a one-item array.

**Consequence for your own components.** `render` clones the element with merged
props — `data-slot`, refs, handlers. A wrapper component that only destructures
the props it uses will silently drop the rest. `components/explorer-link.tsx`
spreads `...props` onto the underlying anchor for exactly this reason, with
`target`/`rel` set *after* the spread so they cannot be overridden.

## 2. The shadcn CLI, in this monorepo

- Run it with a workspace target: `npx shadcn@latest add <c> -c apps/web`.
  From the repo root it exits with `{"error": "monorepo_root"}`.
- Components land in `packages/ui/src/components`; app-level components belong
  in `apps/web/components`. That split comes from `components.json` aliases.
- Style is `base-nova`, base colour neutral, theme and chart colour **olive**,
  preset `b6rrktQmm`.
- **It emitted `use-mobile.ts` into the wrong workspace.** `sidebar.tsx` imports
  `@workspace/ui/hooks/use-mobile`, but the CLI wrote `apps/web/hooks/use-mobile.ts`
  and left `packages/ui/src/hooks/` empty, so the build failed on a missing
  module. If a component imports a hook you do not have, check the other
  workspace before writing one.
- **`SidebarProvider` does not include `TooltipProvider`.** Collapsed sidebar
  buttons render tooltips, so the provider has to wrap the app in
  `app/layout.tsx` or they throw.

## 3. The `use-mobile` hook must not set state in an effect

The stock shadcn implementation (`useState` + `useEffect` + `setIsMobile`) trips
this repo's `react-hooks/set-state-in-effect` rule. A media query *is* an
external store, so the right implementation is `useSyncExternalStore` with a
server snapshot of `false` — a static export renders with no viewport at all,
and React reconciles on hydration. See `packages/ui/src/hooks/use-mobile.ts`.

## 4. recharts 3: what changed and what bites

**`Legend`'s `payload` prop is `Omit`ted from the public props.** You cannot
supply your own legend entries. The swatch colour comes from `item.color`, which
for an `<Area>` is its **`stroke`** — so the moment you use a surface-coloured
stroke (see §5) every swatch renders invisible. The fix is a plain HTML legend
driven from `ChartConfig`; `components/gas-chart.tsx` does that and shows each
series' share while it is at it.

**Ticks are selected by position, not by content.** Thinning an axis by
returning `""` from `tickFormatter` for ticks you want to hide does not work:
recharts still picks the same ticks and they render blank, so the axis ends up
*empty*. Use `interval`. This produced a chart with no x-axis labels at all —
**silent**, since nothing errors.

**`ChartContainer` takes exactly one `ResponsiveContainer` child** and is sized
by className; `aspect-auto h-[260px] w-full` works.

## 5. Chart colour, measured rather than judged

The theme's chart ramp is monochrome olive and **identical in light and dark**
(`--chart-1` 0.88 → `--chart-5` 0.286 lightness, chroma ≤ 0.031). For the gas
decomposition — parts of a whole — a one-hue sequential ramp is the *correct*
encoding, so that is fine. What is not fine is which steps you pick.

Running the `dataviz` skill's validator against the resolved sRGB values:

```
steps 1,2,3  → normal-vision ΔE 11.4 between #7c7c67 and #5b5b4b   FAIL (below 15)
steps 1,2,4  → normal-vision ΔE 17.6                               PASS
```

So the chart uses `--chart-1/2/4`, not `1/2/3`. Two further notes:

- **Read the validator's scope line.** Its "lightness band" and "chroma floor"
  FAILs are *categorical-palette* checks and do not apply to a sequential ramp,
  which only needs lightness monotonicity. Do not restyle the chart to satisfy
  them.
- **Stacked areas need a 2px gap in the surface colour, not a gradient fade.**
  The original vertical gradient (0.8 → 0.08 alpha) washed out the largest band
  and destroyed the boundaries between bands. Flat fills plus
  `stroke="var(--card)" strokeWidth={2}` separates them — which is what breaks
  the legend in §4.

## 6. Screenshotting recharts

`agent-browser screenshot --full` renders the chart area **blank**. The
full-page capture resizes the viewport, `ResponsiveContainer` re-measures, and
the SVG is captured mid-reflow. `isAnimationActive={false}` does *not* fix it —
that was my first, wrong, diagnosis.

Set a tall viewport and take an ordinary screenshot instead:

```bash
agent-browser set viewport 1280 1990    # not `resize`, not `viewport`
agent-browser screenshot out.png
```

Before concluding a chart is broken, query the DOM — `document.querySelector("[data-slot=chart]")`
for dimensions and `.recharts-area-area` for path data. That is what distinguished
a capture artifact from a real bug here.

## 7. Next.js 16 + Turbopack

**`node:sqlite` cannot be imported.** A static import works in `next build` and
fails in `next dev` with `ReferenceError: require is not defined`; routing it
through `createRequire` moves the failure to `Unsupported external type Url for
commonjs reference`. Use `process.getBuiltinModule("node:sqlite")` — a plain
method call no bundler rewrites, added for exactly this case. The build/dev
asymmetry makes this **silent** if you only ever run `next build`.

**`@types/node` must be ≥ 24.** The template ships `^20`, which predates the
`node:sqlite` type definitions.

**The docs are vendored**, at `apps/web/node_modules/next/dist/docs/`. `AGENTS.md`
requires reading them before writing code, and they are version-exact — worth
more than anything you remember about Next.js 15.

## 8. Static export and GitHub Pages

`output: "export"` is on. Consequences worth knowing:

- **Server Components run once at build time**, which is what makes the SQLite
  database a build *input* and the deployed site serverless. No route handlers,
  no cookies, no dynamic params, no `next/image` optimizer — none of which this
  app uses.
- **`basePath` is required** for a project site (`owner.github.io/<repo>`). It
  comes from `PAGES_BASE_PATH`, which `.github/workflows/deploy.yml` derives
  from the repo name and leaves empty for a `*.github.io` site. Verified: a
  base-path build rewrites all 126 asset references.
- **`.nojekyll` is mandatory.** Without it Pages' Jekyll step drops `_next/` and
  the site loads with no CSS or JS — **silent**, it just looks broken.
- **`trailingSlash: true`** so routes emit `route/index.html`.
- **`out/**` must be in the eslint ignores.** Enabling the export made eslint
  lint the generated bundle: 1 warning became **3,925**. Fixed in
  `packages/eslint-config/base.js`.

## 9. Reading sampled data honestly

The collector samples a few hundred blocks out of ~856,000/day, which changes
how the UI may talk about its own numbers.

- **Ratios are unbiased; totals are not.** Gas per transaction, a contract's
  share, gas per call and verified coverage sample numerator and denominator
  together, so the rate cancels. Window totals and per-contract self-gas are
  scaled by `blocks in window ÷ blocks sampled` and are estimates. `SampleMeta.scale`
  carries the factor.
- **Plot rates, not totals.** The chart shows gas/second per sampled block. Per-bucket
  totals would make the y-axis a function of how densely you happened to sample.
- **Suppress deltas on thin comparison windows.** A window with one or two
  blocks produced a `+673.6%` KPI delta that was pure sampling noise.
  `MIN_COMPARISON_BLOCKS = 4`, below which the badge reads "no prior window".
- **Never count unchecked as negative.** Verified share is computed over gas
  whose sources were *looked up*, and the card says what fraction that is. The
  first version counted never-checked and registry-errored identities as
  unverified and reported 19.6% where the real figure was 60.2% — the single
  most misleading bug in the build, and **silent**.
- **Show provenance on screen.** Block range, blocks sampled, stride and
  collection time sit under the dashboard, because a gas figure without its
  sample is not a finding.

## 10. Determinism, because the output is static HTML

- **Pin the locale and timezone in every formatter** (`en-US`, UTC). The server
  renders at build time and the browser rehydrates elsewhere; an implicit locale
  is a hydration mismatch waiting to happen.
- **Never `Math.random()` in render.** While the data was still placeholder it
  used a seeded mulberry32 so successive builds were identical.
- **A module-level database handle goes stale.** `pnpm gas:refresh` *replaces*
  `gas.db`, so a cached handle keeps reading the deleted inode and `next dev`
  serves the previous collection forever — **silent**. `lib/gas/data.ts` keys the
  handle to the file's mtime.

## 11. Architecture decisions worth not re-litigating

- **All windows are embedded in the page.** A static export cannot fetch on
  demand, so switching period is a client-side selection over data already in
  the HTML. When the data grows, move to `app/[period]/page.tsx` with
  `generateStaticParams()` so each window is its own pre-rendered page.
- **`lib/gas/data.ts` is the only seam.** Every accessor is async and carries the
  SQL it runs. Changing the data source should not touch a component.
- **The explorer lives in one module.** `lib/gas/explorer.ts` holds the Robinscan
  URL builders; the chain also has a Blockscout instance, so switching is a
  one-file change. Patterns were verified against the live site — `/tx/` and
  `/block/` work, `/transaction/` and `/blocks/` both 404. Robinscan's block
  pages 500 on recent blocks, which is their indexer lagging, not a bad URL.

## 12. Environment and tooling

- `pnpm gas:refresh` → `scripts/collect-gas-data.mjs`. Knobs: `BLOCKS`,
  `TIME_BUDGET`, `BLOCK_TIMEOUT`, `SOURCES_LIMIT`, `KEEP_DB`, `GAS_DB`.
- **Declare new env vars in `turbo.json`**, or lint warns and the cache is wrong.
  `GAS_DB` and `PAGES_BASE_PATH` are declared; `data/gas.db` is a build input so
  a refresh invalidates the cache.
- The database is **committed** (~34 MB after `VACUUM`) so CI builds need no
  chain access. At `BLOCKS=300` it approaches 50 MB, where GitHub starts warning
  — at that point commit an aggregated extract instead of the full frame table.
