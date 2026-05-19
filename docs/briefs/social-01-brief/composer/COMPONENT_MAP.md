# Component Map

The wireframes in `../wireframes/` use semantic CSS class names. Each maps 1:1 to a React component file path under `app/(platform)/social/poster/` or `components/social/composer/`.

This file is the canonical mapping. Translate the HTML wireframes into React components by following this map. Do not deviate; do not invent new components without adding them to this map.

---

## Convention

| HTML class pattern | React component path |
|---|---|
| `.app-shell` | Use existing `components/platform/AppShell.tsx` |
| `.composer-overlay` | `components/social/composer/ComposerOverlay.tsx` |
| `.calendar-shell` | `components/social/dashboard/CalendarShell.tsx` |
| `.callout` | `components/ui/callout.tsx` (new shadcn-style primitive) |
| `.preview-card` | `components/social/composer/PreviewCard.tsx` |
| `.modal-backdrop` + `.modal` | Use existing `components/ui/dialog.tsx` with size prop per D-6 |

Block class names become PascalCase components. Element names (`__head`, `__body`) become sub-components or inline JSX. Modifiers (`--selected`, `--past`) become props.

---

## Composer overlay

| Wireframe class | Component file | Props |
|---|---|---|
| `.composer-overlay` | `components/social/composer/ComposerOverlay.tsx` | `{ open: boolean, onClose: () => void, initialDraft?: Draft, prefilledDate?: Date }` |
| `.composer__pane--left` | `components/social/composer/ComposerEditor.tsx` | `{ draft: Draft, onChange: (d: Draft) => void, onSubmit: (mode: SchedulingMode) => Promise<void> }` |
| `.composer__pane--right` | Rendered inline in `components/social/composer/ComposerOverlay.tsx` (lines 272–342). `ComposerPreview.tsx` was NOT created as a separate file — the right-pane state (`previewTab`, `activePreviewIndex`) is owned by `ComposerOverlay` directly. `PreviewCard` component handles per-platform card rendering. See audit gap C-2 (closed). | — |
| `.composer__close` | Inline `<Button variant="ghost" size="icon">` |
| `.composer__title` | `<H2>` from existing typography components |
| `.profile-selector` | `components/social/composer/ProfileSelector.tsx` | `{ available: Connection[], selected: string[], onChange: (ids: string[]) => void }` |
| `.profile-chip` | Sub-component inside `ProfileSelector` |
| `.content-card` | `components/social/composer/ContentEditor.tsx` | `{ value: string, onChange: (v: string) => void, mediaUrls: string[], onMediaChange: (urls: string[]) => void, maxLength: number }` |
| `.content-card__textarea` | Use existing `components/ui/textarea.tsx` |
| `.content-card__counter` | Inline in `ContentEditor` |
| `.media-thumb` + `.media-thumb-add` | `components/social/composer/MediaTray.tsx` |
| `.tools-row` | `components/social/composer/ToolsRow.tsx` |
| `.tool-btn` | Use existing `<Button variant="outline" size="sm">` |
| `.customize-row` | `components/social/composer/CustomizeForRow.tsx` | `{ platforms: Platform[], activePlatform: Platform \| null, onChange: (p) => void }` |
| `.platform-actions` | `components/social/composer/PlatformActionsList.tsx` |
| `.platform-action` | Sub-component, one per platform |
| `.scheduling-card` | `components/social/composer/SchedulingCard.tsx` | `{ mode: SchedulingMode, onModeChange: (m) => void, value: SchedulingValue, onChange: (v) => void }` |
| `.scheduling-tabs` | Use existing `components/ui/tabs.tsx` |
| `.scheduling-content` | Inline tab panels inside `SchedulingCard` |
| `.schedule-row` | `components/social/composer/ScheduleRow.tsx` |
| `.schedule-input` | Use existing `components/ui/input.tsx` with `type="datetime-local"` |
| `.schedule-add` | Inline `<Button variant="link">` |
| `.recurrence-grid` | `components/social/composer/RecurrencePicker.tsx` | `{ value: RecurrenceRule, onChange: (r) => void }` |
| `.approval-row` | `components/social/composer/ApprovalToggle.tsx` | `{ enabled: boolean, onChange: (v) => void, approverName?: string }` |
| `.toggle` | Use existing `components/ui/switch.tsx` |
| `.submit-row` | Sub-component inside `ComposerEditor` |
| `.preview-tabs` | Use existing `components/ui/tabs.tsx` |
| `.preview-card` | `components/social/composer/PreviewCard.tsx` | `{ platform: Platform, content: string, mediaUrls: string[], connection: Connection }` |
| `.preview-card--gbp` | Variant of `PreviewCard` controlled by `platform` prop |
| `.preview-empty` | Sub-component or use existing `EmptyState` primitive |
| `.mini-cal` | `components/social/composer/MiniCalendar.tsx` |

---

## Dashboard

| Wireframe class | Component file | Props |
|---|---|---|
| `.app-shell` | Use existing `components/platform/AppShell.tsx` |
| `.page-header` | Use existing `components/platform/PageHeader.tsx` |
| `.tab-line` | Use existing `components/ui/tabs.tsx` (sub-variant) |
| `.filter-bar` | `components/social/dashboard/FilterBar.tsx` | `{ profileFilter: string[], onProfileFilterChange, viewMode: 'month' \| 'timeline', onViewModeChange }` |
| `.filter-bar__profile-select` | Use existing `components/ui/select.tsx` (multi-select variant) |
| `.pill-group` | Use existing `components/ui/toggle-group.tsx` |
| `.callout` | `components/ui/callout.tsx` (NEW primitive — see §"New primitives" below) |
| `.callout__icon`, `.callout__body`, `.callout__cta`, `.callout__close` | Sub-elements of `Callout` |
| `.calendar-shell` | `components/social/dashboard/CalendarShell.tsx` | `{ posts: CalendarPost[], selectedDate: Date, onDateSelect: (d) => void, onPostMove: (id, d) => void, onCellAdd: (d) => void }` |
| `.calendar__month-header` | Sub-component of `CalendarShell` |
| `.calendar__day-header` | Sub-component of `CalendarShell` |
| `.calendar__grid` | Sub-component of `CalendarShell` |
| `.calendar__cell` | `components/social/dashboard/CalendarCell.tsx` | `{ date: Date, posts: CalendarPost[], isSelected, isPast, isOtherMonth, onAdd: () => void, onClick: () => void }` |
| `.calendar__cell-add` | Inline `<Button>` inside `CalendarCell` |
| `.calendar__day-number--today` | Modifier class — handle via conditional className |
| `.post-chip` | `components/social/dashboard/PostChip.tsx` | `{ post: CalendarPost }` |
| `.calendar__day-detail` | `components/social/dashboard/DayDetail.tsx` | `{ date: Date, posts: CalendarPost[], onPostClick: (id) => void, onDelete: (id) => void, onReschedule: (id) => void }` |
| `.day-detail__post` | `components/social/dashboard/DayDetailPostCard.tsx` |
| `.day-detail__hover-actions` | Sub-element of `DayDetailPostCard` |

---

## Modals

| Wireframe class | Component file | Props |
|---|---|---|
| `.modal-backdrop` + `.modal` | Use existing `components/ui/dialog.tsx` with `size` prop per D-6 |
| `.modal--sm` | `<Dialog size="sm">` |
| `.modal--lg` | `<Dialog size="lg">` |
| `.modal__head` | `<DialogHeader>` |
| `.modal__title` | `<DialogTitle>` |
| `.modal__body` | `<DialogContent>` (or wrap in a div if `<DialogContent>` is already the root) |
| `.modal__foot` | `<DialogFooter>` |

### Bulk CSV modal

| Wireframe class | Component file |
|---|---|
| `09-bulk-csv-modal.html` body | `components/social/dashboard/BulkScheduleModal.tsx` |
| `.bulk-upload` (empty state) | Sub-component `BulkUploadEmptyState` |
| `.bulk-upload__illo` | Inline SVG illustration |
| `09a-bulk-csv-uploaded.html` body | `BulkUploadPreviewState` sub-component inside `BulkScheduleModal` |

Props for `BulkScheduleModal`:

```ts
interface BulkScheduleModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (batchId: string, count: number) => void;
}
```

### Post analytics modal

| Wireframe class | Component file |
|---|---|
| `10-post-analytics-modal.html` body | `components/social/dashboard/PostAnalyticsModal.tsx` |
| `.analytics-grid` | Inline layout |
| `.analytics-stats` | Sub-component `AnalyticsStatsRow` |
| `.analytics-card` | Use existing `<Card>` primitive |
| `.analytics-card__label` | `<CardHeader>` content |
| `.analytics-card__value` | `<CardContent>` content with large number styling |
| `.analytics-section` | Use existing `<Card>` |
| `.analytics-section__row` | Sub-component `AnalyticsMetricRow` |

Props:

```ts
interface PostAnalyticsModalProps {
  open: boolean;
  onClose: () => void;
  draftId: string;                           // load via /drafts/[id]/analytics
}
```

### Unsaved-changes modal

| Wireframe class | Component file |
|---|---|
| `08-composer-unsaved-modal.html` body | `components/social/composer/UnsavedChangesDialog.tsx` |

Props:

```ts
interface UnsavedChangesDialogProps {
  open: boolean;
  onSave: () => Promise<void>;
  onDiscard: () => void;
  onCancel: () => void;
}
```

### Add-profile dropdown

| Wireframe class | Component file |
|---|---|
| `11-add-profile-dropdown.html` body | `components/social/dashboard/AddProfileDropdown.tsx` |

Use existing `components/ui/dropdown-menu.tsx` for the cascade behaviour. Each item links to `/company/social/connections/connect/[platform]`.

---

## New primitives (commission BEFORE Wave 2 of framework)

These primitives are referenced by the composer wireframes and by multiple templates in the framework. They do not exist yet. Add them in PR C of the composer workstream (so they're available for D–H):

### `components/ui/callout.tsx`

Per `DECISIONS_LOCKED.md` D-10. Banner-shape Alert variant.

```tsx
export interface CalloutProps {
  variant?: 'info' | 'warning' | 'helpful';   // 'helpful' = the yellow callout from the wireframe
  icon?: ReactNode;
  title: string;
  body?: string;
  cta?: { label: string; onClick: () => void };
  onDismiss?: () => void;
  className?: string;
}
```

Render: rounded card, soft-coloured background per variant, icon left, title + body + CTA right. Dismiss X top-right if `onDismiss` provided.

Replaces:
- `components/BlogStyleCalibrationBanner.tsx` (delete after migration)
- `components/OnboardingReminderBanner.tsx` (delete after migration)

### `components/ui/section-header.tsx`

Per `DECISIONS_LOCKED.md` D-7.

```tsx
export interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
}
```

Renders `<h2 className="text-section-title">` with optional subtitle below and actions right-aligned.

### `components/ui/pagination.tsx`

Per `DECISIONS_LOCKED.md` D-8. Already partially exists in shadcn defaults; ensure it includes:
- `aria-label="Pagination"`
- `aria-disabled` on disabled previous/next
- Optional `pageSizeOptions` prop

```tsx
export interface PaginationProps {
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  pageSize Options?: number[];               // default [10, 25, 50, 100]
  onPageSizeChange?: (size: number) => void;
}
```

### `components/ui/empty-state.tsx`

Per `DECISIONS_LOCKED.md` D-9. May already exist — check first; if so, conform its signature to:

```tsx
export interface EmptyStateProps {
  icon: string;                              // Linearicons name
  title: string;
  body?: string;
  cta?: ReactNode;                           // typically <Button>
  className?: string;
}
```

---

## Type definitions (shared)

Add to `lib/social/types.ts`:

```ts
export type Platform = 'linkedin' | 'facebook' | 'instagram' | 'x' | 'google_business_profile' | 'pinterest' | 'tiktok';
export type DraftState = 'draft' | 'pending_approval' | 'rejected' | 'scheduled' | 'recurring' | 'paused' | 'publishing' | 'published' | 'failed';
export type SchedulingMode = 'post_now' | 'schedule' | 'recurring' | 'draft';

export interface Connection {
  id: string;
  platform: Platform;
  account_name: string;
  account_avatar_url: string;
}

export interface Draft {
  id?: string;                               // undefined for new drafts
  content: string;
  media_urls: string[];
  target_profile_ids: string[];
  platform_variants: Record<string, { content?: string; link?: string; cta?: string }>;
  approval_required: boolean;
  approver_user_id?: string;
}

export interface CalendarPost {
  id: string;
  state: DraftState;
  scheduled_at: string | null;
  published_at: string | null;
  content_excerpt: string;
  primary_media_url: string | null;
  target_profiles: Array<{ platform: Platform; account_avatar_url: string }>;
  is_recurring_child: boolean;
}

export interface RecurrenceRule {
  rule: string;                              // RRULE string
  starting_at: string;                       // ISO 8601
  until?: string;                            // ISO 8601, absent = no end
}
```

---

## State management

The composer overlay is a controlled component owned by the dashboard page. Recommended pattern (existing Opollo convention):

```tsx
// app/(platform)/social/poster/page.tsx
const [composerState, setComposerState] = useComposerState();
// useComposerState is a custom hook in hooks/use-composer-state.ts
// It manages: open/closed, current draft, dirty flag, optimistic UI
```

The dirty flag drives the unsaved-changes modal. When `setComposerState({ open: false })` is called and `dirty === true`, the UnsavedChangesDialog opens instead of closing.

If the existing repo uses Zustand or another state library for the composer, follow that. Otherwise, use the hook pattern above.

---

## Drag-and-drop (calendar reschedule)

Use `@dnd-kit/core` (check if already in repo; if not, add to package.json). The dashboard wraps `<CalendarGrid>` in `<DndContext>`. Drag source: each `<DayDetailPostCard>`. Drop targets: every `<CalendarCell>` where `isPast === false && isOtherMonth === false`.

On drop:
1. Optimistic UI: move the card to the new day.
2. Call `PATCH /api/platform/social/drafts/[id]` with new `scheduled_at` (preserve time-of-day, change date).
3. On 200: refetch `/calendar-view` for the affected range.
4. On error: revert optimistic move, show toast.

---

## File path summary (for `git grep` and orientation)

```
app/(platform)/social/poster/
  page.tsx                              # Dashboard parent
  loading.tsx                           # Suspense fallback
  composer/
    page.tsx                            # Composer overlay route (or modal mount; see Build Order PR C)

components/social/composer/
  ComposerOverlay.tsx
  ComposerEditor.tsx
  ComposerPreview.tsx
  ProfileSelector.tsx
  ContentEditor.tsx
  MediaTray.tsx
  ToolsRow.tsx
  CustomizeForRow.tsx
  PlatformActionsList.tsx
  SchedulingCard.tsx
  ScheduleRow.tsx
  RecurrencePicker.tsx
  ApprovalToggle.tsx
  PreviewCard.tsx
  MiniCalendar.tsx
  UnsavedChangesDialog.tsx

components/social/dashboard/
  CalendarShell.tsx
  CalendarCell.tsx
  PostChip.tsx
  DayDetail.tsx
  DayDetailPostCard.tsx
  FilterBar.tsx
  BulkScheduleModal.tsx
  PostAnalyticsModal.tsx
  AddProfileDropdown.tsx

components/ui/
  callout.tsx                           # NEW per D-10
  section-header.tsx                    # NEW per D-7
  pagination.tsx                        # NEW or update per D-8
  empty-state.tsx                       # ensure conforms to D-9 signature

lib/social/
  types.ts
  schemas/                              # Zod schemas matching API_CONTRACTS.md
    create-draft.ts
    bulk-upload.ts
    approve.ts
  bulk-csv/
    parse.ts                            # SINGLE SOURCE of CSV format (used by API + CAP)
  publishing/
    bundle-social-client.ts             # bundle.social API wrapper
  approval/
    notify-approver.ts                  # SendGrid + Slack notifications
    escalate.ts                         # 48h / 72h / 96h logic

app/api/platform/social/drafts/
  route.ts                              # POST (create)
  [id]/route.ts                         # GET, PATCH, DELETE
  [id]/approve/route.ts                 # POST
  [id]/analytics/route.ts               # GET (uses postgres-cache)
  [id]/review-link/route.ts             # GET
  bulk/route.ts                         # POST (bulk CSV, uses postgres-rate-limit)
  calendar-view/route.ts                # GET

app/api/platform/admin/service-health/
  events/route.ts                       # GET list
  events/[id]/resolve/route.ts          # POST mark resolved
  events/flag/route.ts                  # POST manual flag

app/api/internal/cron/
  publish-due/route.ts                  # every 1 min — picks up scheduled drafts
  heartbeat-check/route.ts              # every 5 min — flags stale crons
  health-check/route.ts                 # every 5 min — notifies on critical events
  cleanup-cache/route.ts                # daily 3am — purges old cache rows
  escalate-approvals/route.ts           # every 6 hours — 48h/72h/96h escalation
  health-digest/route.ts                # daily 9am AEST — digest email

app/api/webhooks/bundle-social/
  route.ts                              # POST (webhook receiver)

app/(platform)/admin/system/health/
  page.tsx                              # admin dashboard
  components/
    ServiceStatusGrid.tsx
    EventTimeline.tsx
    BillingIssueDialog.tsx

lib/platform/service-health/
  monitor.ts                            # withHealthMonitoring wrapper
  classify.ts                           # status code → event_type mapper
  record.ts                             # writes service_health_events
  notify.ts                             # SendGrid + Slack with self-monitoring exclusion
  recipients.ts                         # getPlatformAdminEmails() — DB query for admin recipients
  digest.ts                             # daily digest generator
  types.ts                              # shared types

lib/platform/cache/
  index.ts                              # exports get/set/getStale — orchestrates Redis + Postgres
  redis-cache.ts                        # Upstash Redis client; all calls wrapped, fails silently to null
  postgres-cache.ts                     # social_post_analytics_cache accessor (cold storage)

lib/platform/rate-limit/
  index.ts                              # exports check() — Upstash Ratelimit primary, Postgres fallback
  upstash-rate-limit.ts                 # primary
  postgres-rate-limit.ts                # fallback when Upstash unavailable

hooks/
  use-composer-state.ts                 # composer dirty-state + open/close
  use-calendar-view.ts                  # SWR wrapper around /calendar-view
```

This is the canonical file layout. Match it.
