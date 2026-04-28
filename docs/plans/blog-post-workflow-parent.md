# Blog-post workflow — parent plan

## What it is

A distinct entry point under `/admin/sites/[id]/posts/new` for single blog-post creation, separate from the bulk brief flow. Smart parses metadata from the operator's input, validates required fields (URL slug, WP page title, parent page, meta title, meta description, featured image), and routes through Path B's existing brief runner with `content_type='post'`. Featured image is mandatory — uploaded, picked from the existing 1,777-image library, or fetched by URL — and becomes the WP `featured_media` at publish time.

This is Issue 7 of the UAT-smoke-1 punch list. Issues 1–6 live in the sibling plan `docs/plans/run-surface-ux-overhaul-parent.md`.

## Cross-cutting decisions

| Decision | Choice | Why |
|---|---|---|
| **Reuse vs fork** | Reuse the Path B brief runner with `content_type='post'`; reuse `lib/wp-rest-posts.ts` (already accepts `featured_media`); reuse `lib/image-library.ts` (already has 1,777 stock images + FTS) | Lowest-risk; fastest to ship; no schema fork. |
| **Smart-parser source priority** | YAML front-matter > inline metadata lines > HTML meta tags > first `<h1>` > first paragraph | Front-matter is the most explicit; fallbacks are heuristic and operator-correctable. |
| **Image URL fetch policy** | Server-side `fetch()` with no domain allowlist for v1; size cap 10 MB; MIME-type guard (image/* only); 30s timeout | Lowest-risk: any abuse surfaces in the operator's own image library, no SSRF risk on internal infra (Vercel egress is internet-only). Allowlist deferred to BACKLOG if abused. |
| **Mandatory image gate** | Run-start button disabled until image selected; client + server both enforce | Belt-and-suspenders. Server check prevents API direct-call bypass. |
| **Featured image plumbing** | At publish time (existing `lib/wp-media-transfer.ts`) — fetch image from Cloudflare → POST to WP `/media` → use returned `wp_media_id` as `featured_media` on the post create call | Reuses M4-7 image-transfer worker pattern; no new infrastructure. |
| **Metadata storage** | New `posts.metadata jsonb` column for the parsed-but-unedited metadata snapshot; existing `posts.title`, `posts.slug`, `posts.excerpt` columns hold the operator-confirmed values | Snapshot lets the operator see "what was parsed" vs "what they edited"; useful for debugging smart-parser misses. |

## Required env vars

None new. Image-by-URL uses existing Vercel egress; no allowlist for v1. Cloudflare Images creds already provisioned (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_IMAGES_API_TOKEN`, `CLOUDFLARE_IMAGES_HASH`).

## Sub-slice breakdown (8 PRs)

| Slice | Scope | Effort | Blocks on | Shared with run-surface plan? |
|---|---|---|---|---|
| **BP-1** | Smart-parser library — extract metadata from YAML front-matter / inline / HTML meta / H1 / first paragraph | S | — | No |
| **BP-2** | Composer adapter for blog-post entry (depends on RS-1 if it ships first; else builds the unified composer here) | S | RS-1 (or builds it) | **Yes** (consumed from RS-1) |
| **BP-3** | Blog-post entry-point page `/admin/sites/[id]/posts/new` — composer + smart-parsed metadata form (no image picker yet — disabled state shows "select image to start run") | M | RS-0, BP-1, BP-2 | No |
| **BP-4** | Image picker modal — browses `/admin/images` library with search-by-caption, single-select | M | RS-0 (Popover/Command) | No |
| **BP-5** | Image-upload tab — drag-drop / picker → Cloudflare Images via existing bulk-upload pattern → image_library row → returned to picker | M | BP-4 | No |
| **BP-6** | Image-by-URL tab — paste URL → server fetches + uploads to Cloudflare → image_library row | M | BP-4 | No |
| **BP-7** | Featured image WP attachment — at publish, transfer the chosen image to WP, set `featured_media` on post create | M | BP-3 (post create flow) | No |
| **BP-8** | Run-start gate + WP parent-page picker — start-run button disabled until all required fields valid; parent-page dropdown queries WP `/pages` API | S | BP-3 | No |

**Effort key:** S = under 2 hours, M = ½–1 day.

**Total estimated effort:** ~3–5 days serial; ~2.5 days with parallelism (BP-1 + BP-4 in parallel after RS-0; BP-5 + BP-6 in parallel after BP-4).

## Execution order

```
[parallel]  BP-1 (parser) ─────────────┐
[serial]    RS-0 from sibling plan ────┤ (foundation)
            ↓                           │
[serial]    RS-1 from sibling plan     │ (composer)
            ↓                           │
[parallel]  BP-2 (composer adapter) ───┤
[parallel]  BP-3 (entry-point UI)      │ — uses BP-1 + BP-2
[parallel]  BP-4 (image picker) ───────┘ — uses RS-0 primitives
            ↓
[parallel]  BP-5 (upload tab) ─┐
[parallel]  BP-6 (URL tab)      │ — both extend BP-4
            ↓
[serial]    BP-8 (run-start gate) — uses BP-3 + BP-4
[serial]    BP-7 (WP attachment) — uses publish flow
```

BP-1 ships independently (pure logic). BP-3 / BP-4 ship in parallel after foundation. BP-5 / BP-6 ship in parallel after BP-4. BP-7 + BP-8 close the loop.

---

## BP-1 — Smart-parser library

### Scope

Pure-logic helper that extracts post metadata from the operator's pasted content. Five sources, in priority order:

1. **YAML front-matter** between `---` delimiters at the top:
   ```
   ---
   title: My Post
   slug: my-post
   meta_title: SEO Title
   meta_description: A short description.
   ---
   ```
2. **Inline metadata lines** at the top (case-insensitive label match):
   ```
   Title: My Post
   Slug: my-post
   Meta description: ...
   ```
3. **HTML meta tags** (CMS exports):
   ```html
   <title>My Post</title>
   <meta name="description" content="...">
   <link rel="canonical" href="https://example.com/posts/my-post">
   ```
4. **First `<h1>` or first markdown `# H1`** as `title` fallback.
5. **First paragraph** (first non-empty, non-heading line/block) as `meta_description` fallback, capped at 160 chars.

### What lands

- `lib/blog-post-parser.ts` — exports `parseBlogPostMetadata(text: string): { title, slug, meta_title, meta_description, source_map }`. `source_map` records which source each field came from (for UI hints: "Title parsed from YAML front-matter").
- `lib/__tests__/blog-post-parser.test.ts` — comprehensive matrix: each source × each field × fallback chain.

### Acceptance criteria

- All 5 sources extracted correctly on representative fixtures.
- Slug fallback: derive from title (kebab-case, ASCII, max 60 chars) when no explicit slug given.
- Meta description: cap at 160 chars; truncate at last word boundary.
- Pure function — no DB, no network, no DOM.
- `npm run lint` + `npm run typecheck` clean.

### Risk audit

- **YAML parsing dep.** Use `yaml` (small npm dep) or implement a tiny line-by-line parser for the constrained shape we accept. Lowest-risk: hand-rolled parser limited to the `key: value` shape; reject nested objects. Avoids new npm dep.
- **HTML parsing.** No new dep — use regex for the few tags we care about. Tolerant of attribute order; rejects malformed.
- **Slug derivation.** Strip non-`[a-z0-9-]` characters; collapse whitespace; lowercase. Test the unicode-stripping path explicitly.

### Test plan

- Unit matrix: 15+ test cases across the source-priority and fallback paths.

### Effort

S (~2 hours).

---

## BP-2 — Composer adapter for blog-post entry

### Scope

Reuses `components/Composer.tsx` (built in RS-1). If RS-1 ships first, BP-2 just consumes. If BP-2 ships first, BP-2 builds the shared component.

### What lands

If RS-1 has shipped: zero new component code in BP-2. The entry-point page (BP-3) imports `Composer` and wires it.

If RS-1 has not shipped: BP-2 builds `components/Composer.tsx` per RS-1's spec (single textarea + paste + drag-drop + click-attach + auto-grow + scroll-on-overflow). RS-1 then consumes from BP-2.

### Acceptance criteria

(See RS-1 acceptance criteria.)

### Effort

S (~1 hour) if just consuming. M (~½ day) if building.

---

## BP-3 — Blog-post entry-point page

### Scope

New route `/admin/sites/[id]/posts/new` with composer + smart-parsed metadata form. Image picker is a placeholder until BP-4 ships; until then the run-start button shows "Pick a featured image to start run" disabled.

### What lands

- `app/admin/sites/[id]/posts/new/page.tsx` — server component that renders the entry-point UI.
- `components/BlogPostComposer.tsx` — client component wrapping `Composer` + the smart-parsed metadata form. Uses `parseBlogPostMetadata` from BP-1 on every textarea change (debounced 200ms).
- Metadata form fields: URL slug, WP page title, parent page (BP-8 will populate the dropdown — for BP-3 it's a free-text input), meta title, meta description, featured image (placeholder).
- Each field shows the parsed-source hint ("Auto-filled from YAML title") inline with an edit affordance.
- Save-as-draft action stores in `posts` table (existing schema) with `content_type='post'` + the parsed metadata snapshot in a new `posts.metadata` column.
- Schema migration for the new column.

### Acceptance criteria

- Operator pastes a markdown blob → metadata form populates within 200ms.
- Each field editable inline.
- "Start run" button disabled with explicit "Featured image required" text until BP-4 + BP-8 wire it.
- 380px viewport: form scrolls within viewport; no horizontal scroll.
- 44×44px tap targets on every action.
- `npm run lint` + `npm run typecheck` + `npm run build` clean.

### Risk audit

- **Schema migration: `posts.metadata jsonb` column.** New nullable column; safe. Forward-only; rollback file.
- **Smart parser misses cause operator confusion.** Per-field source hint surfaces what was parsed vs typed. Operator can always edit.
- **Auto-save vs explicit-save.** Lowest-risk: explicit save. Operator clicks "Save draft" or "Start run". No auto-save (avoids the surprise mid-typing.)

### Test plan

- E2E: navigate to /posts/new, paste a markdown blob, assert form populates.
- Component snapshot of the entry-point UI with parsed data.
- Migration up + down.

### Effort

M (~1 day).

---

## BP-4 — Image picker modal

### Scope

Modal browser of `/admin/images` library. Search by caption (FTS via existing `image_library.search_tsv`). Grid layout of thumbnails. Single-select. Returns the selected image's `cloudflare_id` to the calling component.

### What lands

- `components/ImagePickerModal.tsx` — Dialog (RS-0 primitive). Three tabs: "Library", "Upload new" (BP-5 stub), "Paste URL" (BP-6 stub). Library tab is functional.
- Library tab: search input (debounced 300ms), 4×4 grid of thumbnails (Cloudflare delivery URL via `deliveryUrl` from `lib/cloudflare-images.ts`), pagination (load 24 per page, "Load more" button).
- `app/api/admin/images/list/route.ts` (extend existing if present, else create) — accepts `q` (search) + `limit` + `offset`; returns image_library rows with `cloudflare_id`, `caption`, `alt_text`. Auth via `requireAdminForApi(['admin', 'operator'])`.
- Click thumbnail = select; modal closes; selected image returned to caller via `onSelect(image)`.

### Acceptance criteria

- Picker opens within 200ms (route ready, list pre-fetched on first open).
- Search returns results within 500ms (FTS-indexed).
- Selected image shows checkmark before modal closes.
- 380px viewport: grid is 2-wide; no horizontal scroll.
- Tap targets: each thumbnail card is ≥ 88×88px (well above 44×44).
- `npm run lint` + `npm run typecheck` + `npm run build` clean.

### Risk audit

- **Image library has 1,777+ rows.** Pagination prevents over-fetch. FTS search indexed on `image_library.search_tsv` (M4-1).
- **Cloudflare delivery URL contains the public hash.** Already public; no leak risk.
- **Deleted images.** Filter `deleted_at IS NULL` in the query. Existing convention.

### Test plan

- E2E: open picker, search, select.
- Component snapshot at 380px + desktop.

### Effort

M (~½ day).

---

## BP-5 — Image-upload tab

### Scope

"Upload new" tab in the image picker. Drag-drop or file-picker → Cloudflare Images upload via existing `scripts/bulk-upload-cloudflare-images.py` pattern (TS-side: a single-file upload route). Insert `image_library` row. Auto-caption via existing M4-4 captioner. Selected image returns to BP-3.

### What lands

- `app/api/admin/images/upload/route.ts` (new) — POST multipart, accepts a single image file. Server: upload to Cloudflare via the existing helper; insert `image_library` row with `source='upload'`; trigger captioning async (fire-and-forget; the picker can show "Captioning…" state).
- `components/ImagePickerModal.tsx` "Upload new" tab — `Composer`-style file area (drag-drop or click). Uses the same drag-drop affordance pattern as RS-1.
- After upload completes, the new image is auto-selected.

### Acceptance criteria

- Upload completes within 5s for a typical 1-5MB JPEG.
- Captioning happens async; UI shows "Captioning…" pill that resolves within 30s.
- Failure modes: file > 10 MB → reject with clear message. Wrong MIME → reject. Cloudflare 5xx → retry once, then surface error.
- 380px viewport: drag-drop area ≥ 200px tall.
- `npm run lint` + `npm run typecheck` + `npm run build` clean.

### Risk audit

- **Cloudflare API rate limits.** Single-file uploads; well under the documented 200/min cap. No throttling needed.
- **Captioning latency.** M4-4 captioner runs async; picker shows pending state. Operator can proceed to assign the image to the post even before caption resolves (caption is metadata, not blocking).
- **Race: operator selects the image before caption completes.** Caption fills in after; no harm.

### Test plan

- E2E: upload a fixture JPEG, assert image appears in library + selected on the post.
- Manual: 10MB+ file rejected.

### Effort

M (~½ day).

---

## BP-6 — Image-by-URL tab

### Scope

"Paste URL" tab in the image picker. Operator pastes a URL → server fetches → uploads to Cloudflare → image_library row → returned to picker.

### What lands

- `app/api/admin/images/fetch-url/route.ts` (new) — POST `{url}`. Server: HEAD probe (size + Content-Type), reject if > 10 MB or non-`image/*`; GET with 30s timeout; upload to Cloudflare; insert `image_library` row with `source='upload'`; trigger caption.
- `components/ImagePickerModal.tsx` "Paste URL" tab — single text input + "Fetch" button.

### Acceptance criteria

- Fetch + upload completes within 10s for a typical 2-5MB image at typical broadband.
- 30s timeout on the fetch — surface a clear error.
- Size > 10 MB → clear rejection.
- Wrong content-type → clear rejection.
- SSRF defence: reject `localhost`, `127.0.0.1`, `0.0.0.0`, RFC1918 addresses, `metadata.google.internal`, `169.254.0.0/16`.
- `npm run lint` + `npm run typecheck` + `npm run build` clean.

### Risk audit

- **SSRF.** Internal IP block listed above. Vercel runtime egress is internet-only by default but the SSRF guard is belt-and-suspenders for self-hosted.
- **DNS rebinding attack.** Resolve hostname server-side before HEAD/GET; reject if resolved IP is in the blocklist. Defer to a follow-up if sophisticated abuse appears.
- **Large file DoS.** 10 MB cap + 30s timeout. Bounded.

### Test plan

- Unit on the SSRF guard against blocklist IPs.
- E2E: paste a public image URL, assert image lands in library + selected.

### Effort

M (~½ day).

---

## BP-7 — Featured image WP attachment

### Scope

At publish time, the post's chosen image is uploaded to WP via `/wp/v2/media`, the returned `wp_media_id` is set as `featured_media` on the post create call. Reuses `lib/wp-media-transfer.ts` helper.

### What lands

- `app/api/sites/[id]/posts/[post_id]/publish/route.ts` (modify existing) — before calling `wpCreatePost`, transfer the post's featured image: `wpUploadMedia(cfg, imageBytes)` → get `wp_media_id`. Pass `featured_media: wp_media_id` in `wpCreatePost`.
- The chosen image's `cloudflare_id` is fetched via `lib/cloudflare-images.ts::getImage` → bytes downloaded → uploaded to WP.
- Idempotency: the WP-side `wp_media_id` is stamped onto `posts.featured_wp_media_id` (new column). Re-publish reuses it.

### Acceptance criteria

- Publish flow attaches the featured image; published WP post shows the image as featured.
- Re-publish (e.g. operator edits and re-publishes) reuses the existing `wp_media_id`; no duplicate WP media.
- Image transfer failure → publish fails cleanly with translated error; operator retries.
- Post-mode publish without an image (legacy data) is rejected at publish time with `FEATURED_IMAGE_REQUIRED` (server-side guard).
- `npm run lint` + `npm run typecheck` + `npm run build` clean.

### Risk audit

- **WP media upload cost.** Each WP `/media` POST eats WP storage. Idempotency via `wp_media_id` reuse means a single transfer per (post, image) pair.
- **Image transfer race.** Two concurrent publishes of the same post would both upload — prevented by `posts.version_lock` CAS at the publish gate.
- **Existing posts without featured_image.** Not affected — the `FEATURED_IMAGE_REQUIRED` guard fires only on `content_type='post'` rows created via the new entry point. Legacy posts publish unchanged.

### Test plan

- Unit: WP wrapper accepts featured_media (already covered by PB-7 regression test).
- E2E: post with featured image → publish → assert WP post shows image.

### Effort

M (~1 day, including the new column + idempotency).

---

## BP-8 — Run-start gate + WP parent-page picker

### Scope

The "Start run" button is disabled until all required fields valid (slug, title, parent page, meta title, meta description, featured image). Parent-page dropdown queries WP `/pages` API and shows a searchable list.

### What lands

- `components/BlogPostComposer.tsx`:
  - Validation rules: every required field non-empty + valid (slug = `[a-z0-9-]+`, title 1–200 chars, etc.).
  - Run-start button disabled with explicit field-level error inline.
  - Parent-page picker: Combobox (RS-0 `cmdk` primitive) backed by `wpListPages` API call.
- `app/api/sites/[id]/wp-pages/route.ts` (new) — proxies `wpListPages` for the picker. Auth via `requireAdminForApi`.

### Acceptance criteria

- Start-run button disabled until all required fields valid.
- Field-level validation inline (red border + helper text).
- Parent-page combobox loads on focus; search filters results.
- 380px viewport: combobox doesn't overflow.
- `npm run lint` + `npm run typecheck` + `npm run build` clean.

### Risk audit

- **WP `/pages` API latency.** Combobox fetches on focus + caches client-side. Acceptable.
- **WP page list could be large.** `wpListPages` already paginates; combobox shows top 50 + search.
- **No parent page selected.** Required field; gate at run-start.

### Test plan

- E2E: navigate to /posts/new, fill all fields including parent page, start run.
- Manual: invalid slug input shows inline error.

### Effort

S (~2–3 hours).

---

## Write-safety contract (parent-level)

- **Reuses existing schema as much as possible.** New columns: `posts.metadata jsonb` (BP-3), `posts.featured_wp_media_id bigint` (BP-7). Both nullable; forward-only; rollback files included.
- **Image library schema unchanged.** New images go through the existing `image_library` insert path (`source='upload'`).
- **WP media upload is idempotent.** `posts.featured_wp_media_id` stamps the assigned WP media id; re-publish reuses.
- **Server-side gate enforces mandatory image.** `FEATURED_IMAGE_REQUIRED` error at publish time prevents API direct-call bypass of the client gate.
- **SSRF guard on URL fetch.** Blocklist of internal IPs prevents Vercel-egress abuse.

## Risks identified and mitigated (parent-level)

| Risk | Mitigation |
|---|---|
| Operator pastes a malicious URL → SSRF | BP-6 guard: blocklist internal IPs; resolve hostname server-side; reject before fetch. |
| Featured image transfer fails mid-publish | BP-7 cleanly fails publish with translated error; operator retries; `posts.featured_wp_media_id` not stamped on failure. |
| Smart parser misses cause silent operator surprise | BP-3 per-field source hint shows what was parsed; operator edits inline. |
| Image picker swamps slow connections | BP-4 paginates 24 per page; thumbnails are Cloudflare-delivered (already CDN'd). |
| Mobile UX degrades on the entry-point form | Each sub-slice's acceptance criteria pin 380px viewport + 44×44px tap targets. |
| Concurrent edit on the entry-point page | Save-draft uses `posts.version_lock` CAS; `VERSION_CONFLICT` surfaced to UI. |
| Existing post-mode briefs (M13-3+) collide with the new entry point | The new entry creates a post directly (not via brief); the brief flow stays for bulk-post creation. Both write to `posts` table; no collision. |

## Pointers

- `docs/INTEGRATION_MODEL_DECISION.md` — path B (host theme owns chrome). Post body is a fragment; goes into a single HTML widget on the published post.
- `docs/plans/run-surface-ux-overhaul-parent.md` — sibling plan; RS-0 (primitives) + RS-1 (unified composer) are foundations BP-* consume.
- `docs/patterns/ship-sub-slice.md` — every PR follows this shape.
- `lib/wordpress.ts::wpCreatePost` — already accepts `featured_media`.
- `lib/wp-media-transfer.ts` — WP media upload helper (M4-7).
- `lib/image-library.ts::listImages` — existing FTS-backed image listing.
- `lib/cloudflare-images.ts` — Cloudflare upload + delivery URL helpers.
- `scripts/bulk-upload-cloudflare-images.py` — reference pattern for upload + caption flow.

## Out of scope (deferred to BACKLOG with triggers)

- **Bulk blog creation.** Use the existing brief flow with `content_type='post'` if multi-post creation is needed. Trigger to revisit: operator complains about per-post overhead.
- **AI-generated featured images.** Trigger: M16+ or operator request.
- **Auto-publishing schedules / drafts queue.** Trigger: operator routinely scheduling future posts.
- **Categories / tags assignment.** v1 has no UI; operator adds in WP after publish. Trigger: first complaint.

## Sub-slice status tracker

(filled in as PRs land)

| Slice | PR | Merged | Notes |
|---|---|---|---|
| BP-1 | — | — | — |
| BP-2 | — | — | — |
| BP-3 | — | — | — |
| BP-4 | — | — | — |
| BP-5 | — | — | — |
| BP-6 | — | — | — |
| BP-7 | — | — | — |
| BP-8 | — | — | — |
