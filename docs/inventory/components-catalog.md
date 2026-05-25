# Components Catalog

**Generated:** 2026-05-25 via codebase analysis.
**Status:** Phase 1 skeleton — props extracted from source files. `EXPECTED BEHAVIOUR` sections are empty for Steven to fill.

---

## Table of Contents

1. [UI Primitives](#ui-primitives)
   - [Button](#button)
   - [Dialog / DialogContent / DialogHeader / DialogFooter](#dialog--dialogcontent--dialogheader--dialogfooter)
   - [ConfirmDialog](#confirmdialog)
   - [CommentDialog](#commentdialog)
   - [Alert](#alert)
   - [Badge](#badge)
   - [MenuItem](#menuitem)
   - [PageHeader](#pageheader)
   - [PageShell](#pageshell)
   - [StatusPill](#statuspill)
   - [SocialPlatformIcon](#socialplatformicon)
2. [Social Composer](#social-composer)
   - [ComposerOverlay](#composeroverlay)
   - [ComposerEditor](#composereditor)
   - [ProfileSelector](#profileselector)
   - [SchedulingCard](#schedulingcard)
   - [ToolsRow](#toolsrow)
   - [UnsavedChangesDialog](#unsavedchangesdialog)
3. [Calendar](#calendar)
   - [CalendarShell](#calendarshell)
4. [Social Features](#social-features)
   - [SocialPostsListClient](#socialpostslistclient)
   - [PostDetailTabbedClient](#postdetailtabbedclient)
   - [PostApprovalSection](#postapprovalsection)
   - [MediaLibraryClient](#medialibryclient)
5. [Admin](#admin)
   - [ImagesTable](#imagestable)
6. [Viewer / Approval](#viewer--approval)
   - [ApprovalDecisionForm](#approvaldecisionform)
   - [ViewerLinksManager](#viewerlinksmanager)

---

## UI Primitives

### Button

**File:** `components/ui/button.tsx`
**Status:** Active

**Props:**
```typescript
export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}
```

**Variants:**
| Variant | Visual |
|---------|--------|
| `default` | Solid #00e5a0 (primary green) background, white text, full-pill, hover brightness+shadow |
| `destructive` | Solid red background, white text — for irreversible actions |
| `outline` | Hairline border (legacy, backward-compat) |
| `secondary` | White surface, `#1F2937` border, gray-800 text |
| `ghost` | Transparent, dark text, hover bg-gray-100 |
| `link` | Pink underline text (legacy) |
| `toolbar` | Square-ish composer toolbar button; `aria-pressed` drives active state |

**Sizes:**
| Size | Padding |
|------|---------|
| `default` | `py-[10px] px-5 text-sm` |
| `sm` | `py-[6px] px-[14px] text-xs` |
| `xs` | `py-1 px-2 text-xs` |
| `lg` | `py-[14px] px-7 text-base` |
| `icon` | `h-8 w-8` |

**Sub-components used:**
- `Slot` (Radix UI) — via `asChild` prop

**Currently tested by:**
- Unit: no dedicated test file found
- Component: no dedicated test file found

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Which variant is used for primary CTAs (e.g. "Save draft", "Post now")?
- [ ] Which variant is used for Cancel/back actions?
- [ ] Should `toolbar` buttons always show `aria-pressed` state when a panel is open?

---

### Dialog / DialogContent / DialogHeader / DialogFooter

**File:** `components/ui/dialog.tsx` (shadcn/ui wrapper around Radix Dialog)
**Status:** Active

**Props:** Standard Radix `@radix-ui/react-dialog` props. `DialogContent` receives `className?`. All are compound components used together.

**Variants / states:**
- Default modal: centered overlay with backdrop
- `max-w-sm` used by ConfirmDialog / UnsavedChangesDialog
- Larger widths used by ComposerOverlay (custom full-screen split-pane)

**Currently tested by:**
- Component: via ConfirmDialog / UnsavedChangesDialog test coverage

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Should dialogs trap focus?
- [ ] Should Escape always close?
- [ ] Is clicking the backdrop expected to close?

---

### ConfirmDialog

**File:** `components/ui/confirm-dialog.tsx`
**Status:** Active — replaces `window.confirm()` throughout social platform (S-6)

**Props:**
```typescript
type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;       // default: "Confirm"
  confirmVariant?: "default" | "destructive" | "outline" | "ghost"; // default: "default"
  onConfirm: () => void;
};
```

**Variants / states:**
- Default: title + optional description + Cancel (ghost) + Confirm button
- Destructive: red confirm button for irreversible actions (e.g. disconnect connection)

**Sub-components used:**
- `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter`, `Button`

**data-testid values:**
- None currently set on the dialog itself (uses Radix default structure)

**Currently tested by:**
- None found via grep

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Should Cancel always call `onOpenChange(false)` without triggering `onConfirm`?
- [ ] Clicking confirm should close dialog AND call onConfirm — in that order?

---

### CommentDialog

**File:** `components/ui/confirm-dialog.tsx` (same file as ConfirmDialog)
**Status:** Active — used for rejection-note flows

**Props:**
```typescript
type CommentDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  commentLabel?: string;
  commentPlaceholder?: string;
  confirmLabel?: string;
  confirmVariant?: "default" | "destructive" | "outline" | "ghost";
  onConfirm: (comment: string) => void;
};
```

**Variants / states:**
- Same as ConfirmDialog but with a `<textarea>` for a reason / note
- `onConfirm` receives the textarea value as a string

**Currently tested by:**
- None found via grep

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is the comment field required before Confirm is enabled?
- [ ] Minimum / maximum character limits on the comment?

---

### Alert

**File:** `components/ui/alert.tsx` (shadcn/ui)
**Status:** Active

**Props:** Standard shadcn Alert props — `variant?: "default" | "destructive"`, `className?`, plus compound sub-components `AlertTitle`, `AlertDescription`.

**Currently tested by:**
- Referenced throughout the admin and platform surfaces; no dedicated unit tests found.

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is `destructive` variant used for error messages exclusively?

---

### Badge

**File:** `components/ui/badge.tsx` (shadcn/ui)
**Status:** Active

**Props:** `variant?: "default" | "secondary" | "destructive" | "outline"`, `className?`, `children`.

**Note:** Distinct from `StatusPill` (which uses semantic token classes) and `Pill` (which is the Opollo design-system wrapper). Badge is the raw shadcn primitive.

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Which surfaces use Badge vs Pill vs StatusPill?

---

### MenuItem

**File:** `components/ui/menu-item.tsx`
**Status:** Active — used inside `role="menu"` containers (e.g. platform picker, connection dropdowns)

**Props:**
```typescript
export interface MenuItemProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: React.ReactNode;     // leading element (icon, avatar)
  trailing?: React.ReactNode; // trailing element (status text, badge, arrow)
}
```

**Variants / states:**
- Normal: hover `bg-muted/60` + focus `bg-muted/60`
- Disabled: `cursor-not-allowed opacity-60`
- Focus-visible: `shadow-[var(--shadow-focus)]`

**Sub-components used:**
- None (renders a `<button role="menuitem">` directly)

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Should MenuItem handle keyboard navigation (ArrowUp/Down) or does the parent menu container own that?

---

### PageHeader

**File:** `components/ui/page-header.tsx`
**Status:** Active — Spec 02 §1.1 + Spec 04 (2026-05-08)

**Props (compound slots detected by `displayName`):**
```typescript
// Compound component — usage:
// <PageHeader>
//   <PageHeader.Title>…</PageHeader.Title>
//   <PageHeader.Breadcrumb>…</PageHeader.Breadcrumb>
//   <PageHeader.Subtitle>…</PageHeader.Subtitle>
//   <PageHeader.Meta>…</PageHeader.Meta>
//   <PageHeader.Actions>…</PageHeader.Actions>
// </PageHeader>
```

**Layout contract (Spec 04 2026-05-08):**
- Visual order: Title → Breadcrumb → Subtitle → Meta → Actions (regardless of JSX order)
- Rhythm: 20px / 8px / 12px gaps between rows; 32px gap to PageShell.Content

**Sub-components used:**
- `Breadcrumb` (ui/breadcrumb)

**Currently tested by:**
- Unit: `headings-use-page-header` audit rule in build layer

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is `Title` always required? (Dev invariant enforced as `console.error`, not thrown)
- [ ] What is the fallback when no breadcrumb is provided?

---

### PageShell

**File:** `components/ui/page-shell.tsx`
**Status:** Active — Spec 02 §1.3

**Props:**
```typescript
export interface PageShellProps {
  children: React.ReactNode;
  className?: string;
}
// Sub-component:
PageShell.Content // zero inner padding — pages own their grid
```

**Layout contract:**
- `max-w-7xl` (1280px) max width
- Horizontal padding: `px-4 py-6 sm:px-6 lg:px-8`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Should all pages use PageShell? Are there exceptions?

---

### StatusPill

**File:** `components/ui/status-pill.tsx`
**Status:** Active

**Props:**
```typescript
export interface StatusPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  kind: StatusPillKind;
  label?: string;
}

export type StatusPillKind =
  | "success"
  | "warning"
  | "error"
  | "info"
  | "neutral"
  | "strong_signal"
  | "early_signal"
  | "client_green"
  | "client_amber"
  | "client_red";
```

**Kind → token mapping:**
| Kind | Background | Text |
|------|-----------|------|
| `success` | `bg-pk/20` | `text-tx-primary` |
| `warning` | `bg-am/30` | `text-tx-primary` |
| `error` | `bg-rd/20` | `text-tx-primary` |
| `info` | `bg-bl/20` | `text-tx-primary` |
| `neutral` | `bg-su-secondary` | `text-tx-muted` |
| `strong_signal` | `bg-pk` (solid) | `text-tx-inverse` |
| `early_signal` | `bg-am` (solid) | `text-tx-primary` |
| `client_green` | `bg-pk/20` | `text-tx-primary` |
| `client_amber` | `bg-am/30` | `text-tx-primary` |
| `client_red` | `bg-rd/20` | `text-tx-primary` |

**Note:** Distinct from generic `Pill` primitive and shadcn `Badge`. StatusPill uses explicit design-token classes for semantic intentions.

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Which DraftState values map to which StatusPill kind?
- [ ] Which SocialPostState values map to which StatusPill kind?

---

### SocialPlatformIcon

**File:** `components/ui/SocialPlatformIcon.tsx`
**Status:** Active

**Props:**
```typescript
export type SocialPlatformIconKey =
  | "LINKEDIN" | "FACEBOOK" | "INSTAGRAM" | "TWITTER"
  | "GOOGLE_BUSINESS" | "TIKTOK" | "YOUTUBE" | "PINTEREST"
  | "THREADS" | "REDDIT";

// Component signature (inferred from file):
interface SocialPlatformIconProps {
  platform: SocialPlatformIconKey;
  className?: string;
}
```

**Implementation:** Inline SVG using Simple Icons paths. 24×24 single-path glyphs in `currentColor`. Brand fill is neutral (inherits text foreground) — no marketing-colour treatment.

**Note:** Used because Linearicons (the codebase icon convention) has no brand icons. Documented fallback per `docs/patterns/icons.md`.

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Should icons render at 24×24 everywhere or does size vary by context?
- [ ] Is there a fallback glyph for unknown platforms?

---

## Social Composer

### ComposerOverlay

**File:** `components/social/composer/ComposerOverlay.tsx`
**Status:** Active — V2 composer, mounted on `/company/social/*`

**Props:**
```typescript
export interface ComposerOverlayProps {
  open: boolean;
  onClose: () => void;
  initialDraft?: Draft;
  prefilledDate?: Date;
  /** Company ID — required for media upload and AI assist. */
  companyId?: string;
  /** IANA timezone string (e.g. "Australia/Melbourne"). Used for scheduling. */
  companyTimezone?: string;
  /** All connections available to select. */
  availableConnections?: Connection[];
  /** Called when user submits (external override). */
  onSubmit?: (draft: Draft, mode: SchedulingMode) => Promise<void>;
  /** Called after a successful internal submit (POST /api/platform/social/drafts). */
  onSubmitSuccess?: () => void;
  /** Slot for SchedulingCard + submit row. Takes precedence over internal SchedulingCard. */
  schedulingSlot?: React.ReactNode;
  /** Original state of the draft being edited (for header copy + convert-to-draft action). */
  editOriginalState?: DraftState;
  /** Failure reason shown as error banner when editOriginalState === 'failed'. */
  failureReason?: string;
  /** Called when user clicks a post chip in the calendar tab. */
  onNavigateToPost?: (postId: string) => void;
}
```

**Variants / states:**
- New post: `initialDraft` absent, `editOriginalState` absent — blank composer
- Edit draft: `initialDraft` provided, `editOriginalState = 'draft'`
- Edit scheduled: `editOriginalState = 'scheduled'`
- Edit recurring: `editOriginalState = 'recurring'`
- View published (read-only): `editOriginalState = 'published'`
- View failed (read-only + error banner): `editOriginalState = 'failed'`, `failureReason` provided
- Prefilled date: `prefilledDate` sets initial SchedulingCard value

**Keyboard shortcuts:**
| Shortcut | Action |
|----------|--------|
| `⌘↵` | Submit post |
| `⌘S` | Save as draft |
| `⌘⇧S` | Schedule post |
| `⌘K` | Focus editor |
| `⌘E` | Toggle emoji panel |
| `⌘I` | Open media picker |
| `⌘1–5` | Switch preview tab |
| `Esc` | Close composer |
| `?` | Show shortcuts |

**Preview tabs:**
- `preview` — platform preview card (right pane)
- `calendar` — SocialCalendarGrid (right pane, read-only calendar browse)

**Sub-components used:**
- `ProfileSelector` — connection chip row (left pane top)
- `ComposerEditor` — left pane content area
- `PreviewCard` — right pane preview
- `SocialCalendarGrid` — right pane calendar tab
- `SchedulingCard` — scheduling mode + approval toggle (internal slot)
- `UnsavedChangesDialog` — shown when closing with dirty content
- `ComposerErrorBoundary` — wraps the whole overlay
- `PostInfoCard` — info card shown for read-only states
- `EmptyState` — shown when no connections are available
- `Pill`, `SocialPlatformIcon`

**data-testid values:**
- None defined directly in ComposerOverlay; sub-components have their own

**Currently tested by:**
- E2E: `e2e/composer-edit-mode-verification.spec.ts` (verification spec, untracked)
- Unit: `lib/social/__tests__/schedulingCardValueFromIso.unit.test.ts` (exported helper)

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] When `editOriginalState = 'published'`, is the entire composer read-only (no edits possible)?
- [ ] When `editOriginalState = 'failed'`, can the user edit and resubmit, or only view?
- [ ] Does closing a dirty composer always show UnsavedChangesDialog, or only for certain states?
- [ ] What does the header copy say for each `editOriginalState` value?
- [ ] Is `onSubmitSuccess` called in addition to `onSubmit`, or only when `onSubmit` is absent?

---

### ComposerEditor

**File:** `components/social/composer/ComposerEditor.tsx`
**Status:** Active — orchestrates the left pane of ComposerOverlay

**Props:**
```typescript
export interface ComposerEditorProps {
  draft: Draft;
  onChange: (d: Draft) => void;
  onSubmit: (mode: SchedulingMode) => Promise<void>;
  companyId: string;
  selectedConnections: Connection[];
  schedulingSlot?: React.ReactNode;
  className?: string;
  readOnly?: boolean;  // hides ToolsRow, link editors, CustomizeForRow, remove buttons
}
```

**Variants / states:**
- Editable: full toolbar, platform-variant row, per-tile remove buttons
- Read-only (`readOnly=true`): textarea renders but ToolsRow + platform row hidden — used for `state='published'` etc.

**Sub-components used:**
- `ContentEditor` — main text area
- `CustomizeForRow` — per-platform variant toggles
- `PlatformActionsList` — platform-specific action chips
- `ToolsRow` — AI assist, media, emoji, GIF, UTM toolbar

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Does character count display in the editor? Which platform's limit applies when multiple are selected?
- [ ] Does the editor allow per-platform content customisation?

---

### ProfileSelector

**File:** `components/social/composer/ProfileSelector.tsx`
**Status:** Active — connection chip row in composer

**Props:**
```typescript
export interface ProfileSelectorProps {
  available: Connection[];
  selected: string[];
  onChange: (ids: string[]) => void;
  className?: string;
  readOnly?: boolean; // hides "Add profile" affordance, disables chip toggling
}
```

**Variants / states:**
- Interactive: chip row + "Add profile" affordance
- Read-only: same chips rendered without toggle/remove affordance

**data-testid values:**
- `profile-selector` (line 44)

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Can a user deselect all profiles (empty `selected` array)?
- [ ] What happens when `available` is empty?

---

### SchedulingCard

**File:** `components/social/composer/SchedulingCard.tsx`
**Status:** Active — four-tab scheduling UI wired inside ComposerOverlay

**Props:**
```typescript
export interface SchedulingCardValue {
  mode: SchedulingMode;          // "post_now" | "schedule" | "recurring" | "draft"
  scheduledTimes: ScheduleRowValue[];
  recurrence: RecurrenceRule;
  plannedForAt: ScheduleRowValue | null;
  approvalRequired: boolean;
}

export interface SchedulingCardProps {
  value: SchedulingCardValue;
  onChange: (v: SchedulingCardValue) => void;
  onSubmit: () => Promise<void>;
  submitting?: boolean;
  disabled?: boolean;
  disabledTooltip?: string; // shown when disabled=true
}
```

**Tabs:**
| Mode | Tab label | Submit button label |
|------|-----------|---------------------|
| `post_now` | Post now | Post now |
| `schedule` | Schedule | Schedule post |
| `recurring` | Publish regularly | Save schedule |
| `draft` | Save as draft | Save draft |

**Sub-components used:**
- `ScheduleRow` — date/time picker row
- `RecurrencePicker` — RFC 5545 RRULE builder
- `ApprovalToggle` — approval required checkbox

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] When `mode = 'post_now'`, should `disabledTooltip` appear if no profiles are selected?
- [ ] What validation occurs before `onSubmit` fires?

---

### ToolsRow

**File:** `components/social/composer/ToolsRow.tsx`
**Status:** Active — composer toolbar

**Props:**
```typescript
export interface ToolsRowProps {
  companyId: string;
  onInsertText: (text: string) => void;
  onOpenMediaPicker: () => void;
  onAttachGif: (url: string) => void;
  platforms?: Platform[];
  className?: string;
}
```

**Panels (mutually exclusive, `ActivePanel` type):**
| Panel key | Trigger | Action |
|-----------|---------|--------|
| `ai` | Sparkles icon | AI assist → POST `/api/platform/social/cap/assist` |
| `emoji` | Smile icon | Quick emoji grid; inserts via `onInsertText` |
| `gif` | Film icon | GIPHY search; attaches via `onAttachGif` |
| `utm` | Tags icon | UTM parameter builder |
| `shorten` | — | Inline URL shortener form |
| `null` | any close action | All panels closed |

**AI assist error categories:**
- `rate_limit` — too many requests
- `timeout` — upstream timeout
- `content_rejected` — content policy
- `invalid_request` — bad prompt
- `network` — connectivity
- `overloaded` — upstream overloaded
- `unknown` — catch-all

**data-testid values:**
- `ai-trace-id` (line 78) — trace ID badge inside AI panel

**Currently tested by:**
- No dedicated component test found

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is only one panel open at a time (clicking an open panel's icon closes it)?
- [ ] Does the AI panel show a cost estimate before sending?
- [ ] What is the rate-limit behaviour — how many requests per minute?

---

### UnsavedChangesDialog

**File:** `components/social/composer/UnsavedChangesDialog.tsx`
**Status:** Active — shown when closing a composer with dirty content

**Props:**
```typescript
export interface UnsavedChangesDialogProps {
  open: boolean;
  onDiscard: () => void;
  onCancel: () => void;
  onSave?: () => void | Promise<void>; // renders "Save" primary button when provided
}
```

**Variants / states:**
- With `onSave`: three buttons — Save (primary) / Discard / Cancel
- Without `onSave`: two buttons — Discard / Cancel

**data-testid values:**
- `unsaved-save-btn` (line 46) — Save button

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Should this dialog appear when the user has only changed the scheduling mode (no content edits)?
- [ ] Should it appear when editing a `published` post (where the edit is effectively read-only)?

---

## Calendar

### CalendarShell

**File:** `components/social/dashboard/CalendarShell.tsx`
**Status:** Active — full-page calendar shell at `/company/social/calendar`

**Props:**
```typescript
interface CalendarShellProps {
  companyId: string;
  hasConnections: boolean;
  availableConnections: Connection[];
}
```

**Internal state:**
- `currentMonth: Date` — tracks displayed month (controlled via nav buttons)
- `selectedDate: Date` — currently selected day cell
- Composer open/close state via `useComposerState` hook
- Drag-and-drop state via `@dnd-kit/core`

**Sub-components used:**
- `SocialCalendarGrid` — base grid
- `DnDCell` — DnD-aware day cell (internal to this file)
- `PostChip` — individual post chip in cells
- `FilterBar` — status filter controls
- `DayDetail` — side panel for selected day
- `ComposerOverlay` — new post composer
- `BulkScheduleModal` — bulk scheduling modal
- `PostAnalyticsModal` — per-post analytics modal
- `Callout` — used for "no connections" empty state

**data-testid values:**
- `calendar-dnd-cell` (DnDCell, line 73)
- `data-date` attribute on each DnD cell (ISO date string)

**Drag-and-drop contract:**
- Cells in the past (`isPast=true`) or other months (`isOtherMonth=true`) are non-droppable
- Drop target highlights via `isOver && canDrop` → `border-primary/60 bg-primary/10`

**Currently tested by:**
- No dedicated E2E or component test found

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] When no connections exist (`hasConnections=false`), is the calendar still rendered or replaced by an empty state?
- [ ] Does dragging a post to a new date immediately save, or require a confirm step?
- [ ] What happens when the drop fails (API error)?
- [ ] Can posts in `published` or `failed` state be dragged?

---

## Social Features

### SocialPostsListClient

**File:** `components/SocialPostsListClient.tsx`
**Status:** Active — client shell for `/company/social/posts`

**Props:**
```typescript
type Props = {
  companyId: string;
  initialPosts: PostMasterListItem[];
  canCreate: boolean;
  canApprove?: boolean;
  initialQ?: string;
  initialState?: FilterKey;        // "all" | SocialPostState
  page?: number;
  pageSize?: number;
  totalCount?: number;
  sortBy?: SortCol;                // "state_changed_at" | "created_at"
  sortDir?: SortDir;               // "asc" | "desc"
  useComposerFlow?: boolean;       // Spec 22: "New post" opens ?compose=new instead of inline form
};
```

**URL parameters driven:**
- `?q=` — server-side text search (S1-37)
- `?state=` — state filter tab pre-selection (S1-40)
- `?page=N` — pagination (S1-38, 25 per page)
- `?sort=` + `?dir=` — column sort (S1-46)

**Filter tabs (S1-40, S1-45):**
- `all`
- `draft`
- `pending_client_approval`
- `approved`
- `rejected`
- `changes_requested`
- `scheduled`
- `publishing`
- `published`
- `failed`
- `awaiting_msp_release` (S1-45)

**Source badges (S1-43):**
- CSV, CAP, API sources show source badge under the copy text
- Manual posts show no badge

**Sub-components used:**
- `BulkUploadButton`
- `CAPGenerateModal`
- `ProfileSelector` (for filter)
- `Button`, `Pill`, `Lead`
- `PillTabs`
- `SocialModuleShell`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Does "New post" open ComposerOverlay or navigate to a separate page?
- [ ] What is the exact page size (claimed 25 per page in comment)?
- [ ] Does the state filter include a count badge per tab?
- [ ] Can an `editor` role see all tabs or only their own posts?

---

### PostDetailTabbedClient

**File:** `components/PostDetailTabbedClient.tsx`
**Status:** Active — client wrapper for `/company/social/posts/[id]`

**Props:**
```typescript
interface PostDetailTabbedClientProps {
  post: PostMaster;
  canEdit: boolean;
  canSubmit: boolean;
  canCreate: boolean;
  canApprove: boolean;
  variantsSection: React.ReactNode | null;
  approvalSection: React.ReactNode | null;
  decisionsSection: React.ReactNode | null;
  scheduleSection: React.ReactNode | null;
  publishHistorySection: React.ReactNode | null;
}
```

**Tab visibility rules:**
| Tab | Condition |
|-----|-----------|
| `content` | Always |
| `approval` | Only when `pending_client_approval` |
| `review` | Only when `approved` / `rejected` / `changes_requested` |
| `schedule` | Only when `approved` or `scheduled` |
| `history` | Only when `publishing` / `published` / `failed` |

**Footer actions:**
- "Back to posts" — always
- "Schedule another" — only when `published` (D-4 fix for post-publish dead-end)

**Sub-components used:**
- `SocialPostDetailClient`
- `TDetailTabbed` (template)
- `Button`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What happens if the post transitions state while the user is on this page?
- [ ] Is the `content` tab editable when `canEdit=true` and state is `draft`?

---

### PostApprovalSection

**File:** `components/PostApprovalSection.tsx`
**Status:** Active — recipients section on post detail page

**Props:**
```typescript
type Props = {
  postId: string;
  companyId: string;
  initialRecipients: RecipientRow[];
  initialApprovalRequestId: string | null;
  canManage: boolean; // editor+ on pending_client_approval post
};

type RecipientRow = {
  id: string;
  email: string;
  name: string | null;
  requires_otp: boolean;
  revoked_at: string | null;
  created_at: string;
};
```

**Variants / states:**
- Read-only: list of recipients only (when `canManage=false`)
- Managed: list + inline add form + revoke button per recipient (when `canManage=true`)
- Empty state: shown when no recipients yet

**API calls:**
- `POST /api/platform/social/posts/{postId}/recipients` — add recipient
- `DELETE /api/platform/social/posts/{postId}/recipients/{id}` — revoke (soft-delete)

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Can the same email be added twice to the same approval request?
- [ ] What happens to an approval request if all recipients are revoked?
- [ ] Does revoking a recipient send them a notification?

---

### MediaLibraryClient

**File:** `components/MediaLibraryClient.tsx`
**Status:** Active — media browser at `/company/social/media`

**Props:**
```typescript
type Props = {
  companyId: string;
  initialAssets: Asset[];
  initialNextCursor: string | null;  // cursor for next page (S1-57)
  canEdit: boolean;
};

type Asset = {
  id: string;
  source_url: string | null;
  storage_path: string;
  mime_type: string;
  bytes: number;
  width: number | null;
  height: number | null;
  bundle_upload_id: string | null;
  created_at: string;
};
```

**Variants / states:**
- Read-only: asset grid + copy-URL only (when `canEdit=false`)
- Editable: asset grid + add-by-URL form + copy-URL (when `canEdit=true`)
- Load more: cursor-based pagination via "Load more" button (S1-57)

**Internal state:**
- `assets: Asset[]` — accumulated list (appended on load-more)
- `nextCursor: string | null` — API cursor from last response
- `showForm: boolean` — toggle for the add-by-URL form
- `copiedId: string | null` — tracks which URL was last copied (brief highlight)

**API calls:**
- `GET /api/platform/social/media?company_id=…&cursor=…` — paginated asset list
- `POST /api/platform/social/media` — add asset by URL

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What file types are accepted for upload by URL?
- [ ] Is there a file size limit enforced at the API?
- [ ] Can assets be deleted from this view?

---

## Admin

### ImagesTable

**File:** `components/ImagesTable.tsx`
**Status:** Active — admin images grid at `/admin/images`

**Props:**
```typescript
type ImagesTableProps = {
  items: ImageListItemWithUrl[];  // ImageListItem & { previewUrl: string | null }
  backHref?: string;
  filterState?: ImagesFilterState;
};

export type ImagesFilterState = {
  query: string | null;
  tags: string[];
  source: ImageLibrarySource | null;
  deleted: boolean;
};
```

**Source → Pill variant:**
| Source | Pill variant | Label |
|--------|-------------|-------|
| `istock` | `info` | iStock |
| `upload` | `warning` | Upload |
| `generated` | `accent` | Generated |

**Column layout (Spec 18 PR C):**
- Preview: 48×48 thumbnail, optional ImageLightbox
- Title / Caption / File: `TableCell.Stack` (title + filename secondary + caption secondary)
- Tags: up to 6 `Pill` (neutral) chips, "+N" for overflow
- Source: `Pill` with variant per source type
- Dimensions: `TableCell.Mono` or Empty when null
- Imported: `TableCell.Secondary` (relative time via `formatRelativeTime`)

**Bulk delete:**
- `DataTable` with `selectable` prop drives per-row checkboxes
- Selection chip + Delete CTA + `ConfirmActionModal` gates the actual delete

**Sub-components used:**
- `DataTable`, `ColumnDef`
- `BulkImageUpload`
- `ConfirmActionModal`
- `ImageLightbox`
- `Button`, `NavIcon`, `Pill`, `TableCell`

**data-testid values:**
- `image-library-grid` — confirmed in spec (`data-testid="image-library-grid"`)

**Currently tested by:**
- E2E: `/api/admin/images` endpoint tested via media library scope spec

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What happens when a bulk-delete is confirmed — are items hard-deleted or soft-deleted?
- [ ] Can deleted images be restored?
- [ ] Does clicking a thumbnail open the lightbox or navigate to `/admin/images/[id]`?

---

## Viewer / Approval

### ApprovalDecisionForm

**File:** `components/ApprovalDecisionForm.tsx`
**Status:** Active — external approver form at `/viewer/[token]`

**Props:**
```typescript
type Props = {
  token: string;
  alreadyDecided: boolean; // if true, renders "already resolved" panel instead of form
};
```

**Decision options:**
```typescript
type Decision = "approved" | "rejected" | "changes_requested";
```

**Button variants per decision:**
| Decision | Button variant | Label |
|----------|---------------|-------|
| `approved` | `default` | Approve |
| `changes_requested` | `secondary` | Request changes |
| `rejected` | `destructive` | Reject |

**States:**
- Form idle: three decision buttons + comment textarea
- Submitting: selected button shows loading state
- Done: shows "thanks" confirmation panel
- Error: inline error message
- `alreadyDecided=true`: "This request has already been resolved" panel (no form)

**API calls:**
- `POST /api/approve/[token]/decision` — submit decision

**data-testid values:**
- `approval-already-decided` (line 50) — "already resolved" panel

**Currently tested by:**
- E2E: viewer approval flow — see `e2e/` for connection-related specs

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is the comment field required for `rejected` decision? (API requires `rejection_reason` ≥ 30 chars for `rejected`)
- [ ] Is the comment field optional for `changes_requested`?
- [ ] After submitting, can the approver change their decision?
- [ ] Does the `alreadyDecided=true` state distinguish between who decided and what the decision was?

---

### ViewerLinksManager

**File:** `components/ViewerLinksManager.tsx`
**Status:** Active — share-link management at `/company/social/sharing`

**Props:**
```typescript
type Props = {
  companyId: string;
  initialLinks: Link[];
};

type Link = {
  id: string;
  recipient_email: string | null;
  recipient_name: string | null;
  expires_at: string;
  revoked_at: string | null;
  last_viewed_at: string | null;
  created_at: string;
};
```

**Variants / states:**
- Table view: active links list with revoke button per row
- Add form (toggled): recipient email + name fields + Create button
- Post-create: URL shown once for copy (raw token never persisted client-side)
- Error inline: below the add form

**API calls:**
- `POST /api/platform/social/viewer-links` — create new link (returns `{ link, url }`)
- `DELETE /api/platform/social/viewer-links/[id]` — revoke (soft-delete)

**Security note:** Raw token is surfaced only once immediately after creation — it is never written back to disk. The `url` in the response is the only opportunity to copy.

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What is the default expiry duration for new viewer links?
- [ ] Can the expiry be customised at creation time?
- [ ] Does revoking a link immediately invalidate it (hard-invalidate), or only on next access attempt?
- [ ] What does a viewer see when they follow a revoked link?
- [ ] Is `last_viewed_at` updated in real time or periodically?
