# Opollo Site Builder — Working Brief

## What this is
Next.js 14 (App Router) + TypeScript + Tailwind + shadcn/ui + Vercel AI SDK.
A chat interface that generates WordPress pages for Opollo's clients.

## How to work
- Work autonomously. Don't ask for permission for normal coding tasks.
- **Before starting a task that matches a pattern, read `docs/patterns/<pattern-name>.md` first.** The patterns folder is the playbook for recurring shapes — files, tests, PR structure, known pitfalls. If no pattern matches, proceed from first principles and note whether the task is a candidate for a new pattern.
- **For operations tasks** (deploy rollback, key rotation, stuck incident, missing migration, env-var provisioning) — consult `docs/RUNBOOK.md` before acting. Do not freelance on destructive or irreversible operations.
- **For one-off rules that aren't patterns** (test-helper discipline, fresh-stack config, CI-stuck recovery, write-safety audit requirement, UX-debt capture discipline) — see `docs/RULES.md`. Each rule has the incident that taught it.
- After any change: run lint, typecheck, and build. Fix failures yourself before reporting back.
- When reporting back, give me a one-paragraph summary, not a blow-by-blow.
- After opening a PR, monitor CI until it passes. If CI fails, read the failure, fix it, push again. Repeat until green.
- "Done" means: PR open, CI green, summary posted. Not: PR open, CI running, waiting for input.

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

## Auto-continue between sub-slices
After an auto-merged sub-slice PR, automatically proceed to the next sub-slice in the same approved parent milestone without waiting for a prompt. Rule chain:

- `M2c-1 merged → start M2c-2`
- `M2c-2 merged → start M2c-3`
- `M2c-3 merged → start M2d-1` (next slice of parent M2)
- `M2d-N merged → either start M2d-(N+1) or, if M2d was the last slice, status update "M2 complete, ready for Steven's sign-off before M3" and stop`

Stop and wait for Steven only when:
- A parent milestone fully completes (M2 done → wait, do NOT start M3 on your own).
- An architectural escalation surfaces.
- The same CI failure lands twice in a row.

Also: post a one-line status ping per merge so Steven has visibility without needing to prompt — e.g. "M2c-2 merged, starting M2c-3."

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

## E2E coverage is a hard requirement for admin UI changes
Every PR that adds or substantially changes an admin-facing route, form, or action MUST include a Playwright spec for its happy path. Specs live in `e2e/*.spec.ts`; run locally with `npm run test:e2e` (requires `supabase start`).

- A new page → a new spec OR a new test in the closest topical file (sites / users / batches / auth).
- A new form or modal → at least one test that opens it, submits it, and verifies the after-state.
- A new API mutation that has a UI surface → covered by the UI spec that drives it (the API itself is covered at the unit layer).
- Every spec navigates to every page it touches and runs `auditA11y(page, testInfo)` — axe findings are non-blocking today but the history is building for the Level-3 upgrade.

If a change is tested only at the unit layer and not in E2E, state why in the PR description ("purely a lib/ change", "admin-facing but flagged off for this slice", etc.). Silent omissions are a review-blocker.

## Backlog — UX debt

Operator-facing jargon that leaks DB column names or internal implementation
detail. Pick up on a cleanup slice that naturally lives in M6 (Per-Page
Iteration UI, where admin UX polish fits), or earlier if a sibling slice
happens to be in the same file.

### High — remove scope_prefix from the Add Site form
**Surface:** `components/AddSiteModal.tsx` line ~211 "Scope prefix" field.
**Problem:** A solo-dev operator adding a client site shouldn't have to
understand CSS-scoping strategy. The field leaks `sites.prefix` into the UX.
**Fix:** auto-generate server-side at site creation. Algorithm:
1. Lower-case, ASCII-slugify the site name; keep only `[a-z0-9]`.
2. Take the first 2–4 characters.
3. If that prefix already exists in `sites.prefix`, append a single digit
   (2, 3, …) until unique, capped at length 4.
4. If still colliding past `<prefix>9`, fall back to `<prefix>` + base-36
   counter.

Hide the field from the form entirely. `lib/sites.createSite` accepts
`prefix` today; flip it to optional + server-compute when absent.

### Medium — jargon in design-system authoring forms
Audited 2026-04; current offenders:

- `components/TemplateFormModal.tsx`:
  - "Composition (JSON array)" → "Template composition"
  - "required_fields (JSON)" → "Required fields per component"
  - "seo_defaults JSON (optional)" → "SEO defaults (optional)"
- `components/ComponentFormModal.tsx`:
  - "content_schema (JSON)" → "Content shape (JSON Schema)"
  - "image_slots JSON (optional)" → "Image slots (optional)"
- `components/CreateDesignSystemModal.tsx`:
  - "tokens.css" / "base-styles.css" — keep the filenames (designers write
    CSS; the names are accurate), but add a one-line sub-label explaining
    what each section controls.

Design-system authoring is a developer surface, so full de-jargoning isn't
the goal — just hide the raw column names. JSON editing UX itself
(`<Textarea>` with JSON.parse in onBlur) can survive.

### Low — admin-surface labels that expose IDs
Scan done 2026-04, none found on the primary surfaces:

- `app/admin/batches` / `[id]` — shows "WP id" as a column, which is
  operator-meaningful (they can click through to WP admin); keep.
- `/admin/users` — email + role + status, clean.
- `/admin/sites` — name + URL + status, clean.

No `design_system_id`, `version_lock`, `wp_page_id`, `created_by_uuid`
leaked into labels. Revisit if future surfaces add them.
