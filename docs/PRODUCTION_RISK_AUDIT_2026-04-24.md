# Cross-Cutting Production-Risk Audit (M15-5)

**Date:** 2026-04-24
**Scope:** M1 → M14 cross-cutting risk classes that don't fit a single endpoint: hardcoded URLs/IDs, cron reliability, race conditions, unhandled promise rejections, stray `console.*` usage, dead code, RLS bypass paths.
**Method:** Sonnet sub-agent scanned every TS/TSX file under `app/`, `lib/`, `scripts/`, `e2e/`, middleware, next.config, sentry/playwright configs, `vercel.json`, `.github/workflows/*.yml`, plus `package.json` scripts. Opus reviewed each finding for severity and verified the notable ones against the code.
**Prior audits:** M15-2 (schema), M15-3 (env), M15-4 (endpoints). No re-flagging of findings those already captured.

---

## TL;DR

**No actively production-breaking items.** 27 findings; the audit is broad by design and most findings are latent-risk or tech-debt. Two items that could be production-breaking depending on operational context — worth your judgment before deferring:

1. **`/api/cron/process-transfer` has no Vercel schedule** (`vercel.json` missing this cron). The route exists; the worker is correct; nothing fires it. If the M4/M7 image-transfer pipeline actually relies on this cron to drain pending transfers, items are piling up silently. If transfer work only happens inline during batch/regen flows, this is dead code. **Needs operator confirmation.**

2. **`bumpTenantUsage()` is exported but never called.** Tenant budget counters (`tenant_cost_budgets.daily_usage_cents` / `monthly_usage_cents`) are bumped only at pre-job **reservation** time (`reserveBudget`) and reset hourly by cron. The actual-cost writeback hook is defined but not wired — meaning the budget enforcement uses projected spend, not actual. If a job's actual cost diverges significantly from the reservation, tenants can silently overspend their cap. **Financial safety gap; impact depends on reservation fidelity.**

**Escalation triggers:**
- [x] More than 10 findings — 27 total, pause for prioritization.
- [~] Production-breaking — two items on the edge, flagged above for your judgment.
- [ ] Need external data — no.

**I am NOT starting M15-6 until you respond.**

---

## Findings summary (27 items)

### Category counts

| Category | Count | Highest severity in category |
|---|---|---|
| 1. Hardcoded URLs | 7 | LATENT-RISK (Langfuse EU-region drift) |
| 2. Cron reliability | 4 | LIKELY-PROD-BREAKING (transfer cron unscheduled — pending op context) |
| 3. Race conditions / locking | 2 | LIKELY-PROD-BREAKING (bumpTenantUsage unwired — pending op context) |
| 4. Unhandled promises | 1 | TECH-DEBT |
| 5. console.* in prod | 6 | LATENT-RISK (4 sites bypass Axiom) |
| 6. Dead code | 4 | TECH-DEBT (prior M15-2 finding #2 overlaps) |
| 7. RLS bypass paths | 3 | TECH-DEBT (all uses legitimate; minor stylistic) |

### Ordered table

| # | Severity | Category | Location | One-line |
|---|---|---|---|---|
| 1 | LIKELY-PROD-BREAKING\* | Cron | `vercel.json` (missing) | `/api/cron/process-transfer` has no schedule. If M4-7/M7-3 transfer work is active, `transfer_job_items` pile up in `pending` forever. \*Depends on operational context. |
| 2 | LIKELY-PROD-BREAKING\* | Budget | `lib/tenant-budgets.ts:bumpTenantUsage` | Exported, zero callers. Tenant budget counters track reservations only; actual-cost writeback never happens. Tenants can overspend if actuals diverge from reservations. \*Impact depends on reservation fidelity. |
| 3 | LATENT-RISK | URL | `lib/langfuse.ts:37` | Defaults `LANGFUSE_HOST` to `https://us.cloud.langfuse.com`. An EU-region project with `LANGFUSE_HOST` unset silently ingests to the wrong datacenter. |
| 4 | LATENT-RISK | Race | `lib/briefs.ts:385` | Step-7 finalize UPDATE lacks `.eq("version_lock", ...)` guard. Not currently exploitable (brief is freshly inserted in same flow), but breaks the CAS invariant if the pipeline ever becomes resumable. |
| 5 | LATENT-RISK | Observability | `lib/sites.ts:169,175` | Two `console.error` call sites in `rollbackSite()`. Errors bypass the structured logger; operators miss signals in Axiom. |
| 6 | LATENT-RISK | Observability | `lib/system-prompt.ts:132,147,155,219` | Four `console.error` call sites in design-system load paths. Same bypass; explicit operator-visibility intent in comments but Axiom gets nothing. |
| 7 | TECH-DEBT | Dead code | `lib/class-registry.ts` | Exports 4 items; zero production imports. Tested in isolation. Planned for component-level CSS validation that hasn't shipped. |
| 8 | TECH-DEBT | Dead code | `lib/content-schemas.ts` | Exports `InlineHtmlSchema` + type; zero production imports. Planned for structured inline-HTML fields that haven't shipped. |
| 9 | TECH-DEBT | Dead code | `lib/supabase.ts:getAnonClient` | Exported; zero production callers. Comment says "scaffolded for Stage 2." |
| 10 | TECH-DEBT | RLS | `app/api/auth/forgot-password/route.ts:106` | Uses service-role client for `auth.resetPasswordForEmail(email)`. Required by Supabase, but worth a code comment explaining why a service-role client is on a public unauthenticated route. |
| 11 | TECH-DEBT | RLS | `app/api/briefs/[brief_id]/commit/route.ts:65` | Post-commit lookup of `briefs.site_id` for `revalidatePath()` uses service-role. Could use the user's session client; benign today. |
| 12 | TECH-DEBT | RLS | `app/api/cron/process-regenerations/route.ts:165-186` | Two distinct `dynamic import("@/lib/supabase")` calls in the same function, second aliased to `getSvc` to avoid name collision. Resolves to same singleton at runtime; stylistic cleanup. |
| 13 | TECH-DEBT | Promises | `app/admin/sites/[id]/briefs/[brief_id]/review/page.tsx:21` | `Promise.all([getSite, getBriefWithPages])` in a Server Component without explicit try/catch. Next.js framework error boundary catches rejections — correct per Next.js conventions, but not explicit. |
| 14 | TECH-DEBT | Cron | `vercel.json` + routes | No Vercel-level retry on cron 500. Documented architectural trade-off; compensated by per-slot `retry_after` across ticks. A missed tick = 60s of lag, not catastrophic. Flag for ops awareness. |
| 15-21 | (benign) | URL | Various | Hardcoded Cloudflare API host, Cloudflare delivery host, Google Fonts CDN, Anthropic SDK base URL. All canonical public constants. Noted per scope; no action. |

---

## Detailed findings

### 1. [LIKELY-PROD-BREAKING\*] `/api/cron/process-transfer` has no Vercel schedule

**Where:** `vercel.json` contains cron entries for `process-batch`, `process-regenerations`, and `budget-reset`. `process-transfer` is missing.

**Route state:** `app/api/cron/process-transfer/route.ts` exists. `lib/transfer-worker.ts` implements the lease/reap pattern correctly. `maxDuration = 299`. The route is reachable via `curl` with the correct `CRON_SECRET` — i.e., someone could poke it manually — but nothing fires it automatically.

**Doc signal:** the route's own header comment says "not wired into vercel.json crons in this slice" — this was intentional in M4. But M4-7 ("WP media transfer") shipped as part of M7-3 per `docs/BACKLOG.md:128`. If the live system uses `transfer_job_items` (e.g., chat's `search_images` → transfer-to-WP flow, or image library uploads auto-transferring to sites), those items need the cron to drain.

**What to check:**
- Query `transfer_job_items` for rows in `pending` state older than a few minutes. If that set is non-empty and growing, the cron is needed and its absence is actively causing work to stall.
- Alternative: the transfer work might only happen inline during batch generation (chat → search_images → inline transfer). If so, `process-transfer` as a cron is dead code.

**Fix options (if needed):**
- **(a) Add to `vercel.json`:** one-line entry with a reasonable schedule (`* * * * *` for parity with batch/regen, or `*/5 * * * *` if less time-sensitive).
- **(b) Delete the route + lib if dead:** clean up if transfer is truly inline-only.

**Severity rationale:** LIKELY-PROD-BREAKING *if* transfers are active. If inline-only, this is dead-code tech-debt. Your call.

---

### 2. [LIKELY-PROD-BREAKING\*] `bumpTenantUsage()` is exported but never called

**Where:** `lib/tenant-budgets.ts` exports `bumpTenantUsage()`. `grep` finds zero callers in production code — only a reference in `docs/plans/m8-parent.md` as a "future reconciliation hook."

**What the code does today:**
- Pre-job: `reserveBudget()` increments `tenant_cost_budgets.daily_usage_cents` / `monthly_usage_cents` by the PROJECTED cost of the batch/regen, inside a `FOR UPDATE` transaction. If reservation exceeds the cap, it returns `BUDGET_EXCEEDED` and the job doesn't start.
- Mid-job: slot-level costs are written to `generation_job_pages.cost_usd_cents` and rolled up to `generation_jobs.total_cost_usd_cents` as each slot completes.
- Post-job: nothing flows actual costs back to `tenant_cost_budgets`. The counter sits at the reserved value until the hourly cron resets it.

**Consequence:** tenant budget enforcement is based on *reservations*, not *actuals*. If a reservation is accurate, no harm — the cap is respected. If actuals systematically exceed reservations (e.g., because reservations use a conservative-in-one-direction estimate), the tenant's actual spend at Anthropic exceeds the declared cap without the guard knowing.

**What to check:**
- How is the reservation amount computed? If it's `requested_count × max_tokens × opus_price_per_token`, the reservation is a worst-case ceiling — tenants will never overspend, they'll just reserve too much and cron resets will free the over-reservation hourly. In that case the gap is cosmetic (tenants see "used: $X" where X is over-reservation, not real usage).
- If the reservation is more aggressive (e.g., `expected_cost × 1.2`), actuals can exceed the reservation during retries, and the counter is off.

**Fix options:**
- **(a) Wire `bumpTenantUsage`:** call it from the batch-worker slot-completion path with the delta (`actual_cost - reserved_cost`). Same pattern in regen and transfer workers.
- **(b) Leave as-is with a comment:** if reservations are worst-case ceilings, document that and remove `bumpTenantUsage` (or keep as a dead export and annotate).

**Severity rationale:** LIKELY-PROD-BREAKING *if* actuals can exceed reservations. If reservations are worst-case, this is latent tech-debt (the counter is pessimistic, tenants under-utilize their cap).

---

### 3. [LATENT-RISK] Langfuse EU-region drift

**Where:** `lib/langfuse.ts:37`: `baseUrl: process.env.LANGFUSE_HOST ?? "https://us.cloud.langfuse.com"`.

**What's wrong:** an EU-hosted Langfuse project requires `https://cloud.langfuse.com` (no `us.` prefix). A developer provisioning an EU project who forgets to set `LANGFUSE_HOST` will silently ingest spans to the US datacenter — invisible to the EU dashboard and potentially a residency/compliance issue.

**Fix:** either document the gotcha more loudly in `.env.local.example` (it already mentions this in a comment — fine, low priority), or validate at cold start that the implicit US default wasn't selected for an EU project. Probably over-engineered for a small team. Tech-debt with documentation fix.

---

### 4. [LATENT-RISK] Missing CAS on `briefs` finalize UPDATE

**Where:** `lib/briefs.ts` around line 385. The flow:

```
Step 1-6: INSERT briefs (returns version_lock=0)
Step 7:   UPDATE briefs SET status='parsed', version_lock=1 WHERE id = :id
           // ← no .eq("version_lock", 0) guard
```

**What's wrong:** the update uses `id` only as the WHERE predicate. Between steps 1 and 7, if any other writer could modify this brief (currently: no such writer exists — the INSERT + parse flow is synchronous within one request), the UPDATE would silently clobber concurrent writes.

**Why it's not actively a bug:** the INSERT → parse → UPDATE runs inside one route handler invocation; the brief isn't addressable by anyone else until step 7 commits. No concurrent writer exists today.

**Why it's worth fixing:** the CAS pattern is the norm across every other `version_lock` table. Drift here invites a future refactor (making briefs processing resumable / background) to introduce a silent data loss window.

**Fix:** one-line change — add `.eq("version_lock", insert.data.version_lock)` to the UPDATE.

---

### 5. [LATENT-RISK] `console.error` in `lib/sites.ts` rollback path

**Where:** `lib/sites.ts:169,175` inside `rollbackSite()`:

```ts
console.error("[sites.createSite] rollback delete failed", ...);
console.error("[sites.createSite] rollback threw", ...);
```

**Why it matters:** this path fires when a site-creation transaction fails mid-flight (site INSERT succeeded, credentials INSERT failed, compensating delete then failed). The error is visible in Vercel raw function logs but not in Axiom — operators searching Axiom for "failed site creation" find nothing.

**Fix:** replace with `logger.error("sites.createSite.rollback_failed", { error: ..., site_id: ... })`. Keep the same semantics.

---

### 6. [LATENT-RISK] `console.error` in `lib/system-prompt.ts`

**Where:** `lib/system-prompt.ts:132,147,155,219`. Fire when the active design-system / components / templates fail to load during prompt construction.

**Why it matters:** same as #5 — Axiom misses the signal. The in-file comments explicitly justify `console.error` for "clear operator visibility," which is a mis-characterization — `logger.error` already emits to stdout (operators see it in Vercel function logs) AND to Axiom. No reason to bypass.

**Fix:** replace with `logger.error("system_prompt.load_registry_failed", { error, site_id })`. Same pattern across the four sites.

---

### 7-9. [TECH-DEBT] Dead code — `class-registry.ts`, `content-schemas.ts`, `getAnonClient()`

These are documented stubs for planned-but-unshipped features. They overlap with M15-2 finding #2 (dead tables), which is already on your triage list for per-module decisions. Recommendation: roll into the same "scope decision" cleanup slice.

Notable: `lib/class-registry.ts` has a full test file, so it's not *unused* at the test layer — just unwired into production. Deleting it would also delete the test. The decision is whether the planned "per-component class validation gate" is on the roadmap or not.

---

### 10-12. [TECH-DEBT] Service-role usage — minor stylistic flags

Three service-role use sites that warrant either a code comment or a minor refactor. None are security issues; the service-role client is doing exactly what's needed in each case. Details in the findings table.

---

### 13. [TECH-DEBT] `Promise.all` without explicit catch in a Server Component

**Where:** `app/admin/sites/[id]/briefs/[brief_id]/review/page.tsx:21`.

Next.js conventions say Server Component rejections bubble to the nearest `error.tsx` boundary, and the framework handles it. So this is technically correct. But the pattern diverges from admin pages that wrap their data fetches in explicit try/catch. Flag for consistency; not a bug.

---

### 14. [INTENTIONAL / NOTED] No Vercel retry on cron 500

Vercel cron doesn't retry on non-2xx by design. The per-slot `retry_after` column compensates: even if a tick fails entirely, the next minute's tick picks up what wasn't processed. Documented architectural trade-off. Flag for ops awareness; no fix recommended.

---

## Cross-cutting observations (not findings, just signals)

- **Observability contract is mostly honored.** Across 45 routes + dozens of lib files, the stray `console.*` set is only 6 call sites (5 production, 1 emergency-intentional). This is a cleaner observability picture than M15-4 suggested — the structured logger is nearly universal.
- **Optimistic locking is disciplined.** Every `version_lock` table's CRUD path uses the correct CAS guard, with one exception (finding #4, briefs finalize) that's not currently exploitable. The `version_lock` column is a load-bearing invariant across the schema and the code respects it.
- **Lease-based worker patterns are correct.** `batch-worker`, `regeneration-worker`, `transfer-worker` all use `FOR UPDATE SKIP LOCKED` inside transactions. Parallel worker invocations cannot double-process.
- **Budget counter semantics are nuanced.** The reservation-based model is safe if reservations are worst-case ceilings. If they're expected-case estimates, actuals can exceed the cap. Needs a one-paragraph doc in `docs/plans/m8-parent.md` clarifying which it is.
- **No hardcoded credentials, no exploitable auth bypasses, no active data-corruption races.** The drift surface is latent and observability-adjacent, not security-critical.

---

## What I did NOT cover in this audit

- **Live cron telemetry.** This audit is static — it doesn't check Vercel's cron dashboard to see which crons are firing and which are throwing. Finding #1 (process-transfer not scheduled) is confirmed via `vercel.json` inspection, but "are transfers actively needed" is a live-system question.
- **Performance / query plan review.** EXPLAIN ANALYZE'ing hot-path queries is CLAUDE.md's per-PR policy, not this audit's concern. M15-4 already flagged the `regeneration_jobs` daily-budget full-scan.
- **Supabase RLS runtime testing.** The RLS test matrix (M2b/M4/M7/M12) covers this. Nothing surfaced here suggests RLS is broken at the policy level.
- **Vercel function concurrency tuning.** Not audit-scope.
- **Third-party dependency security scans.** CodeQL / Dependabot / gitleaks cover this; separate concern.

---

## Files produced

- `docs/PRODUCTION_RISK_AUDIT_2026-04-24.md` (this file)
- No scratch file this round — Sonnet output fit inline.

Previous scratch inputs remain at `docs/_audit_scratch/` (canonical_schema, code_queries, code_endpoints) pending the M15-6 audit before final cleanup.

---

## Awaiting your response

Three asks:

1. **Confirm or rule out the two "depends on operational context" items** (findings #1 and #2). These are LIKELY-PROD-BREAKING if the context goes the wrong way, LATENT-RISK otherwise. You know the runtime facts I don't.
2. **Prioritization on the 27 findings.** Same shape as M15-3 and M15-4 — over threshold, pause for triage discussion.
3. **Go-ahead for M15-6 (test coverage audit).** After M15-6 completes (the last audit in the series), M15-7 consolidated fix pass begins.

Not starting M15-6 until you respond.
