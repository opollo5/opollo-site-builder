# Frontend Template Framework — Pass 1: Naming & Cluster Absorption

**Workstream:** Opollo Site Builder frontend template framework
**Status:** Pass 1 — framework proposal. Awaiting director sign-off before Pass 2 (per-template specs).
**Inputs:** `FRONTEND_TEMPLATE_DESIGN_PACKAGE.md` (82-route audit), `FRONTEND_TEMPLATE_BASELINE.md` (§18 inconsistency log)
**Author:** Steven Morey (with Claude as drafting collaborator)
**Date:** May 18, 2026

---

## 0. What this document is

The audit consolidated 82 routes into 80 cluster IDs. That is too granular to use as a buildable template framework — each cluster ID encodes its exact section composition, which is what the framework is meant to collapse. This document proposes the collapse: **16 named templates** that absorb all 80 clusters with explicit divergence-resolution notes.

This document does NOT contain per-template specs in the Spec 02 / Spec 04 style. Those come in Pass 2, one template at a time, in the priority order set out in §6. The brief explicitly required: "Stop after Pass 1. Wait for me to confirm the framework before writing per-template specs."

---

## 1. Framework-level decisions to resolve before Pass 2

Pass 2 specs cannot be written until these are settled. Each is flagged from the audit but **none is picked here**, per the brief constraint "Don't pick winners in doc-vs-reality drifts without flagging it as a framework-level decision in Pass 1."

| ID | Decision | Source | Affects | Recommended path |
|---|---|---|---|---|
| D-1 | **Lucide vs Linearicons.** Docs reference Lucide; reality is Linearicons exclusively via NavIcon wrapper. | §2.3 design package | Every template (icons referenced in PageHeader, EmptyState, Alert, RowActions) | Codify Linearicons as canonical; update docs to match reality. Re-evaluating the icon system is a multi-week migration — not in this workstream's scope. |
| D-2 | **Width mode for "unknown (layout-driven)" routes.** 4 design-system subtree routes have width controlled by `layout.tsx`, not the page. | §1 design package, clusters 25–28 | T-LIST-STANDARD, T-DETAIL-SUMMARY, T-GRID | Three options: (a) keep `layout-driven` as a 5th width mode, (b) migrate to PageShell-standard, (c) deprecate. Recommend (a) for design-system subtree only; explicit exception in template spec. |
| D-3 | **PageShell adoption in /company, /company/social, /optimiser (20+ routes).** Per §5 working notes: "the entire company/social module is shell-free by design, not by omission." | §5 design package, R4 baseline | T-LIST-STANDARD, T-DETAIL-TABBED, T-DASHBOARD-FEED, T-DASHBOARD-KPI, T-SETTINGS-FLAT | Two options: (a) add PageShell to all (one sweep, breaks visual habit), (b) codify shell-free in allowlist and remove the R4 lint rule for those routes. Recommend (a) — consistency matters more than habit; if a route needs full-bleed, use the full-bleed width mode explicitly. |
| D-4 | **Detail-tabbed footer-action slot (RECURRING-2 post-publish dead-end).** After publishing from /company/social/posts/[id], no navigation forward. | §5 working notes, QA-ISSUES.md | T-DETAIL-TABBED only | Add `footerActions` slot to T-DETAIL-TABBED. Default contents per tab; for the publish tab specifically: "View on platform" + "Schedule another" + "Back to posts". |
| D-5 | **Detail-editor max-width (RECURRING-1).** /admin/sites/[id]/pages/[pageId] uses `max-w-4xl` (896px). | §5 working notes, QA-ISSUES.md | T-DETAIL-EDITOR only | Confirm 896px is intentional for readability of rich-text content, OR widen to standard (1200px). Without confirmation, recommend keeping 896px — long-form prose readability is the design intent. |
| D-6 | **Modal sizing scale (R28).** 19+ modals use ad-hoc max-w-md/lg/3xl. | R28 baseline, §2.2 design package | Every template that mounts a modal | Establish `size="sm"|"md"|"lg"|"xl"|"full"` prop on Dialog primitive. Remove manual max-w from individual modals. Recommend: sm=440px, md=640px (default), lg=860px, xl=1080px, full=calc(100vw - 64px). |
| D-7 | **Section header primitive (R10).** 13 routes have inconsistent section headers (raw h2, H2 component, raw h3). | R10 baseline | T-DETAIL-SUMMARY, T-LIST-WIDE, T-DASHBOARD-KPI | Two options: (a) standardise on `<H2>` typography component, (b) extract a `<SectionHeader>` primitive that wraps H2 + optional subtitle + optional actions. Recommend (b) — sections frequently need a right-aligned action ("Edit", "Add", filter pills). |
| D-8 | **Pagination — standalone primitive vs DataTable-embedded (R14).** 4 hand-rolled Previous/Next today. | R14 baseline | T-LIST-STANDARD, T-LIST-WIDE | Extract `<Pagination>` primitive. Include `aria-label="Pagination"`, `aria-disabled` on disabled links, current-page indicator. Page-size selector is optional second prop. |
| D-9 | **EmptyState canonical signature (R12).** 6 variants today (component, inline div×3, ComponentsGrid raw div, EmptyAnalyticsState). | R12 baseline, §2.1 design package | Every template with an empty state (~12) | Lock `<EmptyState icon title body? cta?>` signature. `icon` from Linearicons, `body` optional, `cta` is a Button primitive instance. Used everywhere from list views to grid views to flat settings. |
| D-10 | **Banner Alert variants (R8).** BlogStyleCalibrationBanner + OnboardingReminderBanner re-implement Alert. | R8 baseline | T-LIST-STANDARD, T-DETAIL-SUMMARY, T-WIZARD-STEP | Add `<Alert variant="info">` and `<Alert variant="warning">` with banner-shape preset (icon + heading + body + dismiss). Replace both bespoke banner components. |
| D-11 | **Width mode "none" — full-bleed or standard?** /admin/images, /optimiser/proposals, /optimiser/change-log use width=none. | §1 design package, clusters 12, 29, 32 | T-LIST-WIDE | Three options: (a) all should be `wide` and the "none" tag is an audit artefact, (b) genuinely full-bleed (no width cap), (c) keep "none" as a 4th width mode. Recommend (a) — these are tabular pages that benefit from PageShell's width cap; the "none" tag reflects a coding mistake, not a design choice. |

**Sign-off required on all 11 before Pass 2.** D-1, D-3, D-6, D-7, D-9 each block multiple template specs.

---

## 2. The 16 templates

Each template absorbs one or more clusters from §1 of the design package. The "Routes" column counts how many of the 82 audit routes the template covers. The "Width modes" column lists every width-mode variant the template must support — Pass 2 will lock these as a prop on the template component.

### 2.1 Templates by archetype family

| # | Template ID | Purpose | Width modes | Clusters absorbed | Routes |
|---|---|---|---|---|---|
| 1 | **T-LIST-STANDARD** | Standard-width index lists (filter + table or stacked-list + optional pagination). The dominant admin pattern. | standard, layout-driven (D-2) | T-index-list-standard-PHBC, -PHBC-IA, -PHBC-CB-FB-ES-SL-PG, -PHBC-FB-DT-PG, -PH-DT, -PH-CB, -PH-CB-IA-SL, -IA, -PHBC-CB, -unknown-PHBC | ~15 |
| 2 | **T-LIST-WIDE** | Wide index lists for data-table-heavy admin pages (companies, users, audit, batches). | wide, none (D-11) | T-index-list-wide-PHBC-SL, -PHBC-DT, -PHBC-CB-DT, -PHBC-CB-SL, -PHBC-SH-DT, -PHBC-DT-PG, T-index-list-none-PHBC-DT-PG | ~10 |
| 3 | **T-GRID** | Index views rendered as a card grid (media library, design-system components). | standard, layout-driven (D-2) | T-index-grid-standard-PH-IA, T-index-grid-unknown-PHBC | 2 |
| 4 | **T-DETAIL-SUMMARY** | Read-mostly detail pages with one or more card/section blocks. Largest detail family. | standard, wide, layout-driven (D-2) | T-detail-summary-standard-PHBC-CB, -PHBC, -CB-PH-SH-DT-ES-SB, -PH-CB-CA, -AB-CB-CA, -PH; T-detail-summary-wide-PHBC, -PHBC-SL, -PHBC-CB-CG, -PHBC-CA-SH-DT-DM; T-detail-summary-unknown-PHBC, -PHBC-CA | ~12 |
| 5 | **T-DETAIL-TABBED** | Tabbed detail pages where a primary entity has multiple aspect views (currently /company/social/posts/[id]). | standard | T-detail-tabbed-standard-IA | 1 |
| 6 | **T-DETAIL-EDITOR** | Editor-shaped detail pages with rich-text preview + meta grid (post editor, page editor). | standard (max-w-4xl per D-5) | T-detail-editor-standard-PHBC, T-detail-editor-standard-PHBC-SH-RP-DM | 2 |
| 7 | **T-FORM** | Single-form create/edit pages. Absorbs both `form-create` and `form-edit` archetypes. | form (max-w-2xl default), narrow, standard, wide | T-form-create-form-PHBC-FS, -standard-PH, -standard-PHBC-FS, -wide-PHBC-FS, -narrow-PHBC-IA-FS | ~6 |
| 8 | **T-WIZARD-STEP** | Multi-step wizards with progress indicator. | form (max-w-3xl/4xl), standard | T-wizard-step-form-PHBC-WP, -form-PHBC-CB-FS, T-wizard-step-standard-PH-FS-SL, -PH-CB | ~5 |
| 9 | **T-SETTINGS-FLAT** | Flat settings pages with stacked form sections, no wizard progress. | narrow, form, standard, wide | T-settings-flat-narrow-PHBC-FS, -form-PHBC-FS, -wide-PHBC-FS, -narrow-PHBC, -standard-IA, -standard-PH-CA, -narrow-PH | ~7 |
| 10 | **T-DASHBOARD-KPI** | Top-of-funnel dashboards with metric tiles + supporting data tables. | standard, wide | T-dashboard-kpi-wide-PHBC, -wide-PHBC-IA-SH-DT, -standard-PHBC-CB-CA-CG, -standard-IA, -standard-PH-CA | ~5 |
| 11 | **T-DASHBOARD-FEED** | Feed-style dashboards (timeline, calendar, recent-activity). Includes full-bleed calendar variant. | standard, wide, none, full-bleed | T-dashboard-feed-none-PHBC, -wide-PHBC, -standard-PH, -full-bleed, -standard-IA | ~5 |
| 12 | **T-REVIEW-LINK** | Brief/blueprint review pages with primary action(s) at top + structured content. | standard | T-review-link-standard-PHBC, T-review-link-standard-PHBC-IA-CA | 2 |
| 13 | **T-AUTH-CHROME** | All login/auth/invite/expired/callback/approve flows. Public, no AppShell. | narrow, full-bleed | T-auth-chrome-narrow-PH-CA, -narrow-PH-IA-FS, -narrow-PH-IA, -full-bleed, -narrow-CA-FA | ~10 |
| 14 | **T-FULL-BLEED-EDITOR** | Canvas-shaped editors (image generator, future Studio surfaces). | full-bleed | T-full-bleed-editor-standard-PH | 1 |
| 15 | **T-ERROR-STATE** | Public error chrome (/auth-error, future 404/500). | narrow | T-error-state-narrow | 1 |
| 16 | **T-REDIRECT-STUB** | Routes that exist only to redirect (no PageHeader, no content). Exempt from PageHeader rule. | none | T-empty-stub-none, T-empty-stub-none-PH-ES (downgrade to T-LIST-STANDARD empty case — see §3.1) | 4 (exempt) |

**Total templates: 16. Total clusters absorbed: 80. Total routes covered: 82.**

### 2.2 Locked section composition per template

Pass 2 will produce the full slot order. For Pass 1 sign-off, here is the locked section composition each template will own. Composition reads top to bottom; slots in `[brackets]` are optional and template-config-driven.

| Template | Locked composition |
|---|---|
| T-LIST-STANDARD | PageShell ▸ PageHeader (title + breadcrumb + [actions]) ▸ [callout-banner via Alert variant="info"] ▸ [inline-alert via Alert] ▸ [filter-bar] ▸ ListContent (DataTable OR stacked-list OR EmptyState) ▸ [Pagination] |
| T-LIST-WIDE | PageShell wide ▸ PageHeader (title + breadcrumb + [actions]) ▸ [callout-banner] ▸ [section-header per list] ▸ ListContent (DataTable mandatory) ▸ [Pagination] |
| T-GRID | PageShell ▸ PageHeader ▸ [inline-alert] ▸ Grid (card collection OR EmptyState) ▸ [Pagination] |
| T-DETAIL-SUMMARY | PageShell ▸ PageHeader (title + breadcrumb + [actions] + [meta]) ▸ [callout-banner ×N] ▸ [inline-alert] ▸ Section ×N (each: SectionHeader + Card OR DataTable OR EmptyState) ▸ [sidebar variant — width=wide only] |
| T-DETAIL-TABBED | PageShell ▸ PageHeader ▸ [inline-alert ×N] ▸ TabBar ▸ TabPanel (delegated content) ▸ footerActions (D-4) |
| T-DETAIL-EDITOR | PageShell ▸ PageHeader (title + breadcrumb + actions) ▸ SectionHeader ▸ RichTextPreview ▸ DetailMetaGrid ▸ [SectionHeader + delegated content] |
| T-FORM | PageShell ▸ PageHeader (title + breadcrumb + [actions]) ▸ [inline-alert] ▸ FormSection ▸ [FormSection ×N] ▸ FormActions (Cancel + Submit, sticky on long forms) |
| T-WIZARD-STEP | PageShell ▸ PageHeader (title + breadcrumb) ▸ WizardProgress ▸ [callout-banner] ▸ FormSection ▸ [SectionHeader + delegated content] ▸ FormActions (Back + Next/Skip) |
| T-SETTINGS-FLAT | PageShell ▸ PageHeader (title + breadcrumb) ▸ [inline-alert ×N] ▸ FormSection ×N OR stacked-list (account/devices pattern) |
| T-DASHBOARD-KPI | PageShell ▸ PageHeader (title + breadcrumb + [actions]) ▸ [callout-banner] ▸ KpiCardGrid ▸ [SectionHeader + DataTable ×N] |
| T-DASHBOARD-FEED | PageShell (or full-bleed via prop) ▸ PageHeader ▸ [inline-alert] ▸ Feed (delegated client component owns layout) |
| T-REVIEW-LINK | PageShell ▸ PageHeader (title + breadcrumb + primary action) ▸ [inline-alert] ▸ Card ▸ [Card ×N] ▸ [delegated content] |
| T-AUTH-CHROME | AuthShell (full-screen centered, no platform AppShell) ▸ Logo ▸ PageHeader (title + subtitle) ▸ Card (form OR callout content) ▸ [footerActions] |
| T-FULL-BLEED-EDITOR | EditorShell (full-bleed, top-bar only, no sidebar) ▸ PageHeader (title + actions, inline) ▸ EditorCanvas (delegated client component) |
| T-ERROR-STATE | AuthShell ▸ ErrorIcon ▸ PageHeader (title + subtitle) ▸ [actions] |
| T-REDIRECT-STUB | No layout. `redirect()` call only. Exempt from PageHeader rule via `PAGE_HEADER_EXEMPT_ROUTES`. |

### 2.3 Divergences each template resolves

Every template absorbs at least one §18 baseline inconsistency. The audit logged 30 such inconsistencies. The following table maps each R-number to the template(s) that resolve it.

| R# | Inconsistency | Resolution scope | Templates that fix it |
|---|---|---|---|
| R1 | Raw `<button>` (152 instances) | Replace with Button or IconButton primitive | All — enforced via lint rule, not per-template |
| R2 | Hand-rolled modals (19) | Migrate to Dialog primitive with sizing scale D-6 | All templates that mount modals |
| R3 | Error state split (Alert vs raw div) | Standardise on `<Alert variant="destructive">` | All templates with error states (~12) |
| R4 | PageShell absent in social+optimiser | Per D-3 decision: adopt PageShell everywhere | T-LIST-STANDARD, T-DETAIL-TABBED, T-DASHBOARD-FEED, T-DASHBOARD-KPI, T-SETTINGS-FLAT |
| R5 | PageHeader absent in social module (8) | Add PageHeader compound to every page.tsx | T-LIST-STANDARD, T-DETAIL-TABBED, T-DASHBOARD-FEED, T-DASHBOARD-KPI, T-GRID |
| R6 | Raw input/select/textarea (121) | Replace with Input/Select/Textarea primitives | T-FORM, T-WIZARD-STEP, T-SETTINGS-FLAT |
| R7 | Emerald/gray hardcoded palette (16) | Replace with semantic tokens | All — enforced via lint rule |
| R8 | BlogStyle+Onboarding banners re-implement Alert | Per D-10 decision: Alert variant="info"/"warning" | T-LIST-STANDARD, T-DETAIL-SUMMARY, T-WIZARD-STEP |
| R9 | Breadcrumbs.tsx dead duplicate | Delete | All — one-shot cleanup PR, not template-bound |
| R10 | Section-header inconsistency | Per D-7 decision: `<SectionHeader>` primitive | T-DETAIL-SUMMARY, T-LIST-WIDE, T-DASHBOARD-KPI |
| R11 | auth-chrome layout inconsistency | Add flex min-h-screen centered to invite routes | T-AUTH-CHROME |
| R12 | Empty-state bypass (4) | Per D-9 decision: `<EmptyState>` canonical signature | All templates with empty states |
| R13 | Skeleton bypass (3) | Replace with `<Skeleton>` primitive | T-DETAIL-SUMMARY, T-DASHBOARD-KPI |
| R14 | Pagination not consolidated (4) | Per D-8 decision: `<Pagination>` primitive | T-LIST-STANDARD, T-LIST-WIDE |
| R15 | Raw tables bypassing DataTable | Migrate to DataTable; defer system/jobs per allowlist | T-LIST-WIDE, T-DASHBOARD-KPI |
| R16 | font-medium vs semibold vs bold | Define label-weight semantic token | All — enforced via design token, not per-template |
| R17 | Card primitive underused | Migrate raw `div.rounded-lg.border.p-6` to Card | T-DETAIL-SUMMARY, T-DASHBOARD-KPI, T-SETTINGS-FLAT |
| R18 | Local PageShell in auth/approve shadows shared | Remove local shadow | T-AUTH-CHROME |
| R19 | Icon inconsistency (cross/cross-circle etc.) | Lock dismiss=cross, confirm=check across all templates | All — icon governance |
| R20 | gap-2 vs gap-3 vs gap-4 | Define `gap-section`, `gap-form-row` tokens | All — design token, not per-template |
| R21 | Sequential Supabase queries | Wrap in Promise.all per route | Server-component templates — fix per route, not per template |
| R22 | DesignSystemsTable status dot | Replace with StatusPill | T-GRID (single instance) |
| R23 | SocialCalendarClient hardcoded nav buttons | Replace with IconButton | T-DASHBOARD-FEED (full-bleed variant) |
| R24 | setTimeout in briefs/run server component | Move to client-side polling | T-DETAIL-SUMMARY (single instance) |
| R25 | UserRoleActionCell dead code | Delete | One-shot cleanup |
| R26 | 13 zero-import components | Audit import graph, delete confirmed dead | One-shot cleanup |
| R27 | Static "Site" breadcrumb on 2 design-system routes | Pass site name into design-system layout context | T-LIST-STANDARD (layout-driven), T-DETAIL-SUMMARY (layout-driven) |
| R28 | Modal sizing inconsistent | Per D-6 decision | All templates that mount modals |
| R29 | rounded-md vs rounded-lg | Define `--radius-interactive`, `--radius-card` | All — design token |
| R30 | px-3 vs px-4 vs px-2 | Define `--spacing-interactive-x` | All — design token |

---

## 3. Cluster-to-template mapping (full)

The 80 cluster IDs from §1 of the design package, each mapped to its target template, with the divergences the template resolves.

### 3.1 Multi-member clusters (12 clusters, 30 routes)

| Cluster ID | Members | Target template | Notes |
|---|---|---|---|
| T-auth-chrome-narrow-PH-CA | 4 | T-AUTH-CHROME | Login + check-email + forgot-password + reset-password. Card-shaped content. |
| T-empty-stub-none | 4 | T-REDIRECT-STUB | All redirect-only; exempt from PageHeader. |
| T-auth-chrome-narrow-PH-IA-FS | 2 | T-AUTH-CHROME | accept-invite + invite/[token]. Resolves R11 (missing centered layout). |
| T-detail-summary-standard-PHBC-CB | 2 | T-DETAIL-SUMMARY | Brief run + appearance. Callout-banner above content. |
| T-empty-stub-none-PH-ES | 2 | T-LIST-STANDARD (empty case) | admin/posts + admin/batches. Downgrade from "stub" to "list with EmptyState" — they are not redirects. |
| T-form-create-form-PHBC-FS | 2 | T-FORM | Sites/new + sites/edit. Form-width default. |
| T-index-list-standard-IA | 2 | T-LIST-STANDARD | company/users + social/posts. Critical — rank 1 priority. |
| T-index-list-standard-PH-DT | 2 | T-LIST-STANDARD | optimiser/proposals + change-log. Adopts PageShell per D-3. |
| T-index-list-wide-PHBC-DT | 2 | T-LIST-WIDE | batches/[siteId] + maintenance/social-connections. |
| T-index-list-wide-PHBC-SL | 2 | T-LIST-WIDE | companies + companies/[id]/social-profiles. |
| T-review-link-standard-PHBC | 2 | T-REVIEW-LINK | briefs/review + blueprints/review. |
| T-settings-flat-narrow-PHBC-FS | 2 | T-SETTINGS-FLAT | account/security + sites/[id]/settings. Width mode varies per route — template prop. |
| T-wizard-step-form-PHBC-WP | 2 | T-WIZARD-STEP | setup + setup/extract. Max-w-3xl/4xl inconsistency — locked at max-w-3xl in template. |

### 3.2 Single-member clusters (68 clusters, 52 routes)

Grouped by target template. Routes in **bold** are flagged as operator-critical in the design package §5.

**→ T-LIST-STANDARD (10 single-member clusters, ~10 routes)**
- T-index-list-standard-PHBC: **/admin/sites**
- T-index-list-standard-PHBC-IA: **/admin/sites/[id]/content**
- T-index-list-standard-PHBC-CB-FB-ES-SL-PG: **/admin/sites/[id]/posts**
- T-index-list-standard-PHBC-FB-DT-PG: **/admin/sites/[id]/pages**
- T-index-list-standard-PH-CB: /admin/sites/[id]/briefs/[brief_id]/run (also T-detail-summary candidate; route delegates to BriefRunClient, treat as list)
- T-index-list-standard-PH-CB-IA-SL: **/company/social/connections**
- T-index-list-unknown-PHBC: /admin/sites/[id]/design-system/templates (layout-driven, D-2)

**→ T-LIST-WIDE (6 single-member clusters)**
- T-index-list-wide-PHBC-CB-DT: **/admin/batches/[siteId]**
- T-index-list-wide-PHBC-CB-SL: /admin/companies
- T-index-list-wide-PHBC-SH-DT: /admin/users
- T-index-list-wide-PHBC-DT-PG: /admin/users/audit
- T-index-list-none-PHBC-DT-PG: /admin/images (width=none → wide per D-11)

**→ T-GRID (1 single-member)**
- T-index-grid-unknown-PHBC: /admin/sites/[id]/design-system/components (layout-driven, D-2)
- (+ multi-member T-index-grid-standard-PH-IA: /company/social/media — already counted)

**→ T-DETAIL-SUMMARY (12 single-member clusters)**
- T-detail-summary-standard-CB-PH-SH-DT-ES-SB: **/admin/sites/[id]**
- T-detail-summary-standard-PHBC: **/admin/sites/[id]/posts/[post_id]** (overlaps with T-DETAIL-EDITOR — see below)
- T-detail-summary-standard-PH-CB-CA: /optimiser/pages/[id]
- T-detail-summary-standard-AB-CB-CA: **/optimiser/proposals/[id]** (only route with action-bar instead of page-header — adopts PageHeader per D-3)
- T-detail-summary-standard-PH: /optimiser/imports/[brief_id]
- T-detail-summary-unknown-PHBC-CA: /admin/sites/[id]/design-system (layout-driven, D-2)
- T-detail-summary-unknown-PHBC: /admin/sites/[id]/design-system/preview (layout-driven, D-2)
- T-detail-summary-wide-PHBC: /admin/companies/[id]
- T-detail-summary-wide-PHBC-SL: /admin/companies/[id]/social-profiles/[profileId]/connections
- T-detail-summary-wide-PHBC-CB-CG: /admin/batches/[siteId]/[batchId]
- T-detail-summary-wide-PHBC-CA-SH-DT-DM: /admin/images/[id]

**→ T-DETAIL-TABBED (1 single-member, critical)**
- T-detail-tabbed-standard-IA: **/company/social/posts/[id]** — fixes RECURRING-2 via D-4

**→ T-DETAIL-EDITOR (2 single-member)**
- T-detail-editor-standard-PHBC: **/admin/sites/[id]/posts/[post_id]** — overlaps with T-DETAIL-SUMMARY-standard-PHBC; audit ambiguity. Spec 2 will resolve which template owns this route based on whether PostDetailClient renders preview-style or editor-style.
- T-detail-editor-standard-PHBC-SH-RP-DM: **/admin/sites/[id]/pages/[pageId]** — fixes RECURRING-1 via D-5

**→ T-FORM (4 single-member)**
- T-form-create-standard-PH: /admin/posts/[siteId]/new
- T-form-create-standard-PHBC-FS: /admin/sites/[id]/posts/new
- T-form-create-wide-PHBC-FS: /admin/companies/new
- T-form-create-narrow-PHBC-IA-FS: /admin/email-test

**→ T-WIZARD-STEP (3 single-member)**
- T-wizard-step-form-PHBC-CB-FS: /admin/sites/[id]/onboarding
- T-wizard-step-standard-PH-FS-SL: /optimiser/onboarding
- T-wizard-step-standard-PH-CB: /optimiser/onboarding/[id]

**→ T-SETTINGS-FLAT (6 single-member)**
- T-settings-flat-form-PHBC-FS: /admin/sites/[id]/settings
- T-settings-flat-wide-PHBC-FS: /admin/settings/design-system
- T-settings-flat-narrow-PHBC: /account/devices
- T-settings-flat-standard-IA: /company/settings/brand
- T-settings-flat-standard-PH-CA: **/optimiser/clients/[id]/settings**
- T-settings-flat-narrow-PH: /company/social/sharing

**→ T-DASHBOARD-KPI (5 single-member)**
- T-dashboard-kpi-wide-PHBC: /admin/companies/[id]/social-profiles/[profileId]/analytics
- T-dashboard-kpi-wide-PHBC-IA-SH-DT: /admin/system/jobs
- T-dashboard-kpi-standard-PHBC-CB-CA-CG: **/company** (homepage; adopts PageShell per D-3)
- T-dashboard-kpi-standard-IA: /company/social/analytics
- T-dashboard-kpi-standard-PH-CA: /optimiser/diagnostics

**→ T-DASHBOARD-FEED (5 single-member)**
- T-dashboard-feed-none-PHBC: /admin/maintenance
- T-dashboard-feed-wide-PHBC: /admin/_internal/table-examples
- T-dashboard-feed-standard-PH: /company/internal/autosave-lab
- T-dashboard-feed-full-bleed: **/company/social/calendar** — fixes R23
- T-dashboard-feed-standard-IA: /company/social/timeline

**→ T-REVIEW-LINK (1 single-member — already counted under multi-member)**
- T-review-link-standard-PHBC-IA-CA: /admin/sites/[id]/blueprints/review (member of multi-cluster above)

**→ T-AUTH-CHROME (3 single-member)**
- T-auth-chrome-narrow-PH-IA: /auth/approve — fixes R18 (local PageShell shadow)
- T-auth-chrome-full-bleed: /auth/callback
- T-auth-chrome-narrow-CA-FA: /auth/expired

**→ T-FULL-BLEED-EDITOR (1 single-member)**
- T-full-bleed-editor-standard-PH: /company/image/generate

**→ T-ERROR-STATE (1 single-member)**
- T-error-state-narrow: /auth-error

**→ T-REDIRECT-STUB (already counted as multi-member T-empty-stub-none)**

### 3.3 Coverage validation

| Bucket | Count |
|---|---|
| Total routes audited | 82 |
| Routes assigned to a template | 78 |
| Routes exempt (T-REDIRECT-STUB, `PAGE_HEADER_EXEMPT_ROUTES`) | 4 |
| Total assignment | **82 ✓** |

| Bucket | Count |
|---|---|
| Total clusters in audit | 80 |
| Clusters absorbed by templates | 80 |
| Orphan clusters | **0 ✓** |

---

## 4. Templates by route count (descending)

For Pass 2 ordering, the question of "which template covers the most routes" is one input. The other is "which template owns operator-critical routes."

| Template | Routes | Notes |
|---|---|---|
| T-LIST-STANDARD | ~15 | Largest. Includes 4 admin/sites routes flagged critical. |
| T-DETAIL-SUMMARY | ~12 | Largest detail family. Includes admin/sites/[id], optimiser/proposals critical routes. |
| T-AUTH-CHROME | ~10 | All public-facing auth flows. Lower complexity per route but no shared production framework today. |
| T-LIST-WIDE | ~10 | Operator-heavy admin pages (users, batches, companies). |
| T-SETTINGS-FLAT | ~7 | Spread across admin, account, company, optimiser modules. |
| T-FORM | ~6 | Create/edit shared. |
| T-WIZARD-STEP | ~5 | Setup + onboarding flows. |
| T-DASHBOARD-KPI | ~5 | Includes /company homepage. |
| T-DASHBOARD-FEED | ~5 | Includes critical /company/social/calendar (R23 fix). |
| T-REDIRECT-STUB | 4 | Exempt. Spec is essentially "no-op". |
| T-DETAIL-EDITOR | 2 | Includes RECURRING-1 fix. |
| T-GRID | 2 | Low volume but visually distinct. |
| T-REVIEW-LINK | 2 | Brief + blueprint review only. |
| T-DETAIL-TABBED | 1 | But critical (RECURRING-2 fix on /company/social/posts/[id]). |
| T-FULL-BLEED-EDITOR | 1 | Image generator only. |
| T-ERROR-STATE | 1 | /auth-error only. |

---

## 5. Templates by priority score (Pass 2 spec build order)

Computed from the priority scoring in §4 of the design package, rolled up to the template level. Score = sum of constituent cluster scores, with weight on operator-critical routes.

| Wave | Template | Total score | Critical routes covered | Why this wave |
|---|---|---|---|---|
| **Wave 1 — Unblock social + critical detail** | | | | |
| 1 | T-DETAIL-TABBED | 8 | /company/social/posts/[id] | Fixes RECURRING-2 dead-end; only one route but high pain. |
| 2 | T-LIST-STANDARD | 10 + multi-route | /company/social/posts, /company/users, /admin/sites, /admin/sites/[id]/posts | Highest cumulative score; touches most routes; fixes R3+R4+R5+R10+R14. |
| 3 | T-DASHBOARD-FEED | 7 | /company/social/calendar | Fixes R23 and unblocks full-bleed calendar pattern. |
| 4 | T-DASHBOARD-KPI | 7 | /company, /company/social/analytics | Adopts PageShell per D-3; touches /company homepage. |
| **Wave 2 — Cover admin bulk** | | | | |
| 5 | T-DETAIL-SUMMARY | varied | /admin/sites/[id], /optimiser/proposals/[id] | Largest detail family; many R-fixes. |
| 6 | T-FORM | varied | /admin/sites/new, /admin/sites/[id]/edit, /admin/companies/new | Replaces R6 raw form primitives. |
| 7 | T-LIST-WIDE | varied | /admin/users, /admin/batches/[siteId] | Standardises wide data-table pattern. |
| 8 | T-SETTINGS-FLAT | varied | /optimiser/clients/[id]/settings | Cross-module settings consistency. |
| **Wave 3 — Specialised** | | | | |
| 9 | T-DETAIL-EDITOR | 4 | /admin/sites/[id]/pages/[pageId] | Fixes RECURRING-1 (D-5 width decision). |
| 10 | T-WIZARD-STEP | varied | /admin/sites/[id]/setup, /admin/sites/[id]/onboarding | Locks WizardProgress component. |
| 11 | T-REVIEW-LINK | 4 | /admin/sites/[id]/briefs/[brief_id]/review | Two routes, shared composition. |
| 12 | T-GRID | varied | none critical | Low volume; can ship later. |
| **Wave 4 — Edge** | | | | |
| 13 | T-AUTH-CHROME | 8 | /login, /auth/* | Public chrome; one-time consolidation. |
| 14 | T-FULL-BLEED-EDITOR | 6 | /company/image/generate | Single route, but locks the full-bleed editor pattern for future Studio surfaces. |
| 15 | T-ERROR-STATE | 1 | /auth-error | Trivial; ship last. |
| 16 | T-REDIRECT-STUB | 0 | none | Spec is "no PageHeader, no shell, just `redirect()`". One-paragraph spec. |

**Recommended Pass 2 cadence:** four waves, ~4 templates per wave. Each wave is ~1 week of spec writing + 2 weeks of Claude Code implementation. Total framework rollout: ~12 weeks if specs and implementation run in parallel after Wave 1.

---

## 6. What's intentionally NOT in Pass 1

Per the brief constraints:

- **No per-template specs.** Each template's Spec 02 / Spec 04-style document comes in Pass 2 after director sign-off on this proposal.
- **No new design tokens invented.** §3 of the design package shows existing token coverage. New tokens (e.g. `--radius-interactive`, `--spacing-interactive-x`) are flagged in §1 of this doc as framework-level decisions (D-6, D-7, D-9) but not authored.
- **No winners picked on doc-vs-reality drifts.** D-1 (Lucide vs Linearicons), D-3 (PageShell adoption), D-5 (detail-editor max-width) are explicitly framework-level decisions, not designer calls.
- **No new components designed.** Templates compose existing primitives. Where a primitive is missing (SectionHeader, Pagination, banner-shaped Alert), the gap is named in D-7/D-8/D-10 and the primitive creation is a precondition for Pass 2 — not part of any one template spec.

---

## 7. What sign-off looks like

Pass 1 is considered complete and Pass 2 can begin when:

1. **All 11 framework decisions (D-1 through D-11)** have a single locked direction. Recommendations are noted in §1; director approves or substitutes per decision.
2. **Template count is locked at 16** (or director substitutes a different collapse).
3. **Coverage validates 82/82 routes**, confirmed once D-3 outcomes are known (some routes shift template if PageShell adoption changes).
4. **Pass 2 ordering is approved** (the four-wave structure in §5, or director substitutes).
5. **Pre-Pass-2 primitives are commissioned** if D-7, D-8, D-9, D-10 require new components.

Per the brief's autonomy requirement: each Pass 2 spec must be buildable by Claude Code in one autonomous run. The Pre-Pass-2 primitive commissioning step exists so that no template spec is blocked waiting for a primitive that doesn't exist yet.

---

## 8. Open questions for director review (in addition to D-1 through D-11)

These are not framework-level decisions per se but they materially affect what Pass 2 specs will say. Answer before Pass 2 starts:

1. **Should /admin/sites/[id]/posts/[post_id] be T-DETAIL-SUMMARY or T-DETAIL-EDITOR?** The audit places it in both. PostDetailClient is delegated, so the answer depends on whether the client renders preview-style (summary) or editor-style. **Recommendation: editor** — the route has "edit" in its semantic, and the post-detail route on the admin side is the operator's editing surface.

2. **Should T-FORM and T-WIZARD-STEP share a base?** Both have FormSection compositions. **Recommendation: no** — wizard has WizardProgress + Back/Next nav, form has Cancel/Submit. Sharing forces a confused base.

3. **Should T-DASHBOARD-KPI and T-DASHBOARD-FEED share a base?** Both have hero-style metric content. **Recommendation: no** — KPI is "show me numbers", feed is "show me activity". Different visual hierarchies, different data flows.

4. **What's the policy for routes that don't have PageHeader today but should per D-3?** Phased migration (one route per PR) vs sweep (all routes one PR). **Recommendation: sweep, behind a feature flag** — partial adoption creates worse inconsistency than the current state.

5. **/admin/sites/[id]/posts vs /admin/sites/[id]/posts/[post_id] vs /admin/sites/[id]/posts/[post_id] (detail-editor variant) — are these three routes or two?** The cluster IDs imply three. Confirm before Pass 2.

---

## 9. Appendix: cluster-to-template lookup (alpha)

For quick reference during Pass 2. Each cluster ID → its single target template.

| Cluster ID | Template |
|---|---|
| T-auth-chrome-full-bleed | T-AUTH-CHROME |
| T-auth-chrome-narrow-CA-FA | T-AUTH-CHROME |
| T-auth-chrome-narrow-PH-CA | T-AUTH-CHROME |
| T-auth-chrome-narrow-PH-IA | T-AUTH-CHROME |
| T-auth-chrome-narrow-PH-IA-FS | T-AUTH-CHROME |
| T-dashboard-feed-full-bleed | T-DASHBOARD-FEED |
| T-dashboard-feed-none-PHBC | T-DASHBOARD-FEED |
| T-dashboard-feed-standard-IA | T-DASHBOARD-FEED |
| T-dashboard-feed-standard-PH | T-DASHBOARD-FEED |
| T-dashboard-feed-wide-PHBC | T-DASHBOARD-FEED |
| T-dashboard-kpi-standard-IA | T-DASHBOARD-KPI |
| T-dashboard-kpi-standard-PH-CA | T-DASHBOARD-KPI |
| T-dashboard-kpi-standard-PHBC-CB-CA-CG | T-DASHBOARD-KPI |
| T-dashboard-kpi-wide-PHBC | T-DASHBOARD-KPI |
| T-dashboard-kpi-wide-PHBC-IA-SH-DT | T-DASHBOARD-KPI |
| T-detail-editor-standard-PHBC | T-DETAIL-EDITOR |
| T-detail-editor-standard-PHBC-SH-RP-DM | T-DETAIL-EDITOR |
| T-detail-summary-standard-AB-CB-CA | T-DETAIL-SUMMARY |
| T-detail-summary-standard-CB-PH-SH-DT-ES-SB | T-DETAIL-SUMMARY |
| T-detail-summary-standard-PH | T-DETAIL-SUMMARY |
| T-detail-summary-standard-PH-CB-CA | T-DETAIL-SUMMARY |
| T-detail-summary-standard-PHBC | T-DETAIL-SUMMARY (or T-DETAIL-EDITOR — see §8.1) |
| T-detail-summary-standard-PHBC-CB | T-DETAIL-SUMMARY |
| T-detail-summary-unknown-PHBC | T-DETAIL-SUMMARY |
| T-detail-summary-unknown-PHBC-CA | T-DETAIL-SUMMARY |
| T-detail-summary-wide-PHBC | T-DETAIL-SUMMARY |
| T-detail-summary-wide-PHBC-CA-SH-DT-DM | T-DETAIL-SUMMARY |
| T-detail-summary-wide-PHBC-CB-CG | T-DETAIL-SUMMARY |
| T-detail-summary-wide-PHBC-SL | T-DETAIL-SUMMARY |
| T-detail-tabbed-standard-IA | T-DETAIL-TABBED |
| T-empty-stub-none | T-REDIRECT-STUB |
| T-empty-stub-none-PH-ES | T-LIST-STANDARD (empty case) |
| T-error-state-narrow | T-ERROR-STATE |
| T-form-create-form-PHBC-FS | T-FORM |
| T-form-create-narrow-PHBC-IA-FS | T-FORM |
| T-form-create-standard-PH | T-FORM |
| T-form-create-standard-PHBC-FS | T-FORM |
| T-form-create-wide-PHBC-FS | T-FORM |
| T-full-bleed-editor-standard-PH | T-FULL-BLEED-EDITOR |
| T-index-grid-standard-PH-IA | T-GRID |
| T-index-grid-unknown-PHBC | T-GRID |
| T-index-list-none-PHBC-DT-PG | T-LIST-WIDE |
| T-index-list-standard-IA | T-LIST-STANDARD |
| T-index-list-standard-PH-CB | T-LIST-STANDARD |
| T-index-list-standard-PH-CB-IA-SL | T-LIST-STANDARD |
| T-index-list-standard-PH-DT | T-LIST-STANDARD |
| T-index-list-standard-PHBC | T-LIST-STANDARD |
| T-index-list-standard-PHBC-CB | T-LIST-STANDARD |
| T-index-list-standard-PHBC-CB-FB-ES-SL-PG | T-LIST-STANDARD |
| T-index-list-standard-PHBC-FB-DT-PG | T-LIST-STANDARD |
| T-index-list-standard-PHBC-IA | T-LIST-STANDARD |
| T-index-list-unknown-PHBC | T-LIST-STANDARD (layout-driven variant) |
| T-index-list-wide-PHBC-CB-DT | T-LIST-WIDE |
| T-index-list-wide-PHBC-CB-SL | T-LIST-WIDE |
| T-index-list-wide-PHBC-DT | T-LIST-WIDE |
| T-index-list-wide-PHBC-DT-PG | T-LIST-WIDE |
| T-index-list-wide-PHBC-SH-DT | T-LIST-WIDE |
| T-index-list-wide-PHBC-SL | T-LIST-WIDE |
| T-review-link-standard-PHBC | T-REVIEW-LINK |
| T-review-link-standard-PHBC-IA-CA | T-REVIEW-LINK |
| T-settings-flat-form-PHBC-FS | T-SETTINGS-FLAT |
| T-settings-flat-narrow-PH | T-SETTINGS-FLAT |
| T-settings-flat-narrow-PHBC | T-SETTINGS-FLAT |
| T-settings-flat-narrow-PHBC-FS | T-SETTINGS-FLAT |
| T-settings-flat-standard-IA | T-SETTINGS-FLAT |
| T-settings-flat-standard-PH-CA | T-SETTINGS-FLAT |
| T-settings-flat-wide-PHBC-FS | T-SETTINGS-FLAT |
| T-wizard-step-form-PHBC-CB-FS | T-WIZARD-STEP |
| T-wizard-step-form-PHBC-WP | T-WIZARD-STEP |
| T-wizard-step-standard-PH-CB | T-WIZARD-STEP |
| T-wizard-step-standard-PH-FS-SL | T-WIZARD-STEP |

**End of Pass 1. Awaiting director sign-off on D-1 through D-11 and template count before Pass 2 begins.**
