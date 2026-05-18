# Templates — Full Specifications

All 16 templates that absorb the 80 cluster IDs from the 82-route audit.

Each template's spec includes:
- Owner / audience / mode
- Props signature
- Locked section composition
- Width modes supported
- Routes assigned (with critical-route flags)
- Resolved divergences (R-numbers from the audit)
- Migration steps
- Validation steps

---

## T-LIST-STANDARD

**Owner:** Platform UI
**Audience:** Admins, content operators, customers managing collections
**Mode:** Read-mostly index of a collection (with optional filtering, pagination)

**Props:**

```tsx
interface TListStandardProps {
  title: string;
  breadcrumb?: BreadcrumbItem[];
  subtitle?: string;
  actions?: ReactNode;                       // right-aligned in PageHeader
  meta?: ReactNode;                          // timezone, count, etc.

  callout?: CalloutProps;                    // optional banner above filter bar
  inlineAlert?: AlertProps;                  // optional inline alert
  filterBar?: ReactNode;                     // controls row

  children: ReactNode;                       // list content: DataTable, stacked-list, or EmptyState
  pagination?: PaginationProps;              // optional pagination

  width?: 'standard' | 'layout-driven';      // default: 'standard'
}
```

**Composition (locked, top to bottom):**

PageShell ▸ PageHeader (title + breadcrumb + actions + subtitle + meta) ▸ [Callout] ▸ [Alert] ▸ [filterBar] ▸ children ▸ [Pagination]

**Width:** `standard` (max-w-7xl), or `layout-driven` for the 4 design-system subtree routes only.

**Routes assigned** (~15):
- `/admin/sites` — *critical*
- `/admin/sites/[id]/content` — *critical*
- `/admin/sites/[id]/posts` — *critical*
- `/admin/sites/[id]/pages` — *critical*
- `/admin/sites/[id]/briefs/[brief_id]/run`
- `/admin/posts` (downgraded from T-empty-stub-none-PH-ES; renders as list with EmptyState)
- `/admin/batches` (downgraded similarly)
- `/optimiser/proposals` — *critical*
- `/optimiser/change-log`
- `/company/users`
- `/company/social/posts` — *critical*
- `/company/social/connections` — *critical*
- `/admin/sites/[id]/design-system/templates` (layout-driven)

**Resolved divergences:** R3 (Alert error states), R4 (PageShell adoption), R5 (PageHeader adoption — adds to social), R6 (form primitives — n/a here), R10 (SectionHeader), R14 (Pagination primitive), R8 (Callout replaces bespoke banners), R27 (dynamic site-name breadcrumb on design-system routes via layout context).

**Migration steps:**
1. For each route, find the current `page.tsx`.
2. Replace ad-hoc PageHeader / Alert / div-based scaffolding with `<TListStandard title="..." breadcrumb={...} actions={...}>`.
3. Move filter-bar markup into the `filterBar` prop.
4. Move list content into children. If list was a raw table, migrate to `<DataTable>`.
5. If route had `width=none` per audit, set `width="standard"`.
6. If `social_connections.length === 0` should show empty callout (e.g. `/company/social/connections`), pass it via `callout` prop.

**Validation:**

```bash
pnpm typecheck && pnpm lint
pnpm audit:static --template=T-LIST-STANDARD
pnpm test:e2e templates --grep "T-LIST-STANDARD"
```

---

## T-LIST-WIDE

**Owner:** Platform UI
**Audience:** Admins managing wide tabular data
**Mode:** Read-mostly index with DataTable as primary content; wide width

**Props:** same shape as T-LIST-STANDARD but `width: 'wide'` (max-w-screen-2xl).

**Composition:** PageShell wide ▸ PageHeader ▸ [Callout] ▸ [SectionHeader per list] ▸ DataTable ▸ [Pagination]

**Routes assigned** (~10):
- `/admin/users`
- `/admin/users/audit`
- `/admin/companies`
- `/admin/companies/[id]/social-profiles`
- `/admin/batches/[siteId]`
- `/admin/maintenance/social-connections`
- `/admin/images` (migrated from `width=none` per D-11)

**Resolved divergences:** R3, R8, R10, R14, R15 (DataTable migration), R21 (Promise.all on sequential queries — flagged per-route in `audit:static`).

**Migration steps:** Same as T-LIST-STANDARD with `width="wide"`. Routes using raw `<table>` migrate to `<DataTable>`.

---

## T-GRID

**Owner:** Platform UI
**Audience:** Admins + customers viewing card-shaped collections
**Mode:** Read-mostly index rendered as a responsive grid of cards

**Props:**

```tsx
interface TGridProps extends Omit<TListStandardProps, 'children'> {
  items: GridItem[];
  renderItem: (item: GridItem) => ReactNode;
  columns?: number | 'auto';                 // default: 'auto' (responsive)
  emptyState?: EmptyStateProps;              // shown when items.length === 0
}
```

**Composition:** PageShell ▸ PageHeader ▸ [Alert] ▸ Grid (CardGrid OR EmptyState) ▸ [Pagination]

**Routes assigned** (2):
- `/admin/sites/[id]/design-system/components` (layout-driven)
- `/company/social/media`

**Resolved divergences:** R4, R5, R12 (EmptyState replaces inline dashed div), R22 (StatusPill replaces inline status dot in DesignSystemsTable).

---

## T-DETAIL-SUMMARY

**Owner:** Platform UI
**Audience:** All — read-mostly detail pages
**Mode:** Single entity with one or more card/section blocks

**Props:**

```tsx
interface TDetailSummaryProps {
  title: string;
  breadcrumb?: BreadcrumbItem[];
  subtitle?: string;
  actions?: ReactNode;
  meta?: ReactNode;

  callouts?: CalloutProps[];                 // can stack multiple
  inlineAlert?: AlertProps;

  sections: Array<{
    title: string;
    subtitle?: string;
    actions?: ReactNode;                     // section-level actions (Edit, Add)
    content: ReactNode;                      // Card content OR DataTable OR EmptyState
  }>;

  sidebar?: ReactNode;                       // wide-width only
  width?: 'standard' | 'wide' | 'layout-driven';
}
```

**Composition:** PageShell ▸ PageHeader ▸ [Callout×N] ▸ [Alert] ▸ Section×N (SectionHeader + content) ▸ [Sidebar — wide only]

**Routes assigned** (~12):
- `/admin/sites/[id]` — *critical*
- `/admin/sites/[id]/appearance`
- `/admin/sites/[id]/posts/[post_id]` — see note: actually T-DETAIL-EDITOR per `DECISIONS_LOCKED.md` Q1
- `/admin/companies/[id]`
- `/admin/companies/[id]/social-profiles/[profileId]/connections`
- `/admin/batches/[siteId]/[batchId]`
- `/admin/images/[id]`
- `/admin/sites/[id]/design-system` (layout-driven)
- `/admin/sites/[id]/design-system/preview` (layout-driven)
- `/optimiser/pages/[id]`
- `/optimiser/proposals/[id]` — *critical*
- `/optimiser/imports/[brief_id]`

**Resolved divergences:** R3, R4, R5, R8, R10, R13, R17 (Card primitive), R24 (move setTimeout to client polling on `/briefs/[brief_id]/run`), R27.

---

## T-DETAIL-TABBED

**Owner:** Platform UI
**Audience:** Customers viewing tabbed detail (currently social post detail)
**Mode:** Single entity with tabbed aspect views + composer/preview integration

**Props:**

```tsx
interface TDetailTabbedProps {
  title: string;
  breadcrumb?: BreadcrumbItem[];
  actions?: ReactNode;

  tabs: Array<{
    key: string;
    label: string;
    content: ReactNode;
  }>;
  activeTab: string;
  onTabChange: (key: string) => void;

  inlineAlerts?: AlertProps[];

  footerActions: ReactNode;                  // mandated by D-4 (fixes RECURRING-2)
}
```

**Composition:** PageShell ▸ PageHeader ▸ [Alert×N] ▸ TabBar ▸ TabPanel (active tab content) ▸ FooterActions

**Routes assigned** (1, but critical):
- `/company/social/posts/[id]` — *critical, RECURRING-2 fix*

**Resolved divergences:** R2 (Dialog primitive), R3, R4, R5, RECURRING-2 (post-publish dead-end fixed via `footerActions` slot).

**Migration steps:** The composer (built in the composer workstream) is the canonical implementation of T-DETAIL-TABBED. Reference it; do not build a parallel pattern. After composer ships, generalise its tab-shell into `templates/T-DETAIL-TABBED.tsx` and rewire `/company/social/posts/[id]` to use the generalised template.

**Footer-actions default contents** (per D-4):
For the social-post variant: `[View on platform, Schedule another, Back to posts]`. "Schedule another" is the primary button.

---

## T-DETAIL-EDITOR

**Owner:** Platform UI
**Audience:** Operators editing rich content (posts, pages)
**Mode:** Read-write detail page with rich-text preview + metadata grid

**Props:**

```tsx
interface TDetailEditorProps {
  title: string;
  breadcrumb?: BreadcrumbItem[];
  actions?: ReactNode;                       // typically [Save, Preview]

  preview: ReactNode;                        // rich-text rendered content
  metadata: ReactNode;                       // DetailMetaGrid

  additionalSections?: Array<{
    title: string;
    content: ReactNode;
  }>;

  modals?: ReactNode;                        // EditPageMetadataModal etc.
}
```

**Composition:** PageShell ▸ PageHeader ▸ SectionHeader ▸ RichTextPreview ▸ DetailMetaGrid ▸ [SectionHeader + content]×N

**Width:** `max-w-4xl` (896px) per D-5 — intentional for prose readability.

**Routes assigned** (2):
- `/admin/sites/[id]/posts/[post_id]` — *critical, per Q1 routes here not T-DETAIL-SUMMARY*
- `/admin/sites/[id]/pages/[pageId]` — *critical, RECURRING-1 fix*

**Resolved divergences:** R2, R3, R10, RECURRING-1 (max-w-4xl locked as design intent, not oversight).

---

## T-FORM

**Owner:** Platform UI
**Audience:** All
**Mode:** Create / edit forms

**Props:**

```tsx
interface TFormProps {
  title: string;
  breadcrumb?: BreadcrumbItem[];
  subtitle?: string;
  actions?: ReactNode;                       // page-header right-aligned actions

  inlineAlert?: AlertProps;                  // for top-of-form errors

  formSections: Array<{
    title?: string;
    description?: string;
    content: ReactNode;
  }>;

  onCancel: () => void;
  onSubmit: () => Promise<void>;
  submitLabel?: string;                      // default: 'Save'
  cancelLabel?: string;                      // default: 'Cancel'
  isSubmitting?: boolean;

  width?: 'narrow' | 'form' | 'standard' | 'wide';   // default: 'form' (max-w-2xl)
}
```

**Composition:** PageShell ▸ PageHeader ▸ [Alert] ▸ FormSection×N ▸ FormActions (Cancel + Submit, sticky on long forms)

**Width default:** `form` = max-w-2xl. Override via prop.

**Routes assigned** (~6):
- `/admin/sites/new`
- `/admin/sites/[id]/edit`
- `/admin/sites/[id]/posts/new`
- `/admin/companies/new`
- `/admin/posts/[siteId]/new`
- `/admin/email-test`

**Resolved divergences:** R3, R6 (Input/Select/Textarea primitives), R30 (px tokens enforced via Input primitive).

---

## T-WIZARD-STEP

**Owner:** Platform UI
**Audience:** Setup + onboarding flows
**Mode:** Multi-step wizard with progress indicator

**Props:**

```tsx
interface TWizardStepProps {
  title: string;
  breadcrumb?: BreadcrumbItem[];

  totalSteps: number;
  currentStep: number;                       // 1-indexed
  stepLabels?: string[];                     // labels under each progress dot

  callout?: CalloutProps;

  content: ReactNode;                        // the actual step body (FormSection, etc.)

  onBack?: () => void;                       // hidden when currentStep === 1
  onNext: () => void;
  onSkip?: () => void;                       // hidden if not provided

  nextLabel?: string;                        // default: 'Next'
  isSubmitting?: boolean;

  width?: 'form' | 'standard';               // default: 'form' (max-w-3xl)
}
```

**Composition:** PageShell ▸ PageHeader ▸ WizardProgress ▸ [Callout] ▸ content ▸ FormActions (Back + Skip? + Next)

**Routes assigned** (~5):
- `/admin/sites/[id]/setup`
- `/admin/sites/[id]/setup/extract`
- `/admin/sites/[id]/onboarding`
- `/optimiser/onboarding`
- `/optimiser/onboarding/[id]`

**Resolved divergences:** R3, R6, R8 (Callout primitive).

---

## T-SETTINGS-FLAT

**Owner:** Platform UI
**Audience:** All
**Mode:** Flat settings — no wizard, no tabs, just stacked sections

**Props:**

```tsx
interface TSettingsFlatProps {
  title: string;
  breadcrumb?: BreadcrumbItem[];
  subtitle?: string;
  actions?: ReactNode;

  inlineAlerts?: AlertProps[];

  sections: Array<{
    title: string;
    description?: string;
    content: ReactNode;                      // FormSection or stacked-list
  }>;

  width?: 'narrow' | 'form' | 'standard' | 'wide';
}
```

**Composition:** PageShell ▸ PageHeader ▸ [Alert×N] ▸ FormSection×N (or stacked-list for `/account/devices` pattern)

**Routes assigned** (~7):
- `/admin/sites/[id]/settings`
- `/admin/settings/design-system`
- `/account/security`
- `/account/devices`
- `/company/settings/brand`
- `/optimiser/clients/[id]/settings` — *critical*
- `/company/social/sharing`

**Resolved divergences:** R3, R6, R17.

---

## T-DASHBOARD-KPI

**Owner:** Platform UI
**Audience:** Operators monitoring metrics
**Mode:** KPI tiles + supporting data tables

**Props:**

```tsx
interface TDashboardKpiProps {
  title: string;
  breadcrumb?: BreadcrumbItem[];
  actions?: ReactNode;

  callout?: CalloutProps;

  kpis: Array<{
    label: string;
    value: string | number;
    delta?: string;                          // e.g. "+12% vs last week"
    icon?: string;                           // Linearicons name
  }>;

  dataSections?: Array<{
    title: string;
    actions?: ReactNode;
    content: ReactNode;                      // typically DataTable
  }>;

  width?: 'standard' | 'wide';
}
```

**Composition:** PageShell ▸ PageHeader ▸ [Callout] ▸ KpiCardGrid ▸ [SectionHeader + DataTable]×N

**Routes assigned** (~5):
- `/company` (homepage, adopts PageShell per D-3)
- `/admin/system/jobs`
- `/admin/companies/[id]/social-profiles/[profileId]/analytics`
- `/company/social/analytics`
- `/optimiser/diagnostics`

**Resolved divergences:** R6, R10, R17, R15 (system/jobs DataTable migration deferred per allowlist).

---

## T-DASHBOARD-FEED

**Owner:** Platform UI
**Audience:** Operators viewing chronological activity
**Mode:** Feed-style dashboards including the full-bleed calendar

**Props:**

```tsx
interface TDashboardFeedProps {
  title: string;
  breadcrumb?: BreadcrumbItem[];
  actions?: ReactNode;

  inlineAlert?: AlertProps;

  feed: ReactNode;                           // delegated client component (calendar, timeline, log)

  width?: 'standard' | 'wide' | 'none' | 'full-bleed';
}
```

**Composition:** PageShell (or full-bleed) ▸ PageHeader ▸ [Alert] ▸ feed

**Routes assigned** (~5):
- `/admin/maintenance`
- `/admin/_internal/table-examples`
- `/company/internal/autosave-lab`
- `/company/social/calendar` (full-bleed) — *fixes R23*
- `/company/social/timeline`

**Resolved divergences:** R3, R5, R23 (SocialCalendarClient hardcoded nav buttons → IconButton primitive).

---

## T-REVIEW-LINK

**Owner:** Platform UI
**Audience:** Operators reviewing parsed briefs / blueprints
**Mode:** Read + primary action page

**Props:**

```tsx
interface TReviewLinkProps {
  title: string;
  breadcrumb?: BreadcrumbItem[];
  primaryAction: { label: string; onClick: () => void };

  inlineAlert?: AlertProps;

  reviewCards: Array<{
    title: string;
    content: ReactNode;
  }>;

  additionalContent?: ReactNode;
}
```

**Composition:** PageShell ▸ PageHeader (title + primary action) ▸ [Alert] ▸ Card×N ▸ [additionalContent]

**Routes assigned** (2):
- `/admin/sites/[id]/briefs/[brief_id]/review` — *critical*
- `/admin/sites/[id]/blueprints/review` — *critical*

**Resolved divergences:** R3, R13.

---

## T-AUTH-CHROME

**Owner:** Platform UI
**Audience:** Public — unauthenticated and partly authenticated
**Mode:** Auth pages — login, invite, callback, expired, approve

**Props:**

```tsx
interface TAuthChromeProps {
  title: string;
  subtitle?: string;

  inlineAlert?: AlertProps;

  content: ReactNode;                        // form, callout content, or message

  footerActions?: ReactNode;                 // "Back to login" etc.

  width?: 'narrow' | 'full-bleed';           // narrow default; full-bleed for /auth/callback
}
```

**Composition:** AuthShell (not platform AppShell) ▸ Logo ▸ PageHeader (title + subtitle) ▸ Card (content) ▸ [Alert] ▸ [footerActions]

**AuthShell** is a separate shell from the platform AppShell. It is full-screen centered, no sidebar, no topbar. Implement at `components/platform/AuthShell.tsx`.

**Routes assigned** (~10):
- `/login`
- `/login/check-email`
- `/auth/forgot-password`
- `/auth/reset-password`
- `/auth/accept-invite`
- `/invite/[token]`
- `/auth/approve`
- `/auth/callback` (full-bleed)
- `/auth/expired`

**Resolved divergences:** R3, R11 (centered layout consistency), R17, R18 (remove local PageShell in auth/approve).

---

## T-FULL-BLEED-EDITOR

**Owner:** Platform UI
**Audience:** Creators using canvas-shaped editors
**Mode:** Full-bleed editor with top-bar + canvas, no sidebar

**Props:**

```tsx
interface TFullBleedEditorProps {
  title: string;
  actions?: ReactNode;                       // top-bar right-aligned

  canvas: ReactNode;                         // delegated client component (ImageGeneratorClient)
}
```

**Composition:** EditorShell (full-bleed, top-bar only) ▸ PageHeader (inline, no breadcrumb) ▸ canvas

**Routes assigned** (1):
- `/company/image/generate`

**Resolved divergences:** R2, R4, R5.

---

## T-ERROR-STATE

**Owner:** Platform UI
**Audience:** Public — error surface
**Mode:** Public error pages

**Props:**

```tsx
interface TErrorStateProps {
  icon: string;                              // Linearicons name (default: 'alert-triangle')
  title: string;
  subtitle?: string;
  actions?: ReactNode;                       // "Go home", "Contact support", etc.
}
```

**Composition:** AuthShell ▸ ErrorIcon ▸ PageHeader (title + subtitle) ▸ [actions]

**Routes assigned** (1):
- `/auth-error`

**Resolved divergences:** R11.

---

## T-REDIRECT-STUB

**Owner:** Platform UI
**Audience:** N/A — pure redirects
**Mode:** Empty redirect-only routes

**No component.** These routes contain only a `redirect()` call. They are exempt from the PageHeader rule via `PAGE_HEADER_EXEMPT_ROUTES` in the audit config.

**Routes assigned** (4):
- `/admin`
- `/admin/posts/new`
- `/admin/settings`
- `/company/social`

**Migration:** Verify each route is genuinely a redirect; add to `PAGE_HEADER_EXEMPT_ROUTES`. No template component to build.

---

## Resolved divergences (full audit closeout)

After all four waves complete, the following R-numbers from the baseline audit are RESOLVED:

| R# | Inconsistency | Resolved by |
|---|---|---|
| R1 | Raw `<button>` (152) | Lint rule: disallow raw `<button>`. Templates use Button/IconButton. |
| R2 | Hand-rolled modals (19) | Dialog primitive with `size` prop per D-6. All 19 migrated. |
| R3 | Error state split | All templates use `<Alert variant="destructive">` for errors. |
| R4 | PageShell absent in social/optimiser | D-3 sweep: all routes adopt PageShell behind `FEATURE_UNIFIED_SHELL`. |
| R5 | PageHeader absent in social | All social routes adopt PageHeader via their assigned template. |
| R6 | Raw input/select/textarea (121) | Lint rule + template props enforce primitives. |
| R7 | Emerald/gray hardcoded | Lint rule: disallow `bg-emerald-*`, `text-emerald-*`, `bg-gray-*`, `text-gray-*`. Use semantic tokens. |
| R8 | Bespoke banners re-implementing Alert | Callout primitive (D-10) replaces both; banner files deleted. |
| R9 | Breadcrumbs.tsx dead code | Deleted. |
| R10 | Section-header inconsistency | SectionHeader primitive (D-7) used by T-DETAIL-SUMMARY, T-LIST-WIDE, T-DASHBOARD-KPI. |
| R11 | Auth-chrome layout inconsistency | T-AUTH-CHROME with AuthShell wrapper enforces centered layout. |
| R12 | Empty-state bypass | EmptyState primitive (D-9) used everywhere; lint rule disallows inline dashed divs with `min-h-[50vh]`. |
| R13 | Skeleton bypass | Lint rule: disallow `animate-pulse` outside the Skeleton primitive. |
| R14 | Pagination not consolidated | Pagination primitive (D-8) used by T-LIST-STANDARD, T-LIST-WIDE. |
| R15 | Raw tables bypassing DataTable | Routes migrate to DataTable. `/admin/system/jobs` deferred per allowlist. |
| R16 | Font-weight inconsistency | `--font-weight-section`, `--font-weight-label`, `--font-weight-body` tokens. Lint rule disallows raw `font-medium/semibold/bold` outside primitives. |
| R17 | Card primitive underused | Lint rule: disallow `div.rounded-lg.border.p-6` — use `<Card>`. |
| R18 | Local PageShell in auth/approve | Deleted; route uses T-AUTH-CHROME. |
| R19 | Icon inconsistency | `lib/icons.ts` enforces canonical names: dismiss=`cross`, confirm=`check`, link=`link`, list=`list`. |
| R20 | Gap inconsistency | `--gap-section`, `--gap-form-row` tokens. |
| R21 | Sequential Supabase queries | Per-route fix. Audit:static flags any `await` followed by another `await` without `Promise.all`. |
| R22 | DesignSystemsTable status dot | Replaced with StatusPill. |
| R23 | SocialCalendarClient hardcoded nav buttons | Replaced with IconButton. |
| R24 | setTimeout in briefs/run | Moved to client-side polling. |
| R25 | UserRoleActionCell dead | Deleted. |
| R26 | 13 zero-import components | Per-component verification, then delete confirmed dead. |
| R27 | Static "Site" breadcrumb | Design-system layout passes site name into context; breadcrumb renders dynamically. |
| R28 | Modal sizing inconsistent | D-6 size scale enforced via Dialog primitive. |
| R29 | rounded-md vs rounded-lg | `--radius-interactive`, `--radius-card` tokens. |
| R30 | px-3 vs px-4 vs px-2 | `--spacing-interactive-x` token; primitives enforce. |

When all 30 are resolved + `audit:static` passes with zero violations, the framework workstream is done.
