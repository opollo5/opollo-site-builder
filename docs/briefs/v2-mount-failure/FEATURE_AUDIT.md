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

## Features deferred from social-01 spec (out of scope)

Per `project_social_composer_workstream.md` memory:
PRs F–I were explicitly marked out of scope after PRs A–E shipped. These include
advanced scheduling UI, analytics integration, and notification wiring. Not counted
as gaps — they were never in scope for Phase 3/4.
