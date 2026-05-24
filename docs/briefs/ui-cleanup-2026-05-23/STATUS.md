# UI Cleanup 2026-05-23 — Status

<!-- Appended after each PR merges and deploys -->

## Bug 1 — composer-load-scheduled-post

- **PR**: #1022 `fix/composer-load-scheduled-post`
- **Merge SHA**: `1ddd48645edaf4185f4e8519164d2b3bfbbfc4e4`
- **Deploy**: production, 2026-05-23T23:08:40Z, state: success
- **Root cause**: `mapV1ToV2Draft` called `d.draft_data.media_refs.map(...)` unconditionally; V2 rows with `draft_data: {}` threw TypeError, triggering the fetch-error UI ("Couldn't load this post").
- **Fix**: Optional chaining on `draft_data.media_refs` + `target_connection_ids`; falls back to top-level `media_urls` / `target_profiles` columns for V2 rows.

## Bug 2 — ai-assist-modal-cleanup

- **PR**: #1023 `fix/ai-assist-modal-cleanup`
- **Merge SHA**: `9ef730b6aa7fe407a40bd0185bfcd8529fac1a94`
- **Deploy**: production, 2026-05-23T23:39:30Z, state: success (deploy id 4796683935)
- **Root cause 2a**: Generate button used `variant="outline"` — renders as ghost border on white modal background, visually invisible.
- **Root cause 2b**: `AiPanel` rendered a custom `<IconButton label="Close AI panel">` alongside `DialogContent`'s built-in Radix close button, stacking two X affordances top-right.
- **Fix 2a**: Removed `variant="outline"` from Generate button; default filled emerald CTA variant used.
- **Fix 2b**: Removed custom `IconButton` from `AiPanel`; Radix's single built-in close button remains (correct ARIA, Escape key handling).
- **Gate 6 + Gate 7** added to `button-migration-gates.yml` to prevent regression.

## Bug 3 — composer-central-image-library

- **PR**: #1024 `fix/composer-central-image-library`
- **Merge SHA**: `6d93f290f1bcb1ee64676d740d7b041381b16946`
- **Deploy**: production, 2026-05-24T03:27:25Z, state: success (deploy id 4797638976)
- **Root cause**: `MediaPickerModal` Library tab fetched `/api/platform/social/media?include_global=true` which queries `social_media_assets` (~7 rows, company-scoped). The central `image_library` table (1,777+ rows, global) had no read endpoint in the social API surface.
- **Fix**: New route `app/api/platform/social/media/image-library/route.ts` reads `image_library` directly via service role, builds Cloudflare image delivery URLs from `cloudflare_id`, returns paginated `MediaAsset[]`. `MediaPickerModal.fetchLibrary` updated to call `/api/platform/social/media/image-library` instead.
