# Design System Architecture — Final state (post DESIGN-SYSTEM-OVERHAUL, 2026-05-02)

> Moved from `CLAUDE.md` 2026-05-09 as part of the harness restructure.
> Source: pre-restructure CLAUDE.md §"Design System Architecture — Final state".
>
> Pre-overhaul audit findings (Q1–Q8) live separately in
> `docs/audits/DESIGN_SYSTEM_2026-05-02.md`.

DESIGN-SYSTEM-OVERHAUL workstream landed PRs 0–15 (#355–#370). Sites are
now routed through one of two modes set during onboarding; generation
behaviour, the appearance panel, and the design-system landing all
branch off that. Below is the post-workstream contract — refer here
when reasoning about generation prompts or onboarding flows.

## Two site modes

`sites.site_mode` is a text + CHECK column (`copy_existing` | `new_design`,
nullable) added in migration 0067.

- **NULL** — site hasn't been onboarded yet. Site detail renders the
  `OnboardingReminderBanner` (non-dismissible, links to
  `/admin/sites/[id]/onboarding`). Appearance panel renders an empty
  state. Design-system landing renders an empty state. Generation
  fallback: pre-PR-10 behaviour exactly (empty design context unless
  `DESIGN_CONTEXT_ENABLED` is on).
- **`copy_existing`** — site has a live WordPress theme. PR 7's
  extraction wizard at `/admin/sites/[id]/setup/extract` populates
  `sites.extracted_design` (colours / fonts / layout density / visual
  tone / screenshot URL / source pages) and
  `sites.extracted_css_classes` (container / heading levels / button /
  card). Appearance panel renders the read-only profile + Re-extract
  link; **no Kadence sync** (the host theme owns styling).
  Design-system landing renders the "Copy existing site" card.
- **`new_design`** — site is being built fresh on Kadence. The existing
  DESIGN-DISCOVERY wizard at `/admin/sites/[id]/setup` runs through
  design direction → concepts → tone of voice. Appearance panel renders
  the existing `AppearancePanelClient` with Kadence preflight + sync
  + rollback flow. Design-system landing renders the "New design" card.

## Content generation contract per mode

`lib/design-discovery/build-injection.ts` orchestrates context
injection; called once per page-tick from `lib/brief-runner.ts:1606`
and from `lib/system-prompt.ts:200`. Dispatch on `site_mode`:

- **`copy_existing`** — always runs (mode is the gate;
  `DESIGN_CONTEXT_ENABLED` is irrelevant). Emits an
  `<existing_theme_context>` block built from `extracted_design` +
  `extracted_css_classes`. Tells the model to use the extracted CSS
  class names on container / h1 / h2 / h3 / button / card, and NOT
  to introduce new CSS or inline styles unless absolutely necessary.
  Falls back to plain semantic tags for any null bucket.
- **`new_design`** — gated by `DESIGN_CONTEXT_ENABLED`. Emits the
  existing `<design_context>` + `<voice_context>` blocks from
  `design_tokens` / `homepage_concept_html` / `tone_of_voice`.
- **NULL** — pre-PR-10 fallback exactly: empty unless the flag is on.

Path B (PB-1) still applies in both modes: fragments only, no chrome,
inline-style budget capped at 200 chars total. The mode-aware
`<existing_theme_context>` is additive guidance — it doesn't change
the page envelope contract.

## Blog post simplification (PR 13)

`PageContext` carries `siteMode` so `systemPromptFor` appends a
`<blog_post_guidance>` block when `brief.content_type === 'post'`:

- Both modes: prefer plain semantic markup (h1, h2, h3, p, ul, ol,
  li, blockquote, img with alt) over decorative wrappers.
- `copy_existing` posts: avoid inline CSS entirely.
- `new_design` posts: inline `<style>` permitted but capped at ~3
  simple rules.

The page envelope contract (data-opollo wrapper, site-prefix on classes)
still applies.

## Image library context (PR 11, opt-in)

`sites.use_image_library` (boolean, default false; migration 0068).
Toggleable from `/admin/sites/[id]/settings`. When on, the brief
runner calls `buildImageLibraryContextPrefix({siteId, topic: page.title})`,
which queries `image_library` for active rows with caption + alt_text
matching the topic via `websearch_to_tsquery` on `search_tsv`. Up to
5 results are inlined as `<image_library_context>` so the model can
reference URLs directly. Off by default until operators verify
metadata quality.

## Screen / route map

| Route | Purpose |
|---|---|
| `/admin/sites/[id]` | Mode-aware site detail. Banner + design-system card branch on `site_mode`. |
| `/admin/sites/[id]/onboarding` | Mode-selection screen (PR 6). Always lands fresh sites here from `SiteCreateForm`. |
| `/admin/sites/[id]/setup` | DESIGN-DISCOVERY wizard (`new_design` only). |
| `/admin/sites/[id]/setup/extract` | Copy-existing extraction wizard (PR 7; `copy_existing` only). |
| `/admin/sites/[id]/appearance` | Mode-aware appearance panel (PR 8). |
| `/admin/sites/[id]/design-system` | Mode-aware summary + Advanced disclosure. `?advanced=1` reveals the four legacy tabs. |
| `/admin/sites/[id]/design-system/{components,templates,preview}` | Power-user surfaces. Reachable via direct URL or Advanced toggle. Not load-bearing on generation (audit). |
| `/admin/sites/[id]/settings` | Per-site settings. Includes the image-library toggle. |

## Env vars (post-workstream)

- `DESIGN_CONTEXT_ENABLED` — gates the `new_design` injection path
  only. Unset by default. The `copy_existing` path runs regardless.
- `FEATURE_DESIGN_SYSTEM_V2` — gates the separate `design_systems`
  registry block (different from `design_system_versions`). Unchanged
  by this workstream.
- `OPOLLO_MASTER_KEY` / `CLOUDFLARE_*` / `SUPABASE_*` — unchanged.

## Charts

### Mandate

Every chart in every Opollo product renders through **Apache ECharts**
via the `echarts-for-react` wrapper. This applies to:

- Site Builder analytics surfaces
- Optimiser dashboards
- CAP reporting and PURL pages
- Admin / operator tooling
- Customer-facing report exports (server-rendered SVG, see "Server
  rendering for exports" below)

**Banned for standard charts**, no carve-outs: Recharts, Chart.js,
Plotly, Nivo, Visx, Victory, hand-rolled `<svg>` charts.

**Permitted exception:** D3 may be used directly for non-chart
visualisation primitives (force graphs, network diagrams, custom
geometric layouts) only where ECharts has no equivalent — and ECharts
covers Sankey, graph, tree, treemap, sunburst, parallel, heatmap,
candlestick, boxplot, gauge, funnel, calendar, and pictorial charts
out of the box, so "no equivalent" is rare. Any use of D3 for chart-
shaped data (axes, series, ticks) is a banned chart.

### Why

1. **One library, every chart type.** Avoids the Recharts-for-bars-
   plus-D3-for-Sankey-plus-Chart.js-for-radar trap.
2. **One styling pipeline.** A single theme drives every chart.
3. **Performance at scale.** Canvas renderer handles 10k+ datapoints
   without React reconciliation cost on every tick.
4. **Server-rendering for PDF/email** is a native first-class feature
   (see below).
5. **One mental model per contributor.** Every reviewer reads one
   options object, not N library APIs.

### Version

Use the current stable `echarts` and `echarts-for-react` releases on
npm. As of 2026-05-22, `echarts` latest is **6.1.0** and `echarts-for-react`
is on its current major; **do not assume the project remains on 5.x**.
Verify before bumping that:

- `echarts-for-react` declares compatibility with the chosen `echarts`
  major (check its `peerDependencies`).
- The Next.js build (`pnpm build`) succeeds — ECharts ships native
  modules; resolve any Webpack / Turbopack module-resolution issues
  before merging.
- SSR rendering for exports works against the chosen version.

If a major-version bump introduces breakage, pin to the highest stable
minor that builds clean and open an issue for the upgrade.

### Implementation contract

All chart components live under `components/charts/`. Every chart
component is a thin wrapper that:

1. Imports `ReactECharts` from `echarts-for-react`.
2. Builds an `EChartsOption` via a helper in `lib/charts/options/`
   (one helper per chart type: `buildLineOptions`, `buildBarOptions`,
   `buildAreaOptions`, etc.).
3. Passes the shared theme from `lib/charts/theme.ts` — never inline
   colours.
4. Sets `notMerge={true}` unless there is a documented reason
   otherwise.

```typescript
// components/charts/LineChart.tsx
import ReactECharts from 'echarts-for-react';
import { buildLineOptions } from '@/lib/charts/options/line';
import { opolloChartTheme } from '@/lib/charts/theme';

export function LineChart({ data, xKey, yKeys, height = 320 }: Props) {
  const option = buildLineOptions({ data, xKey, yKeys });
  return (
    <ReactECharts
      option={option}
      theme={opolloChartTheme}
      style={{ height, width: '100%' }}
      notMerge
      opts={{ renderer: 'canvas' }}
    />
  );
}
```

### Theme

`lib/charts/theme.ts` exports a single ECharts theme object,
`opolloChartTheme`. Its palette is derived from the design-system
colour tokens.

The exact derivation depends on the existing token pipeline in this
repo — verify before implementation:

- If the design system already exposes resolved colour values as
  module-level constants (TypeScript exports, generated from
  Tailwind/PostCSS at build time), import them and build the theme
  from those constants.
- If colours are CSS-variable-only with no build-time-resolved
  exports, add a small generation step (e.g. read the source-of-truth
  token file at build, emit `lib/charts/theme.generated.ts`).
- **Do not** read `getComputedStyle(document.documentElement)` to
  resolve CSS vars at runtime — that breaks SSR, breaks the canvas
  renderer's first paint, and is invisible on the server-side export
  path.

Register light and dark variants; the active variant is selected at
mount time from the same theme-mode state the rest of the app uses.

### Server rendering for exports

PDF and email exports render charts server-side using ECharts' native
SSR support. The configuration is:

```typescript
import * as echarts from 'echarts';

const chart = echarts.init(null, opolloChartTheme, {
  renderer: 'svg',
  ssr: true,
  width: 800,
  height: 400,
});
chart.setOption(buildLineOptions({ data, xKey, yKeys }));
const svgString = chart.renderToSVGString();
chart.dispose();
```

`renderer: 'svg'` + `ssr: true` enable headless rendering with no
browser dependency. The output is an SVG string suitable for direct
embedding in PDF generators or HTML emails. **Do not** use the canvas
renderer for export paths.

### Migration of existing charting surfaces

The migration of any existing non-ECharts chart surfaces is the scope
of a follow-up PR, not this documentation PR. That PR will:

1. Inventory every chart in the codebase as the first step (verify
   what's actually there — do not trust assertions from earlier docs).
2. Build `lib/charts/theme.ts` and the option builders for the chart
   types in use (line, area, bar, donut, etc.).
3. Build the wrapper components under `components/charts/`.
4. Replace every non-ECharts import call site.
5. Run a visual-regression check against the previous render.
6. Remove the deprecated library/libraries from `package.json`.
7. Land the ESLint guardrail (see "Enforcement", below).

### Enforcement

The follow-up migration PR adds an ESLint rule to prevent regression:

```json
{
  "rules": {
    "no-restricted-imports": [
      "error",
      {
        "paths": [
          { "name": "recharts", "message": "Use ECharts via components/charts/*. See DESIGN_SYSTEM.md §Charts." },
          { "name": "chart.js", "message": "Use ECharts via components/charts/*. See DESIGN_SYSTEM.md §Charts." },
          { "name": "plotly.js", "message": "Use ECharts via components/charts/*. See DESIGN_SYSTEM.md §Charts." },
          { "name": "victory", "message": "Use ECharts via components/charts/*. See DESIGN_SYSTEM.md §Charts." }
        ],
        "patterns": [
          { "group": ["recharts/*", "@nivo/*", "@visx/*", "victory-*"], "message": "Use ECharts via components/charts/*. See DESIGN_SYSTEM.md §Charts." }
        ]
      }
    ]
  }
}
```

Land this rule **in the migration PR**, not the docs PR — adding the
rule to a repo that still contains banned imports breaks CI.

## Known gaps / deferred items

- **Pre-existing CI Supabase-stack failure.** Migrations
  `0031_email_log.sql` and `0031_optimiser_clients.sql` collide on
  the version primary key. Hotfix branch
  `hotfix/migration-0031-collision` (#348) renumbers
  `optimiser_clients` to 0066 but is stale relative to current main.
  E2E + Vitest workflows fail at "Start Supabase local stack" until
  this lands. The DESIGN-SYSTEM-OVERHAUL workstream PRs all merged
  with passing lint + typecheck + build but cannot be E2E-validated
  until the collision is resolved.
- **Vision pass on copy-existing extraction.** PR 7's extractor is
  HTML/CSS-first. Adding a Sonnet vision pass on the Microlink
  screenshot is feasible (we already have the pipeline shape from
  the design-discovery wizard) but deferred — v1 signals look
  strong on static-HTML sites.
- **Cloudflare optimised variant.** Per-account dashboard
  configuration; PR 4 documented the operator-side setup
  (`width=1200, fit=scale-down`) but didn't automate variant
  provisioning. Future slice can add a setup script if more sites
  need it.
- **Audit-log filtering.** PR 14 introduced the `ErrorFallback`
  primitive but the appearance event log still surfaces every
  outcome including raw audit codes. Filtering noise events from
  the operator-visible feed is a follow-up.
- **Onboarding mid-stream re-flips.** `POST /onboarding` overwrites
  `site_mode` unconditionally. Operator who flips mid-wizard leaves
  orphan rows in the previous mode's columns. Cheap to surface as
  a confirmation step in a follow-up; not a corruption risk.
