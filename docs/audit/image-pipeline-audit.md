# Image Pipeline Audit — 2026-05-06

Exhaustive audit of everything related to the iStock/image EXIF/metadata extraction
pipeline. Performed before any code changes. File:line citations are verified.

---

## 1. Schema

### `image_library` (migration 0010)
Core image record. Key columns:
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `cloudflare_id` | text UNIQUE | Cloudflare Images asset id. NULL until upload completes. |
| `filename` | text | Original filename (display only). |
| `caption` | text | Long-form description. IPTC Caption-Abstract precedence. |
| `alt_text` | text | Short accessible alt. IPTC Headline precedence. |
| `tags` | text[] | Keyword array (max 12). GIN-indexed. |
| `source` | text CHECK | `istock`, `upload`, `generated`. |
| `source_ref` | text | External id (iStock numeric id, etc.). |
| `width_px` / `height_px` | int | NULL until extraction runs. |
| `bytes` | bigint | File size. NULL until extraction runs. |
| `search_tsv` | tsvector | Maintained by BEFORE INSERT/UPDATE trigger. GIN-indexed. |
| `deleted_at` | timestamptz | Soft-delete. |
| `version_lock` | int | Optimistic concurrency. |

`search_tsv` trigger fires on INSERT and on UPDATE OF caption, tags — keeps FTS in sync
without app involvement. Weighted: caption=A, tags=B.

### `image_metadata` (migration 0010)
Key-value sidecar for low-churn metadata that doesn't warrant a schema change.
UNIQUE (image_id, key). Known keys used by the pipeline:
- `istock_id` — numeric iStock asset id (1 row populated as of audit date)
- `exif_raw` — full raw EXIF/IPTC/XMP object (populated by reextract endpoint)
- `dominant_colors` — `{primary: "#rrggbb"}` (not yet populated; added by new extract script)
- `camera` — `{make, model, date_taken}` (not yet populated)
- `gps` — `{lat, lng}` (not yet populated)
- `metadata_extracted_at` — ISO timestamp progress marker (new; added by extract script)

### `image_usage` (migration 0010)
Per-(image, site) WP transfer record. UNIQUE (image_id, site_id). Write-safety keystone.

### `transfer_jobs` / `transfer_job_items` / `transfer_events` (migration 0010)
Batch-operation queue and audit log. Not relevant to metadata extraction.

### `sites.use_image_library` (migration 0068)
Boolean toggle (default false). When true, the brief runner injects image suggestions
into generation prompts via `buildImageLibraryContextPrefix`.

### `posts.featured_image_id` (migration 0030)
FK to image_library. BP-7 featured image.

---

## 2. Library files

| File | Purpose |
|---|---|
| `lib/exif-extract.ts` | Canonical EXIF/IPTC/XMP extraction via `exifr`. Extracts caption, alt_text, tags. Safe `str()` helper prevents `[object Object]` bug. Used by upload route and reextract. |
| `lib/image-dimensions.ts` | Pure-header dimension parser (PNG/JPEG/GIF/WebP). No Sharp dep. Also exports `parseIstockIdFromFilename()`. |
| `lib/image-reextract.ts` | On-demand re-extract for one image: dimensions + istock_id + EXIF. Idempotent. Wraps `fetchHeaderBytes` via Cloudflare delivery URL Range request. |
| `lib/search-images.ts` | M4-6 search_images tool executor. FTS via `plainto_tsquery` on search_tsv. Tag filter via `@>`. Max 50 results. |
| `lib/image-library.ts` | Admin data layer: listImages (FTS, filter, soft-delete), getImageDetail, etc. |
| `lib/image-library-context.ts` | Generation context builder. Fetches up to 5 matching images via `websearch_to_tsquery`. Only includes rows with non-null caption + alt_text + cloudflare_id. Renders `<image_library_context>` block. |
| `lib/cloudflare-images.ts` | Cloudflare Images v1 API wrapper: `uploadImage`, `uploadImageFromBytes`, `getImage`, `deliveryUrl`. |
| `lib/istock-seed.ts` | CSV-based iStock catalogue ingest. Creates image_library rows + transfer jobs. |
| `lib/wp-media-transfer.ts` | Per-(image,site) WP media upload with SAVEPOINT adoption. |
| `lib/html-image-rewrite.ts` | Swaps Cloudflare delivery URLs for WP media URLs before publish. |
| `lib/strip-hallucinated-images.ts` | Strips model-hallucinated `<img>` tags with unknown URLs. |

---

## 3. API routes

| Route | Method | Purpose |
|---|---|---|
| `app/api/admin/images/upload/route.ts` | POST | Multipart upload. Calls `extractExifFields`. Fire-and-forget AI caption if <5MB. |
| `app/api/admin/images/list/route.ts` | GET | FTS image picker. Paged. |
| `app/api/admin/images/[id]/route.ts` | PATCH/DELETE | Metadata edit (optimistic lock) + soft-delete. |
| `app/api/admin/images/[id]/reextract/route.ts` | POST | Triggers `reextractImageMetadata`. |
| `app/api/admin/images/[id]/restore/route.ts` | POST | Restore soft-deleted image. |
| `app/api/admin/images/[id]/download/route.ts` | GET | Download original bytes. |
| `app/api/admin/images/check-existing/route.ts` | GET | Duplicate detection by filename/source. |
| `app/api/admin/images/fetch-url/route.ts` | POST | Fetch image from external URL. |
| `app/api/admin/sites/[id]/use-image-library/route.ts` | POST | Toggle sites.use_image_library. |
| `app/api/tools/search_images/route.ts` | POST | Chat tool executor — calls `executeSearchImages`. Auth + rate-limited. |
| `app/api/cron/backfill-image-captions/route.ts` | GET | Cron: EXIF-only caption backfill for NULL-caption rows, batch 50. |

---

## 4. Scripts

| File | Purpose |
|---|---|
| `scripts/backfill-image-captions.ts` | Manual EXIF-only caption backfill. Uses Cloudflare blob endpoint (original bytes with EXIF). Resume-safe: skips rows with caption already set. **BUG: converts IPTC object values via `String()` producing `[object Object]` captions.** |
| `scripts/import-bulk-uploaded-images.ts` | Bulk CSV import from scripts/output/cloudflare-upload-results.csv. Inserts image_library rows. Idempotent. |
| `scripts/bulk-upload-cloudflare-images.py` | Python: bulk-upload images to Cloudflare, produces CSV. |
| `scripts/extract-image-metadata.ts` | **NEW (this workstream).** Comprehensive batch extraction: dimensions, EXIF, camera, GPS, dominant colours, aspect ratio. See pipeline-design.md. |

---

## 5. Generation integration

`lib/brief-runner.ts:2024` calls `buildImageLibraryContextPrefix({ siteId, topic: page.title })`
on every page-tick. The lib checks `sites.use_image_library` first (cheap row read) and
short-circuits when off. When on, queries `image_library` via `websearch_to_tsquery` and
renders an `<image_library_context>` block with up to 5 matching image URLs + captions.

The tool-call surface (`/api/tools/search_images`) lets the model search images during
chat by calling `executeSearchImages({ query, tags, limit })`.

**Gap:** both paths filter on `caption IS NOT NULL AND alt_text IS NOT NULL`. Of 1,777
images currently in the DB, only 2 have valid captions. The other 50 that appear to have
captions are bug-corrupted (`[object Object]` string from the backfill script). The
extract pipeline is the fix.

---

## 6. Known bugs found during audit

### Bug 1: `[object Object]` caption in backfill script
**File:** `scripts/backfill-image-captions.ts:111–130`
**Root cause:** `rawCaption` can be an IPTC record object (not a plain string) in some
exifr versions. The script casts with `String(rawCaption)` which produces `"[object Object]"`.
**Impact:** 50 rows have `caption='[object Object]'` in production; they pass the `NOT NULL`
filter but are meaningless and confuse the AI.
**Fix:** Use the same safe `str()` helper as `lib/exif-extract.ts` — only accept values
where `typeof v === 'string'`. Fixed in `scripts/extract-image-metadata.ts` and
`scripts/backfill-image-captions.ts`.

### Bug 2: Zero dimensions on 1,777 images
**Root cause:** The re-extract endpoint (`POST /api/admin/images/[id]/reextract`) must
be called per-image via the UI. No batch script existed to run it across the whole library.
**Fix:** `scripts/extract-image-metadata.ts` processes the entire library in batches.

### Bug 3: No extended EXIF in image_metadata
**Root cause:** `lib/exif-extract.ts` only extracts caption/alt/tags. Camera make/model,
DateTimeOriginal, and GPS are in the raw exifr output but were never stored.
**Fix:** `scripts/extract-image-metadata.ts` stores camera, date_taken, gps, and
dominant_colors as separate image_metadata rows.

---

## 7. Current DB state (as of 2026-05-06)

| Metric | Value |
|---|---|
| Total images (not deleted) | 1,777 |
| Source breakdown | upload: 1,777, istock: 0, generated: 0 |
| Have caption (any) | 52 |
| Have valid caption (not `[object Object]`) | 2 |
| Have alt_text | 52 |
| Have dimensions (width_px / height_px) | 0 |
| image_metadata rows | 1 (key=istock_id, one image) |
| dominant_colors populated | 0 |
| camera info populated | 0 |
| gps populated | 0 |

All 1,777 images have `cloudflare_id` set — they are in Cloudflare Images.
All filenames match `iStock-XXXXXXXXXX.jpg` pattern, despite being stored as `source='upload'`.
(They were bulk-uploaded via `scripts/bulk-upload-cloudflare-images.py` + imported as uploads,
not seeded via `lib/istock-seed.ts`.)

---

## 8. Required env vars for extraction pipeline

| Var | Purpose | Status in .env.local |
|---|---|---|
| `SUPABASE_URL` | DB connection | ✓ set |
| `SUPABASE_SERVICE_ROLE_KEY` | DB auth | ✓ set |
| `CLOUDFLARE_ACCOUNT_ID` | Blob endpoint auth | ✗ missing |
| `CLOUDFLARE_IMAGES_API_TOKEN` | Blob endpoint auth | ✗ missing |
| `CLOUDFLARE_IMAGES_HASH` | Delivery URL construction | ✗ missing |

The blob endpoint (`/accounts/{id}/images/v1/{cf_id}/blob`) is required to fetch
original files with IPTC/EXIF intact — Cloudflare strips metadata from delivery URLs.
The delivery hash is needed to construct public delivery URLs for dimension probing.
**Both must be added to .env.local before `scripts/extract-image-metadata.ts` can run.**
