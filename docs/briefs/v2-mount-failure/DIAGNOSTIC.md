# V2 Composer Mount Failure — Phase 1 Diagnostic

**Date**: 2026-05-20  
**Routes affected**: `/company/social/calendar`, `/company/social/posts`, `/company/social/timeline`  
**Production SHA**: `d2e85667` (latest main, confirmed current)

---

## Root cause

Two parallel composer implementations exist:

| | V1 (`components/composer/`) | V2 (`components/social/composer/`) |
|---|---|---|
| Entry | `PostComposerModal` | `ComposerOverlay` |
| Mount point | `ComposerMount` in `/company/social/layout.tsx` | `CalendarShell` at `/social/poster` only |
| Trigger | `?compose=new` URL param | `open: boolean` prop via `useComposerState` |
| Platform types | `SocialPlatform` (`linkedin_personal`, `facebook_page`, …) | `Platform` (`linkedin`, `facebook`, …) |
| Profile selector | Text pills, fetches connections client-side | SVG icon circles, receives connections as prop |
| Content editor | `ComposerTextarea` — plain textarea | `ContentEditor` — char counter + media tray |
| Per-platform tabs | None | `CustomizeForRow` + `PlatformActionsList` |
| Preview | `ComposerPreview` | `PreviewCard` + `MiniCalendar` toggle |
| Scheduling | `SchedulingTabs` (tabs at footer, V1 order) | `SchedulingCard` (card below editor, V2 order: Post now → Schedule → Publish regularly → Save as draft) |
| Submit | `ComposerActions` (single button, footer-right) | `SchedulingCard` submit button (inline in card) |
| Approval toggle | Hidden in post_now only | `ApprovalToggle` in `SchedulingCard` |

**PR #912** ("remove FEATURE_COMPOSER_V2 flag guards") wired `ComposerMount` → `PostComposerModal` as the unconditional default at `/company/social/*`. `ComposerOverlay` was already built but only reaches the browser via `/social/poster` (the `CalendarShell`). The customer-facing routes never got the V2 mount.

---

## Route map

| Route | Page file | Client component | Composer trigger | Composer served |
|---|---|---|---|---|
| `/company/social/calendar` | `app/(platform)/company/social/calendar/page.tsx` | `SocialCalendarClient` | `href="?compose=new"` | `PostComposerModal` (via layout `ComposerMount`) |
| `/company/social/posts` | `app/(platform)/company/social/posts/page.tsx` | `SocialPostsListClient` | `router.push("?compose=new")` | `PostComposerModal` (via layout `ComposerMount`) |
| `/company/social/timeline` | `app/(platform)/company/social/timeline/page.tsx` | (inline) | `href="?compose=new"` | `PostComposerModal` (via layout `ComposerMount`) |
| `/social/poster` | `app/(platform)/social/poster/page.tsx` | `CalendarShell` | `openComposer()` → state | `ComposerOverlay` ✓ |

The layout (`app/(platform)/company/social/layout.tsx`) mounts `ComposerMount` which renders `PostComposerModal` when `?compose` is present.

---

## Fix (Phase 3)

1. **Layout** — fetch connections (V1 format) alongside timezone; map to V2 `Connection[]`; pass to new `ComposerMountV2` instead of `ComposerMount`.
2. **New `ComposerMountV2`** — client component inside `Suspense`; reads `?compose` param; renders `ComposerOverlay` when present; on close removes param.
3. **`ComposerOverlay`** — fix hardcoded `aria-label="Compose post"` to dynamic `{draft.id ? "Edit post" : "New post"}`.
4. **`e2e/composer.spec.ts`** — update V1-specific selectors (`data-testid="gif-button"`, `data-testid="tag-button"`, `data-testid="image-upload-zone"`) to V2 equivalents; fixme tag picker (feature absent in V2).
5. **New `e2e/composer-mount.spec.ts`** — verifies `ComposerOverlay` opens on all three customer-facing routes via `?compose=new`.
