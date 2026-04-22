# M5 — Image Library Admin UI

## What it is

An operator-facing admin surface over the image library that M4 populated. Browse, filter, inspect, edit metadata on, and soft-delete rows in `image_library`, plus a per-image detail view that surfaces which sites the image has been transferred to (via `image_usage`). Read-mostly; the only mutations are metadata edits and soft-delete.

M4 shipped the storage layer (Cloudflare), the index (Postgres), the seed (9k iStock rows), the chat-facing `search_images` tool, and the transactional WP transfer. The operator has no UI for any of it — captions are only visible via `search_images` output, and there's no way to fix a bad caption short of a direct SQL write. M5 closes that gap.

## Why a separate milestone

The M4 plan explicitly deferred "Admin UI for browsing the image library" to M5/M6. `lib/search-images.ts` carries a comment calling forward to this milestone ("An unfiltered library dump is not a chat tool — for admin browsing use the future M5/M6 list view"). The shape is a classic new-admin-page + edit-modal + detail surface — best matched to the `new-admin-page.md` pattern and distinct enough from M4's worker/write-safety concerns to ship as its own milestone.

M5 is **not** write-safety-critical in the M3/M4/M7 sense: no billed external calls, no concurrent multi-row state transitions, no client WP site mutation. The safety layer here is schema-level optimistic locking (`image_library.version_lock`) + the existing `image_usage (image_id, site_id) UNIQUE` + the `ON DELETE NO ACTION` FK that already guards against orphaning. Per-slice plans still populate the **"Risks identified and mitigated"** section (CLAUDE.md says populated, not empty), but the risks are smaller in surface.

## Scope (shipped in M5)

- New admin routes: `/admin/images` (list) + `/admin/images/[id]` (detail).
- Thumbnails via Cloudflare Images `public` variant (account-level configured).
- Server-rendered list with paging + text search + tag filter + source filter + deleted/active toggle.
- Per-image detail: full metadata, variant preview (multiple sizes), `image_usage` list across sites, `image_metadata` k/v rows.
- Metadata edit modal: caption / alt_text / tags. Optimistic-locked on `version_lock`, audit columns (`updated_by`, `updated_at`) populated.
- Soft-delete + restore. Soft-delete blocked with `IMAGE_IN_USE` when `image_usage` rows exist.
- Search-images tool re-uses same data layer; no behaviour change to the chat-facing tool.
- E2E spec covering the list, detail, edit, soft-delete paths + axe audit.

## Out of scope (tracked in BACKLOG.md)

- Per-site media library viewer (the per-site slice of `image_usage` grouped by site). Sub-surface of `/admin/sites/[id]` — deferred unless an operator asks for it.
- Single-image upload flow (outside the iStock seed path). Deferred; M4 plan already listed this.
- Re-captioning (re-run Anthropic vision on a row). Deferred; operator writes the override manually in the metadata edit modal today.
- Hard-delete of images. Deferred — soft-delete is sufficient; hard-delete would need a cascade plan + Cloudflare cleanup + `image_usage` reconciliation.
- Crop / focal point / Cloudflare transformations UI. Deferred; Cloudflare's named variants are the stopgap.
- Image analytics ("used on N pages across M sites, last referenced on date X"). Deferred to an M6/M7 slice that wants the signal.
- Bulk-edit (tag a set of images at once). Deferred until an operator needs it; one-at-a-time is fine for the 9k seed.

## Env vars required

| Var | Needed by | Status |
| --- | --- | --- |
| `CLOUDFLARE_IMAGES_HASH` | M5-1..3 (thumbnail URLs) | Present (provisioned 2026-04-21 per M4) |
| `SUPABASE_*` | all slices | Present |

No new env vars. Every Cloudflare var M5 touches is already provisioned from M4.

## Sub-slice breakdown (4 PRs)

| Slice | Scope | Write-safety rating | Blocks on |
| --- | --- | --- | --- |
| **M5-1** | `/admin/images` list page: server component, paginated table, thumbnails, source filter, deleted/active toggle, tag + caption text search (piggybacks on `search_tsv`). `lib/image-library.ts` data layer (`listImages`, `getImage`). | Low — read-only. | Nothing |
| **M5-2** | `/admin/images/[id]` detail page: full metadata, multi-variant preview, `image_usage` per-site list (joined with `sites`), `image_metadata` k/v pane, back-link to list preserving filter state via query params. | Low — read-only. | M5-1 |
| **M5-3** | Metadata edit modal: caption / alt_text / tags. `PATCH /api/admin/images/[id]` with Zod + version_lock optimistic locking + `updated_by` population. Re-indexes `search_tsv` automatically via existing trigger. | Medium — concurrent edits + `search_tsv` invariant. | M5-1 + M5-2 |
| **M5-4** | Soft-delete + restore action. `DELETE /api/admin/images/[id]` (soft) + `POST /api/admin/images/[id]/restore`. Blocked when in-use; surfaces `IMAGE_IN_USE` with the count of referencing sites. List + detail pages gain the action. | Medium — guard against orphaning in-use images. | M5-1..3 |

**Execution order:** M5-1 → M5-2 → M5-3 → M5-4. Strictly serial — each slice depends on its predecessor's lib helpers or UI chrome.

Total expected volume: ~1,800–2,400 lines across the four slices including tests. Each slice sits inside the reviewer-in-5-minutes rule.

## Write-safety contract

Limited surface; documented for completeness and so the per-slice "Risks identified and mitigated" sections have a shared reference.

### Metadata edits (M5-3)

- `image_library.version_lock` already exists (`int NOT NULL DEFAULT 1`, see migration 0010). PATCH handler checks the client-supplied `expected_version` against the current row and returns `VERSION_CONFLICT` + 409 on mismatch. Mirrors the M1 design-system pattern.
- `updated_at` + `updated_by` refreshed on every successful update. Operator identity pulled from `getCurrentUser()` at the API-route entry.
- `tags` input is a `string[]`; Zod enforces each entry is `trim().min(1).max(40)` and the array is `max(12)`. Keeps the `search_tsv` maintainable and matches the captioner's output bounds.
- `search_tsv` stays in sync automatically via the existing `image_library_search_tsv_trigger` (migration 0010). No application code flips `search_tsv` directly.

### Soft-delete (M5-4)

- Sets `deleted_at = now()` + `deleted_by = <current user>`. The existing `idx_image_library_*` partial indexes with `WHERE deleted_at IS NULL` auto-exclude the row from searches.
- Guard: if any `image_usage` row references `image_id`, the API returns `IMAGE_IN_USE` with `{ site_count, site_names }` rather than soft-deleting. This matches the FK's `ON DELETE NO ACTION` intent — the guard reports a friendly error instead of letting the constraint raise a raw 23503.
- `search_images` already filters `deleted_at IS NULL`; soft-deleted rows vanish from the chat tool immediately.
- Restore flips `deleted_at` + `deleted_by` back to NULL. No guard needed — restore can't create an inconsistency.

### No billed external calls in M5

Every mutation is a Postgres write. No Cloudflare POSTs, no Anthropic calls, no WP API. The M4 idempotency + event-log scaffolding isn't exercised by this milestone.

## Testing strategy

Per existing patterns:

| Slice | Patterns applied |
| --- | --- |
| M5-1 | `new-admin-page.md` (list page server-render, `.maybeSingle` discipline, revalidatePath). `lib/__tests__/image-library.test.ts` covering `listImages` pagination + filter behaviour. E2E: list renders seeded rows, filter/search narrows correctly, pagination advances. |
| M5-2 | `new-admin-page.md` detail-page half. Tests: `getImage` returns joined usage rows; NOT_FOUND on unknown id; E2E navigation from list → detail → back preserves filter. |
| M5-3 | `new-api-route.md` (Zod + gate + error codes). Unit tests: VALIDATION_FAILED (tag too long, too many tags, empty caption allowed via explicit opt-in), VERSION_CONFLICT, NOT_FOUND. E2E: edit modal opens, saves, list shows updated caption after `router.refresh()`. |
| M5-4 | Unit tests: soft-delete allowed when no `image_usage`; IMAGE_IN_USE when `image_usage` rows exist; restore round-trip. E2E: archive action removes row from active list, shows in deleted tab, restore returns it. |

**EXPLAIN ANALYZE requirement.** The `listImages` query is a new hot-path admin query (`/admin/images` is a page an operator visits repeatedly). PR description pastes the plan against a realistic-volume seed (9k rows post-M4-5 seed run). The existing `idx_image_library_created_at`, `idx_image_library_search_tsv`, `idx_image_library_tags`, and `idx_image_library_source` cover the access patterns; the EXPLAIN confirms they're chosen rather than falling back to a Seq Scan.

**E2E spec file.** `e2e/images.spec.ts` — new top-level spec covering the four slices' happy paths + `auditA11y` on list, detail, and modal-open states. CLAUDE.md's E2E-is-hard-requirement rule applies.

## Performance notes

- 9k rows is trivial for Postgres. Paged at 50/page, the list page's cold latency is dominated by the `search_tsv` match when a text query is present (GIN index) + the thumbnail fetch from Cloudflare (CDN, ~50ms first byte). No server-side image work.
- Tag filter uses `tags @> $tags` against `idx_image_library_tags` (GIN).
- Detail page's `image_usage` join is small (≤ N sites per image, typically ≤ 5). No pagination needed.
- `image_metadata` is keyed by `image_id` (`idx_image_metadata_image_id`); read is one-index-one-table.

No caching layer needed. If a future slice surfaces per-image analytics ("used across N pages"), that query goes behind an LRU — not this milestone.

## Risks identified and mitigated

Per-slice plans elaborate these; listed here at the parent-milestone level so the safety net is visible in one place.

1. **Concurrent metadata edits racing `version_lock`.** → `image_library.version_lock` already exists (migration 0010). M5-3 PATCH checks `expected_version`; mismatch → 409 `VERSION_CONFLICT`. Test: two PATCHes at `version_lock=1` → first succeeds, second returns VERSION_CONFLICT, no silent overwrite.

2. **Soft-delete of an image still referenced by `image_usage`.** → API guard returns `IMAGE_IN_USE` + the referencing site names before any UPDATE runs. Schema-level fallback: the `image_usage.image_id` FK is `ON DELETE NO ACTION`, so an accidental hard-delete attempt also fails. Test: create `image_usage` row, attempt soft-delete, assert `IMAGE_IN_USE` response + `image_library.deleted_at` unchanged.

3. **`search_tsv` drift after metadata edit.** → The existing `image_library_search_tsv_trigger` (BEFORE INSERT/UPDATE OF caption, tags) refreshes the column atomically in the same row write. M5-3 never sets `search_tsv` directly. Test: UPDATE caption, SELECT `search_tsv` reflects the new caption's tokens.

4. **Operator ID not recorded on edits.** → PATCH handler pulls the session via `getCurrentUser()` at entry, populates `updated_by`. If session resolution fails, route returns 401 before any DB write. Test: authenticated PATCH sets `updated_by`; unauthenticated returns 401.

5. **`/admin/images` list page stale after edit/soft-delete.** → Every mutation route calls `revalidatePath('/admin/images')` + `revalidatePath('/admin/images/[id]')`. Same pattern as M2d's admin surfaces. Known pitfall called out in `new-admin-page.md`. E2E asserts the list reflects the change after `router.refresh()`.

6. **Tag array growth unbounded.** → Zod caps the array at 12 entries, each 1..40 chars, trimmed. Caption is capped at 500 chars (Anthropic captions run ~200-400); alt_text at 200. Input validation runs before the DB write.

7. **Filter / pagination state lost when navigating to detail + back.** → Detail page "Back" link preserves `?q`, `?tag`, `?source`, `?page`, `?deleted` via `URLSearchParams` threading. Not a write-safety risk but a known UX pitfall from the `new-admin-page.md` pattern.

8. **Exposure of DB column names in the UI.** → Labels use operator-friendly copy ("Caption", "Alt text", "Tags", "Used on", "First imported"). No `cloudflare_id`, `version_lock`, `deleted_at`, `image_usage`, or `source_ref` in user-visible strings. The row's internal id surfaces only in the URL. Matches CLAUDE.md "Backlog — UX debt".

9. **Cloudflare variant URL drift if the account's variants are reconfigured.** → URLs are built from `CLOUDFLARE_IMAGES_HASH` + `cloudflare_id` + variant name (`public`, `thumb`, `detail`). If an operator renames a variant on the Cloudflare dashboard, URLs 404. Mitigation: a `lib/cloudflare-image-url.ts` helper is the single point of composition + a health-check smoke that fetches one known-good id on page load in dev (not in CI — Cloudflare network calls aren't shape-stable in test).

10. **RLS policy gap on `image_library` / `image_usage` / `image_metadata`.** → Migration 0010 shipped RLS that allows service-role reads + writes; authenticated-user reads go through the admin gate. M5 API routes use the service-role client (same as every other admin API route) after passing `requireAdminForApi()`. Test: `requireAdminForApi` denies non-admin / non-operator sessions before any query runs.

11. **Edit modal submitting stale `expected_version` after a reload.** → Detail page always reads the current `version_lock` at server-render time; the modal submit uses the same number from the React props tree. If the page was rendered, tab-idled, and another operator edited in the meantime, the submit fails with `VERSION_CONFLICT` (the test from risk 1). UI surfaces "Another operator edited this image — reload." Same pattern M1 established.

12. **Pagination skew under concurrent writes.** → Known Postgres OFFSET pagination quirk. Acceptable for an admin surface at 9k rows; the operator can re-query. Not fixed in M5; documented here so a future cursor-pagination slice has the context. If a subsequent milestone surfaces a "jump to page N" affordance, it re-opens this.

## Relationship to existing patterns

- **List + detail + edit shape** follows `docs/patterns/new-admin-page.md` verbatim. Every shipped example (`/admin/sites`, `/admin/users`, `/admin/batches`) lines up; M5 adds `/admin/images` as the next instance.
- **Mutation endpoints** follow `docs/patterns/new-api-route.md` (Zod at entry, admin gate, uniform error envelope, optimistic locking).
- **E2E coverage** follows `docs/patterns/playwright-e2e-coverage.md`; `auditA11y(page, testInfo)` on every page the spec touches per CLAUDE.md.
- **No new patterns introduced.** M5 is a straightforward application of patterns the repo already has.

## Sub-slice status tracker

Maintained in `docs/BACKLOG.md` under a new **M5 — image library admin UI** section. Updated on every merge:

- `M5-1` — status (planned / in-flight / merged / blocked)
- `M5-2` — status
- `M5-3` — status
- `M5-4` — status

On M5-4 merge, the tracker flips to "merged" and auto-continue proceeds to M6-1 (Per-Page Iteration UI — scope to be written in M6's parent plan at that point).
