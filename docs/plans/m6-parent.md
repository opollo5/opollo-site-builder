# M6 — Per-Page Admin Surface

## What it is

Operator-facing admin surface over the `pages` table that M3's batch generator populates. Browse every page generated for a site, inspect one, edit its display metadata (title / slug / meta_description), and jump to the WP admin UI for deeper content work. This is the "per-page iteration UI" CLAUDE.md flagged as M6 — the surface the operator uses after a batch run to find specific pages, clean up metadata, and triage anomalies.

Re-generation (re-run Claude on a single page to produce a new HTML revision) is **explicitly NOT in M6** — that spends money and mutates the client's WP site, which belongs in M7 under the write-safety-critical bar.

## Why a separate milestone

M3 shipped the batch generator; M4 shipped image handling; M5 shipped the image library admin surface. Pages themselves have no admin UI — the only way an operator can see what was generated is via the WP admin on the client site or by opening Supabase directly. This is fine for a single hand-crafted homepage; it's friction once 40+ pages land in a LeadSource-sized batch and something needs touching up.

M6 is a **read-mostly admin surface** with a single light write path (metadata edit). Same shape as M5 — the `new-admin-page.md` pattern applies verbatim. Not write-safety-critical in the M3/M4/M7 sense; still populates the **"Risks identified and mitigated"** section per CLAUDE.md because (a) slug edits touch a UNIQUE constraint the batch generator relies on, and (b) concurrent edits against an operator-editable row need optimistic locking.

## Scope (shipped in M6)

- Per-site pages list at `/admin/sites/[id]/pages`: server-rendered, filters by status + page_type + free-text search (title / slug).
- Per-page detail at `/admin/sites/[id]/pages/[pageId]`: metadata grid, generated_html preview (static iframe with our design-system CSS only), links to WP admin + the WP-rendered page, `template` + `design_system_version` context.
- Metadata edit modal: title, slug. Optimistic-locked on `pages.version_lock`, `UNIQUE (site_id, slug)` enforced at the schema level with a 409 `UNIQUE_VIOLATION` surfaced to the UI. (`meta_description` lives on WordPress, not in our `pages` row — not editable from this surface.)
- Breadcrumb + nav wiring: Sites detail page gets a "Pages" link; the pages list has a back-link to the site; the page detail has a back-link preserving list filters via `?from=`.
- UX-debt cleanup pass: de-jargon the template / component / design-system authoring forms per CLAUDE.md "Backlog — UX debt → Medium".
- E2E coverage: list → detail → edit modal round-trip + axe audit on every visited page.

## Out of scope (tracked in BACKLOG.md)

- **Single-page re-generation.** Belongs to M7. Spends Anthropic tokens, mutates WP, needs the M3/M4 idempotency + event-log scaffolding applied to a single-slot generation job.
- **Bulk operations.** Delete / archive / republish N pages at once. No operator ask yet; queue when someone needs it.
- **Content brief editor.** `content_brief` is a jsonb record the batch generator produced; editing it without re-running Claude is confusing. Defer with re-generation.
- **Live Tier-1 preview (iframe at the WP draft URL).** SCOPE_v3 specs a three-tier preview; M6 ships Tier 2 (static HTML under our CSS) + Tier 3 (WP admin link). Tier 1 belongs with re-generation because that's when live-vs-draft matters.
- **Page version history diff view.** `page_history` table already exists and is populated by older code paths; exposing it is a follow-up slice tied to re-generation.
- **Viewport switcher + theme switcher.** SCOPE_v3 preview nice-to-haves; out of scope.
- **Cross-site pages search.** Operator drills down via site first; no single operator has enough multi-tenant scope for a global search yet.
- **Pre-existing E2E failures** (`e2e/sites.spec.ts:73`, `e2e/users.spec.ts:19`) present on main since M4-7. Tracked as its own BACKLOG entry so a dedicated slice can triage both without dragging M6 timelines. M6's own specs are independent.

## Env vars required

None new. Every dependency (Supabase, Cloudflare delivery hash for asset-reference thumbnails if any appear, WP admin URL from `sites.wp_url`) is already provisioned.

## Sub-slice breakdown (4 PRs)

| Slice | Scope | Write-safety rating | Blocks on |
| --- | --- | --- | --- |
| **M6-1** | `/admin/sites/[id]/pages` server-rendered list: status + page_type filter, free-text search on title/slug, paginated. `lib/pages.ts` data layer (`listPagesForSite`, `getPage`). Sites detail page gets a "Pages" link. | Low — read-only. | Nothing |
| **M6-2** | `/admin/sites/[id]/pages/[pageId]` detail: metadata grid, Tier-2 static HTML preview (sandboxed iframe), Tier-3 WP admin link (via `sites.wp_url`), `template` + `design_system_version` context. Back-link preserves list filters via `?from=`. | Low — read-only. | M6-1 |
| **M6-3** | Metadata edit modal (title, slug). `PATCH /api/admin/sites/[id]/pages/[pageId]` with Zod + `pages.version_lock` optimistic locking + 409 `UNIQUE_VIOLATION` on slug collisions. Routes call `revalidatePath` on list + detail. | Medium — slug edits hit the `pages_site_slug_unique` constraint the batch generator relies on (M3-6's pre-commit claim). | M6-1 + M6-2 |
| **M6-4** | UX-debt cleanup: de-jargon the design-system authoring forms per CLAUDE.md "Backlog — UX debt → Medium". Label-only changes to `TemplateFormModal.tsx`, `ComponentFormModal.tsx`, `CreateDesignSystemModal.tsx`. Strike through the now-shipped scope_prefix entry (M2d handled it; CLAUDE.md entry is stale). | Low — pure copy changes. | Nothing (can ship in parallel with any earlier slice) |

**Execution order:** M6-1 → M6-2 → M6-3 → M6-4. Strictly serial for 1-3; 4 is decoupled but lands last by convention.

Total expected volume: ~1,500–2,000 lines across four slices including tests.

## Write-safety contract

Narrow surface; documented so the per-slice "Risks identified and mitigated" sections have a shared reference.

### Metadata edits (M6-3)

- `pages.version_lock` already exists from M1 (schema-wide convention). PATCH pins `expected_version`; mismatch → 409 `VERSION_CONFLICT` with `current_version` in the details. Same pattern M5-3 shipped for `image_library`.
- `UNIQUE (site_id, slug)` was added in migration 0007 (M3-1) and is the pre-commit claim the batch generator relies on. If an operator edits a page's slug to one that already exists for the same site, the UPDATE fails with Postgres 23505 — the handler catches that and returns 409 `UNIQUE_VIOLATION`. The generator's own slug-claim flow in `lib/batch-publisher.ts` continues to work unchanged because the constraint is the coordination point.
- `title` has no cross-row uniqueness; max-length caps enforced at the Zod boundary (matches `CreatePageInputSchema`: title 3-160). `meta_description` is NOT in our schema — it's a WP-side field the quality-gate runner checks in generated HTML; editing it belongs to re-generation (M7), not this surface.
- `updated_at` + `updated_by` refresh on every successful UPDATE. `updated_by` resolved from `requireAdminForApi`'s `gate.user` and falls back to null under the flag-off / kill-switch bypass paths (same posture as the rest of the admin API).
- **WP drift on slug edit.** Editing a page's slug in our DB does NOT rename the page on the client's WP site. The UI warns the operator that changing the slug is a metadata-only operation — WP URL still points at the old slug until a publish runs. The M3-6 pattern (pre-commit claim + slug adoption) is designed for this divergence; re-publish fixes it. Flagging the operation is the safety net; automatic reconciliation is deferred to M7.

### Pages list + detail (M6-1, M6-2)

- Read-only. No external calls, no writes, no billing. Service-role client after admin gate, matching every other admin surface.
- The Tier-2 preview iframe sandboxes the rendered HTML: `sandbox="allow-same-origin"` (needed to apply our CSS), no `allow-scripts`. Operator doesn't need to execute scripts to preview; preventing `allow-scripts` is defence-in-depth against XSS inside an operator-controlled content brief.
- `generated_html` may be arbitrarily large (40+ pages × ~30-100KB HTML). The detail page reads it directly; pagination would be premature. Cap rendering at 500KB inline (`HTML_SIZE_MAX_BYTES` in `lib/html-size.ts`); oversized payloads render a size warning + pointer to the WP admin rather than a raw-HTML download link (shipped in `components/PageHtmlPreview.tsx`). M11-4 hoisted the constant into a shared module and added the symmetric write-time quality gate.

### UX-debt cleanup (M6-4)

- Pure label changes in JSX. No schema, no behaviour, no API surface.
- Tests: a snapshot-level assertion per label change so a future regression (reverting a label) trips the test rather than going silent.

### No billed external calls in M6

Every mutation is a Postgres write. No Cloudflare POSTs, no Anthropic calls, no WP API. The idempotency + event-log machinery from M3/M4 isn't exercised by this milestone.

## Testing strategy

Per existing patterns:

| Slice | Patterns applied |
| --- | --- |
| M6-1 | `new-admin-page.md` list-page discipline (`force-dynamic`, `.maybeSingle`, server-reads only). `lib/__tests__/pages.test.ts` covering `listPagesForSite` (filter composition, paging, status/page_type/q). E2E: list renders, filter narrows, site-scoped (another site's pages never leak). |
| M6-2 | Detail page follow-through: `getPage(siteId, pageId)` returns NOT_FOUND for a page belonging to another site (site-scope guard, not just id match). E2E: list → detail → back preserves filter. |
| M6-3 | `new-api-route.md` (Zod + gate + error codes). Unit tests: VALIDATION_FAILED (empty patch, bad slug regex, oversized meta_description), VERSION_CONFLICT, UNIQUE_VIOLATION on slug collision, NOT_FOUND, site-scope guard (can't patch another site's page through this URL). E2E: edit opens + saves + list reflects. |
| M6-4 | One rendering test per modal asserting the new labels are present and the old raw-column-name strings are absent. No behavioural tests needed. |

**EXPLAIN ANALYZE requirement.** `listPagesForSite`'s hot path is `pages WHERE site_id = $1 AND (optional filters) ORDER BY updated_at DESC LIMIT 50`. The existing `idx_pages_site_status ON pages(site_id, status)` covers the common `?status=draft` filter; an `idx_pages_site_updated_at` may need adding for the unfiltered-but-paged view. PR will include the plan output against a realistic-volume seed (post-M3 batch runs on LeadSource have ~40 pages per site).

**E2E spec.** `e2e/pages.spec.ts` — new top-level spec. Seeds a site + template + a few pages, exercises list → detail → metadata edit, runs `auditA11y(page, testInfo)` on every visited page.

## Performance notes

- 40-page-per-site scale is trivial for Postgres. Paged at 50/page, every filter path is indexed.
- Detail page's generated_html is the biggest payload; ~100KB typical. No caching layer.
- M6-4 is zero-cost (label swaps only).

## Risks identified and mitigated

Per-slice plans elaborate these; listed here at the parent-milestone level so the safety net is visible in one place.

1. **Concurrent metadata edits racing `version_lock`.** → M6-3 PATCH pins `expected_version`; mismatch returns 409 `VERSION_CONFLICT` with `current_version`. Same pattern as M5-3 `image_library`. Test: two PATCHes at version_lock=1 → first succeeds, second returns VERSION_CONFLICT.

2. **Slug collision when editing.** → `pages_site_slug_unique` (migration 0007) is the coordination point. Handler catches 23505 and returns 409 `UNIQUE_VIOLATION` with the colliding slug in the details so the UI can render "that slug is already used by <other page>". Test: create two pages for the same site, edit one's slug to the other's → UNIQUE_VIOLATION returned, DB state unchanged.

3. **Cross-site page access via the detail URL.** → `getPage(siteId, pageId)` requires BOTH params; a page belonging to site B accessed via `/admin/sites/{siteA}/pages/{pageIdB}` returns NOT_FOUND, not the row. Defence against URL-manipulation between tenants the operator has access to. Test: seed two sites with one page each; `getPage(siteA, pageB)` returns NOT_FOUND.

4. **WP drift on slug edit.** → UI surfaces a warning on the slug field ("Renaming the slug here does not move the page on WordPress until the next publish"). Content-wise the DB edit is safe — title / meta_description are display-only. Re-publishing is a deferred M7 action. Documented in the risks audit rather than silently hidden.

5. **`generated_html` size surprise.** → `components/PageHtmlPreview.tsx` caps inline rendering at 500KB via `HTML_SIZE_MAX_BYTES`; oversized payloads render a size warning + a pointer to the WordPress admin. Prevents the admin page from DOM-blocking on a pathological record. M11-4 hoisted the constant into `lib/html-size.ts` and added the symmetric write-time quality gate so oversized generations fail at commit rather than silently persisting.

6. **Sandboxed preview iframe escaping.** → `sandbox="allow-same-origin"` only. No `allow-scripts`; no `allow-top-navigation`. If an operator-supplied content brief ever embedded a `<script>` in `generated_html`, it would not execute in the preview. Defence-in-depth against an accidental injection surface.

7. **Operator ID attribution on edits.** → Route resolves `gate.user?.id` from `requireAdminForApi` and stamps `updated_by`. Under flag-off / kill-switch paths, falls back to null — matches the admin API posture established in M2d.

8. **Admin gate bypass on the nested route shape.** → `/admin/sites/[id]/pages` and `/admin/sites/[id]/pages/[pageId]` both call `checkAdminAccess({ requiredRoles: ["admin", "operator"] })` at the top of the page handler. Matches the existing `/admin/sites/[id]` pattern. Test: viewer role redirects to `/admin/sites`.

9. **Stale list after edit.** → PATCH handler calls `revalidatePath('/admin/sites/[id]/pages')` + `revalidatePath('/admin/sites/[id]/pages/[pageId]')`. Client-side modal triggers `router.refresh()` on success. Standard pattern.

10. **Exposure of DB column names in operator UI.** → UI uses "Title" / "Slug" / "Meta description" / "Template" / "Status". No `version_lock`, `wp_page_id`, `design_system_version`, or `content_brief` leak to labels. `wp_page_id` appears as a clickable link label ("Open in WP admin") rather than an integer column.

11. **M6-4 accidentally changing behaviour beyond labels.** → Unit render test asserts old jargon labels absent + new labels present. No JSX structure changes; no form-submit path changes. Review-time diff is limited to string literals inside `<label>` and `<p className="text-muted-foreground">` nodes.

12. **Stale `scope_prefix` backlog entry in CLAUDE.md.** → M2d already removed the field from `AddSiteModal.tsx`; the CLAUDE.md "Backlog — UX debt → High" entry is obsolete. M6-4 strikes it through so future readers see the history without thinking there's still work to do.

13. **Pages list page stale after M7's re-generation (future).** → When M7 ships the single-page regen action, it will need to bust `/admin/sites/[id]/pages/[pageId]`'s cache. Noted here so the M7 plan remembers; not a M6 risk.

## Relationship to existing patterns

- **List + detail + edit shape** follows `docs/patterns/new-admin-page.md` verbatim. Fifth instance (`/admin/sites`, `/admin/users`, `/admin/batches`, `/admin/images`, now pages).
- **Mutation endpoint** follows `docs/patterns/new-api-route.md`: Zod at entry, admin gate, uniform error envelope, optimistic locking, `revalidatePath` on success.
- **E2E coverage** follows `docs/patterns/playwright-e2e-coverage.md`; `auditA11y(page, testInfo)` on every page the spec touches per CLAUDE.md.
- **UX-debt cleanup** is a first-class slice following CLAUDE.md's "Backlog — UX debt" pointers. Same execution shape future milestones can reuse.
- **No new architectural patterns.** M6 is a straightforward application of patterns the repo already has.

## Sub-slice status tracker

Maintained in `docs/BACKLOG.md` under a new **M6 — per-page admin surface** section. Updated on every merge:

- `M6-1` — status (planned / in-flight / merged / blocked)
- `M6-2` — status
- `M6-3` — status
- `M6-4` — status

On M6-4 merge, auto-continue proceeds to **M7 — single-page re-generation + publish drift reconciliation** (write-safety-critical; parent plan drafted at that boundary).
