# Decisions Locked

This file replaces every "awaiting sign-off," "open question," "for director review," and "TBD" in the prior versions of this brief. Every decision below is **final** for the purposes of autonomous build. Steven (director sponsor) may override in review; default behaviour during build is to follow this document.

Decisions are organised by source document.

---

## 1. Composer Parity Spec — scheduling open questions

From `Scheduling_Proposal.md` §13.

| # | Question | LOCKED ANSWER | Rationale |
|---|---|---|---|
| Q1 | Six pre-generated recurring occurrences — right number, or configurable? | **Six. Configurable later via `social_settings.recurring_pregeneration_count`, default = 6.** | Six covers ~2 weeks of weekly cadences and ~1 quarter of monthly cadences. Configurable knob exists for v2 but no UI yet — settings DB row only. |
| Q2 | Approval batching default — "Approve all" vs individual? | **"Approve all" by default. Individual still available via a row-level button.** | Lower friction for agencies who trust the content team. Individual is one click further but visually present. |
| Q3 | Reject reasons — required free text? | **Required. 30-character minimum, 500-character maximum. Field name `rejection_reason` on `social_post_approval_decisions`.** | Forces clarity. Gives the author actionable feedback. 30 chars is enough to be useful, short enough to not be friction. |
| Q4 | What if the approver is on PTO and the post sits in `pending_approval`? | **Auto-escalate to all platform admins (role = `platform_admin`) of the owning company after 48h. Escalate again at 72h via email + Slack. If still no action at 96h, post auto-rejects with `rejection_reason = "Auto-rejected: no approver action within 96 hours"`.** | Bounded waiting period. Auto-reject is safer than auto-publish on a stale decision. Author can resubmit. |
| Q5 | Past-dated bulk CSV rows — fail whole upload, or skip with warning? | **Fail the whole upload. No partial commits. Return 400 with row-level errors. User fixes CSV and re-uploads.** | Partial commits create cleanup headaches. Whole-batch failure is unambiguous. |

---

## 2. Frontend Template Framework — D-decisions

From `Frontend_Template_Framework_Pass_1.md` §1.

| ID | Decision | LOCKED ANSWER | Rationale |
|---|---|---|---|
| D-1 | Lucide vs Linearicons | **Linearicons (canonical). Update docs to match reality. No icon-system migration in this workstream.** | Linearicons is what's in the codebase via NavIcon wrapper. Migrating to Lucide is a multi-week sweep with zero user-facing benefit. Defer. |
| D-2 | Width mode for layout-driven routes (design-system subtree, 4 routes) | **Keep `layout-driven` as a 5th width mode. Restrict to the 4 design-system subtree routes only. Document the exception in `framework/TEMPLATES.md` under T-LIST-STANDARD, T-DETAIL-SUMMARY, T-GRID.** | Migrating these to PageShell-standard is invasive (layout file owns shell). Codifying the exception is cleaner than forcing a refactor. |
| D-3 | PageShell adoption in /company, /company/social, /optimiser | **Adopt PageShell everywhere. Sweep behind a feature flag `FEATURE_UNIFIED_SHELL`. The PageShell migration is a separate PR per module (3 PRs total: `company`, `company/social`, `optimiser`). Ships before the framework wave 2 begins.** | Consistency matters more than habit. Feature flag protects against regression during rollout. |
| D-4 | Detail-tabbed footer-action slot (RECURRING-2 dead-end fix) | **Add `footerActions` slot to T-DETAIL-TABBED. Default contents for the social-posts variant: `[View on platform, Schedule another, Back to posts]` rendered as a sticky bottom bar. Right-aligned. Primary button is `Schedule another` (uses `--color-brand-primary`).** | Concrete fix for RECURRING-2. Slot is generic; default content is per-route configurable. |
| D-5 | Detail-editor max-width (/admin/sites/[id]/pages/[pageId]) | **Keep `max-w-4xl` (896px). Prose readability is the intent.** | 896px is the optimal prose line-length range (66–80 characters). Widening to standard (1200px) hurts readability. |
| D-6 | Modal sizing scale | **`size="sm"|"md"|"lg"|"xl"|"full"` prop on Dialog. Values: sm=440px, md=640px (default), lg=860px, xl=1080px, full=`calc(100vw - 64px)`. Remove manual `max-w-*` from individual modals.** | Matches the dominant audit values (max-w-md ≈ 448, max-w-3xl ≈ 768, max-w-lg ≈ 512). Five sizes covers the inventory. |
| D-7 | Section header — H2 component vs SectionHeader primitive | **Extract `<SectionHeader>` primitive. Signature: `<SectionHeader title subtitle? actions? />`. Renders `<h2 class="text-section-title">` internally. Used in T-DETAIL-SUMMARY, T-LIST-WIDE, T-DASHBOARD-KPI.** | Sections frequently need a right-aligned action (Edit, Add, filter pills). H2 alone is too thin. |
| D-8 | Pagination — standalone primitive or DataTable-embedded | **Standalone `<Pagination>` primitive. Signature: `<Pagination total page pageSize onPageChange pageSizeOptions? />`. Renders Previous/Next + page indicator + optional page-size selector. Includes `aria-label="Pagination"`, `aria-disabled` on disabled links. DataTable accepts it as a prop.** | Reusable on non-table views (image gallery, audit log). Standalone is more flexible. |
| D-9 | EmptyState canonical signature | **`<EmptyState icon title body? cta? />` where `icon` is a Linearicons name string, `body` is optional string, `cta` is an optional Button primitive instance. Renders centered with vertical padding `py-12`. Used everywhere.** | Single shape across all 12+ surfaces. No more inline dashed divs. |
| D-10 | Banner Alert variants (replace BlogStyleCalibrationBanner + OnboardingReminderBanner) | **Add `<Alert variant="info">` and `<Alert variant="warning">` with banner-shape preset (icon + heading + body + dismiss). Delete BlogStyleCalibrationBanner and OnboardingReminderBanner. Migrate 4 consuming routes.** | Two bespoke banners that re-implement Alert with no role and no aria-live is an accessibility failure. Alert variant covers both cases. |
| D-11 | Width=none clusters | **Migrate all three (admin/images, optimiser/proposals, optimiser/change-log) to `width=wide` in PageShell. The "none" tag is an audit artefact reflecting missing PageShell.** | These are tabular pages. Wide is the right width. |

---

## 3. Pass 1 framework — §8 supplementary questions

| # | Question | LOCKED ANSWER |
|---|---|---|
| Q1 | `/admin/sites/[id]/posts/[post_id]` — T-DETAIL-SUMMARY or T-DETAIL-EDITOR? | **T-DETAIL-EDITOR.** The route delegates to `PostDetailClient` which renders an editing surface. Editing semantics dominate. |
| Q2 | Should T-FORM and T-WIZARD-STEP share a base? | **No.** Different progress indicators, different action footers. Sharing would force a confused base. |
| Q3 | Should T-DASHBOARD-KPI and T-DASHBOARD-FEED share a base? | **No.** KPI is "show me numbers"; feed is "show me activity." Different visual hierarchies. |
| Q4 | PageShell migration policy for non-shell routes (per D-3) | **Sweep behind feature flag, one module per PR (3 PRs total). Module order: `optimiser` first (lowest risk, internal-facing), then `company`, then `company/social` (highest risk, customer-facing).** |
| Q5 | `/admin/sites/[id]/posts` vs `/admin/sites/[id]/posts/[post_id]` (editor) vs `/admin/sites/[id]/posts/[post_id]` (summary) — three routes? | **Two routes only.** `/admin/sites/[id]/posts` (list, T-LIST-STANDARD) and `/admin/sites/[id]/posts/[post_id]` (editor, T-DETAIL-EDITOR). The audit's "summary" entry for the post detail page is the cluster ID artefact — the route is editor. |

---

## 4. Composer architectural decisions (previously in spec §0.4, now restated for finality)

These were already locked in v1.3 but are repeated here for one-stop reference.

| # | Decision | Value |
|---|---|---|
| A1 | Orchestration | n8n (not Node.js/Express) |
| A2 | Provider Abstraction Layer | Node.js module called by n8n |
| A3 | Phase 1 dashboard framework | Retool (existing). React/Next.js migration in Phase 2. The composer itself is React/Next.js. |
| A4 | LinkedIn publishing | bundle.social (never direct LinkedIn API) |
| A5 | Database | Supabase PostgreSQL |
| A6 | Cache | Two-layer: Upstash Redis (hot, 60s TTL) + Postgres `social_post_analytics_cache` (cold, historical). Redis failures degrade gracefully — fall through to Postgres cold-cache, then to bundle.social. App never breaks on Redis outage. |
| A7 | Scheduled-publish queue | Vercel Cron + Postgres polling with `SELECT ... FOR UPDATE SKIP LOCKED`. Minute-bucketed delivery. Retry policy via `publish_attempts` column (max 3). In-house, no external dependency. |
| A8 | CI/CD | Docker + GitHub Actions |
| A9 | Environments | Dev / staging / production |
| A10 | Image generation | Ideogram |
| A11 | Email | SendGrid |
| A12 | Feature flag | `FEATURE_COMPOSER_V2` (already exists in `lib/feature-flags.ts`) |
| A13 | Storage bucket | Existing `social-media-uploads` (do not create new) |
| A14 | CAP endpoint | Existing `/api/platform/social/cap/generate` (do not invent new) |
| A15 | Service health monitoring | In-house module at `lib/platform/service-health/`. Wraps every external API call. Notifies platform admins via SendGrid (+ optional Slack) on critical events. **Admin recipients discovered at runtime via `company_users WHERE role = 'platform_admin'` query — no env var.** See `SERVICE_HEALTH.md`. |
| A16 | Vendor reduction policy | Minimise external paid dependencies. Self-host anything where the build cost is low and the failure modes are well-understood (cron). Keep external where infrastructure quality matters (Upstash Redis for performance, SendGrid for deliverability, Ideogram/Anthropic for model quality, bundle.social for OAuth surface). All retained externals have graceful-degradation fallbacks where possible. |

---

## 5. Spec 22 reconciliation (overrides)

This brief **overrides** Spec 22 in the following ways. Where Spec 22 and this brief conflict, this brief wins.

| Spec 22 says | This brief says | Reason |
|---|---|---|
| V1 excludes per-platform variants | V1 includes per-platform variants ("Customize for" toggle row in composer) | Spec 22's exclusion was tied to MVP speed; the visual reference clearly shows the pattern is essential |
| V1 excludes publish-regularly | V1 includes publish-regularly tab | Same reason; recurring posts are a baseline competitor parity feature |
| V1 excludes bulk CSV import to composer | V1 includes bulk CSV upload modal feeding the same drafts pipeline | Same reason; CAP automation reuses this pipeline |
| Implies single shell across composer + page | Composer overlays the page; uses split-pane layout | Visual reference and Steven's direction both require split-pane |

Spec 22 exclusions that still hold (these are NOT in scope for this brief):
- Mobile composer (Phase 2, separate spec)
- Multi-image carousel posts (Phase 2)
- A/B variant testing UI (Phase 3)
- CAP automation feed UI (separate module, lives in `lib/cap/`)

---

## 6. Environment variables required

Listed for clarity. Full descriptions in `composer/.env.example`.

| Variable | Source | Required | Purpose |
|---|---|---|---|
| `BUNDLE_SOCIAL_API_KEY` | bundle.social dashboard | yes | Authenticate publish + analytics calls |
| `BUNDLE_SOCIAL_WEBHOOK_SECRET` | bundle.social dashboard | yes | Verify incoming publish-status webhooks |
| `IDEOGRAM_API_KEY` | Ideogram dashboard | yes | Image generation for CAP and composer |
| `SENDGRID_API_KEY` | SendGrid dashboard | yes | Approval email notifications |
| `SENDGRID_FROM_EMAIL` | Configurable | yes | `noreply@opollo.com` (requires SendGrid Domain Authentication for opollo.com) |
| `UPSTASH_REDIS_REST_URL` | Upstash dashboard | yes | Hot cache layer for analytics |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash dashboard | yes | Hot cache auth |
| `ANTHROPIC_API_KEY` | Anthropic console | yes | AI assistant in composer + CAP |
| `GIPHY_API_KEY` | GIPHY dashboard | yes | GIF picker tool in composer |
| `CRON_SECRET` | Generate via `openssl rand -hex 32` | yes | Vercel auto-injects this in `Authorization` header when invoking cron endpoints; handlers verify. Without it, cron routes are publicly accessible. |
| `NEXT_PUBLIC_FEATURE_COMPOSER_V2` | Vercel env | yes | Feature flag client-side |
| `NEXT_PUBLIC_SITE_URL` | Configurable | yes | `https://app.opollo.com` for production |
| `FEATURE_UNIFIED_SHELL` | Vercel env | optional | Per D-3, used during PageShell migration |
| `SLACK_WEBHOOK_URL_OPS` | Slack app config | optional | Second channel for critical service-health events. Strongly recommended — failsafe when SendGrid is the failing service. |

**Removed:** `SERVICE_HEALTH_ADMIN_EMAILS` — admin recipients now discovered via DB query (`company_users WHERE role = 'platform_admin'`).

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` are assumed already configured (existing Opollo stack).

---

## 7. Build order — high level

Composer:
1. PR A — Schema delta (migrations 0131–0134)
2. PR B — API surface (drafts, calendar-view, bulk, analytics)
3. PR C — Composer shell + profile selector
4. PR D — Content editor + per-platform variants + tools
5. PR E — Scheduling card (4 tabs) + approval workflow
6. PR F — Dashboard (calendar + day-detail) + empty state callout
7. PR G — Bulk CSV upload modal + shared parser
8. PR H — Post analytics modal

See `composer/BUILD_ORDER.md` for the detailed scope of each PR.

Framework: build in 4 waves, each ~4 templates, ~2 weeks per wave. See `framework/WAVE_PLAN.md`.

---

## 8. Default behaviour for genuinely ambiguous cases

If Claude Code encounters a situation not covered above and after a 5-minute search of the repo + this brief still cannot find a clear answer, apply these tiebreakers **in order:**

1. **Prefer additive over destructive.** Adding a new column is safer than altering an existing one. Adding a new component is safer than modifying a shared one.
2. **Prefer feature-flagged.** Wrap behaviour change in a feature flag; default the flag OFF; the user can flip it on after review.
3. **Prefer matching existing pattern in repo.** If the same pattern already exists elsewhere in `app/(platform)/admin/*`, follow it there.
4. **Prefer the smaller scope.** When in doubt about whether to do A or A+B, do A and mark B as a follow-up issue in `DECISION_TRAIL`.
5. **Document the assumption.** `// CLAUDE-ASSUMPTION: <one-line explanation>` comment in code. Append to `composer/ACCEPTANCE.md` §DECISION_TRAIL.
6. **Continue building.** Do not stop. Do not block on this. The user will review at the end.

These tiebreakers are themselves a locked decision. Apply them mechanically.

---

## 99. Override mechanism

If Steven or another director wants to override any decision in this document, they will:

1. Edit this file directly with the new decision.
2. Add a line at the top: `OVERRIDE <YYYY-MM-DD>: <which decision changed and to what>`.
3. Commit and push. Claude Code re-reads this file at the start of each work session.

Until that happens, every decision here is final for build purposes.
