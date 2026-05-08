# Spec 22 — Universal social post composer

**Status:** Queued
**Phase:** 3 (per build proposal v2)
**Estimated:** 5 weeks across 5 PRs
**Depends on:** ADRs 0001-0004, Spec 19 PR 1+2, autosave validation lab passing all 12 scenarios
**Reference UX:** Semrush Social Poster (locked design reference)

---

## 1. Goal

Build a universal post composer for `/company/social/*` that mirrors the Semrush Social Poster experience: a full-screen modal overlay with a left-pane editor and right-pane live preview, opened from "New post" buttons or calendar date clicks, returning the user to where they came from on close.

This becomes the canonical New Post flow, replacing the current inline form embedded in `SocialPostsListClient.tsx`.

---

## 2. Locked decisions (from build proposal v2 + ADRs)

| ID | Decision |
|---|---|
| D2 | Drafts are visible to all editors in the company (collaborative) |
| D10 | Composer state machine: explicit named transitions via `useReducer` or Zustand. **No scattered booleans.** XState rejected as overkill |
| D11 | URL strategy: search param (`?compose=new` or `?compose=<post-id>`). Modal mounted via search-param read |
| D12 | Image picker scope V1: three sources from day one — Opollo AI generator, iStock library (9k images), direct user upload |
| D13 | Transient UI never autosaved (modal openness, hover, tab selection, filters). Persisted: content, media refs, schedule, target profiles, AI metadata |
| D14 | Draft versioning: `draft_version`, `updated_at`, `updated_by` columns. Stale writes rejected with conflict prompt |
| D17 | Autosave validation lab must pass all 12 scenarios before PR 1 starts |
| D19 | Timeline view ships as Spec 22 PR 5 (basic chronological feed) |

---

## 3. V1 hard exclusions (do not build)

These are explicitly out of scope. Mid-build requests to add them require a written exception per build proposal v2.

- ❌ Mobile-optimised composer (desktop-only V1; mobile shows degraded read-only experience)
- ❌ Per-platform copy variants (LinkedIn copy = Twitter copy = Facebook copy in V1)
- ❌ Recurring schedules / "Publish regularly" mode (placeholder tab, no functionality in V1)
- ❌ Bulk-CSV → composer round-trip (CSV import works; opening a row in the composer to edit is V2)
- ❌ Hashtag suggestions, `@` mentions, link unfurl previews
- ❌ Multi-image posts, carousels, polls (single image per post in V1)
- ❌ A/B test variants
- ❌ Brand voice / tone training within composer (AI uses generic prompts in V1)
- ❌ Engagement-time prediction
- ❌ Mobile responsive workflow tests

---

## 4. Reference layout (Semrush composer)

Full-screen modal overlay split into two panes:

**Left pane (~60% width) — Editor:**
- Title: "New post"
- Profile selector row: `+` icon and "Select all" link, multi-select connected accounts
- Copy textarea with placeholder "Paste a link or type something"
- Image upload zone (dashed box with image+ icon); supports three sources per D12
- Tools row: emoji picker, GIF picker, UTM tags, Add tag, AI Assistant trigger
- Mode tabs: Post now | Schedule | Publish regularly | Save as draft
- (Schedule mode) Date picker + Time picker + "Add time" link for multi-time scheduling
- "Post needs approval" toggle with "Learn more" link
- Primary action button (label changes by mode: "Post" / "Schedule" / "Publish regularly" / "Save")
- Secondary action: "Schedule & create another" (or mode equivalent)

**Right pane (~40% width) — Preview:**
- Tab switcher: "Post preview" | "Calendar"
- Live preview card per platform (LinkedIn, Twitter, Facebook, GBP)
- Empty state: "Select at least one profile and start typing to see preview"
- Calendar tab: mini month view showing where this post would land

**Top right of overlay:** `×` close button (returns to underlying URL).

---

## 5. Trigger surfaces

The composer opens from:

| Trigger | URL change |
|---|---|
| "New post" button on `/company/social/calendar` | `?compose=new` appended |
| "New post" button on `/company/social/posts` | `?compose=new` appended |
| Click on a calendar date (empty or with posts) | `?compose=new&date=2026-05-04` (date pre-fills schedule) |
| "Edit" on existing post in posts list | `?compose=<post-id>` appended (composer pre-fills from post data) |
| Direct URL with `?compose=...` | Composer opens on page load |

Closing the composer (× button, Esc, or Cancel) removes the search param. Browser back closes the composer naturally.

---

## 6. State model (per ADR 0001)

Composer internal state machine. **No scattered booleans permitted.** Use `useReducer` with discriminated union OR Zustand with named transitions — developer's choice based on team familiarity.

```ts
type ComposerState =
  | { status: 'idle' }
  | { status: 'editing'; draft: Draft; dirty: boolean }
  | { status: 'saving'; draft: Draft }
  | { status: 'saved'; draft: Draft; savedAt: Date }
  | { status: 'publishing'; draft: Draft }
  | { status: 'published'; postId: string }
  | { status: 'failed'; draft: Draft; error: ComposerError; retryable: boolean }
  | { status: 'recovering'; staleDraft: Draft; freshDraft: Draft }

type Draft = {
  draft_version: number;
  master_text: string;
  link_url?: string;
  media_refs: MediaRef[];
  target_connection_ids: string[];
  schedule?: { date: string; times: string[] };
  approval_required: boolean;
  ai_metadata?: { prompt: string; tone: string; generated_at: string };
}
```

Allowed transitions documented in `/docs/adrs/0001-composer-state-model.md`.

---

## 7. Persistence model (per ADR 0002)

### Server draft table

New table `social_post_drafts`:

```sql
CREATE TABLE social_post_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users(id),
  updated_by UUID NOT NULL REFERENCES auth.users(id),
  draft_version INT NOT NULL DEFAULT 1,
  draft_data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ NULL
);

CREATE INDEX idx_social_post_drafts_company ON social_post_drafts(company_id, archived_at);
CREATE INDEX idx_social_post_drafts_updated ON social_post_drafts(updated_at DESC);
```

Migration number: assign next available (likely 0105).

### Save endpoint contract

`POST /api/platform/social/drafts/[id]`

```ts
const SaveSchema = z.object({
  draft_version: z.number().int(),
  draft_data: DraftDataSchema,
});
```

Server checks `draft_version` matches current row. If mismatch: returns `409 CONFLICT` with current row state. Client shows "Draft was updated by another tab/user. Reload latest?" prompt per ADR 0002.

### Autosave cadence

Use the validated hooks from Spec 14 PR B:
- 800ms debounce after last keystroke
- Tab leader election (only one tab per draft saves)
- Visibility-aware (slower when tab backgrounded)

Drafts visible to all editors in company per D2. RLS policy:
```sql
CREATE POLICY social_post_drafts_company_editors
  ON social_post_drafts FOR ALL
  USING (
    company_id IN (
      SELECT company_id FROM company_users
      WHERE user_id = auth.uid()
        AND role IN ('editor', 'approver', 'admin', 'super_admin')
    )
  );
```

---

## 8. Migration plan (5 PRs)

### PR 1 — Composer shell + URL wiring + draft persistence layer

**Branch:** `feat/spec22-pr1-composer-shell`

**Deliverables:**
- Migration adding `social_post_drafts` table
- `<PostComposerModal>` component — modal mounting, search-param read on mount, close behaviour, focus trap, Esc/× handling
- Reducer or Zustand store implementing the state machine from §6
- Save endpoint `/api/platform/social/drafts/[id]` with version check
- Autosave wiring using validated Spec 14 hooks (lab passing is hard prerequisite)
- Empty modal renders correctly — no editor content yet
- Feature flag `FEATURE_COMPOSER_V2` (default off; on in dev)

**State transitions live:** `idle → editing → saving → saved → idle`

**Visual checkpoint (Steven):** Open composer from `/company/social/calendar` "New post" button. Type something. Close modal. Refresh. Verify draft restored.

**Risk:** MEDIUM (state machine + autosave first real adoption)

**Lines of code estimate:** ~800

---

### PR 2 — Core editor

**Branch:** `feat/spec22-pr2-core-editor`

**Deliverables:**
- `<ProfileSelector>` — multi-select connected accounts, "+", "Select all"
- `<ComposerTextarea>` — placeholder, character count, link detection
- `<ImageUploadZone>` — three-source picker per D12:
  - Tab/segment 1: AI generator (calls existing `/api/platform/social/cap/generate` with image-mode)
  - Tab/segment 2: iStock library browser (paginated, search by tag/title — leverages existing image library)
  - Tab/segment 3: Direct upload (drag-drop + file input, integrates with existing Cloudflare Images upload)
- `<ToolsRow>` — emoji, GIF, UTM, Add tag (AI Assistant trigger placeholder; real wiring in PR 4)
- `<SchedulingTabs>` — Post now / Schedule / Save as draft (Publish regularly tab placeholder, returns "coming soon")
- `<ScheduleDatePicker>` + `<ScheduleTimePicker>` — when Schedule mode active
- `<ApprovalToggle>` — toggle with "Learn more" link to existing approval workflow docs
- `<ComposerActions>` — primary button (label changes per mode) + "Schedule & create another"
- Wire through to existing `POST /api/platform/social/posts` on submit

**Visual checkpoint (Steven):** Compose post end-to-end. Schedule it. Verify it appears in calendar.

**Risk:** MEDIUM (image picker complexity)

**Lines of code estimate:** ~1500

---

### PR 3 — Preview pane

**Branch:** `feat/spec22-pr3-preview-pane`

**Deliverables:**
- `<ComposerPreview>` right pane
- `<PreviewTabs>` — Post preview | Calendar
- `<LivePreviewCard>` per platform:
  - LinkedIn preview (matches LinkedIn post visual)
  - Twitter/X preview (matches X post visual)
  - Facebook preview (matches FB post visual)
  - GBP preview (matches Google Business Profile post visual)
- Live update on every keystroke (debounced; no per-platform variants in V1 — all platforms show same copy per D12 exclusions)
- Empty state: "Select at least one profile and start typing to see preview"
- `<MiniCalendarPreview>` — Calendar tab shows month view with selected date highlighted

**Visual checkpoint (Steven):** Preview pane updates live as user types. Per-platform previews look correct.

**Risk:** LOW (mostly UI work, no new backend)

**Lines of code estimate:** ~1000

---

### PR 4 — AI Assistant integration

**Branch:** `feat/spec22-pr4-ai-assistant`

**Deliverables:**
- AI Assistant button in tools row triggers inline expansion below textarea (NOT a separate modal)
- Sub-panel inputs:
  - Prompt textarea ("Write a post about...")
  - Tone selector: professional / casual / playful (generic V1 — brand voice deferred per exclusions)
  - Length: short / medium / long (~60ch / ~150ch / ~280ch)
  - Platform-aware: if Twitter/X selected, optimises for 280 chars
- Wires to existing `POST /api/platform/social/cap/generate`
- Streams generated text into composer textarea
- "Replace" / "Append" buttons after generation completes
- Cost tracking via existing tenant budget system; if budget exhausted, button shows tooltip "Out of AI credits"
- Existing rate limit (10 triggers/company/24h) respected

**Visual checkpoint (Steven):** Click AI Assistant, generate a post, accept it, post appears in textarea. Quality acceptable.

**Risk:** LOW (existing API; mostly wiring)

**Lines of code estimate:** ~600

---

### PR 5 — Timeline view + final polish

**Branch:** `feat/spec22-pr5-timeline-and-polish`

**Deliverables:**
- Timeline view at `/company/social/timeline` — basic chronological feed of all posts across platforms (per D19)
- Timeline button in `SocialViewToggle.tsx` no longer disabled; routes to new view
- "Schedule & create another" secondary button — saves current draft, opens fresh composer
- Multi-time scheduling: "Add time" link in Schedule mode — creates N copies of post at different times
- Final composer polish: keyboard accessibility audit, focus trap verification, screen reader labels
- E2E tests: draft recovery, scheduling, multi-profile selection, AI insertion, browser-close-reopen recovery
- Feature flag `FEATURE_COMPOSER_V2` flipped to default-on after rollout sequence

**Visual checkpoint (Steven):** Timeline shows posts in chronological order. Composer feels polished. No keyboard trap bugs.

**Risk:** LOW

**Lines of code estimate:** ~800

---

## 9. Observability requirements

Per build proposal v2 §"Observability requirements", every workflow emits structured logs:

```
compose_opened          { user_id, company_id, source: 'calendar' | 'posts' | 'edit', correlation_id }
compose_closed          { user_id, company_id, dirty: boolean, mode: 'cancel' | 'save' | 'schedule', correlation_id }
draft_saved             { draft_id, version, bytes, latency_ms, correlation_id }
draft_save_failed       { draft_id, error_code, retryable, correlation_id }
draft_recovered         { draft_id, source: 'localStorage' | 'server', correlation_id }
draft_conflict          { draft_id, conflicting_version, resolved_by: 'reload' | 'overwrite', correlation_id }
publish_started         { post_id, company_id, profile_count, correlation_id }
publish_succeeded       { post_id, latency_ms, correlation_id }
publish_failed          { post_id, error_code, platform, correlation_id }
ai_generated            { user_id, prompt_chars, output_chars, cost_usd, correlation_id }
ai_failed               { user_id, error_code, retryable, correlation_id }
```

Correlation ID propagated through `x-correlation-id` HTTP header, all log lines, toast errors (last 8 chars shown to user), Sentry/Axiom metadata.

---

## 10. Feature flag rollout

Flag: `FEATURE_COMPOSER_V2`

| Stage | Rollout | Trigger |
|---|---|---|
| Internal | `super_admin` users only | PR 1 merged |
| 10% | First 10% of companies (alphabetical) | PR 5 merged + Steven's final visual checkpoint passed |
| 50% | Half of companies | 7 days after 10% with no critical bugs |
| 100% | All companies | 14 days after 50% with no critical bugs |

Kill switch: setting `FEATURE_COMPOSER_V2=false` reverts to current `SocialPostsListClient.tsx` inline form. No data loss (drafts persist regardless).

Deprecation date: `FEATURE_COMPOSER_V2` flag removed and old inline form deleted 30 days after 100% rollout.

---

## 11. Per-PR rollback metadata

Each PR description includes:
- **Reversible?** Yes (all 5 PRs)
- **Migration required?** PR 1 yes (drafts table); PR 2-5 no
- **Data risk?** PR 1: None (new table). PR 2-5: None.
- **Fallback route?** Existing `SocialPostsListClient.tsx` inline form remains functional behind feature flag.

---

## 12. Definition of done

✅ Composer opens from all 4 trigger surfaces in §5
✅ All state transitions in §6 work without scattered booleans
✅ Draft autosave works; conflicts handled per ADR 0002
✅ Image picker offers all three sources (AI / iStock / upload) per D12
✅ AI Assistant generates usable content via existing `/api/platform/social/cap/generate`
✅ Live preview renders correctly per platform
✅ Timeline view ships at `/company/social/timeline`
✅ All V1 exclusions respected (no per-platform variants, no mobile, no recurring schedules)
✅ All 11 logged events emit in production
✅ Correlation IDs flow end-to-end
✅ Feature flag rollout plan executed
✅ E2E tests cover: draft recovery, scheduling, multi-profile, AI insertion, browser-close-reopen
✅ Steven's 5 visual checkpoints (one per PR) signed off
✅ No regressions on Specs 02, 05, 07, 08, 14, 18

---

## 13. Operating rules for Claude Code

- Single tab. Sequential PRs. No parallel composer work.
- Auto-merge each PR when CI green per CLAUDE.md autonomy posture
- Pause for Steven's visual checkpoint between each PR — do NOT auto-progress
- If autosave lab discovers Spec 14 hook defects mid-Spec-22, STOP and fix in Spec 14 follow-up PR before continuing
- Respect freeze list: no Dependabot, no framework upgrades, no off-list schema changes
- ADRs 0001-0004 are authoritative for architectural decisions; do not deviate without exception process

---

*End of Spec 22.*
