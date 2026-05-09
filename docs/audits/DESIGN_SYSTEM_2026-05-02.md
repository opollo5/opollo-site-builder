# Design System Architecture — Audit 2026-05-02

> Moved from `CLAUDE.md` 2026-05-09 as part of the harness restructure.
> Source: pre-restructure CLAUDE.md §"Design System Architecture — Audit 2026-05-02".
>
> **Frozen in time.** This is the audit captured before the
> DESIGN-SYSTEM-OVERHAUL workstream. The post-workstream contract
> is in `docs/architecture/DESIGN_SYSTEM.md` — refer there for
> current behaviour, not here.

Foundational audit done before the DESIGN-SYSTEM-OVERHAUL workstream (PRs 0–15).
Findings drive the architecture decisions that follow. File:line citations
in parentheses are the source of truth — re-verify before relying on a claim
older than ~one milestone.

## Q1 — Are the Versions / Components / Templates / Preview tabs load-bearing?

**No** for `design_system_versions.tokens_css` / `base_styles_css`.

The four tabs at `app/admin/sites/[id]/design-system/{page,components,preview,templates}/page.tsx`
are UI-only — they let an operator edit and store CSS strings against
`design_system_versions`, but those strings are never read by the brief
runner, batch worker, blog pipeline, or any Anthropic call. The only
consumer of `design_system_versions` rows is the admin UI via
`app/api/sites/[id]/design-systems/route.ts`.

Caveat: the **separate** `design_systems` (singular) registry — gated by
`FEATURE_DESIGN_SYSTEM_V2` — does feed `tokens_css` into the prompt's
"Available components" registry block via `lib/design-system-prompt.ts:82`
and `lib/system-prompt.ts:218–248`. Different table, different flag,
different code path. The four UI tabs do NOT participate in that.

Architectural consequence: PR 9 takes the "NOT load-bearing" branch — hide
the tabs behind an Advanced disclosure and replace the raw-CSS-editor entry
point with a guided flow.

## Q2 — What does `context_build_failed` mean?

Server-side audit-log outcome only, emitted by
`app/api/sites/[id]/appearance/preflight/route.ts:94` when
`buildPaletteSyncContext()` returns `!ok`. The user never sees the literal
string — the route maps the inner code to an HTTP envelope (409 / 401 / 404 /
502) returned at lines 100–122. Inner codes: `KADENCE_NOT_ACTIVE`,
`SITE_NOT_FOUND`, `SITE_CONFIG_MISSING`, `DS_NOT_FOUND`, `WP_AUTH_FAILED`,
`WP_REST_UNREACHABLE`.

What the user actually sees today is whatever the Appearance panel renders
when the preflight POST fails — which is where the leak happens. PR 8 + PR 14
fix the UX side; the server-side outcome string stays for the audit log.

## Q3 — Brief runner inputs: design-discovery (new) vs tokens.css (old) — both?

Both, gated independently.

- `lib/brief-runner.ts:1606` calls `buildDesignContextPrefix(brief.site_id)`
  every page-tick. Reads `sites.{design_tokens, homepage_concept_html,
  tone_applied_homepage_html, tone_of_voice}`. Gated by
  `DESIGN_CONTEXT_ENABLED`.
- `lib/system-prompt.ts:218–248` (`resolveDesignSystemSlot`) — when
  `FEATURE_DESIGN_SYSTEM_V2` is on AND a `design_systems` row is active,
  embeds `tokens_css` + component/template registry into the prompt template.
- Both can be on simultaneously; they target different prompt regions.
  Neither reads from the four-tab `design_system_versions` table.

## Q4 — DESIGN_CONTEXT_ENABLED on staging / prod

Default unset → flag treats it as off
(`lib/design-discovery/build-injection.ts:42`). Not committed in repo
(no `.env.staging`, no workflow file sets it). Operator-configured at deploy
time in Vercel. **Treat as currently OFF in prod** until Steven confirms
otherwise. PR 10 will run mode-aware generation as a separate code path so
the workstream isn't blocked on flipping that flag.

## Q5 — Content generation output format (Path B confirmation)

Confirmed Path B — fragments only, inline CSS budget capped.

`lib/brief-runner.ts:574–609` system prompt enforces:
- Raw HTML, no markdown fences.
- A contiguous fragment of one or more top-level `<section>` elements.
- No `<!DOCTYPE>`, `<html>`, `<head>`, `<body>`, `<nav>`, `<header>`,
  `<footer>`, `<meta>`, `<link>`, `<title>`, `<script>`.
- Every `<section>` carries `data-opollo`.
- Every CSS class begins with the site prefix.
- `<style>` blocks allowed only for keyframes / scoped utilities; total
  inline-style budget under 200 characters.

Reference: `docs/plans/path-b-migration-parent.md`.

## Q6 — Setup wizard at /admin/sites/[id]/setup

Exists, three-step DESIGN-DISCOVERY wizard
(`app/admin/sites/[id]/setup/page.tsx:15–29`):

1. **Design direction** — operator-supplied references / description /
   industry → 3 generated concepts → approve one.
2. **Tone of voice** — sample copy + guided questions → tone JSON +
   approved samples.
3. **Done** — summary + "Start generating content" CTA.

`?step=1|2|3` query param drives step. No-param entry redirects to
the resume step computed from `design_direction_status` and
`tone_of_voice_status`. Writes to: `design_brief`,
`{design_direction,tone_of_voice}_status`, `homepage_concept_html`,
`inner_page_concept_html`, `tone_applied_homepage_html`, `design_tokens`,
`tone_of_voice`, `regeneration_counts`.

## Q7 — "Set up design system" button on site detail

`app/admin/sites/[id]/page.tsx:389–394` — links to
`/admin/sites/${site.id}/design-system` (the four-tab UI). PR 12 redirects
this to `/admin/sites/${site.id}/onboarding` (the new mode-selection
screen introduced in PR 6).

## Q8 — sites table columns related to design

Migration **0060** (`supabase/migrations/0060_design_discovery_columns.sql`):

| Column | Type | Default | Null | Purpose |
|---|---|---|---|---|
| `design_brief` | jsonb | — | yes | Step 1 operator inputs (refs, screenshots, description, industry, refinement notes). |
| `homepage_concept_html` | text | — | yes | Approved homepage concept HTML; inline CSS only; reference context for generation. |
| `inner_page_concept_html` | text | — | yes | Companion to homepage concept for inner pages. |
| `tone_applied_homepage_html` | text | — | yes | Homepage concept with approved tone rewritten into hero / CTA / first service card. |
| `design_tokens` | jsonb | — | yes | Extracted tokens: `{primary, secondary, accent, background, text, font_heading, font_body, border_radius, spacing_unit}`. |
| `design_direction_status` | text | `'pending'` | no | `pending` / `in_progress` / `approved` / `skipped`. |
| `tone_of_voice` | jsonb | — | yes | `{formality_level, sentence_length, jargon_usage, personality_markers[], avoid_markers[], target_audience, style_guide, approved_samples}`. |
| `tone_of_voice_status` | text | `'pending'` | no | Same enum as design_direction_status. |

Migration **0066** (`supabase/migrations/0066_design_discovery_regen_counts.sql`):

| Column | Type | Default | Null | Purpose |
|---|---|---|---|---|
| `regeneration_counts` | jsonb | `{"concept_refinements":0,"tone_samples":0}` | no | Server-enforced caps (≤10 per loop) tracked across the wizard. |

## Architecture decisions for PRs 5–15 (locked by this audit)

1. **Site mode** — add `sites.site_mode` enum (`copy_existing` | `new_design`)
   default null. New onboarding screen at `/admin/sites/[id]/onboarding`
   (PR 6) sets it before the user hits the existing wizard or the new
   extraction flow.
2. **Copy-existing extraction columns** — add `sites.extracted_design`
   (jsonb) + `sites.extracted_css_classes` (jsonb) for PR 7's output. Keep
   the existing DESIGN-DISCOVERY columns (`design_tokens` etc.) as the
   `new_design` path.
3. **Design system tabs** — take the NOT-load-bearing branch in PR 9.
   Hide tabs behind Advanced; entry point becomes the mode-aware design
   summary, not the raw CSS editor.
4. **Mode-aware generation** — PR 10 routes both `copy_existing` and
   `new_design` paths through `buildDesignContextPrefix`, with the
   copy-existing branch substituting `extracted_design` /
   `extracted_css_classes` for `design_tokens` / concept HTML. Behaviour
   when `site_mode IS NULL` falls back to current logic; no regression
   on flag-off sites.
5. **Appearance panel** — PR 8 reads `site_mode` first and renders one of
   three states (no mode set / copy_existing / new_design). The
   `context_build_failed` audit code stays server-side; the UI never
   surfaces it.
