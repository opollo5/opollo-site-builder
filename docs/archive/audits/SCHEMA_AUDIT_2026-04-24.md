# Schema → Code Audit (M15-2)

**Date:** 2026-04-24
**Scope:** M1 → M14 (migrations 0001-0013 + all lib/, app/, scripts/, e2e/ code)
**Method:** Parallel Sonnet sub-agents extracted (a) the canonical post-migration schema from `supabase/migrations/*.sql` and (b) every Supabase query chain in the codebase (`.from()/.select()/.insert()/.update()/.delete()/.eq()/.rpc()` etc. + raw `pg` SQL strings). Opus cross-referenced the two and classified findings.
**Inputs:** `docs/_audit_scratch/canonical_schema.md` (~1400 lines, 27 tables + 6 RPCs/functions + 4 triggers + 2 enums + 1 storage bucket) and `docs/_audit_scratch/code_queries.md` (~1870 lines, ~212 distinct query chains). Scratch dir to be cleaned up after M15-3..M15-6.

---

## TL;DR

**No new production-breaking schema-to-code mismatches beyond the one already in flight.** The `opollo_users.deleted_at` bug that triggered M15 was fully cleaned up by commit 5cd7667 — every remaining user-lifecycle reference in the codebase uses `revoked_at` correctly. M15-1 is separately handling the `/api/ops/reset-admin-password` endpoint.

However, the audit surfaced **14 latent findings** (past the >10 escalation threshold). None will crash today; several are the same shape of trap that produced the original bug. The single highest-leverage fix is **generated Supabase types + a CI gate that fails on column-not-in-types** (M15-8 already planned). That alone would have caught the original `deleted_at` drift at typecheck time.

**Escalation flag:** count is over 10 — pause for your prioritization before M15-7 scoping. I am NOT starting M15-3 until you review this.

---

## Findings Summary (14 items)

| # | Severity | Category | Milestone | One-line |
|---|---|---|---|---|
| 0 | — | (Reference only) | M14-1 / M15-1 | `opollo_users.deleted_at` bug: fixed in 5cd7667; M15-1 in flight on `/api/ops/reset-admin-password`. Not re-flagged. |
| 1 | LATENT-RISK | Type safety | Cross-cutting | No generated `types/supabase.ts`. Code hand-maintains row types + dynamic `.select("col1,col2")` strings — the exact class of defect that shipped the original bug. |
| 2 | LATENT-RISK | Dead-in-code schema | M1, M12-1 | 8 tables defined in migrations are never written by production code (schema exists, code doesn't touch them). |
| 3 | TECH-DEBT | Audit-column drift | M3-1 | `app/api/admin/batch/[id]/cancel` updates `generation_jobs` (Q129) and `generation_job_pages` (Q130) without stamping `updated_at`. Rows keep stale updated_at post-cancel. |
| 4 | LATENT-RISK | Query performance | M7-1 | `lib/regeneration-worker.ts` daily-budget check (Q105) does a full-table scan of `regeneration_jobs.cost_usd_cents` filtered only by `created_at`. No supporting index; runs on every enqueue. |
| 5 | TECH-DEBT | Feature gap | M4-1 | `transfer_jobs` schema has `cancel_requested_at` but no cancel API/UI exists — schema is wired for a feature that didn't ship. |
| 6 | TECH-DEBT | Schema asymmetry | M1 | `chat_sessions_archive` lacks the `DEFAULT now()` on `created_at/updated_at` and the `message_count` CHECK constraint that `chat_sessions` has. (Dead table today — see #2.) |
| 7 | TECH-DEBT | Schema inconsistency | M1 | `page_history.operator_user_id` is `uuid` with no FK; sibling `updated_by` is `text`. Two audit columns for the same concept at different types. (Dead table today — see #2.) |
| 8 | TECH-DEBT | Schema inconsistency | M3-1, M4-1, M7-1 | Parallel event tables use different PK types: `generation_events` and `regeneration_events` are `bigserial`; `transfer_events` is `uuid`. |
| 9 | TECH-DEBT | Missing constraint | M4-1, M12-1 | `image_library.version_lock`, `briefs.version_lock`, `brief_pages.version_lock`, `brief_runs.version_lock`, `site_conventions.version_lock` lack `CHECK (version_lock >= 1)`. Other `version_lock` columns (design_*, pages, tenant_cost_budgets) have it. |
| 10 | TECH-DEBT | Constraint asymmetry | M3-1, M4-1, M7-1 | `transfer_job_items_lease_coherent` CHECK is stricter than `generation_job_pages_lease_coherent` and `regeneration_jobs_lease_coherent` — M4 also requires `worker_id IS NOT NULL AND lease_expires_at IS NOT NULL` in leased states; M3 and M7 only check the state enum. |
| 11 | LATENT-RISK | Dynamic columns | M1a | `updateDesignSystem`, `updateComponent`, `updateTemplate` use `{...parsed.data, version_lock}` spread. `parsed.data` comes from a Zod schema. If Zod drifts from DB columns the query fails at runtime, not typecheck. |
| 12 | LATENT-RISK | RLS asymmetry | M4-1 | `image_usage` SELECT policy excludes `viewer` role; `image_library` and `image_metadata` include it. May be intentional (WP plumbing hidden from viewers), but undocumented. |
| 13 | LATENT-RISK | RLS documentation | M3-1, M4-1, M7-1, M8-1 | Service-role-only write tables (all generation_*, transfer_*, regeneration_*, tenant_cost_budgets) have no authenticated INSERT/UPDATE/DELETE policies. Intentional (workers use service-role), but a future dev writing an admin surface could hit 42501 with no signal pointing them to the service-role client. |
| 14 | LATENT-RISK | RLS documentation | M2a | `opollo_config` has no authenticated read policy — intentional to protect `first_admin_email` from enumeration, but undocumented at the schema level. |

---

## Critical finding — reference only

### 0. `opollo_users.deleted_at` bug (M14-1; M15-1 in flight)

- **Schema truth:** `opollo_users` has never had a `deleted_at` column in any of the 13 migrations. The column added in `0006_m2c_revoked_at.sql` is `revoked_at` — semantically a *session-invalidation* timestamp (a new login with `iat > revoked_at` passes the gate without clearing the column), not a deletion marker.
- **Fix state:** Commit 5cd7667 (`fix(m14-1): opollo_users has no deleted_at column — filter on revoked_at`) resolved the known call site. Grep confirms every remaining `opollo_users` reference in the repo uses `revoked_at`:
  - `lib/auth.ts:209` — `.select("role,email,revoked_at")`
  - `lib/auth-revoke.ts:103` — `.update({ revoked_at: ... })`
  - `app/api/admin/users/list/route.ts:41` — `.select("id, email, display_name, role, created_at, revoked_at")`
  - `app/api/admin/users/[id]/reinstate/route.ts:56,96` — reads and clears `revoked_at`
  - `app/api/admin/users/[id]/revoke/route.ts:102` — `.is("revoked_at", null)` guard
  - `app/api/ops/reset-admin-password/route.ts:146-148` — the M15-1 surface; covered elsewhere.
- **Action:** None here. M15-1 owns `/api/ops/reset-admin-password`. Listed for completeness.

---

## Detailed findings

### 1. [LATENT-RISK] No generated Supabase types

**What:** The repo has no `types/supabase*.ts`. Row types are hand-written (e.g. `AdminUserRow` in `app/api/admin/users/list/route.ts:25`, `OpolloUserRow` in tests, `DETAIL_PAGE_FIELDS`/`DETAIL_IMAGE_FIELDS` as string constants in `lib/pages.ts` and `lib/image-library.ts`). Column lists in `.select("a, b, c")` are string literals — TypeScript cannot validate them against the schema.

**Why it matters:** This is the root cause of the shape of bug that triggered M15. A query `.select("deleted_at")` against a table that doesn't have `deleted_at` passes lint, typecheck, and most unit tests (if the test mocks the Supabase client). It only fails at runtime against a real database. Every table introduced since M1 has widened the blast radius.

**Fix:** M15-8 already scopes this. `supabase gen types typescript --linked > types/supabase.ts`, commit the file, regenerate on every migration, and use `Database["public"]["Tables"]["opollo_users"]["Row"]` + `.select<"id,email,revoked_at", Pick<..., "id" | "email" | "revoked_at">>()` patterns. Add CI check that fails on schema-vs-types drift.

---

### 2. [LATENT-RISK] Dead-in-code schema (8 tables)

**What:** These tables exist in the schema but no production code writes to or reads from them via either supabase-js or raw `pg`:

| Table | Introduced | Intended purpose |
|---|---|---|
| `page_history` | M1 (0001) | Write-once audit log for page operations |
| `site_context` | M1 (0001) | Site-level snapshot (pages_tree, menus_current, etc.) |
| `pairing_codes` | M1 (0001) | WP plugin initial-pairing flow |
| `health_checks` | M1 (0001) | Historical probe records (distinct from `/api/health` liveness) |
| `chat_sessions` | M1 (0001) | Conversation state persistence |
| `chat_sessions_archive` | M1 (0001) | Archive partition for chat_sessions |
| `brief_runs` | M12-1 (0013) | Worker-run state for briefs → pages expansion |
| `site_conventions` | M12-1 (0013) | Anchor-cycle output per brief |

M1 tables (6) are original-scope stubs that never got code. M12-1 tables (2) are forward-facing schema shipped ahead of the M12-2+ worker.

**Why it matters:** Dead schema rots silently. A future dev may assume these tables are populated and JOIN against them, or a migration may drop a column the code never used, or a RLS policy may go unreviewed. `chat_sessions`/`chat_sessions_archive` in particular are production-facing (chat flow runs today) and their absence from code paths suggests the chat surface is using some other storage — worth confirming that's intentional.

**Fix:** Triage per table:
- Populate or drop each of the M1 6. Leaning toward drop for `pairing_codes` / `health_checks` / `chat_sessions*` if the product decisions already moved past them; keep `page_history` / `site_context` if they're on the roadmap with an owner.
- Keep the M12-1 2; they have a planned owner (M12-2+). Add a comment in migration 0013 noting "forward-looking; populated by M12-N worker."

---

### 3. [TECH-DEBT] `updated_at` not stamped on batch-cancel

**Where:** `app/api/admin/batch/[id]/cancel/route.ts:118-125` (Q129) and `app/api/admin/batch/[id]/cancel/route.ts:138-148` (Q130).

**What:** Cancel path updates `generation_jobs` (sets `status="cancelled", cancel_requested_at, finished_at`) and `generation_job_pages` (sets `state="skipped", last_error_code, last_error_message, finished_at, retry_after:null`) without setting `updated_at`. Both tables have `updated_at timestamptz NOT NULL DEFAULT now()`. No trigger auto-maintains it.

**Why it matters:** Rows carry a stale `updated_at` post-cancel. Audit timelines based on that column will miss the cancel. Not crash-inducing.

**Fix:** Add `updated_at: new Date().toISOString()` to both update objects.

---

### 4. [LATENT-RISK] Missing index for daily-budget check

**Where:** `lib/regeneration-worker.ts` `checkDailyBudget` (Q105).

**What:** `await supabase.from("regeneration_jobs").select("cost_usd_cents").gte("created_at", startOfDay.toISOString())` — filters only by `created_at`. `regeneration_jobs` has indexes on `(site_id, created_at DESC)`, `(page_id, created_at DESC)`, and `(created_by)` but none on `created_at` alone. Query planner will pick whichever covering index exists and filter in-memory, or scan the whole table.

**Why it matters:** Fires on every regen enqueue. At current volume it's fine. If regen throughput grows to thousands of jobs/day, this query's cost grows linearly — the "this is slow" signal will arrive mid-incident.

**Fix:** Either (a) add `CREATE INDEX idx_regen_jobs_created_at ON regeneration_jobs (created_at DESC) WHERE status != 'cancelled'` or (b) scope the query to `site_id` as well and use the existing composite index. Option (b) is probably right — daily budget should be per-site anyway, not global.

**Required by CLAUDE.md:** "any new DB query in a code path that runs per-request or per-slot... MUST be EXPLAIN ANALYZE'd against a realistic-volume seed before merge." This query predates the rule but should be retroactively validated.

---

### 5. [TECH-DEBT] No cancel endpoint for transfer_jobs

**What:** `transfer_jobs` has `cancel_requested_at timestamptz` column in its M4-1 schema. No `app/api/admin/transfer*/cancel/route.ts` exists. `generation_jobs` has both the column AND a cancel endpoint. Asymmetric.

**Why it matters:** Either the cancel flow is missing (operator can't stop a stuck ingest/transfer mid-flight), or the column is dead and should be dropped. Likely the former based on symmetry with generation_jobs.

**Fix:** Product decision — either wire an `/api/admin/transfer/[id]/cancel` route or drop the column in a future migration. Flag for M15-4 (endpoint audit) since it's in that territory.

---

### 6. [TECH-DEBT] `chat_sessions_archive` schema drift

**Where:** 0001_initial_schema.sql.

**What:** `chat_sessions` has `messages jsonb NOT NULL DEFAULT '[]'`, `message_count int NOT NULL DEFAULT 0 CHECK (message_count >= 0 AND message_count <= 200)`, `created_at/updated_at NOT NULL DEFAULT now()`. `chat_sessions_archive` has the same columns but NO defaults and NO CHECK. Any archive insert path must supply all four values explicitly.

**Why it matters:** Today: nothing — both tables are dead in code (finding #2). If an archive path gets written later, the drift becomes a footgun.

**Fix:** Either fold it into the table when someone ships the archive flow, or drop both tables in the same cleanup slice.

---

### 7. [TECH-DEBT] `page_history` dual-type user columns

**Where:** 0001_initial_schema.sql.

**What:** `page_history.operator_user_id uuid` (no FK to opollo_users) and `page_history.updated_by text` (free-text, no FK). Two columns that conceptually reference the same "who did this" user, at incompatible types.

**Why it matters:** Today: nothing — table is dead in code. If population arrives later, no one will know which column to fill.

**Fix:** Pick one. If it's an append-only audit log where the user may later be deleted, `updated_by text` with a human-readable handle makes sense and `operator_user_id` should go. If referential integrity matters, keep `operator_user_id` (with FK added) and drop `updated_by`.

---

### 8. [TECH-DEBT] Event-table PK type inconsistency

**What:**
- `generation_events.id bigserial` (M3-1)
- `regeneration_events.id bigserial` (M7-1)
- `transfer_events.id uuid` (M4-1)

Three parallel audit-log tables with different PK types.

**Why it matters:** Hard to standardize tooling on "the event tables." Also means export/partition/rollup queries must branch on table.

**Fix:** Low-priority. If we ever build a unified event stream, this becomes load-bearing. Until then it's cosmetic.

---

### 9. [TECH-DEBT] `version_lock` missing CHECK constraint

**Where:**
- `image_library.version_lock int NOT NULL DEFAULT 1` (M4-1)
- `briefs.version_lock int NOT NULL DEFAULT 1` (M12-1)
- `brief_pages.version_lock int NOT NULL DEFAULT 1` (M12-1)
- `brief_runs.version_lock int NOT NULL DEFAULT 1` (M12-1)
- `site_conventions.version_lock int NOT NULL DEFAULT 1` (M12-1)

Comparison — tables WITH the CHECK:
- `design_systems.version_lock integer NOT NULL DEFAULT 1 CHECK (version_lock >= 1)`
- `design_components.version_lock integer NOT NULL DEFAULT 1 CHECK (version_lock >= 1)`
- `design_templates.version_lock integer NOT NULL DEFAULT 1 CHECK (version_lock >= 1)`
- `pages.version_lock integer NOT NULL DEFAULT 1 CHECK (version_lock >= 1)`
- `tenant_cost_budgets.version_lock int NOT NULL DEFAULT 1 CHECK (version_lock >= 1)`

**Why it matters:** The application never writes `version_lock = 0` deliberately, but a bug that does (e.g., an off-by-one in an optimistic-lock bump) would be silently accepted on the 5 tables without the CHECK and rejected on the 5 with it.

**Fix:** Add `CHECK (version_lock >= 1)` to all 5 missing tables in a single forward-only migration. Safe — no existing rows violate it.

---

### 10. [TECH-DEBT] Lease-coherent CHECK asymmetry

**Where:**
- `transfer_job_items_lease_coherent` (M4-1): `(state='pending' AND worker_id IS NULL AND lease_expires_at IS NULL) OR (state IN ('leased','uploading','captioning','publishing') AND worker_id IS NOT NULL AND lease_expires_at IS NOT NULL) OR (state IN ('succeeded','failed','skipped'))`
- `generation_job_pages_lease_coherent` (M3-1): `(state='pending' AND worker_id IS NULL AND lease_expires_at IS NULL) OR state IN ('leased','generating','validating','publishing','succeeded','failed','skipped')`
- `regeneration_jobs_lease_coherent` (M7-1): same looser shape as M3.

**Why it matters:** M4 enforces that leased rows ALWAYS have worker_id + lease_expires_at set. M3 and M7 do not — they let a row be in `leased` state with null worker_id, which is an invariant the workers rely on for recovery. This class of bug is the one PR #18's self-audit rule is supposed to catch for write-safety-critical milestones.

**Fix:** Tighten M3 and M7 CHECKs to match M4's form. Requires a forward migration. Needs a sweep of existing rows first to make sure no orphan-leased rows are still in the table.

---

### 11. [LATENT-RISK] Dynamic update spreads

**Where:**
- `lib/design-systems.ts:208-215` (`updateDesignSystem`, Q26)
- `lib/components.ts:176-184` (`updateComponent`, Q35)
- `lib/templates.ts` (`updateTemplate`, Q43)

All three do `.update({ ...parsed.data, version_lock: expected + 1 })` where `parsed.data` is the output of a Zod `.parse()` on request body.

**Why it matters:** If the Zod schema diverges from DB columns (a developer adds `foo_new` to Zod without migrating the table), the next PATCH with `foo_new` in the body fails at runtime with `PGRST204` (column not found). Lint + typecheck both pass.

**Fix:** Short-term — unit tests on the three update paths that assert Zod-schema keys ⊆ DB columns. Long-term — the M15-8 type generation work should surface this via `Database["Tables"][...]["Update"]` typing of the Zod output.

---

### 12. [LATENT-RISK] `image_usage` RLS excludes viewer

**Where:** Migration 0010.

**What:** `image_library` and `image_metadata` allow SELECT for `role IN ('admin','operator','viewer')`. `image_usage` allows SELECT only for `role IN ('admin','operator')` — viewers cannot read usage records.

**Why it matters:** If a viewer-role admin UI lands, it'll render image detail pages correctly until they try to display "used on N sites." This surfaces as a silent empty join, not an RLS denial — the join returns 0 rows instead of erroring.

**Fix:** Either align the policy to include `viewer`, or add a comment on the migration explaining the exclusion (if WP media IDs are considered internal plumbing).

---

### 13. [LATENT-RISK] Service-role-only write tables (undocumented)

**What:** These tables have RLS enabled but no authenticated-role INSERT/UPDATE/DELETE policies (only SELECT + service_role_all):
- `generation_jobs`, `generation_job_pages`, `generation_events`
- `transfer_jobs`, `transfer_job_items`, `transfer_events`
- `regeneration_jobs`, `regeneration_events`
- `tenant_cost_budgets`

**Why it matters:** All production writes currently use `getServiceRoleClient()` and bypass RLS — the design is coherent. But a future developer writing an admin surface against one of these tables using `createRouteAuthClient()` will get a 42501 error with no hint that "use service-role for this table" is the answer. The same happens if anyone ever exposes these to the browser via a Supabase client.

**Fix:** Add a comment block at the top of each migration noting "writes happen server-side via service-role; authenticated policies are intentionally absent." Same pattern as the existing comment on `opollo_config`.

---

### 14. [LATENT-RISK] `opollo_config` read is admin-only (undocumented)

**Where:** Migration 0004.

**What:** `opollo_config` has RLS enabled with only `service_role_all` — no authenticated SELECT policy at all. Intentional (prevents enumeration of `first_admin_email`), but the reasoning lives only in migration commit history.

**Fix:** Add a comment in the migration. Low effort, high value for the next person to read this table.

---

## Verification evidence — what I checked and did NOT find

| Check | Result |
|---|---|
| Column references in `.select()` / `.insert()` / `.update()` against non-existent columns | None found |
| Column references in `.eq()` / `.filter()` / `.is()` / `.in()` / `.ilike()` / `.order()` against non-existent columns | None found |
| Table references in `.from()` against tables not in schema | None found |
| Foreign-table joins (`.select("id, rel:other_table!inner(...)")`) against tables not in schema | None found |
| RPC calls against functions not defined in schema | None found — only `activate_design_system` is called, and it's defined |
| Storage buckets referenced in code but not provisioned | None found — only `site-briefs` is used, and it's provisioned in 0013 |
| Enum values used in code that don't exist in the schema ENUMs | None found (checked `site_status`, `health_status`) |
| Check-constraint violations in obvious insert/update paths | None found (status transitions, version_lock bumps all consistent) |
| Stale TypeScript types with `deleted_at?: string \| null` on user-ish rows | None found — no drift there |
| Code that references `deleted_at` on a table that doesn't have it | None — every `deleted_at` hit is on `image_library`, `briefs`, `brief_pages`, or a test/component that references one of those |
| Code that uses authenticated clients on service-role-only tables in production | None — all production writes on generation_*/transfer_*/regen_* use service-role |

---

## What I did NOT cover in this audit

- **Runtime query analysis.** The audit is static — it cross-references source code against migration SQL, not the live database. If the production DB has drifted from migrations (manual ALTER TABLE, Supabase dashboard edits), this audit won't catch it. Recommendation: add a CI check that compares the live schema (via `supabase db diff`) against migrations.
- **Deep raw-`pg` SQL parsing.** Raw `pg.query` usage in `lib/batch-worker.ts`, `lib/batch-publisher.ts`, `lib/transfer-worker.ts`, `lib/tenant-budgets.ts`, `lib/auth-revoke.ts`, `lib/regeneration-publisher.ts`, `lib/batch-jobs.ts` was surveyed but not parsed statement-by-statement. Sample checks (SELECT columns, INSERT columns, UPDATE targets) matched schema, but a query-level parse across these files is a separate slice if warranted.
- **Migration ordering / rollback verification.** Migration sequence 0001-0013 was treated as canonical. Rollback scripts exist at `supabase/rollbacks/0013_m12_1_briefs_schema.down.sql` but weren't audited for correctness.
- **`supabase/data-migrations/` folder is empty** — no seed data drift to check.
- **Live RLS evaluation.** RLS policies are read from migrations; I didn't run them against sample queries to verify they actually admit/reject the expected rows. The M2b/M4/M7/M12 RLS tests do this at test time.
- **Cross-branch audit.** Only the current checkout (branch `fix/m14-1-opollo-users-deleted-at`) was scanned. If other branches have pending schema changes, they're not in scope.

---

## Files produced

- `docs/SCHEMA_AUDIT_2026-04-24.md` (this file)
- `docs/_audit_scratch/canonical_schema.md` (~1400 lines; ground-truth schema)
- `docs/_audit_scratch/code_queries.md` (~1870 lines; every query usage)
- `docs/_audit_scratch/_extract.js` (one-shot script that decoded the persisted-output JSON; safe to delete after M15-6)

Scratch files are inputs to M15-3..M15-6 as well — keep them around; I'll clean `docs/_audit_scratch/` up after M15-6 lands.

---

## Awaiting your review

I am NOT starting M15-3 (env var audit) until you respond. Triggers for pause:
- [x] **More than 10 findings** — 14 items, needs prioritization discussion.
- [ ] Production-breaking bug found — no; the one known case is covered by M15-1.
- [ ] Need external data — no.

When you respond, the useful signals for me are: (a) which of the 14 items you want escalated into M15-7 immediate fixes vs pushed to BACKLOG, and (b) whether to proceed to M15-3.
