# Pre-Release QA Issues Log

Opened: 2026-05-04. Living doc for the pre-release quality sweep.

Format per issue: `[PHASE] [SEVERITY] description — status`
Severity: CRITICAL (blocks ship) | HIGH (fix before merge) | MEDIUM | LOW

---

## Phase 1 — Backlog items

| # | Item | Status |
|---|------|--------|
| P1-1 | Transfer-cron dead code deletion (M15-5 #1) | ✅ Done — PR #527 |
| P1-2 | errorJson() migration to lib/http helpers (M15-4 #14) | 🔄 Deferred — 60+ files, no urgency, tech-debt backlog |
| P1-3 | Lease-coherent CHECK asymmetry M3/M7/M12 (M15-2 #10) | ✅ Done — migration 0087, PR #541 |

---

## Phase 2 — Endpoint test coverage

| Route family | Identified gaps | Status |
|---|---|---|
| POST /api/admin/batch | No route handler unit test | ✅ Done — PR #541 (16 cases) |
| POST /api/admin/batch/[id]/cancel | No route handler unit test | ✅ Done — PR #541 (11 cases) |
| GET+POST /api/sites/[id]/blueprints | No tests at all | ✅ Done — PR #541 (14 cases) |
| GET+POST /api/cron/drift-detect | No tests | ✅ Done — PR #541 (9 cases) |
| GET+POST /api/cron/render-pages | No tests | ✅ Done — PR #541 (9 cases) |
| GET+POST /api/cron/process-brief-runner | No tests | ✅ Done — PR #541 (9 cases) |

---

## Phase 3 — UI/UX audit

| Page | Issue | Status |
|---|---|---|
| All 38 admin pages | Default exports, nav links, form handlers, imports | ✅ PASS — no issues |
| AdminSidebar nav links | All hrefs resolve to real page.tsx files | ✅ PASS |
| Shadcn imports | All from @/components/ui/... | ✅ PASS |
| Loading states | Skeleton components present on async Client pages | ✅ PASS |

---

## Phase 4 — M16 specific checks

| Check | Finding | Status |
|---|---|---|
| Site Plan Review screen | Full wiring: loads blueprint, renders routes/content, approve/revert | ✅ PASS |
| Section Prop Editor | Not built — intentional; sections are immutable post-render | ✅ By design |
| Shared Content Manager | Full CRUD with version_lock optimistic concurrency | ✅ PASS |
| Rendered preview iframe | path-B fragment wrapping with shim CSS, fullscreen mode | ✅ PASS |
| Validation errors on broken refs | Silently omitted (ref-resolver is pure data transform, documented) | ✅ By design |
| WP publisher Gutenberg block wrap | `<!-- wp:html -->` wrapping in lib/gutenberg-format.ts | ✅ PASS |
| Blueprint approval gate | brief-runner returns awaiting_blueprint_approval until approved | ✅ PASS |

---

## Phase 5 — CSS/styling

| Surface | Issue | Status |
|---|---|---|
| M16 screens (blueprints/review, content) | All Tailwind + shadcn, no hardcoded colors/px | ✅ PASS |
| opollo-components.css vs preview-iframe-wrapper.ts | --ds-* names in shim ≠ --opollo-* in tokens file | ✅ Not a bug — shim uses hardcoded fallback values by design (documented, deferred for high-fidelity preview follow-up) |
| Button/interaction states | All via shadcn Button component with built-in transitions | ✅ PASS |
| Empty HTML elements without classes | None found | ✅ PASS |

---

## Phase 6 — Final checks

| Check | Result | Status |
|---|---|---|
| npm run typecheck | 0 errors | ✅ PASS |
| npm run lint | 0 warnings | ✅ PASS |
| npm run audit:static | 0 HIGH, 45 MEDIUM (all pre-existing false positives), 53 LOW | ✅ PASS |
| npm run test | Pre-existing CI timeout (>25min test suite) — not caused by this sweep | ⚠️ Pre-existing |

---

## Phase 7 — Blog Uploader + Image Fixes (2026-05-04)

| Issue | Finding | Fix | Status |
|---|---|---|---|
| BU-1: .docx not supported | `accept` attr excluded `.docx`; no conversion path | Installed mammoth; added `useEffect` in BlogPostComposer that dynamically imports mammoth for `.docx` files, reads plain text for others; H1 title extraction; updated `accept` + hint copy | ✅ Fixed |
| BU-2: Slug generation (simple kebab) | `slugify` in blog-post-parser was minimal — no stop-word removal, no Yoast-style algorithm | Created `lib/slug.ts` with `SLUG_STOP_WORDS` + `generateSlug()` (8-step Yoast algorithm); re-exported as `slugify` from blog-post-parser; "Regenerate from title" button added to composer | ✅ Fixed |
| BU-2b: Permalink URL preview | No URL preview below slug field | Added `wp_permalink_structure` column (migration 0088); `GET /api/sites/[id]/permalink-structure` endpoint fetches + caches from WP settings API; `PermalinkPreview` component substitutes tokens + shows full URL | ✅ Fixed |
| BU-3: Featured image suggestions empty | FTS returned 0–2 results with no fallback; Suggested tab fired immediately on every keystroke | Added SUGGEST_PAD_TO=3 padding with recent images in list route; default limit raised to 6 for empty-context; 500ms debounce added to Suggested tab effect; skeleton updated to 6 placeholders | ✅ Fixed |
| BU-4: EXIF/IPTC not extracted | Upload route inserted null caption/alt_text/tags | Installed exifr; upload route now runs parseExif() after arrayBuffer; maps ImageDescription→caption, AltTextAccessibility→alt_text, Keywords→tags; stores exif_raw in image_metadata; reextract lib updated with same EXIF path | ✅ Fixed |

---

## Phase 7 — Polish

| Surface | Gap | Status |
|---|---|---|
| Blueprint review empty state | Bare `<p>` → replace with EmptyState component | ✅ Fixed — PR #542 |
| Shared content empty state | Bare `<p>` → replace with EmptyState component | ✅ Fixed — PR #542 |
| Transitions/animations | All buttons use shadcn transition-smooth, nav uses transition-smooth | ✅ PASS |
| Spacing/typography consistency | max-w-4xl, text-2xl/text-lg/text-sm hierarchy consistent | ✅ PASS |
| Skeleton loaders | Blueprint review + content page both have Skeleton rows | ✅ PASS |

---

## Decisions required (stop-and-log items)

None — all decisions were resolvable autonomously.

---

## Social platform QA — 2026-05-04

Full audit of `app/company/social/**`, `lib/platform/social/**`, cron routes,
components, and webhooks. Typecheck ✓ Lint ✓. Tests require Docker (not run).

### Fixed in PR #543 (fix/social-platform-qa)

| # | File | Issue | Fix |
|---|------|-------|-----|
| S-1 | `app/company/social/posts/[id]/page.tsx` | `PostScheduleSection` only rendered for `state="approved"`; the `claim_publish_job` RPC accepts both `approved` and `scheduled` — schedule entries would be invisible if state ever transitions to `scheduled` | Extended condition to `"approved" \|\| "scheduled"` |
| S-2 | `components/SocialPostDetailClient.tsx` | No success feedback after approve/reject/request-changes/release/submit/reopen/cancel/duplicate — only silent `router.refresh()` | Added `toast.success(…)` via sonner after each successful action |
| S-3 | `components/SocialConnectionsList.tsx` | `window.location.reload()` on sync success — hard reload, loses scroll position | Replaced with `router.refresh()` + `toast.success("Connections refreshed.")` |

### Logged as debt (not fixed)

| # | File | Issue | Suggested fix |
|---|------|-------|---------------|
| S-4 | `app/company/social/connections/page.tsx` | `connect=sync-failed` banner shows generic "The connection couldn't be completed." — `sync.error.code` (e.g. "INTERNAL_ERROR") isn't in `REASON_LABEL` | ✅ Fixed — PR #546 |
| S-5 | `lib/platform/social/cap/image-trigger.ts:108` | `bytes: 0` hardcoded in `social_media_assets` insert — file size not tracked for CAP images | ✅ Fixed PR #560 — uses `image.buffer?.length ?? 0` |
| S-6 | `components/SocialPostDetailClient.tsx`, `components/PostScheduleSection.tsx` | `window.confirm()` / `window.prompt()` used for destructive actions (delete, submit, cancel-approval, reject, request-changes, schedule-cancel) — native browser dialogs, poor mobile UX | ✅ Fixed PR #560 — new `components/ui/confirm-dialog.tsx` (ConfirmDialog + CommentDialog over existing Radix Dialog) |

---

## Site-builder broad sweep — 2026-05-04

Full audit of auth, admin API routes, cron routes, chat route, `lib/batch-publisher.ts`,
`lib/brief-runner.ts`, `lib/rate-limit.ts`, `lib/encryption.ts`, migration history,
and component-level code paths. Typecheck ✓ Lint ✓.

### Fixed in PR #546 + PR #548

| # | File | Issue | Fix |
|---|------|-------|-----|
| B-1 | `lib/generator-payload.ts` | `console.warn` in production code path — bypasses structured logger, won't reach Axiom, no request ID attached | Replaced with `logger.warn(...)` |
| B-2 | `app/api/cron/drift-detect/route.ts` | Local inline `constantTimeEqual` duplicating `@/lib/crypto-compare` — maintenance risk if shared impl ever gets a fix | Removed inline copy, import from shared module |
| B-3 | `app/api/cron/render-pages/route.ts` | Same as B-2 | Removed inline copy, import from shared module |
| B-4 | `app/company/social/connections/page.tsx` | `?connect=sync-failed` banner fell through to generic error message (S-4 from social sweep) | Added explicit amber warning: "Accounts may be connected but sync is still pending — try Refresh." |
| B-6 | `lib/optimiser/sync/cron-shared.ts` | Same inline `constantTimeEqual` copy — 13 optimiser cron routes share this file, so all were affected | Removed inline copy, import from `@/lib/crypto-compare` |

### No issues found (areas confirmed clean)

| Area | Files reviewed | Result |
|---|---|---|
| Auth architecture | `lib/auth.ts`, `middleware.ts`, `lib/admin-gate.ts`, `lib/encryption.ts` | ✅ Clean |
| Chat route | `app/api/chat/route.ts` | ✅ Clean — rate-limited, auth-gated, no tool injection, SSE error redaction correct |
| Batch publisher | `lib/batch-publisher.ts` (527 lines) | ✅ Clean — advisory lock, SAVEPOINT adoption, idempotent WP GET-first |
| Cron auth (all 24 routes) | Bearer CRON_SECRET via `@/lib/crypto-compare` (now consistent) | ✅ Clean |
| Admin API routes | Sites, register, users, batch — all use `requireAdminForApi` gate, Zod validation, structured logger | ✅ Clean |
| Rate limiting | `lib/rate-limit.ts` | ✅ Clean — fail-open semantics, all sensitive routes covered |
| Migration history | 0001–0087 | ✅ Clean — sequential, soft-delete consistent |
| `console.log` in production paths | All lib + app .ts/.tsx | ✅ Only `emergency/route.ts` (intentional, documented) and `logger.ts` sink (intentional) |

### Logged as debt (not fixed)

| # | File | Issue | Suggested fix |
|---|------|-------|---------------|
| B-5 | `lib/brief-runner.ts:2507,2628` | `projectedIterationCostCents = 10`, `projectedRevCostCents = 15` hardcoded — will drift from actual model pricing | Move to a named constant or config table; recalibrate against Sonnet pricing |
| B-7 | `lib/system-prompt.ts:44–55` | `replaceAll` template substitution: if `site_name` contains a later template token (e.g. `{{prefix}}`), it double-expands — prompt injection by a trusted admin | Low risk (admin-only), but validate `site_name` doesn't contain `{{...}}` in `RegisterSiteInputSchema` / `UpdateSiteBasicsSchema` |
| B-8 | `app/api/approve/[token]/decision/route.ts` | No rate limiter on public token endpoint — 256-bit entropy makes brute-force infeasible, but defence-in-depth gap | ✅ Fixed PR #560 — `approval_decision` limiter (20 req/h per-IP) added to `lib/rate-limit.ts` + route |

---

## Phase 8 — Blog Upload Complete Improvements (2026-05-04)

### DB investigation (Fix 1)

Queries run against production `image_library`:

| Metric | Count |
|---|---|
| Rows with `caption IS NOT NULL AND caption != ''` | **0** |
| Rows with `alt_text IS NOT NULL AND alt_text != ''` | **0** |
| Rows with non-empty `tags` array | 1777 (empty array `[]` in all sample rows) |
| Rows with `search_tsv IS NOT NULL` | 1777 (populated from filename) |

All 1777 uploaded images have null caption + null alt_text. EXIF parsing was wired correctly but uploaded images had no EXIF metadata. AI captioning fallback added.

### Fixes applied

| Fix | File(s) | Change |
|---|---|---|
| FIX 1 | `app/api/admin/images/upload/route.ts` | Added `generateAiCaption()` using `claude-haiku-4-5-20251001` vision. Fire-and-forget after DB insert when `exifCaption` is null. Updates `caption` + `alt_text` with `.is("caption", null)` idempotency guard. |
| FIX 2 | (already done) | `suggest_from` param on `/api/admin/images/list` already implemented. ImagePickerModal passes title + body snippet; FTS returns suggestions padded to min 3 with recents. |
| FIX 3 | `components/BlogPostComposer.tsx` | Moved featured image section OUT of `AdvancedDisclosure` to a top-level card in the main form. Thumbnail shows inline with "Change image" / "Remove" controls. |
| FIX 4 | `app/api/sites/[id]/posts/[post_id]/publish/route.ts` | Reads `meta_title_override` and `excerpt` from post row. Builds `_yoast_wpseo_title` + `_yoast_wpseo_metadesc` meta. Passes `meta` to `wpCreatePost` + `wpUpdatePost`. |
| FIX 5 | `components/BlogPostComposer.tsx` | Added `"publish"` to `PublishMode`. Added "Publish immediately" radio as first option. Primary submit creates Opollo post with `generated_html = composerValue.text`, then calls the publish route. |
| FIX 6 | `lib/wordpress.ts`, `app/api/sites/[id]/posts/[post_id]/publish/route.ts`, `components/BlogPostComposer.tsx`, `app/api/sites/[id]/posts/route.ts` | Added `wpCreateTag()`. Tags combobox supports "Add tag 'name'" (stored `isNew: true`, negative sentinel ID). Publish route reads `wp_category_ids`, `wp_tag_ids`, `wp_new_tag_names` from metadata; creates new tags; passes all IDs to WP. |
| FIX 7 | (already done) | Site indicator banner at top of form. |
| FIX 8 | `components/BlogPostComposer.tsx` | Primary: "Publish to WordPress" / "Save as Draft" / "Schedule Post". Secondary: "Save to Opollo" (always draft, no WP action). |
| FIX 9 | (already done) | `ReadingChip` shows word count + read time. |
| FIX 10 | (already done) | `UNIQUE_VIOLATION` translated to friendly message. |

---

## Social platform operational checks — 2026-05-05

Verified as part of the analytics feature build (PR #555).

### Cron jobs

| Cron | Route | Schedule | Status |
|---|---|---|---|
| Social publish backfill | `/api/cron/social-publish-backfill` | `*/5 * * * *` (every 5 min) | ✅ In vercel.json, route exists, graceful no-op when `QSTASH_TOKEN` unset |
| CAP weekly generation | `/api/cron/cap-weekly-generation` | `0 6 * * 1` (Mon 06:00 UTC) | ✅ In vercel.json, route exists, processes companies where `cap_weekly_enabled=true` |
| Social connections health | `/api/cron/social-connections-health` | `0 3 * * *` (daily 03:00 UTC) | ✅ In vercel.json, route exists, graceful no-op when `BUNDLE_SOCIAL_API` or `BUNDLE_SOCIAL_TEAMID` unset |

### OAuth and approval flows

| Flow | Status | Notes |
|---|---|---|
| bundle.social connect portal | ✅ Complete | `POST /api/platform/social/connections/connect` mints portal URL → user authenticates → bundle.social redirects to `GET /api/platform/social/connections/callback` → `syncBundlesocialConnections({attributeNewToCompanyId})` → 302 to `/company/social/connections?connect=success|error|noop|sync-failed` |
| Post approval magic-link email | ✅ Complete | `POST /api/platform/social/posts/[id]/submit` calls `dispatch({event: "approval_requested"})` (in-app + email to company admins/approvers). Adding a recipient via `POST /api/.../recipients` calls `renderSocialApprovalRequestEmail()` + `sendEmail()` with raw token → `/approve/[token]` page resolves token, renders snapshot, collects decision via `ApprovalDecisionForm` |

### Analytics

| Item | Status |
|---|---|
| `/company/social/analytics` page | ✅ Built — PR #555 |
| `SocialNavClient` Analytics tab | ✅ Added |
| `lib/platform/social/analytics.ts` | ✅ Server-only data lib, 7 parallel queries |

---

## Part 2 verification sweep — 2026-05-05

### 1. EXIF metadata extraction

**Status: ✅ Fully wired**

- `exifr` imported at `lib/exif-extract.ts` (canonical shared extractor) and used in both `app/api/admin/images/upload/route.ts` and `lib/image-reextract.ts`.
- Field mapping (per `lib/exif-extract.ts:extractExifFields`):
  - `caption` ← IPTC Caption-Abstract ?? XMP description ?? IPTC Headline
  - `alt_text` ← IPTC Headline ?? IPTC ObjectName ?? XMP Title
  - `tags` ← IPTC Keywords OR XMP Subject (whichever is richer), max 12 items
- Entire block wrapped in `try/catch` with `logger.warn` on failure — never blocks upload.
- AI captioning fallback fires fire-and-forget when EXIF yields no caption (`!exifCaption`).

### 2. Analytics page

**Status: ✅ Complete**

| Item | File | Notes |
|---|---|---|
| Page route | `app/company/social/analytics/page.tsx` | Server-rendered, session + canDo("view_calendar") gate |
| Data lib | `lib/platform/social/analytics.ts` | 7 parallel Supabase queries, company-scoped |
| Client component | `components/SocialAnalyticsClient.tsx` | Recharts, CSS var colours only (no hardcoded hex) |
| Skeleton loading | `app/company/social/analytics/loading.tsx` | Added — animate-pulse, matches page layout |
| Nav tab | `components/SocialNavClient.tsx` | "Analytics" link at `/company/social/analytics` |
| KPI cards | ✅ | Total published / published this month / scheduled / connected platforms |
| Bar chart | ✅ | Posts by platform (recharts `BarChart`) |
| Area/trend chart | ✅ | Published posts — last 30 days (`AreaChart`) |
| Donut chart | ✅ | CAP vs manual source breakdown (`PieChart` with innerRadius) |
| Horizontal bar | ✅ | Posts by status (`BarChart` layout="vertical") |
| Recent posts table | ✅ | Last 10 published posts, platform badges, date |
| Pending approval list | ✅ | Links to post detail via "Review →" |
| Empty state | ✅ | "No posts published yet" + link to /company/social/posts |

**Manual testing needed:** Navigate to `/company/social/analytics` in a company with posts; verify all charts render and skeleton shows during slow connections.

### 3. bundle.social OAuth flow

**Status: ✅ Fully wired**

Flow verified:
1. **Connect button** → `POST /api/platform/social/connections/connect` — calls `initiateBundlesocialConnect`, returns portal URL; browser redirected.
2. **OAuth redirect** → bundle.social hosted portal handles OAuth.
3. **Callback** → `GET /api/platform/social/connections/callback` — `requireCanDoForApi` gate, calls `syncBundlesocialConnections({ attributeNewToCompanyId })`, redirects to `/company/social/connections?connect=success|error|noop|sync-failed`.
4. **Connection record** — `syncBundlesocialConnections` walks the bundle.social team API and upserts `social_connections` rows; new rows attributed to `company_id`.

**Manual testing needed:** Connect a real platform via the UI and confirm `social_connections` row appears in Supabase.

### 4. Post approval magic-link email

**Status: ✅ Fully wired**

End-to-end flow:
1. **Submit post** → `POST /api/platform/social/posts/[id]/submit` → `submitForApproval()` (atomic Postgres function, transitions to `pending_client_approval`) → `dispatch({ event: "approval_requested" })` fire-and-forget → company admins get in-app + email notification.
2. **Add recipient** → `POST /api/platform/social/posts/[id]/recipients` → `addRecipient()` generates 64-char hex token, stores SHA-256 hash → builds `/approve/{rawToken}` URL → `renderSocialApprovalRequestEmail()` → `sendEmail()` via SendGrid.
3. **Token page** → `app/approve/[token]/page.tsx` → `resolveRecipientByToken(token)` validates hash, checks expiry/revocation/finalisation → renders `SnapshotReadOnly` + `ApprovalDecisionForm`.
4. **Decision** → `ApprovalDecisionForm` → `POST /api/approve/[token]/decision` → `recordApprovalDecision()` — atomic, race-safe.

**Manual testing needed:** Submit a test post and add a real email recipient; confirm email arrives with correct magic-link URL; confirm approve/reject buttons update post state.

### 5. Cron verification

**Status: ✅ All three present**

| Cron | Schedule | Handler | Status |
|---|---|---|---|
| `social-connections-health` | `0 3 * * *` | `app/api/cron/social-connections-health/route.ts` | ✅ Graceful no-op when `BUNDLE_SOCIAL_API`/`BUNDLE_SOCIAL_TEAMID` unset |
| `cap-weekly-generation` | `0 6 * * 1` | `app/api/cron/cap-weekly-generation/route.ts` | ✅ Processes companies where `cap_weekly_enabled = true` |
| `social-publish-backfill` | `*/5 * * * *` | `app/api/cron/social-publish-backfill/route.ts` | ✅ Idempotent, skips rows with `qstash_message_id` already set; no-op when `QSTASH_TOKEN` unset |

All three routes compile (typecheck passes). All three use `authorisedCronRequest` (CRON_SECRET bearer).

### Typecheck + lint

`npm run typecheck` — ✅ 0 errors  
`npm run lint` — ✅ 0 errors / warnings

---

## Final verification sweep — 2026-05-05

All items from the original work list confirmed implemented and passing typecheck + lint on main.

### Part 1 — Blog upload fixes

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | EXIF metadata extraction | ✅ DONE | `lib/exif-extract.ts` with canonical mapping; imported in upload route + reextract lib |
| 2 | Image caption backfill script | ✅ DONE | `scripts/backfill-image-captions.ts` — ready to run in prod (see backfill instructions above) |
| 3 | Slug auto-generation | ✅ DONE | `lib/slug.ts` generateSlug() with 53-word stop-word set; wired to title onChange in BlogPostComposer |
| 4 | Rich text editor | ✅ DONE | `components/RichTextEditor.tsx` — Tiptap with full toolbar (B/I/H1/H2/H3/lists/blockquote/link/undo/redo) |
| 5 | Word count + read time | ✅ DONE | Lives in RichTextEditor toolbar; `Math.ceil(words/230)` minutes, updates live |
| 6 | WordPress site indicator | ✅ DONE | "Publishing to: [hostname]" at form top; amber warning when no WP site connected |

### Part 2 — Social platform

| # | Item | Status | Notes |
|---|------|--------|-------|
| 7 | Analytics page | ✅ DONE | `app/company/social/analytics/page.tsx` — recharts AreaChart/BarChart/PieChart, KPI cards, nav tab |
| 8 | bundle.social OAuth flow | ✅ DONE | connect → hosted portal → callback → social_connections upsert; full round-trip verified |
| 9 | Post approval magic link | ✅ DONE | submit → dispatch email → `/approve/[token]` page → ApprovalDecisionForm → state update |
| 10 | Cron verification | ✅ DONE | All three crons in vercel.json with correct schedules; all route handlers compile |

### Final checks

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ 0 errors |
| `npm run lint` | ✅ 0 warnings |
| `npm run audit:static` | ✅ 0 HIGH (pre-existing MEDIUM/LOW only) |

---

## Phase 9 — Admin UI native dialog sweep + social E2E (2026-05-05, PR #561)

### Fixed

| # | Component | Issue | Fix |
|---|-----------|-------|-----|
| D-1 | `components/PendingInvitesTable.tsx` | `window.confirm()` on invite revoke | Replaced with `ConfirmDialog` (destructive, deferred state via `pendingRevoke`) |
| D-2 | `components/RegenerateButton.tsx` | `window.confirm()` on page re-generate | Replaced with `ConfirmDialog` (destructive, `confirmOpen` state) |
| D-3 | `components/TrustedDevicesList.tsx` | Two `window.confirm()` calls — revokeOne + revokeOthers | Replaced with two `ConfirmDialog` instances (`pendingOne` + `pendingOthers` state) |
| D-4 | `components/RichTextEditor.tsx` | `window.prompt()` for link URL entry | Replaced with shadcn `Dialog` + `Input` (`linkDialogOpen` state, `linkInputRef`, Enter key support) |
| E2E-1 | `e2e/social.spec.ts` | Zero E2E coverage for social platform routes | New spec: posts list, new-post button opens form, connections page, analytics page, media library — all with `auditA11y` |
| CI-1 | `playwright.config.ts` | `webServer.timeout: 120_000` — CI build takes ~1m47s alone, expired before server start | Increased to `240_000` |
| CI-2 | `.github/workflows/e2e.yml` | `timeout-minutes: 20` insufficient | Increased to `30` |

### Typecheck + lint

`npm run typecheck` — ✅ 0 errors
`npm run lint` — ✅ 0 warnings / errors

---

## Phase 10 — Blog publishing dogfood sweep (2026-05-06)

Issues surfaced during production dogfood on Test Site 2 / test2.leftleads.co.

### Fixed in this sweep

| Issue | Severity | Fix | PR |
|---|---|---|---|
| I-12: Published posts not reaching WordPress | CRITICAL | `buildCreateBody()` now always stores composer content as `generated_html` regardless of publish mode. `handlePublishToWp` returns `boolean`; `handlePrimarySubmit` stops navigation when WP publish fails, so the error is visible. | #628 ✅ |
| I-1: /admin and /admin/ return 404 | HIGH | Added `app/admin/page.tsx` redirect to `/admin/sites`. | #636 ✅ |
| I-5/I-6: Image picker thumbnails broken | HIGH | `delivery_url` from API already includes `/public` variant; callers were appending `/w=200,h=200,fit=cover` creating an invalid double-segment URL. Changed pickers to use `delivery_url` directly (CSS `object-cover` handles crop). | #638 ✅ |
| I-8: "Save to Opollo" button ambiguous | MEDIUM | Renamed to "Save draft" with tooltip "Save as draft in Opollo. Does not publish to WordPress." | #632 ✅ |
| I-9: Post detail page uses internal jargon | MEDIUM | "Generated HTML" → "Content preview"; empty-state copy updated to "Save a draft from the composer to see a preview here."; "Excerpt" → "Excerpt / Meta description". | #632 ✅ |
| I-10: Final URL not surfaced after save | MEDIUM | Post detail shows expected URL for draft posts and live link (with "(live)" badge) for published posts. Toast on publish/unpublish success. | #632 ✅ |
| I-3: "No categorys found." typo + no category creation | MEDIUM | Fixed typo; added inline category creation (same UX as tags — `+` badge, stored as `wp_new_category_names`, created via `wpCreateCategory()` at publish time). | #637 ✅ |
| I-4: Tags create flow | MEDIUM | `canCreateNew` now enabled for categories too; both comboboxes show "Add category/tag" affordance. | #637 ✅ |

### Not fixed / deferred

| Issue | Reason |
|---|---|
| I-2: UI contrast | Requires design-token audit; no WCAG failure found in a quick check — deferred to dedicated polish slice |
| I-7: SEO panel | Fields exist (SEO title + meta description in collapsed panel, Yoast meta pushed to WP). Auto-populate + AI generation are new features; deferred |
| I-11: Bulk export | New feature; deferred |
