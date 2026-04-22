# M3 — Batch Generator (retroactive)

## Status

Shipped. Backfilled during M11-6 (audit close-out 2026-04-22) because M3 is the proof-of-pattern that every later write-safety-critical milestone (M4, M7, M8) cites. Its risk audit previously lived only in test file comments; this plan surfaces it in one place.

## What it is

A cron-driven batch worker that generates N pages per job by calling Anthropic per slot, running quality gates, and publishing to WordPress. Every step is idempotent under retry — the `generation_jobs` / `generation_job_pages` / `generation_events` schema is designed so a partial crash never double-bills and never double-publishes.

## Scope (shipped in M3)

- **Migration 0007** `0007_m3_1_batch_schema.sql` — `generation_jobs`, `generation_job_pages` (slots), `generation_events` (append-only event log). Lease-coherence CHECK constraint (`status / worker_id / lease_expires_at` must be mutually consistent). Per-slot `anthropic_idempotency_key`. Partial UNIQUE on `(site_id, slug) WHERE status != 'removed'` on the `pages` table — the coordination point for M3-6's pre-commit slug claim.
- **Migration 0008** `0008_m3_4_slot_html.sql` — adds `generated_html` + cost columns to slots.
- **Migration 0009** `0009_m3_7_retry_after.sql` — `retry_after` column for bounded exponential backoff on transient failures.
- **Libs** `lib/batch-worker.ts` (lease + heartbeat + reaper + processSlotAnthropic), `lib/batch-publisher.ts` (publishSlot: WP create → UPDATE pages → event log), `lib/batch-jobs.ts` (createBatchJob with Zod + budget gate), `lib/quality-gates.ts` (runtime HTML validation), `lib/anthropic-call.ts` (SDK wrapper with idempotency-key threading), `lib/anthropic-pricing.ts` (per-model cost table).
- **Cron entry** `app/api/cron/process-batch/route.ts` — one slot per invocation, constant-time CRON_SECRET compare. Vercel's 300s ceiling × parallel cron hits fan out with `SKIP LOCKED` lease contention.
- **Admin UI** `/admin/batches` (list), `/admin/batches/[id]` (detail with per-slot status + retry), New-batch modal + server actions.

## Out of scope (later milestones)

- **Per-tenant cost budgets.** M8 enforces these at `createBatchJob` + `enqueueRegenJob`.
- **Image library + WP media transfer.** M4.
- **Single-page re-generation.** M7.
- **HTML size cap at write time.** M11-4 added the `html_size` quality gate.
- **Per-batch budget cap.** Only a global tenant-wide cap was in scope at M3-time (moved to per-tenant in M8).

## Env vars required

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` — DB-direct client used for `SELECT FOR UPDATE SKIP LOCKED` primitives.
- `ANTHROPIC_API_KEY` — batch worker Anthropic call.
- `CRON_SECRET` — cron route authz; 32-char minimum.

## Risks identified and mitigated (write-safety-critical)

1. **Two workers lease the same slot.** → `SELECT FOR UPDATE SKIP LOCKED` + atomic UPDATE to `running` with `worker_id`. Two concurrent leases → one succeeds, other skips. Tests: `batch-worker-anthropic.test.ts` + `batch-worker-retry.test.ts` concurrency assertions.

2. **Crashed worker's lease held forever.** → Reaper resets `running` jobs with expired leases back to `pending`. Lease-coherence CHECK enforces `worker_id NULL` + `lease_expires_at NULL` on any non-running row. Tests: reaper test block in `batch-worker.test.ts`.

3. **Retry duplicates the Anthropic call (billing).** → Every slot has a stable `anthropic_idempotency_key` computed deterministically in `createBatchJob`. Every retry replays the same key; Anthropic returns the cached response within 24h. Tests: `batch-worker-anthropic.test.ts` "threads the stored idempotency key verbatim."

4. **Partial-commit on Anthropic stage (DB blip between cost save and state flip).** → Event log written FIRST (`anthropic_response_received` with cost + tokens + response_id). Cost columns flipped second. Reconciliation job can rebuild cost totals from the event log if the columns are stale. Tests: `batch-worker-anthropic.test.ts` "writes event log BEFORE cost columns flip."

5. **Pages UNIQUE (site_id, slug) race between two batch slots generating the same slug.** → M3-6's pre-commit pattern: `INSERT INTO pages … ON CONFLICT DO NOTHING` wrapped in a SAVEPOINT; loser retries with an adoption step. Advisory lock on `(site_id, slug)` hash serialises the WP-create step. Tests: `batch-publisher.test.ts` "SLUG_CONFLICT" + adoption tests.

6. **WP page create fails mid-publish; slot stuck in `publishing`.** → Publisher records explicit `publishing` → `succeeded` OR `publishing` → `failed` transitions. Reaper + retry cap (3 attempts) cover the transient-failure path; non-retryable errors short-circuit to `failed`. Tests: `batch-worker-publish.test.ts`.

7. **Gates pass in tests but fail in production due to non-deterministic Anthropic output.** → Gates are pure functions over the HTML string. Same input → same verdict. Tests: `quality-gates.test.ts` covers every gate + the runner's short-circuit behaviour. M11-4 added the `html_size` gate as the first check to short-circuit oversized payloads before regex-heavy gates run.

8. **Cost-total drift between slots and job aggregate.** → Event log is the truth. Slot cost columns + job aggregate are derived; a reconciliation job can recompute. Tested implicitly — any code path that writes cost also writes the event.

9. **CRON_SECRET leakage via log output.** → Never logged. Constant-time compared. Cron logs include `processed_job_id` / `outcome` but never secret headers.

10. **Cost explosion from a misconfigured prompt.** → Per-job `total_cost_usd_cents` aggregate. M7-5 added `REGEN_DAILY_BUDGET_CENTS` tenant-wide cap at enqueue. M8-2 split this into per-tenant budgets.

## Shipped sub-slices

| Slice | PR | Notes |
| --- | --- | --- |
| M3-1 | early M3 | `generation_jobs` + `generation_events` schema + lease-coherence CHECK + UNIQUE (site_id, slug) on pages |
| M3-2 | — | `createBatchJob` + Zod + deterministic idempotency keys |
| M3-3 | — | Cron entry with constant-time CRON_SECRET compare |
| M3-4 | — | `processSlotAnthropic` + `lib/anthropic-call.ts` + cost computation |
| M3-5 | — | Runtime quality gates (wrapper / scope_prefix / html_basics / slug_kebab / meta_description) |
| M3-6 | — | `publishSlot` — WP create + pages-committed event + pre-commit slug claim + SLUG_CONFLICT adoption |
| M3-7 | — | Retry + backoff (`retry_after` column + RETRY_BACKOFF_MS table) |

## Tests that prove each risk

| Risk | Test file + key assertion |
| --- | --- |
| 1 | `batch-worker-anthropic.test.ts` lease-contention |
| 2 | `batch-worker.test.ts` reaper block |
| 3 | `batch-worker-anthropic.test.ts` idempotency-key threading |
| 4 | `batch-worker-anthropic.test.ts` "writes event log BEFORE cost columns flip" |
| 5 | `batch-publisher.test.ts` SLUG_CONFLICT + adoption |
| 6 | `batch-worker-publish.test.ts` |
| 7 | `quality-gates.test.ts` |
| 8 | `batch-worker-anthropic.test.ts` cost reconciliation assertion |
| 9 | No specific test; review-time enforced |
| 10 | `m8-tenant-budget-enforcement.test.ts` (M8 layer) |

## E2E coverage

`e2e/batches.spec.ts` covers the admin list + the site-scope filter. Full end-to-end (create batch → cron tick → publish) is NOT in E2E and is called out as a backlog item — the worker is CPU-bound and heavily unit-tested, so the smoke test is lower priority than surfaces like chat (M11-1) or budgets (M11-5).
