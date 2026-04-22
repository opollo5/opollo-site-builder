# M7 — Single-Page Re-Generation + WP Publish Drift Reconciliation

## What it is

An operator-initiated action on a single existing page: "re-generate this one page against the current design system and republish it to WordPress." Closes the loop M6-3 deliberately left open — editing `pages.slug` or `pages.title` in the DB today doesn't update the WP-side content; re-generation + WP `PUT` is how drift gets reconciled.

**Write-safety-critical milestone** per CLAUDE.md. Spends Anthropic tokens, mutates the client's WordPress site, coordinates three external systems (Anthropic, Cloudflare, WP) without 2-phase-commit. Every sub-slice plan carries the full **"Risks identified and mitigated"** audit. M3 and M4 are the proof-of-pattern; M7 is the third application.

## Why a separate milestone

- **M3** (batch generator) produced pages from a template against a brief list. One-shot creation; no concept of re-running.
- **M4** (image library) mirrored images into WP on publish. Transactional write-through; no concept of updating a published page.
- **M6** (per-page admin UI) gave operators the detail view + metadata edit + drift warning. Editing a slug today surfaces a yellow banner saying "WordPress keeps the old URL until the next publish" — this milestone is that next publish.
- **M7** is the first surface in the codebase that re-writes an existing published WP page. The safety layer needs to handle partial failures (Anthropic OK → WP PUT fails → operator retries) and drift (our slug changed → WP slug still old) without losing the customer's published content.

## Scope (shipped in M7)

- New schema: `regeneration_jobs` table plus an append-only `regeneration_events` audit log. Single-slot shape — no separate `regeneration_job_pages` child because re-gen is always one page at a time.
- New worker: `lib/regeneration-worker.ts` that leases a `regeneration_jobs` row, runs the M3 generation pipeline (Anthropic call → quality gates → WP update → image transfer → event log), and commits the new `generated_html` to `pages`.
- Anthropic integration reusing the M3-4 pattern: pre-computed idempotency key, event-log-first accounting, cost aggregation.
- WP update path reusing the M3-6 pattern with an adoption step for the drift case (slug changed in our DB; WP page still has the old slug — adopt via GET-by-wp_page_id before deciding PUT vs POST).
- Image transfer via the M4-7 `transferImagesForPage` path for any new Cloudflare URLs in the re-generated HTML.
- Admin UI: "Re-generate" button on `/admin/sites/[id]/pages/[pageId]` that enqueues the job and polls the status.
- Drift reconciliation: when the regenerated page commits successfully, if `pages.slug` differs from the WP-side slug, the WP update explicitly renames via `post_name` (WP REST API supports `slug` as a field on PUT).
- Optimistic-lock on `pages.version_lock` throughout so concurrent re-gens race to exactly one winner.
- Quality gate runner reused from M3-5 (no new gates; the existing five substantive gates apply).
- Retry + budget cap machinery reused from M3-7.
- E2E coverage: operator enqueues a regen on a seeded page, worker processes it (stubbed Anthropic + WP), detail page shows new `generated_html`.

## Out of scope (tracked in BACKLOG.md)

- **Bulk re-generation** (regen N pages at once). Surface the per-page flow first; bulk belongs to its own milestone once operators ask for it.
- **Regen with a modified brief.** M7 re-runs against the existing `content_brief`. If operators want to edit the brief before regen, that's a follow-up slice.
- **Partial regen** (regenerate one section of a page). Pattern doesn't map to Claude's single-shot HTML output; would need a fundamentally different prompt strategy.
- **Scheduled / cron re-gen** (auto-refresh pages on DS version bump). The existing drift detection flags + operator triggers cover current needs.
- **Rollback to a prior revision.** `page_history` table exists but isn't populated today; exposing it is a separate slice.
- **Live Tier-1 preview during regen in-flight.** M6-2 deferred this; still out.

## Env vars required

| Var | Needed by | Status |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | M7-2 | Present (shared with M3) |
| `CLOUDFLARE_IMAGES_HASH` | M7-3 | Present (provisioned with M4) |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_IMAGES_API_TOKEN` | M7-3 image transfer | Present |
| `OPOLLO_MASTER_KEY` | M7-3 WP credential decryption | Present |
| `CRON_SECRET` | M7-4 worker trigger | Present |
| `SUPABASE_*` | all | Present |

No new env vars. Every external dependency is already provisioned from M3 + M4.

## Sub-slice breakdown (5 PRs)

| Slice | Scope | Write-safety rating | Blocks on |
| --- | --- | --- | --- |
| **M7-1** | Schema: `regeneration_jobs` (+ `regeneration_events`) tables with constraints, lease-coherence CHECK, RLS, indexes. `pages.version_lock` stays the optimistic-lock anchor. Unit tests cover constraint-reject paths. | **High** — UNIQUE constraints are the write-safety layer for retries + concurrent regens. | Nothing |
| **M7-2** | Worker core: `lib/regeneration-worker.ts` with lease / heartbeat / reaper over `regeneration_jobs`. Runs Anthropic against the existing `content_brief` with M3-4's idempotency + event-log pattern. Dummy quality-gate + WP stages so the worker is testable without live calls. | **Critical** — billed Anthropic call; idempotency retry reuse. | M7-1 |
| **M7-3** | WP update stage: reuses M3-6's publish path + adoption logic, extended for drift (our slug ≠ WP slug). Calls `transferImagesForPage` (M4-7) for any new Cloudflare URLs in the re-gen'd HTML. Writes new `generated_html` back to `pages` with `version_lock` bump. | **Critical** — mutates client WP, transactional transfer across 3 systems. | M7-2 + M4-7 infrastructure. |
| **M7-4** | Admin UI: "Re-generate" button on `/admin/sites/[id]/pages/[pageId]`. `POST /api/admin/sites/[id]/pages/[pageId]/regenerate` enqueues the job. Detail page polls status via server-rendered re-fetch (simple `setInterval` on the client wrapping router.refresh). | **Medium** — enqueues a billed job. Budget gate + operator confirm before POST. | M7-1..3 |
| **M7-5** | Cron wiring + budget cap: `/api/cron/process-regenerations` worker tick. `regeneration_jobs` carries the same budget-cap pattern as `generation_jobs`. Budget enforcement happens at job creation time, NOT worker time (matches M3-7). | **Medium** — cost gate. | M7-4 |

**Execution order:** strictly M7-1 → M7-2 → M7-3 → M7-4 → M7-5. Each slice has dependencies on the previous one's schema or code.

Total expected volume: ~3,500–4,500 lines across five slices including tests. Each slice stays within the reviewer-in-5-minutes rule except possibly M7-3 which is the write-safety-dense one.

## Write-safety contract

Three external systems (Anthropic, Cloudflare, WP) plus our DB, all touched within one worker tick. Same "idempotent + recovery-safe" design as M3 + M4:

### Anthropic (M7-2)

- Pre-computed `anthropic_idempotency_key` on `regeneration_jobs` INSERT (UUIDv5 from `job_id + page_id`). Retries reuse it automatically.
- Event-log-first: `regeneration_events` row with type `anthropic_response_received` written BEFORE the `regeneration_jobs.cost_usd_cents` UPDATE. Reconciliation reads the event log.
- Retryable failures (429, 5xx, network): `retry_after` + exponential backoff per M3-7.
- Non-retryable (400, 401, 413): terminal fail with explicit `failure_code`.

### Cloudflare Images (M7-3, transitive via M4-7)

- Cloudflare upload is `image_library` INSERT path, which is already write-safe per M4-3. M7 never re-uploads an image it already has; the `extractCloudflareIds` + `image_usage` join in `transferImagesForPage` short-circuits when the image was previously mirrored to this site.

### WordPress (M7-3)

- `wp_idempotency_key` pre-computed on regen job insert. WP PUT with idempotency marker; on 429/5xx retries use the same key; on 200 the marker is stamped into `pages.updated_at`.
- **Drift case:** after Anthropic produces new HTML, we compare the DB's current `pages.slug` with the WP-side slug (fetched via GET-by-wp_page_id). If they differ, the PUT includes `slug` in the body so WP updates `post_name` atomically. WP's PUT with a changed slug returns the new URL; we reconcile.
- If the WP PUT succeeds but our DB write of the new `generated_html` fails, the retry's first action is a GET-by-wp_page_id adoption check: if the WP page's `modified` timestamp is newer than our last known, we adopt the WP state (the PUT already ran) and only commit our DB write. No double PUT.
- `pages.version_lock` gated on the UPDATE. Two concurrent regens against the same page race to INSERT into `regeneration_jobs` first; then the worker's UPDATE to `pages` checks `version_lock` — the loser gets VERSION_CONFLICT.

### Event log first (M7-1)

`regeneration_events` is the append-only truth source. Every billed external call gets an event row BEFORE the state column flips. Reconciliation + post-mortem debugging both read the event log.

## Testing strategy

Per existing patterns:

| Slice | Patterns applied |
| --- | --- |
| M7-1 | `new-migration.md` (constraint-reject tests, RLS role matrix, cascade behaviour, lease-coherence CHECK). |
| M7-2 | `background-worker-with-write-safety.md` (lease / heartbeat / reaper, crash recovery) + `concurrency-test-harness.md`. Anthropic stubbed via the M3-4 test pattern. |
| M7-3 | `new-batch-worker-stage.md` (idempotency reuse, retryable classification, cost reconciliation) + drift-specific tests: our slug changed → WP PUT carries new slug; WP PUT succeeded + our DB write failed → retry adopts. Fetch mocked. |
| M7-4 | `new-api-route.md` (Zod + gate + error codes) + `new-admin-page.md` (button wiring, router.refresh, revalidatePath). |
| M7-5 | Cron signature check + budget enforcement tests; `retry_after` behaviour. |

**Concurrency test harness.** `concurrency-test-harness.md` applies on M7-3 — two concurrent regens of the same page must produce exactly one WP PUT + exactly one `pages.version_lock` bump. The M3-6 pre-commit-claim pattern translates directly.

**EXPLAIN ANALYZE.** The worker's `FOR UPDATE SKIP LOCKED` dequeue against `regeneration_jobs` must stay fast as the table grows. M7-1 includes an `idx_regen_jobs_leasable` partial index and paste the plan in the PR description.

**E2E coverage.** `e2e/pages.spec.ts` gets extended: operator clicks Re-generate on a seeded page, the worker is kicked manually in the test (not via cron), detail page reflects the updated HTML. Anthropic + WP are stubbed; the focus is UI wiring + polling + revalidation.

## Risks identified and mitigated

Per-slice plans elaborate these; listed here at the parent-milestone level so the safety net is visible in one place.

1. **Double-billing Anthropic on retry.** → Pre-computed `anthropic_idempotency_key` on `regeneration_jobs` INSERT. Every retry reuses it. Test: reaped-then-reprocessed job uses the same key; Anthropic stub asserts identical body on both calls.

2. **Double-PUT to WP on retry.** → Pre-computed `wp_idempotency_key`; retries first GET-by-wp_page_id to detect the partial-commit case (WP PUT succeeded + our DB write failed) and adopt rather than re-PUT. Same pattern M3-6 established. Test pinned.

3. **Two concurrent regens racing the same page.** → `regeneration_jobs (page_id) UNIQUE WHERE status IN ('pending', 'running')` — a partial unique index that allows at most one in-flight job per page. Second enqueue attempt returns 409 `REGEN_ALREADY_IN_FLIGHT`.

4. **Pages version_lock stale when the regen worker commits.** → Worker reads `pages.version_lock` at dequeue time, carries it through Anthropic + WP, and stamps `version_lock = expected + 1` in the final UPDATE with WHERE clause pinning. Mismatch (operator edited metadata while regen was in flight) → worker fails the job with VERSION_CONFLICT. Operator retries the regen; the new run picks up the edited metadata.

5. **Drift: slug changed in DB; WP still has old slug.** → Worker always fetches WP state before deciding PUT shape. If slugs differ, the PUT body includes `slug` so WP updates `post_name`. WP returns the new URL; we reconcile into `pages.slug` (if different) and `pages.wp_slug_resolved_at`. Test: seed `pages.slug = new-slug` + WP has `old-slug` → regen produces PUT that includes both new slug + new HTML; post-regen `pages.slug` unchanged and WP confirms `old-slug → new-slug`.

6. **Anthropic OK → WP 5xx → operator retries.** → Anthropic response cached in `regeneration_events`. Retry fetches it from the event log instead of re-calling. WP retry uses the same idempotency key. Cost counted once. Test: first attempt sets `anthropic_response_received`, then WP stub 500s; retry reads event + WP stub 200s; total cost = 1× Anthropic call.

7. **Regen against a page whose design system has been archived.** → Worker loads the design system at dequeue time (same as M3-3). If the page's `design_system_version` no longer has an active DS, worker fails with `DS_ARCHIVED` and surfaces a friendly error on the detail page. No Anthropic call happens. Test pinned.

8. **Budget runaway.** → Every `regeneration_jobs` INSERT runs through the M3-7 budget gate. Daily / monthly caps enforced at enqueue time. Test: 99% budget consumed + new regen attempt → 429 `BUDGET_EXCEEDED`, no job created.

9. **Operator enqueues a regen then cancels.** → `regeneration_jobs.cancel_requested_at` checked at every worker tick; worker short-circuits to `cancelled` status at the next state transition. Anthropic calls already in flight are not interrupted (Anthropic API doesn't support mid-stream cancel); the cost is recorded but the WP write skipped.

10. **Stale `generated_html` after regen.** → After successful commit, `revalidatePath('/admin/sites/[id]/pages/[pageId]')`. Detail page polls status every 2s while `status IN ('pending', 'running')`; switches to static after terminal. Stale cache is the operator's problem only if they navigate outside the polling window — standard admin UX.

11. **Image transfer fails mid-regen.** → `transferImagesForPage` already handles this (M4-7). Failure short-circuits with `WP_IMAGE_TRANSFER_FAILED`; the regen job state is `failed`, `generated_html` unchanged, WP unchanged. Operator retries manually. Test: Cloudflare stub returns 429 on one image; worker fails cleanly.

12. **Quality gates fail on the new HTML.** → M3-5 runner. Failure → job state `failed_gates` (new terminal state), HTML stored in the event log for inspection, WP untouched. Operator sees the gate failures in the detail page's regen panel.

13. **`regeneration_events` retention.** → Kept indefinitely in M7. M4's `transfer_events` has the same posture. If event volume becomes an issue, a cleanup slice under ops-infra handles it.

14. **Cron stops firing.** → Same infrastructure as M3's batch worker cron (`/api/cron/process-batch`). Parent plan re-uses the `CRON_SECRET` check pattern. If cron stops firing, jobs sit `pending` — observable via the admin UI + a future observability alert.

15. **WP credentials missing for the site.** → Worker checks credential decryption on dequeue. Failure → terminal `WP_CREDS_MISSING` with a friendly message surfacing to the detail page. Test: seed site without credentials + enqueue → terminal fail.

16. **Operator can't observe what happened.** → The event log (`regeneration_events`) is append-only and queryable. Detail page shows the last 5 events for the page (regen history). Debugging is always a SELECT away, no grep through logs.

## Relationship to existing patterns

- **Workers** follow `docs/patterns/background-worker-with-write-safety.md` + `new-batch-worker-stage.md`. M3 + M4 are both proof-of-pattern; M7 is the third application.
- **Schema** follows `docs/patterns/new-migration.md` + `docs/DATA_CONVENTIONS.md`. `regeneration_jobs` ships with `deleted_at`, audit columns, `version_lock` where edits are expected, RLS from day one.
- **WP drift reconciliation** is a new specific subpattern within the M3-6 publish flow; documented inline in `lib/regeneration-worker.ts` and the M7-3 plan, not promoted to a repo-level pattern yet (single consumer).
- **Write-safety invariants** match M3's (idempotency key stamped at insert, event-log-first, SAVEPOINT on unique-violation, top-branch CASE on job aggregation).

No new architectural patterns are introduced by M7 that aren't immediate sub-patterns of existing ones.

## Sub-slice status tracker

Maintained in `docs/BACKLOG.md` under a new **M7 — single-page re-generation** section. Updated on every merge.

On M7-5 merge, auto-continue proceeds to **M8** — scope TBD at that boundary; roadmap candidates are (a) multi-tenant billing / Stripe, (b) observability-deep (Sentry / Langfuse / Axiom) once env vars land, (c) per-tenant cost budgets. Parent plan drafted when M7-5 ships.
