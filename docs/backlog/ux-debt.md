# UX debt — live items

> Moved from `CLAUDE.md` 2026-05-09 as part of the harness restructure.
> Source: pre-restructure CLAUDE.md §"Backlog — UX debt".
>
> **Shipped items deleted.** Per the restructure directive: ship-state
> lives in git log, not in this backlog. The previous "High — remove
> scope_prefix" (M2d) and "Medium — jargon in design-system authoring
> forms" (M6-4) entries have been removed; consult git log for those.

Operator-facing jargon that leaks DB column names or internal
implementation detail. Pick up on a cleanup slice that naturally lives
in M6 (Per-Page Iteration UI, where admin UX polish fits), or earlier
if a sibling slice happens to be in the same file.

## Low — admin-surface labels that expose IDs

Scan done 2026-04, none found on the primary surfaces:

- `app/admin/batches` / `[id]` — shows "WP id" as a column, which is
  operator-meaningful (they can click through to WP admin); keep.
- `/admin/users` — email + role + status, clean.
- `/admin/sites` — name + URL + status, clean.

No `design_system_id`, `version_lock`, `wp_page_id`, `created_by_uuid`
leaked into labels. Revisit if future surfaces add them.

---

## Image-to-Post UX backlog

> Reference: `docs/briefs/image-generator/IMAGE_TO_POST_FLOW.md` for full gap analysis.
> All items below are proposed priority — Steven to confirm before scheduling.

### [P2] Bulk image-gen destination intent fork

**Problem:** The Generate page does not make the downstream destination explicit before generation. Approving an image may create a scheduled draft (auto-attach) or do nothing (no publish_date), which surprises operators who expected to just download files.

**Reference/Intent:** Two distinct user intents that should be a pre-generation choice — (a) DOWNLOAD: generate files only, no draft creation; (b) POST TO SCHEDULER: auto-attach creates draft with caption + channel + date on approval. Orthogonal to the existing Preview/Generate cost toggle.

**Proposed approach:** Add a destination selector step in the ingest UI before dispatch — "Download images" vs "Create scheduled posts". Drives whether `publish_date` column is required and whether `target_publish_date` is set on jobs. No schema change needed; purely a UI/routing decision.

**Proposed priority:** P2 — needs UI design brief before building.

---

### [P2] Aspect-ratio variant stacking — DECISION NEEDED

**Problem:** Approving multiple images for the same publish date stacks ALL of them onto `media_asset_ids` of a single draft — even when the images are the same content in different aspect-ratio variants (1:1 for LinkedIn, 16:9 for Twitter). These are platform-format alternatives, NOT a carousel. Stacking them produces a draft with 2–4 images attached when the intent is one image per platform post.

**Investigation (confirmed):** The `autoAttachImage` FIND path — when a draft already exists for `(company, date)` — appends to `media_asset_ids` unconditionally. It does NOT check whether the incoming image is a variant of one already attached. Each aspect-ratio variant job runs auto-attach independently and each appends its asset ID. Caption and channel are NOT re-written on the find path (create-only rule), so only the first approval prefills those; subsequent approvals only stack images.

**Proposed approach:** When finding an existing draft for the same date, check whether any already-attached asset shares the same `parent_post_index` as the incoming job. If yes, treat it as a variant replace (swap, don't stack) rather than a new attachment. Requires reading `image_generation_jobs` to correlate `parent_post_index` → asset UUID. Interacts with the empty-shell refinement below — design both together.

**Proposed priority:** P2 — must be resolved before bulk image-gen is client-ready.

---

### [P2] Carousel approval UX — needs brief

**Problem:** Current batch results page uses a static grid of image cards. Steven dislikes this UX. Each card shows only the image with no caption or platform context; Approve gives only a toast with no card state change and no link to the created draft.

**Reference/Intent:** Desired: smooth horizontal card carousel (SmartSlider-style), each image previewed as it will look on its target platform (reuse social-poster preview component), with image numbering, caption shown on card, target platform shown, and card transitions (current fades out + next slides in) on Approve/Reject. After Approve: card shows "Draft created" badge with a link to open the draft in the Composer.

**Proposed approach:** Replace `BatchResultsClient` grid with a new carousel component. Reuse the existing per-platform post preview components. The draft link (post-approve) uses `?compose=<draftId>` URL pattern already established.

**Proposed priority:** P2 — needs a visual brief (Figma/mockup) before building.

---

### [P1] Empty-shell caption/channel refinement *(extends existing entry below)*

**Problem extension:** The create-only rule also silently blocks channel prefill — not just caption. An empty shell (`target_profiles = []`) from a pre-fix approval permanently blocks the LinkedIn account from being pre-selected on future approvals for the same date. Same root cause as the caption blocking.

**Proposed refinement (combined):** In the find path, if `existing_draft.content === ""` AND `existing_draft.target_profiles = []`, write both `post_text` → `content` and resolved connections → `target_profiles`. If either field is non-empty, treat that field as operator-intentional and leave it alone. This fills empty shells completely while still never overwriting real operator text or channel selection.

**Proposed priority:** P1 — simple, high-value, naturally pairs with the variant-stacking fix above.

---

### [P2] Date-shift (UTC midnight scheduling)

**Problem:** Dates targeted in the spreadsheet (e.g. `2026-06-14`) appear to land a day early in the calendar (shows June 13). Likely cause: `target_publish_date` stored as YYYY-MM-DD is converted to `scheduled_at = YYYY-MM-14T00:00:00Z` (midnight UTC). For operators in UTC+10 (AEST) that UTC midnight is June 13 at 10:00 PM local — one calendar day behind.

**Proposed approach:** Investigate the `target_publish_date → scheduled_at` mapping in `autoAttachImage.findOrCreateScheduledDraft` and the `CalendarShell` display logic. Options: (a) use company timezone for midnight instead of UTC midnight; (b) use noon UTC as a timezone-safe anchor; (c) display in company timezone. Decision affects scheduling semantics — investigate before changing.

**Proposed priority:** P2 — affects UX correctness but not correctness of the published post time.

---

### [P3] App-wide icon/font sizing pass *(involve Caleb — design system sweep)*

**Problem:** Icons app-wide are too small/faint; base font size needs ≥1px bump across the product.

**Proposed approach:** One deliberate design-system sweep, not per-screen. Caleb to define target sizes; implement as a single token-level change in the design system (not scattered per-component). The Composer toolbar fix (PR 3 in this batch) is a targeted stopgap only — this item covers the full product.

**Proposed priority:** P3 — final polish, schedule with Caleb.

---

## Image gen — auto-attach caption refinement *(original entry — see P1 above for extended scope)*

**Item:** `findOrCreateScheduledDraft` create-only rule blocks captions on pre-existing empty shells.

**Current behaviour:** `content` is written only on new draft creation, never on update — correct for operator-edited drafts. But if an empty shell (`content = ""`) already exists for a date (e.g. from a pre-fix batch approval), a subsequent approval for the same date finds that draft, appends the image, and leaves `content = ""` — the caption is silently dropped even though the operator hasn't written anything.

**Proposed refinement:** In the find path, if `existing_draft.content === ""` (blank, not just whitespace), write `post_text` to it. This fills empty shells while never overwriting real operator text (any non-empty content is treated as intentional and left alone).

**Risk:** Requires reading `content` from the found draft (one extra field in the SELECT), then a conditional UPDATE. The update must be fail-soft — same contract as the rest of auto-attach. No schema change needed.

**Scope:** `findOrCreateScheduledDraft` in `lib/image/auto-attach.ts` — add `content` to the find SELECT, add a conditional PATCH if found draft has blank content. New test: find-path with blank existing content → content updated; find-path with non-blank content → content NOT updated.
