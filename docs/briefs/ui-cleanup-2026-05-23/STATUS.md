# UI Cleanup 2026-05-23 — Status

<!-- Appended after each PR merges and deploys -->

## Bug 1 — composer-load-scheduled-post

- **PR**: #1022 `fix/composer-load-scheduled-post`
- **Merge SHA**: `1ddd48645edaf4185f4e8519164d2b3bfbbfc4e4`
- **Deploy**: production, 2026-05-23T23:08:40Z, state: success
- **Root cause**: `mapV1ToV2Draft` called `d.draft_data.media_refs.map(...)` unconditionally; V2 rows with `draft_data: {}` threw TypeError, triggering the fetch-error UI ("Couldn't load this post").
- **Fix**: Optional chaining on `draft_data.media_refs` + `target_connection_ids`; falls back to top-level `media_urls` / `target_profiles` columns for V2 rows.
