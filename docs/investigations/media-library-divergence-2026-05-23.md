# Media Library Divergence — 2026-05-23

## Symptom

Composer "Add media → Library" tab shows ~7 images. `/admin/images` shows 1,777+ images. They are not the same data.

## Root cause

Two separate tables, two separate APIs, no shared read path.

### Composer Library tab
- **Component**: `components/social/composer/MediaPickerModal.tsx:115`
- **Endpoint**: `GET /api/platform/social/media?company_id=X&include_global=true`
- **Route**: `app/api/platform/social/media/route.ts`
- **Library**: `lib/platform/social/media/list.ts:listMediaAssets`
- **Table**: `social_media_assets`
- **Scope**: company-scoped (or `scope='global'` staff-promoted rows)
- **Row count**: ~7 (company + global)

### Admin images (`/admin/images`)
- **Page**: `app/(platform)/admin/images/page.tsx`
- **Endpoint**: `GET /api/admin/images/list`
- **Library**: `lib/image-library.ts:listImages`
- **Table**: `image_library`
- **Scope**: global (no `company_id` column)
- **Row count**: 1,777+

## Schema diff

| Field | `social_media_assets` | `image_library` |
|---|---|---|
| `company_id` | YES | NO (global) |
| `source_url` | YES | NO |
| `cloudflare_id` | NO | YES |
| `mime_type` | YES | NO (use source + default) |
| `bytes` | YES | YES |
| `scope` | `company\|global` | always global |
| FTS | NO | YES (`search_tsv`, GIN) |

## Delivery URL pattern

`image_library` rows are served via Cloudflare Images:

```
https://imagedelivery.net/${CLOUDFLARE_IMAGES_HASH}/${cloudflare_id}/public
```

`CLOUDFLARE_IMAGES_HASH` is already set in Vercel production (used by `lib/batch-publisher.ts:329`).

## Fix

Create `app/api/platform/social/media/image-library/route.ts` — a new GET endpoint that:
1. Auth-checks `view_calendar` permission via `requireCanDoForApi` (viewer+)
2. Queries `image_library` via service-role (non-deleted, `created_at DESC`)
3. Maps rows to `MediaAsset` shape: `cloudflare_id` → delivery URL, `mime_type` = `"image/jpeg"` (no GIFs in this table)
4. Returns `{ ok: true, data: { assets, next_cursor } }` — same shape as the existing endpoint

Update `MediaPickerModal.tsx:115` to call `/api/platform/social/media/image-library` instead of `/api/platform/social/media`.

The upload path (POST to `/api/platform/social/media`) is unchanged — uploads still go to `social_media_assets`.

## Why not just swap the endpoint in the existing route?

The existing GET route serves `social_media_assets` which is company-scoped. `image_library` is global and requires a different query shape. Separating them keeps both tables accessible via their respective routes without a flags-based branch in the handler.
