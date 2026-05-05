# Opollo Site Builder — Working Brief

## What this is
Next.js 14 (App Router) + TypeScript + Tailwind + shadcn/ui + Vercel AI SDK.
A chat interface that generates WordPress pages for Opollo's clients.

## How to work
- Work autonomously. Don't ask for permission for normal coding tasks.
- **Before starting a task that matches a pattern, read `docs/patterns/<pattern-name>.md` first.** The patterns folder is the playbook for recurring shapes — files, tests, PR structure, known pitfalls. If no pattern matches, proceed from first principles and note whether the task is a candidate for a new pattern.
- **For operations tasks** (deploy rollback, key rotation, stuck incident, missing migration, env-var provisioning) — consult `docs/RUNBOOK.md` before acting. Do not freelance on destructive or irreversible operations.
- **For one-off rules that aren't patterns** (test-helper discipline, fresh-stack config, CI-stuck recovery, write-safety audit requirement, UX-debt capture discipline, secret-handling discipline) — see `docs/RULES.md`. Each rule has the incident that taught it.
- After any change: run lint, typecheck, and build. Fix failures yourself before reporting back.
- When reporting back, give me a one-paragraph summary, not a blow-by-blow.
- After opening a PR, monitor CI until it passes. If CI fails, read the failure, fix it, push again. Repeat until green.
- "Done" means: PR merged (or handed to Steven for merge, where required) and summary posted. Not: PR open, CI running, waiting for input.

## Merging
- Auto-merge your own PRs when ALL of these are true:
  - CI is fully green (all required checks pass)
  - No review requested and no pending review comments
  - The PR was opened by Claude Code (not by Steven)
  - The PR is not write-safety-critical (see below)
- Human merge still required for:
  - Any PR Claude Code escalates to Steven for a decision
  - M3, M4, M7 milestone PRs (concurrency / transactional / circuit breaker code)
  - Any PR Steven explicitly flags for review

## Self-test loop
- Retry ceiling is 10 attempts per PR, not 3. Retry count alone is no longer the escalation trigger — "not converging" is.
- Escalate to Steven only when: (a) you see the same failure twice in a row (the fix isn't landing), or (b) you hit a genuine architectural question requiring his input — spec deviation, security tradeoff, schema decision.
- CI failure logs are auto-posted as PR comments by `.github/workflows/ci.yml` (added in PR #18). Read those comments directly instead of asking Steven to paste logs.

## Sub-slice autonomy
For sub-slices of a parent milestone whose plan Steven has already approved (M2a/b/c/d under M2, etc.), execute end-to-end without per-slice plan review:

- Propose the sub-slice plan in the PR description itself, not as a message to Steven beforehand.
- Write code immediately against the approved parent plan.
- Open the PR with plan-as-description + code + tests in one go.
- Self-correct CI failures within the 10-retry ceiling above.
- Auto-merge when green.
- Status update to Steven once merged: one-liner, e.g. "M2c-2 merged, proceeding to M2c-3."

Escalate only for: architectural decisions not in the parent plan, spec deviations, security tradeoffs, or same-failure-twice CI loops. Do NOT escalate for: sub-slice planning, operational/infra issues, routine tradeoffs already covered in the parent plan.

## Auto-continue — across sub-slices AND across milestones
After an auto-merged PR, automatically proceed to the next PR per the roadmap. No stop-gates at sub-slice boundaries, no stop-gates at parent-milestone boundaries. Silence = keep going.

Rule chain:

- `M2c-1 merged → start M2c-2`
- `M2c-2 merged → start M2c-3`
- `M2c-3 merged → start M2d-1` (next slice of parent M2)
- `M2d-N (last) merged → start M3-1` (next milestone per the roadmap)
- `M3-N (last) merged → start M4-1`
- etc. through the roadmap in the technical design doc.

Write-safety-critical milestones (M3 batch generator, M4 image library, M7 anything that spends money or mutates client WP sites) still require per-slice plans with the **"Risks identified and mitigated"** audit. That audit + the concurrency / E2E / migration / RLS test patterns are the safety net — not a wait for Steven at a milestone boundary.

Stop and wait for Steven only when:
- An architectural escalation surfaces (cost tradeoff, spec ambiguity, security decision — things the plan can't resolve).
- The same CI failure lands twice in a row (same-failure-twice rule).
- A required env var is missing (note what's needed, skip the affected sub-slice, continue with slices that don't depend on it).
- Steven explicitly tells you to pause — e.g. "I want to test M4 before starting M5." Silence is NOT a pause signal; it's a proceed signal.

Post a one-line status ping per merge: `"<slice> merged, starting <next>"`. That's the visibility channel — Steven reads the pings in his GitHub inbox.

## Parallelism (multi-session coordination)
Serial-single-session is the default. When Steven runs two browser tabs of Claude Code in parallel, coordinate via `docs/WORK_IN_FLIGHT.md` and follow `docs/PARALLELISM_PLAN.md`:

- Read `docs/WORK_IN_FLIGHT.md` before editing any file. Respect the other session's claims + the "Hot-shared" list.
- Append a claim block with your branch, slice, files claimed, and (if applicable) reserved migration number.
- Prefix every status message to Steven with `[Session A]` / `[Session B]` so cross-session output stays legible.
- On merge, remove your claim block in the next PR's first commit (or a one-line cleanup PR if nothing's queued).
- Conflict with the other session's claims → stop and ask Steven; do NOT coordinate with the other session directly.

The bootstrap prompt Steven pastes into a second tab lives in `docs/PARALLELISM_PLAN.md` → *The bootstrap prompt*.

## Enabling auto-merge on every PR
Every PR must have GitHub auto-merge armed at creation time. Call `mcp__github__enable_pr_auto_merge` (with `mergeMethod: "SQUASH"`) immediately after `create_pull_request` — it is not enabled implicitly. Without that call, the PR sits in the mergeable state until someone clicks the button in the UI, breaking the self-driving loop.

## PR auto-merge monitoring

When monitoring a PR with auto-merge armed, handle the "out-of-date with base branch" state, not just merged/failed. Specifically:

1. If a polled PR shows state OPEN with mergeable=BEHIND (or equivalent signal that the branch is behind main), run `gh pr update-branch <PR>` automatically.
2. If update-branch fails due to merge conflict, stop and report — do not force it.
3. If update-branch succeeds, continue polling; CI will re-run and auto-merge fires when green.
4. Apply this to every PR being monitored, including ones stacked behind other PRs that just merged.

This prevents the failure mode where PR A merges, PR B becomes behind main, and the monitor waits forever because auto-merge can't fire on a behind-main branch.

## Self-audit is the review; proceed without external gate
Self-audit is the first AND the final layer for planning. Once a plan has a populated **"Risks identified and mitigated"** section (see below for what that must contain), proceed directly to implementation. Do NOT post plans to Steven or Claude.ai as a review gate — not for parent milestones, not for sub-slices.

Where plans live:
- Parent milestone plans go in the first sub-slice's PR description.
- Sub-slice plans go in their own PR description.
- Status updates ("M3-1 merged, starting M3-2") happen once per merge — that's the visibility channel.

Escalate to Steven only when:
- You cannot self-resolve a tradeoff (cost, deadline, spec ambiguity).
- A decision needs information you don't have (legal, security review, infrastructure cost ceiling).
- The same CI failure lands twice in a row.

Every plan MUST include a **"Risks identified and mitigated"** section listing:

- Each write-safety hotspot in the proposed design (billed external calls, concurrent writers, multi-row state transitions, triggers, race windows, schema-level uniqueness assumptions).
- How the plan mitigates it (idempotency key, DB unique constraint, advisory lock, dedicated test case, etc.).
- Any gaps you are deliberately deferring, with a reason and a follow-up slice / milestone pointer.

If an obvious write-safety gap exists (missing idempotency key on a billed external call, missing constraint on a high-churn table, missing test assertion on a concurrency invariant, trigger that can deadlock with a worker), fix it in the plan *before* coding. Write-safety-critical milestones (M3 batch generator, anything that spends money or mutates client WP sites) get this audit applied to every sub-slice plan, not just the parent milestone plan.

A plan without a populated "Risks identified and mitigated" section is not ready to execute.

## Commands
- `npm run dev` — local dev
- `npm run lint` — ESLint
- `npm run typecheck` — tsc --noEmit
- `npm run build` — production build
- `npm run test` — Vitest
- `npm run test:coverage` — Vitest with V8 coverage (60% line / 55% branch baseline)
- `npm run test:e2e` — Playwright (requires `supabase start`)
- `npm run audit:static` — static-analysis script (`scripts/audit.ts`) catching middleware/auth/db/migration/typography/env-var/error-handling/dead-route class errors before runtime. **HIGH severity gates CI.** Per `docs/RULES.md` rule #8 — see also the PLATFORM-AUDIT workstream PRs (#386, #389, #392, #394, #396, #398, #400, #402).
- `npm run analyze` — production build with @next/bundle-analyzer reports

## DX hygiene
Pre-commit and commit-message hygiene is enforced via Husky. Hooks install on
`npm install` via the `prepare` script.

- **pre-commit:** `lint-staged` runs ESLint (auto-fix) on staged JS/TS and
  stylelint on CSS. Any remaining warning fails the commit — `--max-warnings=0`.
- **commit-msg:** `commitlint` enforces Conventional Commits
  (feat / fix / chore / refactor / docs / test / perf / build / ci / revert).
  Milestone scopes like `feat(m3-6):` or `feat(infra):` pass the default rule
  set; header length cap is 100 chars.

Supply-chain scanning runs server-side:
- **CodeQL** (`.github/workflows/codeql.yml`) — SAST on every PR + weekly cron.
- **Dependabot** (`.github/dependabot.yml`) — weekly npm + actions refresh,
  Radix grouped, minors/patches grouped, majors separate.
- **gitleaks** (`.github/workflows/gitleaks.yml`) — secret scan with
  `.gitleaks.toml` allow-list for the deterministic test master key + local
  Supabase JWTs.
- **npm audit** (`.github/workflows/audit.yml`) — blocks on critical CVEs in
  prod deps, informational at high. Threshold will tighten to `high` once the
  pending Next.js framework upgrade lands.

## Standards
- Server Components by default; Client Components only when required
- shadcn/ui components over custom; Tailwind utility classes only
- Strict TypeScript — no `any`, no `@ts-ignore`
- One logical change per commit; conventional commit messages

## Git workflow
- Branch per task: `feat/`, `fix/`, `chore/`, `refactor/`
- Always open a PR, never push direct to main
- PR description should reference the issue it closes

## What I care about
- Don't loop me in on routine errors — fix and retry
- Do loop me in on design decisions or scope questions
- Keep PRs small enough to review in 5 minutes
- **RUNBOOK is load-bearing for incident response. Code that changes a blocker code, audit event name, or error envelope MUST update the matching `docs/RUNBOOK.md` entry in the same PR.**
- **Never print env-var values or connection strings to tool output.** Any command that reads from `.env.local`, env, or another secret source runs with `2>$null` (PowerShell) / `2>/dev/null` (bash). Pass values via variables — never inline them into the visible command, never `Write-Output`/`Write-Host`/`echo` them, never paste a connection string into a chat update. If you need to confirm a value is set, print only its length or a hash prefix. Tool output that surfaces a secret (CLI parse errors, `--debug` flags, verbose logs) gets piped through a redactor before it reaches the conversation. Full rule + incident: `docs/RULES.md` #9.

## Performance standards
- **Lighthouse CI:** every PR runs `.github/workflows/lighthouse.yml`
  against a production build of `/login` (session-gated admin surfaces
  are out of scope — they'd need the full Supabase-in-CI flow to render).
  Thresholds are `warn` for now; baseline ratchets to `error` once we
  have a few runs of stable history.
- **EXPLAIN ANALYZE for hot-path queries:** any new DB query in a code
  path that runs per-request or per-slot (chat route, batch worker,
  middleware, admin list pages) MUST be EXPLAIN ANALYZE'd against a
  realistic-volume seed before merge. Paste the plan in the PR
  description so the index decision is visible in history. Pointed-read
  queries keyed by PK/UUID skip this; new JOINs, LIKE / ILIKE, ORDER BY,
  and anything without an obvious index path do not.

## Data + AI conventions
Lives in dedicated docs so this file doesn't sprawl:

- `docs/DATA_CONVENTIONS.md` — soft-delete (`deleted_at` + `deleted_by`),
  audit columns (`created_at` / `updated_at` / `created_by` / `updated_by`),
  `version_lock` for optimistic concurrency, `supabase/data-migrations/`
  contract. Forward-facing; existing tables fold in on the next natural
  migration.
- `docs/PROMPT_VERSIONING.md` — `lib/prompts/vN/` layout, per-version
  immutability, eval harness under `__evals__/`, prompt injection
  defense via tagged inputs, per-tenant cost budgets spec, Langfuse
  integration. Cutover is its own sub-slice (blocked on
  `LANGFUSE_*` env provisioning for the shipping path).
- `docs/RUNBOOK.md` — on-call playbook: deploy rollback, auth
  break-glass, batch cancellation, WP publish failures, Supabase
  quota, security incident response.

## Release hygiene
- `.github/workflows/release-please.yml` watches main; every merge
  aggregates conventional commits into a Release PR that bumps
  `package.json` + generates `CHANGELOG.md`. Merging that PR cuts
  a GitHub Release + git tag.
- No external secrets — default `GITHUB_TOKEN` is enough.
- Commit discipline matters for the changelog: `feat:` → Features,
  `fix:` → Bug Fixes, `perf:` → Performance, etc. `chore:` / `test:`
  / `ci:` / `build:` are hidden from the user-facing changelog.

## Observability + security contract
Every change has to honour the following invariants. They landed with the
security-observability-baseline sub-PR and fail-fast CI is how they stay true.

- **Request IDs:** every HTTP response carries `x-request-id`. Middleware
  propagates a well-formed incoming UUID; otherwise it mints a fresh UUIDv4.
  Don't log, print, or return "unknown" — the logger reads it from
  AsyncLocalStorage (`lib/request-context.ts`) automatically.
- **Structured logging:** use `import { logger } from "@/lib/logger"`.
  Never `console.log` in production paths. `logger.{debug,info,warn,error}`
  emits one JSON line per call, pulls context fields from
  AsyncLocalStorage, and sanitises Error / bigint / deep objects. When
  Axiom provisioning lands, the transport swap is one-file.
- **Health endpoint:** `/api/health` is the liveness/readiness contract.
  Add checks for any new hard dependency (e.g. Redis when rate limiting
  is wired). 200 = all green, 503 = degraded.
- **Security headers:** `lib/security-headers.ts` is the single source
  of truth. X-Frame-Options, X-Content-Type-Options, Referrer-Policy,
  Permissions-Policy, HSTS, and CSP (report-only) are applied to every
  response. If you need to relax a header for a single route, document
  *why* in a comment next to the override.
- **Supply-chain scans:** CodeQL, Dependabot, and gitleaks run on every
  push + PR. New dependencies must clear CodeQL; leaked-secret matches
  block merge. If a fixture legitimately matches a gitleaks rule, add
  it to `.gitleaks.toml` with a justification comment.
- **Env provisioning:** anything that reaches an external service must
  degrade gracefully when its secret is unset (Sentry no-op without DSN,
  in-memory logger without Axiom token, etc.). Hard-requiring an env
  var at cold-start is reserved for secrets that are operationally
  guaranteed (Supabase URL, service role key).
- **Transactional email** ships through `lib/email/sendgrid.ts` and
  `lib/email/templates/base.ts` only. Direct `@sendgrid/mail` imports
  outside those two files are a code-review block. Every send writes
  a row to `email_log` (success or failure). Required env vars:
  `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, `SENDGRID_FROM_NAME`.
  Smoke-test the wrapper from prod with
  `npx tsx scripts/send-test-email.ts <to-email>`.

## E2E coverage is a hard requirement for admin UI changes
Every PR that adds or substantially changes an admin-facing route, form, or action MUST include a Playwright spec for its happy path. Specs live in `e2e/*.spec.ts`; run locally with `npm run test:e2e` (requires `supabase start`).

- A new page → a new spec OR a new test in the closest topical file (sites / users / batches / auth).
- A new form or modal → at least one test that opens it, submits it, and verifies the after-state.
- A new API mutation that has a UI surface → covered by the UI spec that drives it (the API itself is covered at the unit layer).
- Every spec navigates to every page it touches and runs `auditA11y(page, testInfo)` — axe findings are non-blocking today but the history is building for the Level-3 upgrade.

If a change is tested only at the unit layer and not in E2E, state why in the PR description ("purely a lib/ change", "admin-facing but flagged off for this slice", etc.). Silent omissions are a review-blocker.

## Design System Architecture — Audit 2026-05-02

Foundational audit done before the DESIGN-SYSTEM-OVERHAUL workstream (PRs 0–15).
Findings drive the architecture decisions that follow. File:line citations
in parentheses are the source of truth — re-verify before relying on a claim
older than ~one milestone.

### Q1 — Are the Versions / Components / Templates / Preview tabs load-bearing?

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

### Q2 — What does `context_build_failed` mean?

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

### Q3 — Brief runner inputs: design-discovery (new) vs tokens.css (old) — both?

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

### Q4 — DESIGN_CONTEXT_ENABLED on staging / prod

Default unset → flag treats it as off
(`lib/design-discovery/build-injection.ts:42`). Not committed in repo
(no `.env.staging`, no workflow file sets it). Operator-configured at deploy
time in Vercel. **Treat as currently OFF in prod** until Steven confirms
otherwise. PR 10 will run mode-aware generation as a separate code path so
the workstream isn't blocked on flipping that flag.

### Q5 — Content generation output format (Path B confirmation)

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

### Q6 — Setup wizard at /admin/sites/[id]/setup

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

### Q7 — "Set up design system" button on site detail

`app/admin/sites/[id]/page.tsx:389–394` — links to
`/admin/sites/${site.id}/design-system` (the four-tab UI). PR 12 redirects
this to `/admin/sites/${site.id}/onboarding` (the new mode-selection
screen introduced in PR 6).

### Q8 — sites table columns related to design

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

### Architecture decisions for PRs 5–15 (locked by this audit)

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

## Design System Architecture — Final state (post DESIGN-SYSTEM-OVERHAUL, 2026-05-02)

DESIGN-SYSTEM-OVERHAUL workstream landed PRs 0–15 (#355–#370). Sites are
now routed through one of two modes set during onboarding; generation
behaviour, the appearance panel, and the design-system landing all
branch off that. Below is the post-workstream contract — refer here
when reasoning about generation prompts or onboarding flows.

### Two site modes

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

### Content generation contract per mode

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

### Blog post simplification (PR 13)

`PageContext` carries `siteMode` so `systemPromptFor` appends a
`<blog_post_guidance>` block when `brief.content_type === 'post'`:

- Both modes: prefer plain semantic markup (h1, h2, h3, p, ul, ol,
  li, blockquote, img with alt) over decorative wrappers.
- `copy_existing` posts: avoid inline CSS entirely.
- `new_design` posts: inline `<style>` permitted but capped at ~3
  simple rules.

The page envelope contract (data-opollo wrapper, site-prefix on classes)
still applies.

### Image library context (PR 11, opt-in)

`sites.use_image_library` (boolean, default false; migration 0068).
Toggleable from `/admin/sites/[id]/settings`. When on, the brief
runner calls `buildImageLibraryContextPrefix({siteId, topic: page.title})`,
which queries `image_library` for active rows with caption + alt_text
matching the topic via `websearch_to_tsquery` on `search_tsv`. Up to
5 results are inlined as `<image_library_context>` so the model can
reference URLs directly. Off by default until operators verify
metadata quality.

### Screen / route map

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

### Env vars (post-workstream)

- `DESIGN_CONTEXT_ENABLED` — gates the `new_design` injection path
  only. Unset by default. The `copy_existing` path runs regardless.
- `FEATURE_DESIGN_SYSTEM_V2` — gates the separate `design_systems`
  registry block (different from `design_system_versions`). Unchanged
  by this workstream.
- `OPOLLO_MASTER_KEY` / `CLOUDFLARE_*` / `SUPABASE_*` — unchanged.

### Known gaps / deferred items

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

## Optimiser module

Lives on `feat/optimiser`. The Autonomous Landing Page Optimisation Engine — an internal Opollo tool that analyses Google Ads landing pages, scores alignment, and produces optimisation proposals. Spec: `docs/Optimisation_Engine_Spec_v1.5.docx`.

**Namespacing rules — strict.**
- Routes only under `/optimiser/*` and `/api/optimiser/*`. Don't add optimiser logic to `/admin/*` or `/api/cron/*` outside the optimiser module.
- DB tables prefixed `opt_*`. Migrations append-only and numbered sequentially after the latest.
- Module-private code under `lib/optimiser/`, `components/optimiser/`, and `skills/optimiser/`. Outside callers import from `@/lib/optimiser` only — never from a sub-path.
- Existing Site Builder code outside the module is read-only. The one allowed exception is this CLAUDE.md file. If you find yourself wanting to edit `middleware.ts`, `lib/auth.ts`, or any non-optimiser route or lib, stop and reroute the design through the module boundary.

**Inherited surfaces.** The optimiser reuses the existing Site Builder's auth (Supabase + role gates via `lib/admin-gate.ts`), the Site Builder generation engine (M12/M13 — Phase 1.5+), `site_conventions`, the WordPress connector (indirectly, via the Site Builder), page versioning, the cron runner under `/api/cron/*`, and the transactional email provider (TBC during Slice 6). Don't build parallel infrastructure for any of these.

**Credential encryption.** `opt_client_credentials` uses the same AES-256-GCM + `OPOLLO_MASTER_KEY` pattern as `site_credentials` (see `lib/encryption.ts`). The spec's reference to Supabase Vault is satisfied by the existing project-level master-key contract; deferring to Vault would split the chain of custody for credential encryption.

**Phase 1 done = six PRs merged into `feat/optimiser`.** Slice 1 (foundation) → Slice 2 (data ingestion) → Slice 3 (onboarding) → Slice 4 (page browser + healthy state) → Slice 5 (alignment scoring + playbooks + proposals) → Slice 6 (review UI + memory + emails + change log). Don't merge `feat/optimiser` into `main` without Steven's go-ahead.

## Backlog — UX debt

Operator-facing jargon that leaks DB column names or internal implementation
detail. Pick up on a cleanup slice that naturally lives in M6 (Per-Page
Iteration UI, where admin UX polish fits), or earlier if a sibling slice
happens to be in the same file.

### ~~High — remove scope_prefix from the Add Site form~~ (shipped in M2d)
M2d's UX cleanup removed the Scope prefix field from `AddSiteModal.tsx`;
`lib/sites.createSite` now auto-generates via `generateUniquePrefix` when the
caller doesn't supply one.

### ~~Medium — jargon in design-system authoring forms~~ (shipped in M6-4)
The three form labels listed here all shipped in M6-4 — see
`components/TemplateFormModal.tsx`, `components/ComponentFormModal.tsx`, and
`components/CreateDesignSystemModal.tsx` for the updated copy + the two
sub-labels under `tokens.css` / `base-styles.css`.

### Low — admin-surface labels that expose IDs
Scan done 2026-04, none found on the primary surfaces:

- `app/admin/batches` / `[id]` — shows "WP id" as a column, which is
  operator-meaningful (they can click through to WP admin); keep.
- `/admin/users` — email + role + status, clean.
- `/admin/sites` — name + URL + status, clean.

No `design_system_id`, `version_lock`, `wp_page_id`, `created_by_uuid`
leaked into labels. Revisit if future surfaces add them.
