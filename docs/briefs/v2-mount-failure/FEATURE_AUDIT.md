# V2 Composer Mount — Feature Audit

**Date:** 2026-05-20
**Status:** Complete. All phases shipped. PR #953 (Phase 3 mount) and PR #954 (Phase 4 gaps) merged and deployed to production.

## What was audited

Verified the social-01 brief spec against the live customer-facing composer mount
after PR #953 (`fix/v2-composer-mount`) is merged. The audit covers two planes:

1. **Component existence** — does the V2 feature exist in `components/social/composer/`?
2. **Customer-facing reachability** — is it wired into the `/company/social/*` routes?

---

## Spec coverage matrix

| Feature | PR | Component | Customer-facing? | Status |
|---|---|---|---|---|
| Split-pane overlay shell | PR C | `ComposerOverlay.tsx` | ✅ via `ComposerMountV2` after #953 | ✅ |
| Profile selector (circular icon chips) | PR C | `ProfileSelector.tsx` | ✅ | ✅ |
| Content editor (textarea + char counter) | PR C | `ComposerEditor.tsx` | ✅ | ✅ |
| Per-platform variant tabs | PR C | `CustomizeForRow.tsx` / `PlatformActionsList.tsx` | ✅ | ✅ |
| Post preview right pane | PR C | `PreviewCard.tsx` | ✅ | ✅ |
| Mini calendar right pane | PR C | `MiniCalendar.tsx` | ✅ | ✅ |
| Scheduling card (4 modes) | PR E | `SchedulingCard.tsx` | ✅ | ✅ |
| Unsaved-changes dialog | PR E | `UnsavedChangesDialog.tsx` | ✅ | ✅ |
| AI assistant panel | ToolsRow | `ToolsRow.tsx` (AiPanel) | ✅ | ✅ |
| Emoji panel | ToolsRow | `ToolsRow.tsx` (EmojiPanel) | ✅ | ✅ |
| GIF picker (GIPHY) | ToolsRow | `ToolsRow.tsx` (GifPanel) | ✅ | ✅ (needs `NEXT_PUBLIC_GIPHY_API_KEY`) |
| Media upload (MediaTray) | PR C | inside `ComposerEditor.tsx` | ✅ | ✅ |
| UTM tags panel | ToolsRow | `ToolsRow.tsx` (UtmPanel) | ✅ | ✅ |
| Draft submit → POST /api/platform/social/drafts | PR E | `ComposerOverlay.tsx` `handleSubmit` | ✅ | ✅ |
| Approval toggle | PR E | `ApprovalToggle.tsx` | ✅ | ✅ |
| Recurrence picker | PR E | `RecurrencePicker.tsx` | ✅ | ✅ |
| URL-param open (`?compose=new`) | #953 | `ComposerMountV2` | ✅ | ✅ |
| URL-param edit (`?compose=<id>`) | #954 | `ComposerMountV2` | ✅ Pre-fills content | ✅ |
| CAP push-to-composer link | #954 | `CapCampaignDetail` | ✅ "Open in composer" link | ✅ |

---

## Closed gaps

### G1 — `?compose=<id>` opens empty content — CLOSED (PR #954)

**Location:** `components/composer/composer-mount-v2.tsx`

**Was:** When `?compose=<draftId>` is in the URL, `ComposerMountV2Inner` created
an `initialDraft` with the `id` set but `content: ""`. The `ComposerOverlay`
rendered with an empty editor — the existing draft's content was never loaded.

**Fix:** `ComposerMountV2Inner` now runs a `useEffect` that fetches
`GET /api/platform/social/drafts/${initialDraftId}` and maps
`draft_data.master_text → content`, `draft_data.media_refs[].url → media_urls[]`,
`draft_data.target_connection_ids → target_profile_ids`. Rendering is held
(`return null`) until the fetch resolves. Graceful degradation on 4xx/5xx.

**Regression test:** `e2e/composer-mount.spec.ts` — "pre-fills content when
`?compose=<id>` opens an existing draft" (mocks the draft API, asserts textarea value).

### G2 — No "Open in composer" action after CAP push — CLOSED (PR #954)

**Location:** `components/CapCampaignDetail.tsx`

**Was:** After "Push to composer" succeeded, the UI showed a plain `Draft ID: <uuid>`
text with no navigation affordance.

**Fix:** Replaced with an "Open in composer" Next.js `<Link>` pointing to
`/company/social/posts?compose=${post.social_draft_id}`.

---

## Routes covered by `ComposerMountV2`

All routes under `app/(platform)/company/social/` share the layout that mounts
`ComposerMountV2`. Tested routes in `e2e/composer-mount.spec.ts`:

- `/company/social/calendar?compose=new` ✅
- `/company/social/posts?compose=new` ✅
- `/company/social/timeline?compose=new` ✅

Other routes in the layout that also inherit the mount (untested but correct by
inheritance):

- `/company/social/` (root — redirects in practice)
- `/company/social/analytics`
- `/company/social/connections`
- `/company/social/posts/[id]` (post detail — composer would overlay on top)
- `/company/social/media`
- `/company/social/sharing`
- `/company/social/connections/connect/[platform]`

---

## Live feature verification (CI e2e evidence, 2026-05-19)

**CI run**: [26130155721](https://github.com/opollo5/opollo-site-builder/actions/runs/26130155721/job/76853227578), SHA `9b2a0867`, e2e: PASS (12m21s)

The following features were verified via e2e tests running against the live
Next.js server (same code as production):

| Feature | e2e test | Result |
|---|---|---|
| V2 mount at `/company/social/calendar?compose=new` | `composer-mount.spec.ts:27` | ✓ 2.0s |
| V2 mount at `/company/social/posts?compose=new` | `composer-mount.spec.ts:27` | ✓ 2.0s |
| V2 mount at `/company/social/timeline?compose=new` | `composer-mount.spec.ts:27` | ✓ 2.0s |
| Right-pane preview + calendar tabs | `composer-mount.spec.ts:50` | ✓ 1.7s |
| Draft pre-fill via `?compose=<id>` | `composer-mount.spec.ts:61` | ✓ 1.8s |
| Composer opens via `?compose=new` URL | `composer.spec.ts:98` (1) | ✓ 2.6s |
| Loading spinner then editor pane | `composer.spec.ts:108` (2) | ✓ 1.7s |
| Schedule mode (date/time inputs) | `composer.spec.ts:121` (3) | ✓ 1.8s |
| + Add time button | `composer.spec.ts:134` (4) | ✓ 1.9s |
| Approval toggle in schedule mode | `composer.spec.ts:147` (5) | ✓ 1.8s |
| Submit disabled when no profiles | `composer.spec.ts:160` (6) | ✓ 1.7s |
| GIF picker panel | `composer.spec.ts:173` (7) | ✓ 1.9s |
| Emoji panel + insertion | `composer.spec.ts:198` (8) | ✓ 1.9s |
| Close removes `?compose` from URL | `composer.spec.ts:214` (9) | ✓ 2.4s |
| Content editor textarea present | `composer.spec.ts:227` (FIX 19) | ✓ 1.6s |
| V2 scheduling card — post now tab | `composer.spec.ts:307` (V2-1) | ✓ 1.7s |
| V2 scheduling card — schedule tab | `composer.spec.ts:320` (V2-2) | ✓ 1.7s |
| V2 scheduling card — + Add time | `composer.spec.ts:334` (V2-3) | ✓ 1.8s |
| V2 scheduling card — recurrence | `composer.spec.ts:347` (V2-4) | ✓ 1.7s |
| V2 scheduling card — save as draft | `composer.spec.ts:361` (V2-5) | ✓ 1.8s |
| V2 approval toggle + submit payload | `composer.spec.ts:374` (V2-6) | ✓ 1.7s |
| V2 preview pane reflects typed content | `composer.spec.ts:408` (V2-9) | ✓ 1.6s |
| V2 recurring children mode | `composer.spec.ts:438` (V2-7) | ✓ 1.8s |
| V2 rejection reason validation | `composer.spec.ts:477` (V2-8) | ✓ 1.1s |

**Total: 24 passing, 0 failing.**

---

## Features deferred from social-01 spec (out of scope)

Per `project_social_composer_workstream.md` memory:
PRs F–I were explicitly marked out of scope after PRs A–E shipped. These include
advanced scheduling UI, analytics integration, and notification wiring. Not counted
as gaps — they were never in scope for Phase 3/4.
