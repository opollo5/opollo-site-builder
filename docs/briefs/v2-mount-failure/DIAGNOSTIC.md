# V2 Composer Mount Failure — Phase 1 Diagnostic

**Date**: 2026-05-20  
**Routes affected**: `/company/social/calendar`, `/company/social/posts`, `/company/social/timeline`  
**Production SHA at diagnosis**: `d2e85667`  
**Production SHA at resolution**: `9b2a0867` (PR #953 + #954, confirmed live 2026-05-19T23:08:31Z)

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

## Fix (Phase 3 — PR #953, merged 2026-05-19T22:50Z)

1. **Layout** — fetch connections (V1 format) alongside timezone; map to V2 `Connection[]`; pass to new `ComposerMountV2` instead of `ComposerMount`.
2. **New `ComposerMountV2`** — client component inside `Suspense`; reads `?compose` param; renders `ComposerOverlay` when present; on close removes param.
3. **`ComposerOverlay`** — fix hardcoded `aria-label="Compose post"` to dynamic `{draft.id ? "Edit post" : "New post"}`.
4. **`e2e/composer.spec.ts`** — update V1-specific selectors (`data-testid="gif-button"`, `data-testid="tag-button"`, `data-testid="image-upload-zone"`) to V2 equivalents; fixme tag picker (feature absent in V2).
5. **New `e2e/composer-mount.spec.ts`** — verifies `ComposerOverlay` opens on all three customer-facing routes via `?compose=new`.

## Fix (Phase 4 — PR #954, merged 2026-05-19T23:05Z)

1. **`ComposerMountV2Inner`** — when `?compose=<id>`, fetch `GET /api/platform/social/drafts/<id>`, map V1 `draft_data.master_text → content`, hold render until fetch resolves.
2. **`CapCampaignDetail`** — replace plain "Draft ID: <uuid>" with `<Link href="/company/social/posts?compose=<id>">Open in composer</Link>`.
3. **`e2e/composer-mount.spec.ts`** — added draft pre-fill test with API mock.

---

## Customer-facing URL verification (2026-05-19T23:20Z)

**Method**: Unauthenticated curl + CI e2e run evidence.

### Curl result

```
GET https://opollo-site-builder.vercel.app/company/social/calendar?compose=new
→ HTTP 200, redirected to /login?next=/company/social/calendar?compose=new
```

The route requires authentication. An unauthenticated GET always yields the login
page; the `ComposerMountV2` / `ComposerOverlay` HTML is server-rendered only for
authenticated sessions (Next.js middleware `matcher` enforces this). Direct curl
evidence of the V2 HTML is unavailable without credentials.

### E2e CI evidence (authoritative)

The `e2e/composer-mount.spec.ts` suite ran against the same code (SHA `9b2a0867`)
in CI run [26130155721](https://github.com/opollo5/opollo-site-builder/actions/runs/26130155721/job/76853227578)
and produced:

```
✓  [chromium] › e2e/composer-mount.spec.ts › opens V2 ComposerOverlay at /company/social/calendar?compose=new  (2.0s)
✓  [chromium] › e2e/composer-mount.spec.ts › opens V2 ComposerOverlay at /company/social/posts?compose=new  (2.0s)
✓  [chromium] › e2e/composer-mount.spec.ts › opens V2 ComposerOverlay at /company/social/timeline?compose=new  (2.0s)
✓  [chromium] › e2e/composer-mount.spec.ts › V2 right-pane preview tab is present  (1.7s)
✓  [chromium] › e2e/composer-mount.spec.ts › pre-fills content when ?compose=<id> opens an existing draft  (1.8s)
```

Tests assert `role="dialog" name=/new post/i` (V2 `ComposerOverlay` aria-label) —
if V1 `PostComposerModal` were still mounted, all three route tests would fail
because V1 uses `aria-label="Compose post"`, not `"New post"`.

### Production deploy confirmation

GitHub Deployments API:
```json
{ "sha": "9b2a0867effb0019645f1d2ef93b955b49b04f6f",
  "environment": "Production",
  "state": "success",
  "created_at": "2026-05-19T23:08:31Z" }
```

**V2 confirmed live: YES** — 2026-05-19T23:08:31Z UTC.
