# Engineering Standards

Portable engineering brief. Target audience: an AI coding agent (Claude Code / similar) or a human contributor working on a Next.js + TypeScript + Supabase + Vercel project with Claude Code in the loop. Nothing in this file is specific to one product — project-specific concerns go in `CLAUDE.md`.

Copy this file verbatim into any new project. Update table names, env vars, and URLs as you fork.

---

## Working principles

- **Work autonomously.** Don't ask for permission for normal coding tasks. Ask when a decision has cost, security, legal, or spec-ambiguity implications.
- **Self-test before reporting.** Run lint + typecheck + build + unit tests before saying "done." Fix failures yourself.
- **Report back in a paragraph, not a blow-by-blow.** Include: what shipped, what's still pending, what needs the operator's input.
- **Done means PR open, CI green, auto-merge armed, summary posted** — not "PR opened, CI running."

---

## Self-test loop

- Retry ceiling: **10 attempts per PR**, not 3. Retry count alone is not the escalation trigger; "not converging" is.
- Escalate when: (a) the same failure lands twice in a row (the fix isn't landing), or (b) a genuine architectural question surfaces — spec deviation, security tradeoff, schema decision.
- CI failure logs should be auto-posted as PR comments by the `ci.yml` workflow. Read those directly — don't ask the operator to paste logs.

---

## Sub-slice autonomy

For sub-slices of a parent milestone whose plan the operator has already approved:

- Propose the sub-slice plan in the **PR description itself**, not as a pre-flight message.
- Write code immediately against the parent plan.
- Open the PR with plan-as-description + code + tests in one go.
- Self-correct CI failures within the 10-retry ceiling.
- Auto-merge when green.
- Status update to the operator once merged: one-liner, e.g. "M2c-2 merged, proceeding to M2c-3."

Escalate only for: architectural decisions not in the parent plan, spec deviations, security tradeoffs, or same-failure-twice CI loops. Do NOT escalate for: sub-slice planning, operational / infra issues, routine tradeoffs already covered in the parent plan.

### Auto-continue between sub-slices

After an auto-merged sub-slice PR, automatically proceed to the next sub-slice without waiting for a prompt:

- `Ma-1 merged → start Ma-2`
- `Ma-2 merged → start Ma-3`
- `Ma-N (last of Ma) merged → start Mb-1` (next sub-milestone of the parent)
- `Mb-N (last of parent M) merged → status update "M complete, ready for sign-off before next milestone" and stop`

Stop and wait for the operator only when:
- A parent milestone fully completes.
- An architectural escalation surfaces.
- The same CI failure lands twice in a row.

Also: post a one-line status ping per merge so the operator has visibility without having to prompt.

---

## Auto-merge discipline

Every PR gets GitHub auto-merge armed at creation time. Immediately after `create_pull_request`, call `enable_pr_auto_merge` (or equivalent) with `mergeMethod: "SQUASH"`. Auto-merge is NOT enabled implicitly. Without that explicit call, the PR sits in the mergeable state until a human clicks the button, breaking the self-driving loop.

---

## Self-audit is the review; proceed without external gate

Self-audit is the first AND the final layer for planning. Once a plan has a populated **"Risks identified and mitigated"** section, proceed directly to implementation. Do NOT post plans to the operator or an external reviewer as a review gate — not for parent milestones, not for sub-slices.

Where plans live:
- Parent milestone plans go in the first sub-slice's PR description.
- Sub-slice plans go in their own PR description.
- Status updates happen once per merge — that's the visibility channel.

Escalate to the operator only when:
- You cannot self-resolve a tradeoff (cost, deadline, spec ambiguity).
- A decision needs information you don't have (legal, security review, infra cost ceiling).
- The same CI failure lands twice in a row.

### Every plan MUST include "Risks identified and mitigated"

List:
- Each write-safety hotspot in the proposed design (billed external calls, concurrent writers, multi-row state transitions, triggers, race windows, schema-level uniqueness assumptions).
- How the plan mitigates it (idempotency key, DB unique constraint, advisory lock, dedicated test case, etc.).
- Any gaps deliberately deferred, with a reason and a follow-up slice pointer.

If an obvious write-safety gap exists — missing idempotency key on a billed external call, missing constraint on a high-churn table, missing test assertion on a concurrency invariant, trigger that can deadlock with a worker — fix it in the plan *before* coding. Write-safety-critical milestones get this audit on every sub-slice plan, not just the parent.

A plan without a populated "Risks identified and mitigated" section is not ready to execute.

---

## Standards

- Server Components by default; Client Components only when required.
- shadcn/ui components over custom; Tailwind utility classes only.
- Strict TypeScript — no `any`, no `@ts-ignore`.
- One logical change per commit; **Conventional Commits** enforced by `commitlint`.
- Never check in secrets. `.gitleaks.toml` allow-lists deterministic test fixtures only; document each entry's "why it's safe."

### Commands (standard shape)

```
npm run dev            # local dev
npm run lint           # ESLint
npm run typecheck      # tsc --noEmit
npm run build          # production build
npm run test           # Vitest unit suite
npm run test:coverage  # Vitest with V8 coverage
npm run test:e2e       # Playwright end-to-end
npm run analyze        # production build with @next/bundle-analyzer
```

---

## Git workflow

- Branch per task: `feat/`, `fix/`, `chore/`, `refactor/`, `docs/`.
- Always open a PR; never push direct to main.
- Squash-merge is the default merge method. PR title becomes the commit message on main, so the title MUST be a conventional-commit subject (`feat: …`, `fix(scope): …`).
- Push with `git push -u origin <branch>`; on network error, retry up to 4 times with exponential backoff (2s/4s/8s/16s).

---

## E2E coverage is a hard requirement for UI changes

Every PR that adds or substantially changes a user-facing route, form, or action MUST include a Playwright spec for its happy path. Specs live under `e2e/*.spec.ts`; run locally with `npm run test:e2e` (requires `supabase start` or whatever the local DB shim is).

- A new page → a new spec OR a new test in the closest topical file.
- A new form or modal → at least one test that opens it, submits it, and verifies the after-state.
- A new API mutation that has a UI surface → covered by the UI spec that drives it (the API itself is covered at the unit layer).
- Every spec navigates to every page it touches and runs `auditA11y(page, testInfo)` — axe findings start non-blocking; history builds over time.

If a change is tested only at the unit layer and not in E2E, state why in the PR description. Silent omissions are review-blockers.

---

## Observability + security contract

Fail-fast CI is how these stay true.

- **Request IDs:** every HTTP response carries `x-request-id`. Middleware propagates a well-formed incoming UUID; otherwise mints a fresh UUIDv4. Reject malformed incoming IDs (log-injection defence). Don't log, print, or return "unknown" — the logger reads the request ID from AsyncLocalStorage automatically.
- **Structured logging:** `import { logger } from "@/lib/logger"`. Never `console.log` in production paths. `logger.{debug,info,warn,error}` emits one JSON line per call, pulls context from AsyncLocalStorage, sanitises Error / bigint / deep objects. Transport swap to Axiom / Datadog / etc. is one file.
- **Health endpoint:** `/api/health` is the liveness + readiness contract. Returns 200 when all checks pass, 503 when any hard dependency fails. Public-pathed so monitors don't need tokens. Add checks for any new hard dependency.
- **Security headers** (centralise in `lib/security-headers.ts`, applied by middleware):
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=(), payment=()`
  - `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
  - `X-DNS-Prefetch-Control: on`
  - `Content-Security-Policy-Report-Only` with a tight `default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, dynamic origins from env. Ship report-only first; flip to enforce after nonce migration.
- **Supply-chain scans on every push + PR:** CodeQL (SAST), Dependabot (weekly deps), gitleaks (secret scan), npm audit (CVEs at critical blocking, high informational until Next.js is on a patched release).
- **Env provisioning:** anything that reaches an external service MUST degrade gracefully when its secret is unset (Sentry no-ops without DSN; logger writes to stdout without Axiom token). Hard-requiring an env var at cold-start is reserved for secrets that are operationally guaranteed (Supabase URL, service-role key).

---

## Performance standards

- **Lighthouse CI:** every PR runs `lighthouse.yml` against a production build of the unauthenticated entry page. Thresholds start at `warn`, ratchet to `error` after stable-history baseline. Reports upload to Google's temporary public storage (no keys).
- **EXPLAIN ANALYZE for hot-path queries:** any new DB query in a code path that runs per-request or per-slot (chat route, batch worker, middleware, admin list pages) MUST be `EXPLAIN ANALYZE`'d against a realistic-volume seed before merge. Paste the plan in the PR description. Pointed-reads keyed by PK / UUID skip this; new JOINs, `LIKE` / `ILIKE`, `ORDER BY`, and anything without an obvious index path do not.

---

## Data conventions

- **Soft delete** on every mutable business table: `deleted_at timestamptz NULL, deleted_by uuid REFERENCES auth.users(id) NULL`. Default reads exclude `deleted_at IS NOT NULL`; admin "include archived" is opt-in.
- **Audit columns**: `created_at`, `updated_at`, `created_by`, `updated_by`. App bumps `updated_at` explicitly — no triggers (deadlock surface). Background workers leave `updated_by` NULL; event-log carries provenance.
- **Optimistic concurrency** via `version_lock integer NOT NULL DEFAULT 1` on tables that allow concurrent operator edits. UPDATE sets `version_lock = version_lock + 1`; caller passes `expected_version_lock`; zero affected rows → `VERSION_CONFLICT`.
- **Data migrations** (operations that rewrite existing rows) live in `supabase/data-migrations/`. Idempotent, batched (max 10k rows per statement), paired with a runbook entry.
- **Naming**: singular-snake-case for new tables. `CHECK (status IN (...))` text constraints over Postgres ENUMs (ENUMs are hard to alter).
- **RLS**: every new table ships `ENABLE ROW LEVEL SECURITY` + a `service_role_all` policy + authenticated-role policies keyed to an `auth_role()` helper.

---

## Release hygiene

- `release-please` watches main; every merge aggregates conventional commits into a Release PR. Merging that PR bumps `package.json`, appends to `CHANGELOG.md`, creates a GitHub Release + git tag.
- No external secrets — default `GITHUB_TOKEN` suffices with `contents: write` + `pull-requests: write` permission declarations.
- Changelog sections: `feat` → Features, `fix` → Bug Fixes, `perf` → Performance, `refactor` → Refactors, `docs` → Docs. `chore` / `test` / `ci` / `build` are hidden from the user-facing changelog.

---

## DX hygiene (local)

- **Husky 9** — `prepare: husky` in `package.json` installs hooks on `npm install`.
- **Pre-commit:** `lint-staged` runs ESLint `--fix --max-warnings=0` on staged JS/TS and stylelint on CSS. Warnings fail the commit.
- **Commit-msg:** `commitlint` enforces Conventional Commits. Header cap 100 chars (milestone scopes like `feat(m3-6):` need the breathing room); body/footer length dropped so multi-paragraph HEREDOC commits work.
- **Never `--no-verify`** unless the operator explicitly asks. A failing hook is a bug to fix, not a hook to skip.

---

## Runbook

Every project ships a `docs/RUNBOOK.md`. Shape:

```
## <Short symptom>
**Symptom:** ...
**Impact:** ...
**Diagnose:** ...
**Mitigate:** ...
**Resolve:** ...
```

Minimum entries on day one: deploy rollback, auth broken, suspected key leak. Add one entry per live incident the same day.

---

## AI / prompts

When an LLM is on the hot path:

- **Prompt versioning.** `lib/prompts/vN/` directories are immutable per version. `metadata.json` records release date + target model + notes.
- **Eval suite.** `lib/prompts/__evals__/` with fixtures and a runner. Evals are manual (they hit a billed API); CI runs an integration harness that stubs the provider.
- **Prompt-injection defence via tagged inputs.** Wrap untrusted content in XML tags: `<user_message>`, `<wp_existing_content>`, `<tool_result name="..." id="...">`. Tool schemas (Zod) validate structure so the model can't smuggle payloads through loosely-typed fields.
- **Per-tenant cost budgets.** A `tenant_cost_budgets` table (or equivalent) caps monthly spend per customer; `createBatchJob` enforces the cap before dispatching work. Event-log-first accounting — the cost source of truth is the append-only event log, never a direct budget write.
- **LLM observability** (Langfuse / equivalent) gated on the transport's secret env vars. Without them, zero overhead — the wrapper is strictly additive.

---

## What the operator cares about

- Don't loop in on routine errors — fix and retry.
- Do loop in on design decisions or scope questions.
- Keep PRs small enough to review in 5 minutes when an escalation bubbles up.

---

## Session continuity

This brief is designed to be re-read at the start of every agent session and to serve as the sole standing source of truth. When project-specific concerns surface (env vars, table names, feature flags, custom rules), capture them in `CLAUDE.md` alongside this file. Don't dilute this file with per-project detail.
