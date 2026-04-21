# M8 — Per-Tenant Cost Budgets

## What it is

Per-site daily + monthly caps on the sum of all Anthropic spend (batch generation + regeneration) plus the M4 image-captioning transfers that were billed to Anthropic. Enforced at the enqueue surfaces: `createBatchJob` (M3-2), `enqueueRegenJob` (M7-4), and the iStock seed ingest orchestrator (M4-5). M7-5's tenant-wide `REGEN_DAILY_BUDGET_CENTS` env cap stays as the outer ceiling — it protects against a new feature burning everyone's tokens; per-tenant caps protect against one client monopolising the shared cap.

## Why a separate milestone

M3 and M4 shipped global cost aggregation (`generation_jobs.total_cost_usd_cents`, `transfer_jobs.total_cost_usd_cents`). M7-5 added a tenant-wide daily cap at the regen enqueue path. There's no currently-enforced per-site ceiling. A single operator running a 40-page batch on one client site drains the same cap everyone else's batches draw from.

BACKLOG explicitly tracked "Per-tenant cost budgets" against `docs/PROMPT_VERSIONING.md` with trigger "start of M4". M4 shipped ages ago; this is overdue. M8 closes that gap with a dedicated schema + enforcement in every enqueue path.

## Scope (shipped in M8)

- New table `tenant_cost_budgets` — one row per site, holding daily + monthly cap cents + rolling usage counters.
- Migration backfills existing sites with a generous default cap (configurable via `DEFAULT_TENANT_DAILY_BUDGET_CENTS` / `DEFAULT_TENANT_MONTHLY_BUDGET_CENTS` env vars).
- Enforcement in three enqueue surfaces:
  - `lib/batch-jobs.createBatchJob` (M3-2) — check + reject with `BUDGET_EXCEEDED` when creating a batch would push the site over its cap.
  - `lib/regeneration-publisher.enqueueRegenJob` (M7-4) — same check, same error code. Replaces the tenant-wide check from M7-5 with a tenant-scoped one; M7-5's env-var cap remains as a safety net.
  - `lib/istock-seed.ts` (M4-5) — pre-flight includes the per-tenant cap check before any billed API call.
- Admin UI surface on `/admin/sites/[id]` — a read-only badge showing the site's current day/month usage against its cap.
- Usage reset — daily usage resets at UTC midnight; monthly at the 1st of each month (in UTC). Handled by the `budget_daily_reset` cron that runs once per hour and zeros out any rows whose `daily_reset_at` is in the past.
- Admin-only PATCH to raise / lower the cap on a per-site basis. `PATCH /api/admin/sites/[id]/budget` with Zod + version_lock.

## Out of scope (tracked in BACKLOG.md)

- **Stripe billing integration.** Caps are read from our DB only; they don't sync with a customer's actual subscription tier. Deferred until first paying customer is imminent.
- **Cross-tenant alerts.** Slack / email notification when a tenant hits 80% of their cap. Useful but belongs to observability infra once Sentry / Langfuse land.
- **Historical cost charts.** `generation_events` + `transfer_events` + `regeneration_events` already hold every cost row; a charting UI is follow-up work.
- **Breakdown by model.** Current cap is dollars-total; a future slice could split Sonnet vs Opus vs Haiku caps.
- **Auto-top-up.** If a tenant hits the cap, we refuse; no auto-raise. Operator action required.
- **Burst window** (allow a 24h spike above daily cap if monthly is healthy). Complicates the math and isn't obviously worth the bargaining UX.

## Env vars required

| Var | Needed by | Status |
| --- | --- | --- |
| `DEFAULT_TENANT_DAILY_BUDGET_CENTS` | M8-1 migration default | New — default 500c ($5/day) when unset |
| `DEFAULT_TENANT_MONTHLY_BUDGET_CENTS` | M8-1 migration default | New — default 10000c ($100/mo) when unset |
| `CRON_SECRET` | M8-4 reset cron | Present |
| `SUPABASE_*` | all | Present |

Both new vars have code-side defaults so the migration runs cleanly without provisioning. Operators can set them before rollout to tune initial defaults; existing tenants are backfilled with those defaults.

## Sub-slice breakdown (5 PRs)

| Slice | Scope | Write-safety rating | Blocks on |
| --- | --- | --- | --- |
| **M8-1** | Schema: `tenant_cost_budgets` table with `daily_cap_cents`, `monthly_cap_cents`, `daily_usage_cents`, `monthly_usage_cents`, `daily_reset_at`, `monthly_reset_at`, `version_lock`, audit columns. UNIQUE on site_id. RLS. Backfill trigger for new sites. Migration backfills existing sites. | High — UNIQUE on site_id prevents dup rows; version_lock for operator edits. | Nothing |
| **M8-2** | Enforcement in `createBatchJob` + `enqueueRegenJob`. Sum projected cost + current usage; reject with `BUDGET_EXCEEDED`. Increment usage atomically on successful enqueue (UPDATE with the computed delta). | Critical — cap is the safety layer; race between check + increment must not allow overdraw. | M8-1 |
| **M8-3** | iStock seed script integration. `lib/istock-seed.ts` pre-flight cost estimate + per-tenant cap check. On dry-run, show projected usage; on real run, refuse if over cap. | Medium — seed is idempotent; over-cap check short-circuits before any API call. | M8-2 |
| **M8-4** | Usage reset cron `/api/cron/budget-reset`. Runs hourly; zeros out rows whose `daily_reset_at` / `monthly_reset_at` is past. Sets the next reset to today-midnight+1day / next-month-1st. | Medium — race condition if two resets run simultaneously; advisory lock handles it. | M8-1 |
| **M8-5** | Admin UI: budget badge on `/admin/sites/[id]` + PATCH endpoint to edit caps. Optimistic-locked on `version_lock`. Zod-validated. | Low — admin-only; caps can't go negative. | M8-1..M8-4 |

**Execution order:** M8-1 → M8-2 → M8-3 → M8-4 → M8-5. Each slice layers on top; M8-3 and M8-4 could run in parallel after M8-2 but staying serial keeps the review load steady.

## Write-safety contract

### Check + increment race (M8-2)

The ordinary read-check-then-increment pattern has a race: two simultaneous enqueues each read the same pre-increment usage and both succeed. Two fixes available:

- **Optimistic (version_lock).** Read usage + cap + version_lock, compute delta, UPDATE pins `version_lock = expected`. Loser retries with fresh read. Acceptable tail latency; small overdraw window if versions happen to match.
- **Pessimistic (row-level lock).** `SELECT … FOR UPDATE` inside a transaction; compute delta; UPDATE + COMMIT. No retries; blocks instead of races.

**Decision: pessimistic.** Budget enforcement is called exactly once per enqueue and holds its lock for milliseconds. The optimistic retry loop adds complexity (what if retries also lose? exponential backoff? cap on retries?) that isn't justified for a write rate of ≤1/sec per tenant.

### Monthly rollover (M8-4)

`daily_reset_at` and `monthly_reset_at` are explicit timestamps rather than being derived from `now()`. The reset cron zeroes usage and advances the reset timestamp to the NEXT day/month boundary. Two simultaneous resets hit the same row; the second's UPDATE is a no-op (WHERE clause includes `daily_reset_at < now()`). No advisory lock needed.

### Admin-edit cap (M8-5)

Standard version_lock pattern. Concurrent edits surface 409 `VERSION_CONFLICT` same as M5-3 / M6-3.

## Testing strategy

| Slice | Patterns applied |
| --- | --- |
| M8-1 | `new-migration.md`. Constraint-reject tests. RLS role matrix. Backfill trigger creates a row for each new site. |
| M8-2 | Concurrency test: two simultaneous enqueues compete for the same budget; exactly one succeeds. BUDGET_EXCEEDED returned for the loser with the current usage in details. |
| M8-3 | Seed script pre-flight rejects when projected cost > per-tenant cap. Dry-run mode works without touching DB counters. |
| M8-4 | Daily reset runs; usage counter zeros; next reset timestamp advances by one day. Monthly reset ditto. Two concurrent resets — second is a no-op. |
| M8-5 | Zod validation (negative caps rejected, oversized caps warned). VERSION_CONFLICT on stale version_lock. Admin gate test. |

## Risks identified and mitigated

1. **Race between budget check + increment.** → M8-2 uses `SELECT FOR UPDATE` inside a transaction. Unit test spawns two concurrent enqueue attempts against the same tenant with half-cap-each projected cost; asserts exactly one succeeds.

2. **Reset cron doesn't fire.** → Monitoring via `/api/health` — we add a check that flags "N tenants have reset_at more than 25 hours in the past" as degraded. If the cron is stuck, usage eventually saturates and every enqueue fails with BUDGET_EXCEEDED — loud operator visibility, no silent overdraw.

3. **Existing batch jobs mid-flight when M8-2 ships.** → Per-slot cost is already tracked on `generation_job_pages.cost_usd_cents`. M8-2's enforcement is at enqueue time only; in-flight jobs complete normally. The first tick after M8-2 sees accurate per-tenant usage from the accumulated per-slot costs.

4. **Existing regen jobs mid-flight.** → Same as above. `enqueueRegenJob` is the enforcement point; in-flight jobs continue.

5. **Tenant sets their cap to 0.** → Admin PATCH validation: minimum 0 (paused tenant) is allowed, but the UI surfaces "Site is paused — no new enqueues possible" rather than silently failing every enqueue attempt with a cryptic code.

6. **Tenant's cap falls below today's current usage (admin lowered it).** → New enqueues rejected; existing rows don't roll back. Operator sees the BUDGET_EXCEEDED error at the enqueue surface. Matches the "can't undo past spend" reality.

7. **Cost recorded in multiple places (events + aggregate columns).** → The enforcement layer reads from the aggregate columns (`daily_usage_cents`, `monthly_usage_cents`) only. Event log is still the audit truth but doesn't gate enqueues — keeps the enforcement query cheap (one row read vs. a sum query over events).

8. **Forgetting to bump usage on a new cost surface.** → M8-2 wraps every usage write in a shared `bumpTenantUsage(siteId, deltaCents)` helper. A grep for `tenant_cost_budgets` in the codebase shows everywhere usage is touched; reviewers catch surfaces that skip it.

9. **Migration backfill creates duplicate rows on re-apply.** → `INSERT … ON CONFLICT DO NOTHING` on `site_id`. Idempotent.

10. **Admin-wiped `tenant_cost_budgets` row.** → Default-caps applied at row-create; no orphan enqueue path exists. If a row is deleted manually in SQL, the first enqueue for that site re-creates it via an upsert in the enforcement helper (defense-in-depth for operator error).

11. **`BUDGET_EXCEEDED` leaking cap details to the operator.** → Response includes `{ cap_cents, usage_cents, period: 'daily'|'monthly' }` — intentional; operators need this to triage. No cross-tenant leak since the request is always scoped to one site.

12. **Monthly cap bypass by enqueueing right before the reset.** → Acceptable: a tenant with 99% of their monthly cap at 23:59 UTC can enqueue one batch that drains it; reset at 00:00 gives them a fresh budget. Matches physical reality (Anthropic's own billing cycle).

## Relationship to existing patterns

- **Schema** follows `docs/patterns/new-migration.md` + `DATA_CONVENTIONS.md`.
- **Enforcement** is a new cross-cutting concern; documented inline. Could be promoted to a `cost-enforcement` pattern if a third cost surface ever needs the same shape.
- **Admin PATCH** follows `docs/patterns/new-api-route.md` + version_lock.
- **Reset cron** follows the existing `/api/cron/*` shape.

## Sub-slice status tracker

Maintained in `docs/BACKLOG.md`. On M8-5 merge, auto-continue proceeds to M9 — candidate scope TBD, but likely observability wiring once one of the blocked env-var sets lands (Sentry / Langfuse / Axiom / Upstash).
