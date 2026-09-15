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

## 2b. Tailwind `@source` paths, and a comment that eats the stylesheet

`packages/ui/src/styles/globals.css` shipped two `@source` globs that were one
level short — they resolved to `packages/apps/` and `packages/components/`,
neither of which exists, and Tailwind ignored them **silently**. Paths are
relative to the CSS file, so from `packages/ui/src/styles/` the repo root is
four levels up, not three.

Correcting them changed the compiled CSS by **zero bytes** (88,445 bytes, 499
selectors, before and after), because Tailwind v4's automatic source detection
was already covering `apps/web`. So this is dead config rather than a bug — but
verify that way round before assuming a glob is load-bearing.

**The trap while fixing it:** a CSS comment explaining the paths contained the
literal `apps/*/components`. The `*/` in that path **closed the comment early**,
the rest parsed as garbage, and the stylesheet fell from 88 KB to 4 KB — the
page renders unstyled with only a PostCSS stack trace deep in the build output.
Never write a glob containing `*/` inside a `/* … */` comment.

**How to verify any stylesheet change:** diff the compiled selectors rather than
eyeballing the page.

```bash
pnpm build && find .next/static -name '*.css' | head -1 | xargs cat \
  | grep -o '\.[a-zA-Z@][-a-zA-Z0-9_\\:/@.\[\]%]*' | sort -u > after.txt
comm -23 before.txt after.txt   # anything here is a class you just lost
```

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

## 11b. pnpm 12, and where settings actually live

The repo is pinned to `pnpm@12.4.1` via `packageManager`, with `engines.node >= 24`.
Three things changed under pnpm 12 that cost time:

- **The `pnpm` field in `package.json` is no longer read.** Overrides and other
  settings now live in `pnpm-workspace.yaml`. pnpm warns, but the setting is
  simply ignored — put an override in the wrong file and it silently does
  nothing.
- **A supply-chain policy blocks freshly published packages.** `minimumReleaseAge`
  rejected `open@11.0.3` (published hours earlier, pulled in transitively by
  `shadcn`). The right fix is an `overrides:` pin to the previous patch, which
  satisfies the guard rather than disabling it; `minimumReleaseAgeExclude` is the
  escape hatch pnpm maintains itself for versions you pinned deliberately. Note
  the lockfile is validated *before* re-resolution, so a new override needs
  `pnpm clean --lockfile` (or deleting the lockfile) to take effect.
- **Build scripts are deny-by-default** via `allowBuilds` in
  `pnpm-workspace.yaml`. A new dependency whose postinstall matters — `esbuild`
  fetching its platform binary — fails the install until listed. pnpm appends a
  placeholder line (`esbuild: set this to true or false`) when it errors, so
  editing the file yourself can leave a duplicate YAML key.

## 11c. Two majors that are available and should not be taken

Checked 2026-09-11, with every dependency otherwise pinned to the newest release
inside its current major:

- **ESLint 10** installs but breaks linting. `typescript-eslint` and
  `eslint-plugin-react-hooks` both declare `^10.0.0`, but
  `eslint-plugin-react@7.37.5` — the newest published — supports only `^9.7` and
  throws `TypeError: contextOrFilename.getFilename is not a function` on
  `react/display-name`. Stay on `eslint@9.39.5` until `eslint-plugin-react`
  ships ESLint 10 support, even though pnpm now marks 9.x deprecated.
- **TypeScript 7** is blocked by peer ranges: `typescript-eslint@8.70.0`
  requires `typescript >=4.8.4 <6.1.0`. Stay on `5.9.3`.

Re-check both before assuming they are still blocked — the fix is one upstream
release away in each case.

## 12. Environment and tooling

- `pnpm gas:refresh` → `scripts/collect-gas-data.mjs`. Knobs: `BLOCKS`,
  `TIME_BUDGET`, `BLOCK_TIMEOUT`, `SOURCES_LIMIT`, `KEEP_DB`, `GAS_DB`.
- **Declare new env vars in `turbo.json`**, or lint warns and the cache is wrong.
  `GAS_DB` and `PAGES_BASE_PATH` are declared; `data/gas.db` is a build input so
  a refresh invalidates the cache.
- The database is **committed** (~34 MB after `VACUUM`) so CI builds need no
  chain access. At `BLOCKS=300` it approaches 50 MB, where GitHub starts warning
  — at that point commit an aggregated extract instead of the full frame table.

## 13. The Chain health page (2026-09-14)

`/health` replays the 2026-09-04 incident from public signals and shows every
alert the rules would have raised over the collection. Data comes from
`gasmon health` (see `gasmon/README.md`, "Chain health") via
`pnpm health:refresh` → `apps/web/data/health.db`. The page reads it through
`lib/health/data.ts`, the same kind of seam as `lib/gas/data.ts`.

**`blockTimestamp` of `0x0` is not a timestamp.** Robinhood's official RPC
includes `blockTimestamp` on every log, but for history its value is `0x0`.
Parsing it produced 12,292 Chainlink transmissions all dated 1970 and negative
inclusion delays — **silent**, since a zero parses fine. Ethereum logs from
`eth.drpc.org` carry real values. The collector fetches block times whenever the
field is zero, on both chains. Check a value, not just that the key exists.

**recharts 3 `Line` takes no per-series `data`; `Scatter` does.** A chart that
overlays individual observations (the grey dots) on a derived line (the p90 step)
passes the line's rows as the `ComposedChart` data and the dots as `Scatter data`.
`YAxis dataKey` must name a key both datasets share.

**`syncId` does not sync a numeric time axis.** It matches by data index or by
category value. Stacked charts with different sampling (every Ethereum block,
every batch, 1-min receipt means) share an x-domain, but each keeps its own
crosshair. Don't add `syncId` expecting a shared cursor: it lines up unrelated
indices and moves the tooltip to the wrong time.

**The chart ramp does not flip in dark mode, so pick the accent per mode.**
`--chart-1…5` are identical in light and dark (§5). A single step that reads on one
card vanishes on the other. Measured: `--chart-4` is 9.42:1 on the light card and
1.80:1 on the dark one; `--chart-1` is 1.43:1 and 11.82:1. `SignalChart` sets
`[--health-accent:var(--chart-4)] dark:[--health-accent:var(--chart-1)]` on the
`ChartContainer` and points the series colour at `var(--health-accent)`.

**Status colours are reserved, and one is below 3:1.** Alert markers use the
dataviz status steps: warning `#fab219`, serious `#ec835a`, critical `#d03b3b`.
Warning measures 1.83:1 on the light card, so severity always renders as icon plus
label (`SeverityBadge`). Chart markers carry a number or letter keyed to the event
list, never colour alone.

**Close markers need staggered tags.** On Sep 4, four markers fall within ~2
minutes of a 90-minute window, and their tags printed as `123A`. `SignalChart`
assigns each tag to the first row whose previous tag is ≥ 2.5% of the domain away,
and grows the top margin by 11 px per row used.

**Mixed units on a delay axis read as noise.** recharts' own ticks gave
`0 s · 400 s · 13 min · 20 min`. Delay charts pass explicit `yTicks` (multiples of
5 min for posting delay, of 60 s for inclusion delay), formatted as seconds below
2 min and minutes above.

**Functions do not cross the server → client boundary.** Rule metadata carries
formatting functions (`peakLabel`), so `lib/health/rules.ts` is imported by the
client components directly. It is not passed through the snapshot the server
component builds.

**The database accumulates; it is not replaced.** Unlike `gas.db`, `health.db`
keeps growing: history is what the replay windows are made of. `health:refresh`
starts an hour before the newest stored batch and the collector skips what it has.
The mtime-keyed handle still matters, because writes change the file under
`next dev`. Declare `HEALTH_DB` in `turbo.json` like `GAS_DB`; lint warns
otherwise.

**Don't build against a database being written.** The Sep 1–14 backfill took ~1¾
hours. The log and header sources took 44 minutes (Chainlink alone 21), and
20,780 receipt samples took another 62. To preview the page mid-collection, copy
the database with SQLite's online
backup and point `HEALTH_DB` at the copy. A read-only open of the live file can
hit `SQLITE_BUSY` while the collector commits.

**Payload.** With the full collection the page embeds two dense replay windows
(every Ethereum block, every batch and every transmission) and a binned
fortnight. It exported at 284 KB of HTML before receipt samples were added, and
at 464 KB with the full Sep 1–14 collection (a 12 MB database).

**Hard-coded claims go stale as the database grows.** The first build's fortnight
card said only the write-path page stayed quiet outside the incident. That went
stale as soon as the traffic rule was tightened to two bins and went quiet too. A
tile
labelled "first warning on Sep 4" actually showed the first warning in the replay
window, although Sep 4 had also warned at 09:20. The page now derives such
sentences from the alerts. The rules table counts episodes outside the incident
period rather than other *days*, so a false alarm on the incident's own date
still shows.
