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
