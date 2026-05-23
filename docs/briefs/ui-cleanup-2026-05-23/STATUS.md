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
- **Deploy**: pending (watching)
- **Root cause 2a**: Generate button used `variant="outline"` — renders as ghost border on white modal background, visually invisible.
- **Root cause 2b**: `AiPanel` rendered a custom `<IconButton label="Close AI panel">` alongside `DialogContent`'s built-in Radix close button, stacking two X affordances top-right.
- **Fix 2a**: Removed `variant="outline"` from Generate button; default filled emerald CTA variant used.
- **Fix 2b**: Removed custom `IconButton` from `AiPanel`; Radix's single built-in close button remains (correct ARIA, Escape key handling).
- **Gate 6 + Gate 7** added to `button-migration-gates.yml` to prevent regression.
