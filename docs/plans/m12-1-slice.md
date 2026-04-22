# M12-1 — Slice plan: schema + upload + parser + operator commit

Canonical sub-slice plan for M12-1. Parent plan: `docs/plans/m12-parent.md`. This document is the executable spec — every column, route, state, and test case M12-1 must land lives here.

**Status:** planning only. No code will be written on this PR. Execution happens on a follow-up PR branched off main once this doc is merged.

**Scope as agreed with Steven (pre-build audit):**
- All four tables land in a single migration (`briefs`, `brief_pages`, `brief_runs`, `site_conventions`). The parent plan split `site_conventions` into M12-2 as a JSONB column on `briefs`; M12-1 consolidates it as its own table so M12-2 + M12-3 are purely app-layer slices.
- Upload route is `POST /api/briefs/upload` (parent plan said `/api/sites/[id]/briefs`; consolidated to a single endpoint that reads `site_id` from the multipart body).
- Commit UI is `/admin/sites/[id]/briefs/[brief_id]/review` (parent plan said `/admin/sites/[id]/briefs/[briefId]`; `/review` suffix is the operator surface, freeing the base path for a future list view).

---

## 1. Migration reservation

**Reserved:** `supabase/migrations/0013_m12_1_briefs_schema.sql`

Latest migration on main is `0012_m8_1_tenant_cost_budgets.sql`. `0013` is the next sequential slot.

Companion files per `docs/patterns/new-migration.md`:
- `supabase/rollbacks/0013_m12_1_briefs_schema.down.sql`
- `lib/__tests__/m12-1-schema.test.ts` (constraint + cascade tests)
- `lib/__tests__/m12-1-rls.test.ts` (role × table × op matrix — see §7)

`docs/WORK_IN_FLIGHT.md` carries the reservation until the forward PR merges.

---

## 2. Schema — four tables

All four tables follow `docs/DATA_CONVENTIONS.md`: audit columns (`created_at`, `updated_at`, `created_by`, `updated_by`), soft-delete (`deleted_at`, `deleted_by`), and `version_lock` where the operator can concurrently edit. `ENABLE ROW LEVEL SECURITY` + `service_role_all` + at least one authenticated-role policy per `docs/patterns/new-migration.md`.

### 2.1 `briefs`

Parent row. One per uploaded document. Holds metadata + Storage pointer + parse state.

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK. |
| `site_id` | `uuid` | NOT NULL | — | FK → `sites(id)` ON DELETE CASCADE. |
| `title` | `text` | NOT NULL | — | Operator-facing label. Defaults to uploaded filename; editable in review UI. |
| `status` | `text` | NOT NULL | `'parsing'` | `CHECK (status IN ('parsing', 'parsed', 'committed', 'failed_parse'))`. `parsing` → runs the parser. `parsed` → awaits operator review. `committed` → list frozen, runner can start. `failed_parse` → parser surfaced an unrecoverable error. |
| `source_storage_path` | `text` | NOT NULL | — | `site-briefs/<site_id>/<brief_id>.md`. UNIQUE at schema level. |
| `source_mime_type` | `text` | NOT NULL | — | `CHECK (source_mime_type IN ('text/plain', 'text/markdown'))`. Stretch PDF/.docx adds values via follow-up migration. |
| `source_size_bytes` | `bigint` | NOT NULL | — | `CHECK (source_size_bytes > 0 AND source_size_bytes <= 10485760)` — 10 MB hard cap. |
| `source_sha256` | `text` | NOT NULL | — | Hex digest of the uploaded bytes. Populated by the upload route pre-insert. |
| `upload_idempotency_key` | `text` | NOT NULL | — | See §4 for construction. UNIQUE at schema level. |
| `parser_mode` | `text` | NULL | — | `CHECK (parser_mode IS NULL OR parser_mode IN ('structural', 'claude_inference'))`. NULL until parsing completes. |
| `parser_warnings` | `jsonb` | NOT NULL | `'[]'::jsonb` | Non-fatal issues surfaced to operator (malformed fences, dropped inference entries, etc.). |
| `parse_failure_code` | `text` | NULL | — | Populated when `status='failed_parse'`. Codes: `EMPTY_DOCUMENT`, `NO_PARSABLE_STRUCTURE`, `INFERENCE_FALLBACK_FAILED`. |
| `parse_failure_detail` | `text` | NULL | — | Human-readable detail. |
| `committed_at` | `timestamptz` | NULL | — | Set atomically when operator commits. |
| `committed_by` | `uuid` | NULL | — | FK → `opollo_users(id)` ON DELETE SET NULL. |
| `committed_page_hash` | `text` | NULL | — | sha256 of the ordered `brief_pages` list at commit time. See §6 (idempotency). |
| `version_lock` | `int` | NOT NULL | `1` | Bumped on every operator edit. |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |
| `updated_at` | `timestamptz` | NOT NULL | `now()` | App-set, not trigger. |
| `deleted_at` | `timestamptz` | NULL | — | Soft delete. |
| `created_by` | `uuid` | NULL | — | FK → `opollo_users(id)` ON DELETE SET NULL. |
| `updated_by` | `uuid` | NULL | — | FK → `opollo_users(id)` ON DELETE SET NULL. |
| `deleted_by` | `uuid` | NULL | — | FK → `opollo_users(id)` ON DELETE SET NULL. |

**Constraints / indexes:**

- `PRIMARY KEY (id)`
- `UNIQUE (source_storage_path)` — one brief per Storage object.
- `UNIQUE (upload_idempotency_key)` — Stripe-style replay semantics.
- `CHECK (committed_at IS NULL) = (status <> 'committed')` — coherence: `committed_at` set iff status is `committed`.
- `CHECK (committed_page_hash IS NULL) = (status <> 'committed')` — same shape for the hash.
- `INDEX idx_briefs_site_created ON briefs (site_id, created_at DESC) WHERE deleted_at IS NULL` — drives the site-scoped list query in the admin UI.
- `INDEX idx_briefs_site_status ON briefs (site_id, status) WHERE deleted_at IS NULL` — powers the "awaiting commit" and "running" filters.

**RLS:**

- `ENABLE ROW LEVEL SECURITY`
- `service_role_all FOR ALL TO service_role USING (true) WITH CHECK (true)` — all API routes hit this via `getServiceRoleClient()` after the admin gate.
- `briefs_read FOR SELECT TO authenticated USING (public.auth_role() IN ('admin', 'operator', 'viewer'))` — mirrors `sites_read`. Scoping is by `site_id` at the app layer; RLS gates the role band.
- `briefs_write FOR ALL TO authenticated USING (public.auth_role() IN ('admin', 'operator')) WITH CHECK (public.auth_role() IN ('admin', 'operator'))` — viewers read, operators + admins mutate.

### 2.2 `brief_pages`

One row per parsed page in a brief. Editable by the operator until commit; frozen thereafter (guarded in app layer + the commit idempotency key).

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK. |
| `brief_id` | `uuid` | NOT NULL | — | FK → `briefs(id)` ON DELETE CASCADE. |
| `ordinal` | `int` | NOT NULL | — | 0-indexed position in the page list. `CHECK (ordinal >= 0)`. |
| `title` | `text` | NOT NULL | — | Editable page title. Seeded from parsed H2 or the inference-returned label. |
| `slug_hint` | `text` | NULL | — | Operator-supplied URL slug. Null until operator sets it; the runner (M12-3) can default it from the title. |
| `mode` | `text` | NOT NULL | — | `CHECK (mode IN ('full_text', 'short_brief'))`. Parser infers; operator can flip. |
| `source_span_start` | `int` | NULL | — | Byte offset into the source doc where this page's section begins. NULL when the inference fallback produced the entry (no span). |
| `source_span_end` | `int` | NULL | — | Matching end offset. `CHECK (source_span_end IS NULL OR source_span_end > source_span_start)`. |
| `source_text` | `text` | NOT NULL | — | The extracted section of the brief this page is about. For `full_text` mode this is the complete section (≥ 400 words per parent plan); for `short_brief` this is the summary snippet. Read verbatim by the runner. |
| `word_count` | `int` | NOT NULL | — | Pre-computed on insert. `CHECK (word_count >= 0)`. Drives the mode inference default and the UI's `full_text` / `short_brief` toggle hint. |
| `operator_notes` | `text` | NULL | — | Operator-added context for the runner (M12-3 reads this into the page-spec). |
| `version_lock` | `int` | NOT NULL | `1` | Bumped on every operator edit. |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |
| `updated_at` | `timestamptz` | NOT NULL | `now()` | |
| `deleted_at` | `timestamptz` | NULL | — | |
| `created_by` | `uuid` | NULL | — | FK → `opollo_users(id)` ON DELETE SET NULL. |
| `updated_by` | `uuid` | NULL | — | FK → `opollo_users(id)` ON DELETE SET NULL. |
| `deleted_by` | `uuid` | NULL | — | FK → `opollo_users(id)` ON DELETE SET NULL. |

**M12-3 will ADD (not in M12-1):** `draft_html text`, `generated_html text`, `critique_log jsonb`, `current_pass_kind text`, `current_pass_number int`, `status text` (pending/generating/awaiting_review/approved/failed/cancelled). M12-1 deliberately stops at the pre-runner shape — simpler review, less rework.

**Constraints / indexes:**

- `PRIMARY KEY (id)`
- `UNIQUE (brief_id, ordinal)` — no duplicate positions within a brief. Gap rows are allowed (ordinal 0, 2, 3 without 1 is fine — the runner reads ORDER BY ordinal).
- `INDEX idx_brief_pages_brief_ordinal ON brief_pages (brief_id, ordinal) WHERE deleted_at IS NULL` — the hot-path query for both the review UI and the runner's "next page" lookup. Parent plan §EXPLAIN ANALYZE requirement names this.

**RLS:**

- `ENABLE ROW LEVEL SECURITY`
- `service_role_all FOR ALL TO service_role USING (true) WITH CHECK (true)`
- `brief_pages_read FOR SELECT TO authenticated USING (public.auth_role() IN ('admin', 'operator', 'viewer'))`
- `brief_pages_write FOR ALL TO authenticated USING (public.auth_role() IN ('admin', 'operator')) WITH CHECK (public.auth_role() IN ('admin', 'operator'))`

### 2.3 `brief_runs`

Scaffolding table. M12-1 creates it empty; M12-3 is the code that inserts + leases. Landing the schema now means M12-3 is purely app-layer.

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK. |
| `brief_id` | `uuid` | NOT NULL | — | FK → `briefs(id)` ON DELETE CASCADE. |
| `status` | `text` | NOT NULL | `'queued'` | `CHECK (status IN ('queued', 'running', 'paused', 'succeeded', 'failed', 'cancelled'))`. `paused` is the pause-mode-only review state (operator approval pending). |
| `current_ordinal` | `int` | NULL | — | The page index the runner is currently on. NULL when `status='queued'`. `CHECK (current_ordinal IS NULL OR current_ordinal >= 0)`. |
| `worker_id` | `text` | NULL | — | Lease holder. |
| `lease_expires_at` | `timestamptz` | NULL | — | Lease expiry. |
| `last_heartbeat_at` | `timestamptz` | NULL | — | Refreshed every 30s. |
| `started_at` | `timestamptz` | NULL | — | First transition to `running`. |
| `finished_at` | `timestamptz` | NULL | — | Terminal transition. |
| `failure_code` | `text` | NULL | — | Populated on `status='failed'`. Codes reserved: `ANCHOR_FAILED`, `BUDGET_EXCEEDED`, `BRIEF_TOO_LARGE`, `WORKER_CRASH`. |
| `failure_detail` | `text` | NULL | — | |
| `cancel_requested_at` | `timestamptz` | NULL | — | |
| `version_lock` | `int` | NOT NULL | `1` | |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |
| `updated_at` | `timestamptz` | NOT NULL | `now()` | |
| `deleted_at` | `timestamptz` | NULL | — | |
| `created_by` | `uuid` | NULL | — | FK → `opollo_users(id)` ON DELETE SET NULL. |
| `updated_by` | `uuid` | NULL | — | FK → `opollo_users(id)` ON DELETE SET NULL. |
| `deleted_by` | `uuid` | NULL | — | FK → `opollo_users(id)` ON DELETE SET NULL. |

**Constraints / indexes:**

- `PRIMARY KEY (id)`
- `UNIQUE INDEX brief_runs_one_active_per_brief ON brief_runs (brief_id) WHERE status IN ('queued', 'running', 'paused')` — the concurrency keystone from parent plan §Sequential runner concurrency. At most one non-terminal run per brief. Second enqueue raises 23505; the API surfaces `BRIEF_RUN_ALREADY_ACTIVE`.
- `INDEX idx_brief_runs_leasable ON brief_runs (lease_expires_at NULLS FIRST) WHERE status IN ('queued', 'running')` — drives `FOR UPDATE SKIP LOCKED` dequeue in M12-3.
- `INDEX idx_brief_runs_brief_created ON brief_runs (brief_id, created_at DESC) WHERE deleted_at IS NULL` — history view.
- `CHECK (brief_runs_lease_coherent)` — `(status = 'queued' AND worker_id IS NULL AND lease_expires_at IS NULL) OR status IN ('running', 'paused', 'succeeded', 'failed', 'cancelled')`. Mirrors the M3 / M7 lease-coherence constraint.

**RLS:** same shape as `briefs` (service-role-all + read for all authenticated roles + write for admin/operator).

### 2.4 `site_conventions`

Per-brief, not per-site. Captures the frozen design+content conventions promoted from page 1's anchor cycle (M12-2/M12-3). M12-1 creates an empty table; no row is written until the runner lands.

**Why per-brief not per-site:** the anchor cycle stabilises conventions *for this document's voice and direction*. A second brief on the same site may deliberately pick a different tone (launch page vs evergreen content). Per-brief keeps the conventions scoped to the document they came from. A future consolidation into a per-site "default conventions" row can layer on top.

| Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- |
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` | PK. |
| `brief_id` | `uuid` | NOT NULL | — | FK → `briefs(id)` ON DELETE CASCADE. UNIQUE — one conventions row per brief. |
| `typographic_scale` | `text` | NULL | — | e.g. `'compact'`, `'generous'`, `'display-first'`. Free text in M12-1; M12-2 adds a `CHECK (... IN (...))` once the enum is locked from eval experiments. |
| `section_rhythm` | `text` | NULL | — | e.g. `'alternating'`, `'stacked'`, `'sectioned-with-rule'`. Same M12-2 enum-lock intent. |
| `hero_pattern` | `text` | NULL | — | e.g. `'centered-text'`, `'split-image'`, `'full-bleed-video'`. |
| `cta_phrasing` | `jsonb` | NULL | — | Structured: primary CTA verb+object, secondary CTA, tone-of-address (`'we/you'`, `'third-person'`). |
| `color_role_map` | `jsonb` | NULL | — | Mapping from the site's DS palette tokens to semantic roles (`primary-surface`, `accent`, `muted`). Preserved verbatim into pages 2..N. |
| `tone_register` | `text` | NULL | — | `'formal'`, `'confident-casual'`, `'playful'`, etc. |
| `additional` | `jsonb` | NOT NULL | `'{}'::jsonb` | Escape hatch for conventions the anchor cycle discovers that don't fit the columns above. Parent plan's "stored exact (structured JSONB, not prose)" contract applies. |
| `frozen_at` | `timestamptz` | NULL | — | Set by the runner when the anchor cycle completes. NULL until then. Fresh rows are written first; `frozen_at` flips during a single UPDATE under `version_lock`. |
| `version_lock` | `int` | NOT NULL | `1` | Anchor-promotion UPDATE predicates on this. Concurrent runner claims lose the second UPDATE. |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |
| `updated_at` | `timestamptz` | NOT NULL | `now()` | |
| `deleted_at` | `timestamptz` | NULL | — | |
| `created_by` | `uuid` | NULL | — | FK → `opollo_users(id)` ON DELETE SET NULL. Worker writes leave this NULL. |
| `updated_by` | `uuid` | NULL | — | |
| `deleted_by` | `uuid` | NULL | — | |

**Constraints / indexes:**

- `PRIMARY KEY (id)`
- `UNIQUE (brief_id)` — enforces the one-conventions-row-per-brief invariant at the schema layer.

**RLS:** same shape as `briefs`.

---

## 3. Storage bucket

**Bucket:** `site-briefs`

Provisioned in the same migration via `storage.buckets` insert (see `supabase/migrations/0010_m4_1_image_library_schema.sql` for the canonical shape). Settings:

- `public = false` — no public reads. All access goes through service-role.
- `file_size_limit = 10485760` (10 MB). Matches the `briefs.source_size_bytes` CHECK ceiling.
- `allowed_mime_types = ARRAY['text/plain', 'text/markdown']`.

**Storage RLS policies** (in the `storage.objects` table):

- `site_briefs_service_role_all FOR ALL TO service_role USING (bucket_id = 'site-briefs') WITH CHECK (bucket_id = 'site-briefs')` — upload route writes here after the admin gate.
- `site_briefs_authed_read FOR SELECT TO authenticated USING (bucket_id = 'site-briefs' AND public.auth_role() IN ('admin', 'operator', 'viewer'))` — defence-in-depth. The admin UI downloads via the service-role helper, but if a signed URL is ever issued the role band still applies.
- No `INSERT` / `UPDATE` / `DELETE` policies for authenticated — uploads flow through the API route, not direct Storage.

**Object naming:** `<site_id>/<brief_id>.md`. The `source_storage_path` column on `briefs` carries the full path; keeping it explicit (not derived) means a rename in the future is a data migration, not a silent drift.

**Retention:** none. Briefs are operator-owned content; the soft-delete lifecycle on `briefs` is the retention mechanism. Storage objects are removed when a brief is hard-deleted (M12 does not ship a hard-delete path; deferred).

---

## 4. Upload API route

**Path:** `POST /api/briefs/upload`

Deviation from the parent plan's `/api/sites/[id]/briefs` shape logged at the top of this doc: a single endpoint reads `site_id` from the multipart body. Rationale: the upload flow is invoked from a modal that already has the site in its React tree; the URL path carrying `site_id` adds no authorization value (the admin gate + `site_id` ownership check is the same either way).

**Auth:** `requireAdminForApi({ roles: ['admin', 'operator'] })`. Viewers cannot upload.

**Site ownership:** the route additionally verifies the authenticated user has access to `site_id`. In the current single-tenant admin, any `admin` / `operator` can reach any site, but we wire the check explicitly so a future tenant-scoped version doesn't need a retrofit. Failure → `FORBIDDEN`.

### Request shape

`Content-Type: multipart/form-data`.

Fields:

| Field | Type | Required | Validation |
| --- | --- | --- | --- |
| `file` | `File` | yes | MIME must be `text/plain` or `text/markdown`. Size ≤ 10485760 bytes. |
| `site_id` | `uuid` string | yes | Zod UUID. Route verifies site exists + not soft-deleted. |
| `title` | string | no | Defaults to `file.name` with the extension stripped. Max 200 chars. |
| `idempotency_key` | string | no | Client-supplied idempotency key. When present, replaces the server-computed key (§below). Max 100 chars. |

### Idempotency

**Server-computed key (default):** `sha256(site_id || ':' || uploaded_by || ':' || file_sha256).hex().slice(0, 64)`.

- Two uploads of the same file by the same operator on the same site produce the same key → replay-safe. The second request reads the existing `briefs` row, asserts the `source_sha256` matches, and returns the existing `brief_id` with HTTP 200 (not 201).
- `site_id` + `uploaded_by` in the key prevents cross-tenant / cross-operator collisions of an identical file.
- The stored key is a `UNIQUE` column on `briefs`; a concurrent double-submit catches 23505 and short-circuits to the replay path.

**Client-supplied key:** when `idempotency_key` is in the body, it is used directly. Same replay semantics. If the same key arrives with a *different* file SHA → `IDEMPOTENCY_KEY_CONFLICT` (HTTP 422).

### Response shape

**Success — HTTP 201 (new) or 200 (replay):**

```json
{
  "ok": true,
  "data": {
    "brief_id": "uuid",
    "site_id": "uuid",
    "status": "parsing" | "parsed" | "failed_parse",
    "parser_mode": null | "structural" | "claude_inference",
    "review_url": "/admin/sites/<site_id>/briefs/<brief_id>/review",
    "replay": true | false
  },
  "timestamp": "2026-04-23T06:30:00.000Z"
}
```

Parse runs synchronously inside the request when the file is small enough to finish under the 10s Vercel function budget; the route returns `status='parsed'` and `parser_mode` populated. For oversized-but-under-cap files where Claude inference is needed, the parse runs in the same request (inference tokens are within budget at 60k input cap). No background job is introduced in M12-1.

**Error envelopes — HTTP 4xx:**

| HTTP | Code | When |
| --- | --- | --- |
| 400 | `VALIDATION_FAILED` | Zod rejects the body; missing `file` or `site_id`; malformed UUID. |
| 400 | `BRIEF_EMPTY` | File is 0 bytes or contains only whitespace. |
| 401 | `UNAUTHORIZED` | No session. |
| 403 | `FORBIDDEN` | Wrong role or site not accessible. |
| 404 | `NOT_FOUND` | `site_id` doesn't exist or is soft-deleted. |
| 413 | `BRIEF_TOO_LARGE` | File > 10 MB OR parsed content > 60k token cap (detected post-parse). |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | MIME not in the allowed list. |
| 422 | `IDEMPOTENCY_KEY_CONFLICT` | Same key, different file SHA. |
| 500 | `INTERNAL_ERROR` | Storage write failure, DB failure, parser crash. |

Add `BRIEF_EMPTY`, `BRIEF_TOO_LARGE`, `BRIEF_RUN_ALREADY_ACTIVE` to `lib/tool-schemas.ts` `errorCodeToStatus`.

### Write order

1. Compute `file_sha256` from the request bytes.
2. Compute idempotency key.
3. SELECT existing `briefs` row by `upload_idempotency_key`. If present + same `source_sha256` → return replay envelope. Same key + different SHA → `IDEMPOTENCY_KEY_CONFLICT`.
4. Upload bytes to Storage at `<site_id>/<brief_id>.md` using a pre-generated UUID.
5. INSERT `briefs` row with `status='parsing'`, `source_storage_path`, `source_size_bytes`, `source_sha256`, `upload_idempotency_key`, `created_by=auth.uid()`.
6. Invoke `lib/brief-parser.ts::parseBrief(brief_id)` synchronously.
7. Parser updates `briefs.status` to `parsed` (or `failed_parse`) + inserts `brief_pages` rows in one transaction.
8. Respond.

Step 4 → step 5 race: if Storage write succeeds but the DB INSERT fails, the Storage object is orphaned. Acceptable for M12-1 because the upload route is idempotent on retry — the second call with the same key re-INSERTs (since no row exists yet) and overwrites the Storage object. A janitor path to sweep orphaned objects lands with the hard-delete slice (deferred, tracked in BACKLOG).

### Revalidation

Route calls `revalidatePath('/admin/sites/${site_id}/briefs')` after successful insert so the list view picks up the new row.

---

## 5. Parser behaviour spec (`lib/brief-parser.ts`)

Signature: `parseBrief(brief_id: string): Promise<ApiResponse<{ parser_mode: 'structural' | 'claude_inference', pages: BriefPageDraft[], warnings: ParserWarning[] }>>`.

### 5.1 Structural-first path

Runs first. Returns success if any of the following extract ≥ 1 page:

1. **Markdown H2 delimiters (primary):** every `## <title>` line starts a new page. Content between one H2 and the next (or EOF) is the page's `source_text`. `word_count` is the split-by-whitespace length of `source_text`. Mode is `full_text` when `word_count >= 400`, otherwise `short_brief`.
2. **Markdown H1 delimiters (fallback):** if the document has no H2s but has ≥ 2 H1s, treat H1s the same way. (A single H1 is the doc title, not a page delimiter.)
3. **`---` separator:** hrule-separated blocks are pages. The first non-empty line of each block becomes the title; everything else is `source_text`.
4. **Numbered "Page N:" headers:** lines matching `/^Page\s+\d+\s*:\s*(.+)$/m` are delimiters. The matched group is the title.

Parser records which path fired in `parser_mode='structural'` and which rule in `parser_warnings` (informational, not fatal).

Each page entry carries `source_span_start` + `source_span_end` = byte offsets into the source bytes. These are load-bearing: parent plan risk #2 (hallucinated pages) is mitigated by the UI displaying the cited span for every entry.

### 5.2 Claude-inference fallback

Fires when structural-first returns zero pages. Calls Claude once with:

- `<brief_document>` tagged input (full source).
- System prompt instructing "return JSON array `[{ title, source_quote, mode }]` where `source_quote` is a verbatim substring from the document ≥ 50 chars".
- Idempotency key per parent plan risk #6: `sha256('brief-parse:' + brief_id + ':' + source_sha256)`. Stored on the Anthropic call via `traceAnthropicCall` + Anthropic's `idempotency_key` header. Retries return the cached response.

Post-processing:

- Each returned entry's `source_quote` is searched in the source text via exact-match indexOf. Entries without a matching span are **dropped** (not surfaced) and a warning is appended.
- `source_span_start` / `source_span_end` are the match offsets.
- `source_text` is the source substring from the match start through the start of the next entry's match (or EOF for the last entry).
- Mode is inferred the same way as structural (word count ≥ 400 → `full_text`).

If every inference entry fails validation → `parse_failure_code='INFERENCE_FALLBACK_FAILED'`, `briefs.status='failed_parse'`, no `brief_pages` rows inserted. Operator sees an error state in the review UI with the failure detail + a "re-upload" CTA.

### 5.3 Behaviour matrix (required tests in §7)

| Input | Path | Outcome |
| --- | --- | --- |
| Valid markdown with ≥ 1 `##` | structural (H2) | N pages, warnings empty. |
| Valid markdown with 0 `##` but ≥ 2 `#` | structural (H1-fallback) | N pages. |
| Valid markdown with `---` rules | structural (hrule) | N pages. |
| `Page 1: Foo\n...\nPage 2: Bar\n...` | structural (numbered) | 2 pages. |
| Plain prose, no headings or rules | inference fallback | N ≥ 0 pages (dropped entries warned). |
| Empty document (0 bytes or whitespace-only) | rejected at upload | `BRIEF_EMPTY` (HTTP 400); no `briefs` row written. |
| Oversized document (> 10 MB) | rejected pre-upload | `BRIEF_TOO_LARGE` (HTTP 413); no Storage write. |
| Markdown with unclosed code fence | best-effort structural | Fence content is treated as prose; `parser_warnings` carries `UNCLOSED_CODE_FENCE`. Pages still emit. |
| Markdown with YAML frontmatter that's malformed | best-effort | Frontmatter block stripped with `MALFORMED_FRONTMATTER` warning; remaining doc parses normally. |
| Inference returns entries with no matching span | drop + warn | Dropped entries logged in `parser_warnings`; remaining entries committed. If *all* are dropped → `INFERENCE_FALLBACK_FAILED`. |
| Oversized-under-cap: file size OK but content > 60k input tokens for downstream runner | rejected post-parse | `BRIEF_TOO_LARGE`; `briefs.status='failed_parse'`, `parse_failure_code='BRIEF_TOO_LARGE'`. Operator re-uploads a shorter version. |

### 5.4 Warnings vocabulary

Warnings are non-fatal; surfaced in the review UI as yellow banners above the page list. Codes:

- `UNCLOSED_CODE_FENCE`
- `MALFORMED_FRONTMATTER`
- `INFERENCE_ENTRY_DROPPED` (with dropped title + reason)
- `HEADING_HIERARCHY_SKIPPED` (H1 followed by H3 with no H2, etc.)
- `TRAILING_EMPTY_SECTION` (a delimiter with no content after it)

---

## 6. Operator commit UI

**Route:** `/admin/sites/[id]/briefs/[brief_id]/review`

Implemented as a Server Component with a Client Component boundary for the editable page list. Follows `docs/patterns/new-admin-page.md` + `docs/patterns/assistive-operator-flow.md`.

### 6.1 States

| State | When | UI |
| --- | --- | --- |
| `loading` | Initial fetch of `briefs` + `brief_pages`. | Skeleton list. |
| `parsing` | `briefs.status='parsing'` (polled every 2s while in this state; parse is synchronous in M12-1 so this should flash, but exists for resilience). | Banner: "Reading your brief…". |
| `parsed` | `briefs.status='parsed'`. Editable page list. | Heading + warnings banner + page-list editor + "Commit & unlock runner" CTA. |
| `committing` | POST `/api/briefs/[brief_id]/commit` in flight. | CTA disabled, inline spinner; rest of form read-only. |
| `committed` | `briefs.status='committed'`. | Read-only page list + "Start generation run" CTA (the M12-5 surface — disabled in M12-1, with a "Available in M12-5" tooltip). |
| `failed_parse` | `briefs.status='failed_parse'`. | Red banner with `parse_failure_detail` + "Re-upload" CTA that returns to the upload modal. |
| `error` | Fetch failure or commit endpoint returned an error. | Inline error with the translated message + retry CTA. |

### 6.2 Editable page list (state: `parsed`)

Each row shows:

- Ordinal (drag handle reorders; ordinal re-numbered on save).
- Title (inline-editable text input).
- Mode pill (`Full text` / `Short brief`) with a click-to-flip toggle and a ⓘ tooltip: "Full text means the brief contains the entire page copy. Short brief means only the outline — the runner will expand it."
- Word count (read-only).
- Source span preview: first 120 chars of `source_text` + "Show full source" toggle. This is the anti-hallucination surface — every page points to the verbatim text it came from.
- "Add page above" / "Add page below" / "Remove" row actions.

Page operations mutate locally; the "Commit" button is the only persistence surface. A "Save draft" secondary button persists edits to `brief_pages` under `version_lock` without flipping `briefs.status` — lets the operator leave and come back.

### 6.3 Confirmation modal

Per `docs/patterns/assistive-operator-flow.md` §"Destructive / billing actions": commit is one-way and unlocks a billed runner, so confirmation names the consequence.

Modal copy:

> **Commit this page list?**
>
> After committing, the page list is locked. You won't be able to reorder or edit pages without cancelling the run and starting a new brief.
>
> You'll then be able to start a generation run from this brief. Starting the run will spend Anthropic tokens — the brief runner makes up to 5 Claude calls per page. Estimated cost shown on the run surface.
>
> **Committing:** `N` pages, first page is "`<first page title>`".
>
> [Cancel] [Commit page list]

### 6.4 Commit endpoint

**Path:** `POST /api/briefs/[brief_id]/commit`.

Auth: admin + operator. Site ownership verified.

Request body:

```json
{
  "expected_version_lock": 3,
  "page_hash": "<sha256 of the ordered brief_pages JSON>"
}
```

`page_hash` is computed client-side as `sha256(JSON.stringify(pages.map(p => ({ ordinal: p.ordinal, title: p.title, mode: p.mode, source_sha256: sha256(p.source_text) }))))`. It is the commit idempotency key: a second commit request with the same hash is a replay (returns the original success envelope); a second request with a *different* hash means the operator edited after reading → `VERSION_CONFLICT` (HTTP 409), operator refreshes and retries.

Server-side commit:

1. Begin transaction.
2. SELECT `briefs` FOR UPDATE WHERE `id = brief_id AND version_lock = expected_version_lock AND status = 'parsed'`. Zero rows → `VERSION_CONFLICT`.
3. Recompute `page_hash` from the current `brief_pages` rows; compare to the submitted hash. Mismatch → `VERSION_CONFLICT`.
4. UPDATE `briefs` SET `status='committed'`, `committed_at=now()`, `committed_by=auth.uid()`, `committed_page_hash=<recomputed>`, `version_lock=version_lock+1`.
5. Commit transaction.
6. `revalidatePath` the review URL.

Idempotency replay: if step 2 finds the brief already `committed` and `committed_page_hash` matches the incoming `page_hash` → return success envelope with `replay: true`. Different hash → `ALREADY_EXISTS` (409) with a translated message ("This brief is already committed. Start a new brief to change the page list.").

### 6.5 Error surfacing

Every error goes through `lib/error-translations.ts` per `docs/patterns/assistive-operator-flow.md`. New translation entries land with this slice:

- `BRIEF_EMPTY` → "Your brief is empty. Upload a file with content and try again."
- `BRIEF_TOO_LARGE` → "That brief is too large. The 10 MB / 60k-token cap is there so the generator can keep the whole document in context. Trim it and try again."
- `IDEMPOTENCY_KEY_CONFLICT` → "We've already stored a different brief with this idempotency key. Refresh and upload again without supplying a key."
- `VERSION_CONFLICT` (on commit) → "Someone else edited this brief's page list while you were reviewing. Refresh to see the latest version, then commit."
- `ALREADY_EXISTS` (on commit replay with hash mismatch) → "This brief is already committed. Start a new brief to change the page list."
- `NO_PARSABLE_STRUCTURE` / `INFERENCE_FALLBACK_FAILED` → "We couldn't find pages in your brief. Try separating pages with `## Page title` headings or `---` lines, then re-upload."

---

## 7. Test coverage targets

### 7.1 Migration tests — `lib/__tests__/m12-1-schema.test.ts`

Constraint + cascade tests, no RLS (RLS has its own file):

1. Happy-path INSERT of one `briefs` row + three `brief_pages` rows + one `brief_runs` row + one `site_conventions` row with service-role client.
2. `UNIQUE (source_storage_path)` rejects a duplicate path (23505).
3. `UNIQUE (upload_idempotency_key)` rejects a duplicate key (23505).
4. `UNIQUE (brief_id, ordinal)` on `brief_pages` rejects a duplicate position (23505).
5. `UNIQUE (brief_id)` on `site_conventions` rejects a second conventions row (23505).
6. Partial unique index `brief_runs_one_active_per_brief` rejects a second `status IN ('queued','running','paused')` row; *allows* a second row after the first flips to `succeeded` / `failed` / `cancelled`.
7. Coherence `CHECK` on `briefs` rejects `status='committed' AND committed_at IS NULL`.
8. Coherence `CHECK` on `briefs` rejects `status='parsing' AND committed_at IS NOT NULL`.
9. `CHECK` on `briefs.source_size_bytes` rejects 0 and rejects 10485761.
10. `CHECK` on `briefs.source_mime_type` rejects `'application/pdf'` in M12-1.
11. `CHECK` on `brief_pages.mode` rejects `'unknown'`.
12. `CHECK` on `brief_runs_lease_coherent` rejects `status='queued' AND worker_id IS NOT NULL`.
13. FK cascade: delete the parent `briefs` row → `brief_pages`, `brief_runs`, `site_conventions` rows all go.
14. FK SET NULL: soft-deleting an `opollo_users` row nulls `created_by` / `updated_by` / `deleted_by` / `committed_by` columns on the four tables.

### 7.2 RLS tests — `lib/__tests__/m12-1-rls.test.ts`

Full `docs/patterns/rls-policy-test-matrix.md` grid. Rows: `admin` / `operator` / `viewer`. Columns: `SELECT` / `INSERT` / `UPDATE` / `DELETE`. Tables: `briefs`, `brief_pages`, `brief_runs`, `site_conventions`.

That's 4 roles × 4 tables × 4 ops = 64 cells; viewer writes are denies (42501 on INSERT, 0-row filter on UPDATE/DELETE), admin + operator writes are allows. Per the pattern's "one `it` per cell" rule, the file ships 64 tests.

Additional:

65. Service-role bypasses RLS for all four tables (one test per table; 4 more).
66. `authenticated-no-role` (authenticated user without an `opollo_users` row) gets deny on every op (sanity — `public.auth_role()` returns NULL).

### 7.3 Parser unit tests — `lib/__tests__/brief-parser.test.ts`

Table-driven fixtures under `lib/__tests__/__fixtures__/briefs/`:

1. `valid-h2.md` — 5 `## ` sections → 5 pages, modes inferred by word count.
2. `valid-hrule.md` — 3 sections separated by `---` → 3 pages.
3. `valid-numbered.md` — `Page 1: Home\n...\nPage 2: About\n...` → 2 pages.
4. `valid-h1-fallback.md` — 3 `# ` (no H2) → 3 pages via H1-fallback.
5. `empty.md` — 0 bytes → parser returns a special "empty" result; upload route rejects with `BRIEF_EMPTY` before calling the parser. Test asserts the route-layer rejection, parser is not invoked.
6. `oversized.md` — 10_485_761 bytes → upload route rejects with `BRIEF_TOO_LARGE` before calling the parser (pre-Storage-write). Test asserts the route-layer rejection.
7. `no-structure.md` — prose-only → inference fallback fires. Mocked Claude response returns 4 entries with valid `source_quote`s → 4 pages.
8. `malformed-fence.md` — unclosed `` ``` `` block → structural parse succeeds, warning `UNCLOSED_CODE_FENCE` present.
9. `malformed-frontmatter.md` — broken YAML at top → frontmatter stripped with warning, body parses normally.
10. `inference-no-match.md` — mocked Claude response returns entries with non-existent `source_quote`s → all dropped, `parse_failure_code='INFERENCE_FALLBACK_FAILED'`.
11. `inference-partial-match.md` — mocked Claude response returns 4 entries; 1 has a broken `source_quote` → 3 pages emitted, 1 dropped with warning.
12. `parse-idempotency.test.ts` — call `parseBrief` twice on the same `brief_id`; the second call short-circuits (asserts a single Anthropic call via mock counter).

Six *required* test cases per the user instruction are #1 (valid), #5 (empty), #7 (no-delimiters/inference), #8 or #9 (malformed), #6 (oversized), #7 again (inference-fallback). The expanded list above over-covers per the parent plan's "structural-first path with table-driven fixtures" contract.

### 7.4 Upload route integration tests — `lib/__tests__/briefs-upload-route.test.ts`

Model on `lib/__tests__/admin-api-gate.test.ts` + `lib/__tests__/transfer-worker.test.ts` for the Storage interaction shape.

1. **Happy path (new brief).** Valid multipart with a structural markdown file. Asserts: 201 response, `briefs` row with `status='parsed'`, N `brief_pages` rows, Storage object at expected path, `upload_idempotency_key` populated.
2. **Auth failure.** Viewer role → 403 `FORBIDDEN`. Unauthenticated → 401 `UNAUTHORIZED`.
3. **Dedup replay.** Upload the same file twice from the same user / site → second call returns 200 with `replay: true`, no new `briefs` row, no new Storage object. (Assert Storage object count unchanged via service-role list.)
4. **Oversized.** File > 10 MB → 413 `BRIEF_TOO_LARGE`, no Storage write, no DB write. (Asserted by checking the Storage bucket is empty and `briefs` count is 0 after the call.)

Bonus (not in the required 4 but trivially additive to the same file): validation failure (missing `site_id`), unsupported MIME, idempotency-key-conflict (same key, different file SHA).

### 7.5 Commit UI Playwright E2E — `e2e/briefs-review.spec.ts`

Per `docs/patterns/playwright-e2e-coverage.md`. Requires `supabase start`.

1. **Parse → edit → commit happy path.** Operator logs in, uploads a fixture `valid-h2.md` via the new-brief modal, lands on `/review`, verifies the 5-row page list, edits one title, flips one mode, reorders two rows, clicks "Commit page list", confirms the modal, and asserts the list becomes read-only + status pill flips to "Committed". `auditA11y()` runs on the upload modal and the review page.
2. **Edit cancel.** Operator uploads, edits a title, clicks "Cancel" (leaves the page). Returns to the review URL directly — asserts the previous edit is gone (because the operator didn't click "Save draft") and the original parsed list is visible. (Tests the non-persistence of un-saved edits.)
3. **Commit dedup.** Two browser contexts: operator A and operator B both open the same brief's review page. A clicks commit, confirms. B clicks commit without refresh → B sees the translated `VERSION_CONFLICT` message + a "Refresh" CTA. B refreshes → sees committed state, the "Commit" button is gone. Asserts `briefs.committed_at` was set exactly once (service-role query).

---

## 8. Dependencies + non-dependencies

**Depends on (shipped on main):**
- `docs/DATA_CONVENTIONS.md` — soft-delete + audit columns + version_lock contract.
- `docs/patterns/new-migration.md`, `new-api-route.md`, `new-admin-page.md`, `rls-policy-test-matrix.md`, `assistive-operator-flow.md`.
- `lib/supabase.ts::getServiceRoleClient`, `lib/admin-api-gate.ts::requireAdminForApi`, `lib/http.ts` response helpers, `lib/error-translations.ts`, `lib/anthropic-call.ts::traceAnthropicCall`, `lib/logger.ts`.
- Storage bucket provisioning pattern from `0010_m4_1_image_library_schema.sql`.

**Does NOT depend on:**
- M8 `reserveWithCeiling` — M12-1 is the pre-runner slice; no tokens spent except the parser's fallback call (which bills at `reserveBudget` scale today).
- Any M12-2+ work.

**Downstream slices consume from M12-1:**
- M12-2 reads `briefs` rows, writes `brand_voice` / `design_direction` columns (separate ALTER migration in M12-2).
- M12-3 leases `brief_runs` rows, writes `brief_pages.draft_html` + friends (separate ALTER in M12-3).
- M12-3 writes `site_conventions` rows at anchor-cycle completion.

---

## 9. Risks identified and mitigated

1. **Orphaned Storage objects on DB INSERT failure.** → Idempotency key makes the retry a no-op; second attempt overwrites the Storage object. Janitor path deferred (tracked in BACKLOG).
2. **Parser inference hallucination.** → Every returned entry validated against a literal substring match in the source; entries without a match are dropped + warned. Structural-first path is deterministic. Operator commit is still required before any generation spend.
3. **Concurrent operator edits on the page list.** → `version_lock` on both `briefs` and `brief_pages`. Commit endpoint asserts the `page_hash` matches the DB's current state under transaction; mismatch raises `VERSION_CONFLICT` the UI surfaces as "Refresh".
4. **Double-commit racing the same brief.** → Commit idempotency key (`page_hash`) replays on match; rejects on mismatch. Commit transaction uses `FOR UPDATE` + `WHERE status='parsed'` so a second commit sees zero rows to update.
5. **Concurrent upload double-submit.** → `upload_idempotency_key` is `UNIQUE` at the schema layer. The second submit catches 23505 and returns the first row's envelope.
6. **Claude-inference parse billed twice.** → Anthropic idempotency key `sha256('brief-parse:' + brief_id + ':' + source_sha256)`. Retries return the cached response. Parent plan risk #6.
7. **Operator uploads a file too large for downstream runner tokens.** → Post-parse size check against the 60k-token cap. Fails with `BRIEF_TOO_LARGE`, `briefs.status='failed_parse'`; no runner can start because no committed brief exists. Parent plan §Whole-doc context.
8. **PII in uploaded briefs leaked to Anthropic on the fallback call.** → Parser fallback is on-platform (Claude) — PII visibility policy is no different from the rest of the admin surface. Langfuse trace redacts the body to `sha256` + byte count per parent plan risk #7; the actual bytes are never shipped to the trace store.
9. **RLS gap on Storage object reads.** → `storage.objects` policies mirror the table policies (admin/operator/viewer read, service-role all). The upload route + any admin download go through service-role; defence-in-depth covers the "future signed URL" case.
10. **Migration is safe to run on an empty table only.** → No existing rows; the four tables are new. Zero pre-check required. `ADD CONSTRAINT UNIQUE` on a populated table is not a risk here.

---

## 10. Execution checklist (post-merge of this doc)

When the M12-1 forward PR opens, these are the acceptance boxes. Each must be explicitly ticked in the PR body.

- [ ] Migration `0013_m12_1_briefs_schema.sql` + rollback + types regen.
- [ ] Storage bucket `site-briefs` provisioned in the migration.
- [ ] `lib/brief-parser.ts` with structural-first + Claude-inference fallback.
- [ ] `app/api/briefs/upload/route.ts` + service-role helper in `lib/briefs.ts`.
- [ ] `app/api/briefs/[brief_id]/commit/route.ts` + helper in `lib/briefs.ts`.
- [ ] `app/admin/sites/[id]/briefs/[brief_id]/review/page.tsx` Server Component + client-side editable list.
- [ ] `components/UploadBriefModal.tsx` on the site detail page (entry point).
- [ ] Translations for new error codes in `lib/error-translations.ts`.
- [ ] `lib/tool-schemas.ts` extended with the new error codes.
- [ ] All five test files landed and green.
- [ ] EXPLAIN ANALYZE for `SELECT ... FROM brief_pages WHERE brief_id=$1 ORDER BY ordinal` against a 40-row fixture, plan pasted in PR body.
- [ ] `docs/WORK_IN_FLIGHT.md` claim block removed in the first commit after merge (or in the M12-1 forward PR's first commit).
- [ ] Lighthouse CI baseline run passes on `/admin/sites/:id/briefs/:brief_id/review` is exempt (admin surface; parent plan's performance contract limits LHCI to `/login`).
- [ ] `auditA11y()` clean on upload modal + review page.
- [ ] One-line status ping per merge: "M12-1 merged, starting M12-2."
