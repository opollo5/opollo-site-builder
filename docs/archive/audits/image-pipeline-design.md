# Image Pipeline Design — Intended Architecture

Reconstructed from code, migrations, git history, and the current DB state.
Accurate as of 2026-05-06 audit.

---

## Source images

All 1,777 current images are iStock files bulk-uploaded to Cloudflare Images via
`scripts/bulk-upload-cloudflare-images.py` (Python; produces a CSV of cloudflare_ids)
then imported as `source='upload'` rows via `scripts/import-bulk-uploaded-images.ts`.

The `lib/istock-seed.ts` CSV-seeding path (which sets `source='istock'` and creates
transfer jobs) was built but not used for the current library. The current images are
labelled `source='upload'` even though their filenames are all `iStock-XXXXXXXXXX.jpg`.

Future uploads from the in-app picker arrive via `POST /api/admin/images/upload` (multipart),
which calls `uploadImageFromBytes` → Cloudflare, then inserts an `image_library` row with
EXIF fields extracted at upload time.

---

## Metadata extraction pipeline

```
Source file (iStock JPEG)
    │
    ▼
Cloudflare Images (CDN storage)
    │   cloudflare_id stored in image_library
    │
    ├── Delivery URL (imagedelivery.net/<hash>/<id>/public)
    │       Cloudflare STRIPS IPTC/EXIF from delivery transforms.
    │       Used for: dimension probe (Range request, first 64KB),
    │                 delivery URL in prompts and HTML.
    │
    └── Blob endpoint (api.cloudflare.com/client/v4/accounts/<id>/images/v1/<cf_id>/blob)
            Returns ORIGINAL file with all IPTC/EXIF/XMP intact.
            Requires: CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_IMAGES_API_TOKEN.
            Used for: caption/alt/tags extraction, camera/GPS/date extraction.
                      (Must use this endpoint, not delivery URL.)
    │
    ▼
exifr.parse(originalBytes, { iptc, exif, xmp, tiff, reviveValues: true })
    │
    ├── caption     ← IPTC Caption-Abstract ?? XMP description ?? IPTC Headline
    ├── alt_text    ← IPTC Headline ?? IPTC ObjectName ?? XMP Title
    ├── tags        ← IPTC Keywords OR XMP Subject (max 12, whichever is richer)
    ├── camera.make ← EXIF Make
    ├── camera.model← EXIF Model
    ├── date_taken  ← EXIF DateTimeOriginal (Date object when reviveValues=true)
    └── gps         ← EXIF GPSLatitude + GPSLongitude (decimal degrees)
    │
    ▼
sharp(originalBytes)
    ├── metadata()  → width, height, format (more reliable than pure header parser)
    └── stats()     → dominant: {r, g, b}  (primary colour)
    │
    ▼
Supabase writes
    │
    ├── image_library UPDATE
    │       caption    (if null — never overwrites operator edits)
    │       alt_text   (if null)
    │       tags       (if empty array)
    │       width_px   (if null)
    │       height_px  (if null)
    │       bytes      (if null)
    │
    └── image_metadata UPSERT (UNIQUE image_id + key)
            key='exif_raw'              value_jsonb = full raw exifr output
            key='dominant_colors'       value_jsonb = {"primary": "#rrggbb"}
            key='camera'                value_jsonb = {make, model, date_taken}
            key='gps'                   value_jsonb = {lat, lng}  (if present)
            key='istock_id'             value_jsonb = "1234567890" (if iStock filename)
            key='metadata_extracted_at' value_jsonb = "2026-05-06T..."  (idempotency sentinel)
```

---

## Full-text search

`image_library.search_tsv` is a `tsvector` column maintained by a BEFORE INSERT/UPDATE
trigger on (caption, tags). It is GIN-indexed.

Weighting:
- caption = weight A (highest)
- tags    = weight B

Two search surfaces:

1. **Chat tool** (`/api/tools/search_images` → `lib/search-images.ts`):
   Uses `plainto_tsquery` (natural-phrase input, no syntax knowledge required).
   Returns up to 50 ranked results with cloudflare_id, caption, alt_text, tags, dimensions.
   Input validated by `SearchImagesInputSchema`. Either `query` or `tags` required.

2. **Generation context** (`lib/image-library-context.ts`):
   Uses `websearch_to_tsquery` (supports AND/OR/quotes, more expressive).
   Triggered per-page-tick when `sites.use_image_library = true`.
   Returns up to 5 results filtered to rows with non-null caption + alt_text.
   Results injected as `<image_library_context>` block into the prompt.

---

## Connection to page/blog generation

`lib/brief-runner.ts:2024` calls `buildImageLibraryContextPrefix({ siteId, topic: page.title })`
on every page generation tick. Flow:

1. Check `sites.use_image_library` — if false, return empty string immediately.
2. Query `image_library` via `websearch_to_tsquery(search_tsv, topic)` — up to 5 results.
3. Filter: `deleted_at IS NULL`, `caption NOT NULL`, `alt_text NOT NULL`, `cloudflare_id NOT NULL`.
4. Build delivery URLs via `deliveryUrl(cloudflare_id, 'public')`.
5. Render `<image_library_context>` XML block with url, caption, alt, tags per image.
6. Return block (prepended to designContextPrefix so the model sees it early in the prompt).

The model is instructed to reference image URLs directly in `<img src="...">` with the
supplied alt text. It must NOT invent URLs; `lib/strip-hallucinated-images.ts` enforces
this by stripping unverifiable `<img>` tags before publish.

**Prerequisite:** the generation path only works when images have populated captions +
alt_text. As of the audit, only 2 of 1,777 images have valid metadata. The
`scripts/extract-image-metadata.ts` batch script is the fix.

---

## Admin image management UI

`/admin/images` — list view with FTS search, source filter, soft-delete toggle.
`/admin/images/[id]` — detail: thumbnail, EXIF metadata form (caption/alt/tags), re-extract
button, download button, usage summary (which sites use this image).

---

## Known data gaps (to be filled by extract script)

| Field | Current state | Fix |
|---|---|---|
| `width_px` / `height_px` | NULL on all 1,777 | Extract via Sharp from blob bytes |
| `caption` | NULL or `[object Object]` on 1,775 | Extract via exifr from blob bytes |
| `alt_text` | NULL on 1,725 | Extract via exifr from blob bytes |
| `tags` | Empty on all | Extract via exifr from blob bytes |
| `image_metadata.exif_raw` | 0 rows | Store full exifr output |
| `image_metadata.dominant_colors` | 0 rows | Extract via Sharp stats() |
| `image_metadata.camera` | 0 rows | Extract from EXIF Make/Model/DateTimeOriginal |
| `image_metadata.gps` | 0 rows | Extract from EXIF GPS fields (where present) |
