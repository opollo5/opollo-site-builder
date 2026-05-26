# Components Catalog

Inventory of all UI components in the Opollo Site Builder codebase. Generated 2026-05-26.

Grouped by feature area. UI primitives use a condensed table. Feature/composite components use the full format.

---

## Table of Contents

1. [Auth Components](#1-auth-components)
2. [Site Management Components](#2-site-management-components)
3. [Batch / Brief Components](#3-batch--brief-components)
4. [Blog / Content Components](#4-blog--content-components)
5. [Media Library Components](#5-media-library-components)
6. [Design System Components](#6-design-system-components)
7. [Social Composer Components](#7-social-composer-components)
8. [Social Dashboard Components](#8-social-dashboard-components)
9. [Social Preview Components](#9-social-preview-components)
10. [CAP (Content Automation Pipeline) Components](#10-cap-content-automation-pipeline-components)
11. [Optimiser Components](#11-optimiser-components)
12. [Platform Admin Components](#12-platform-admin-components)
13. [User / Account Components](#13-user--account-components)
14. [Notification / Utility Components](#14-notification--utility-components)
15. [SEO / Session Components](#15-seo--session-components)
16. [UI Primitives](#16-ui-primitives)

---

## 1. Auth Components

### LoginForm
**File:** `components/LoginForm.tsx`
**Type:** `"use client"`
**Props interface:**
- `next: string` — redirect target after successful login

**Variants/states:** idle, submitting ("Signing in…"), redirecting (button disabled)
**Sub-components used:** `Button`, `Input`
**Currently tested:** component test, e2e

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What should happen when the email does not exist vs wrong password — same error message or different?
- [ ] What is the error state for a network failure (no response)?
- [ ] What happens if `next` points to a route the user lacks access to after login?
- [ ] What happens on browser back after redirect (session still valid)?
- [ ] Is there a lockout after N failed attempts visible in the UI?

---

### AcceptInviteForm
**File:** `components/AcceptInviteForm.tsx`
**Type:** `"use client"`
**Props interface:**
- `token: string` — invite token from URL
- `email: string` — invitee email (read-only display)

**Variants/states:** idle, submitting ("Setting password…"), error
**Sub-components used:** `Button`, `Input`, `Alert`, `StrengthMeter` (internal)
**Currently tested:** unit

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What if the token has expired (>24 h) by the time the user submits?
- [ ] What if the token has already been used?
- [ ] What is the error state for a 5xx response?
- [ ] Should the strength meter be visible before the user starts typing?
- [ ] What is the post-success experience — redirect to login with a toast?

---

### ForgotPasswordForm
**File:** `components/ForgotPasswordForm.tsx`
**Type:** `"use client"`
**Props interface:** none
**Variants/states:** idle, submitting ("Sending…"), success (replaces form with confirmation copy), error
**Sub-components used:** `Button`, `Input`
**Currently tested:** unit

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Success copy says "check your email" — should the email address be shown in the copy?
- [ ] What if the user submits again after seeing the success state — should the form be re-enterable?
- [ ] What is the expected error state for RATE_LIMITED — same page or a separate screen?
- [ ] What happens when the reset link in the email is clicked more than once?

---

### CheckEmailPolling
**File:** `components/CheckEmailPolling.tsx`
**Type:** `"use client"`
**Props interface:** (inferred — polls session state after OTP / magic-link email sent)
**Variants/states:** polling, redirecting on session found
**Sub-components used:** `Button`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] How long does polling run before it times out?
- [ ] What does the user see if polling times out?
- [ ] Is there a "Resend email" button and does it have a cooldown?
- [ ] What is the visual indicator that polling is in progress?

---

### AuthCallbackClient
**File:** `components/AuthCallbackClient.tsx`
**Type:** `"use client"`
**Props interface:** (inferred — handles OAuth callback hash exchange)
**Variants/states:** loading/redirect, error
**Sub-components used:** none (redirect-only component)
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What does the user see while the callback is being processed?
- [ ] What is the error state if the OAuth code exchange fails?
- [ ] Where does the user land on success vs failure?

---

### PlatformAcceptInviteForm
**File:** `components/PlatformAcceptInviteForm.tsx`
**Type:** `"use client"`
**Props interface:** (platform-tenant variant of AcceptInviteForm)
**Variants/states:** idle, submitting, error, success
**Sub-components used:** `Button`, `Input`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] How does this differ from `AcceptInviteForm` — different API endpoint? Different redirect target?
- [ ] What if the invited user already has an account on another company?

---

## 2. Site Management Components

### AddSiteModal
**File:** `components/AddSiteModal.tsx`
**Type:** `"use client"`
**Props interface:**
- `open: boolean`
- `onClose: () => void`
- `onSuccess: () => void`

**Variants/states:** idle, submitting ("Registering…"), field-level validation errors, form-level error, success (calls `onSuccess` + `onClose`)
**Sub-components used:** `Button`, `Input`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What if the WordPress URL is unreachable during registration?
- [ ] What if the app password credentials are invalid — is that validated immediately or deferred?
- [ ] What is the empty state for the sites list before any site is added?
- [ ] What happens if the modal is closed mid-submit?

---

### EditSiteModal
**File:** `components/EditSiteModal.tsx`
**Type:** `"use client"` (inferred)
**Props interface:** (inferred — site id + current values prefilled)
**Variants/states:** idle, submitting, error, success
**Sub-components used:** `Button`, `Input`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Which fields are editable after creation (name, URL, credentials)?
- [ ] Does changing the WP URL re-validate connectivity?
- [ ] What is the error state if the site ID no longer exists?

---

### Breadcrumbs
**File:** `components/Breadcrumbs.tsx`
**Type:** Server Component (inferred)
**Props interface:** (inferred — path segments or explicit items array)
**Variants/states:** static render
**Sub-components used:** none
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What is the truncation behaviour for long segment names?
- [ ] Does the final breadcrumb item link or is it plain text?

---

## 3. Batch / Brief Components

### BatchDetailClient
**File:** `components/BatchDetailClient.tsx`
**Type:** `"use client"`
**Props interface:** (inferred — batch id, initial slots array, status)
**Variants/states:** loading, running, completed, failed, slot-level status
**Sub-components used:** `BatchSuccessMoment`, `Button`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] How does slot progress update — polling, websocket, or server-sent events?
- [ ] What is the error state for a slot that fails generation?
- [ ] What happens when the user navigates away while a batch is running?
- [ ] What is the maximum number of slots visible without pagination?

---

### BatchSuccessMoment
**File:** `components/BatchSuccessMoment.tsx`
**Type:** `"use client"` (inferred — celebration animation)
**Props interface:** (inferred — batch summary counts)
**Variants/states:** visible celebration
**Sub-components used:** none
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Does the moment auto-dismiss or require user interaction?
- [ ] What does the user see after dismissing — the batch detail or sites list?

---

### BatchesTable
**File:** `components/BatchesTable.tsx`
**Type:** `"use client"` (inferred)
**Props interface:** (inferred — batches array, site context)
**Variants/states:** loading, empty, populated, pagination
**Sub-components used:** `data-table`, `Button`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What is the empty state copy when no batches exist?
- [ ] What columns are sortable?
- [ ] Does row click navigate to batch detail?

---

### BriefReviewClient
**File:** `components/BriefReviewClient.tsx`
**Type:** `"use client"`
**Props interface:** (inferred — brief id, brief content, site context)
**Variants/states:** viewing, approving, rejecting, error
**Sub-components used:** `BriefCommitWaiter`, `Button`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What does the user see while the brief is being committed after approval?
- [ ] What is the reject flow — free-text reason or predefined options?
- [ ] Can a brief be re-edited after initial approval?

---

### BriefRunClient
**File:** `components/BriefRunClient.tsx`
**Type:** `"use client"`
**Props interface:** (inferred — brief id, template, site context)
**Variants/states:** idle, running, complete, error
**Sub-components used:** `Button`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What triggers a brief run — a button click or automatic on page load?
- [ ] What is the polling interval for status updates?
- [ ] What is the timeout before showing an error state?

---

### BriefCommitWaiter
**File:** `components/BriefCommitWaiter.tsx`
**Type:** `"use client"` (inferred — polls for commit completion)
**Props interface:** (inferred — brief id, onComplete callback)
**Variants/states:** waiting (spinner/progress), complete
**Sub-components used:** none
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What is the timeout before the waiter gives up and shows an error?
- [ ] Is there user-visible progress during the wait?

---

### NewBatchModal
**File:** `components/NewBatchModal.tsx`
**Type:** `"use client"`
**Props interface:**
- `open: boolean`
- `onClose: () => void`
- `site: { id: string; name: string } | null`
- `templates: BatchTemplateOption[]`

**Variants/states:** idle, submitting, error
**Sub-components used:** `Button`, `Input`, `Textarea`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What is the maximum number of slugs per batch?
- [ ] What if the site is null — is the submit button disabled?
- [ ] What validation is applied to each slug line?
- [ ] What is the success transition — navigate to batch detail automatically?

---

### NewBatchButton
**File:** `components/NewBatchButton.tsx`
**Type:** `"use client"` (inferred — button that opens NewBatchModal)
**Props interface:** (inferred — site + templates forwarded to modal)
**Variants/states:** idle, modal open
**Sub-components used:** `NewBatchModal`, `Button`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is the button disabled when no site is selected?

---

### ConceptRefinementView
**File:** `components/ConceptRefinementView.tsx`
**Type:** `"use client"` (inferred)
**Props interface:** (inferred — concept draft, refinement options)
**Variants/states:** viewing, editing refinement prompt, regenerating
**Sub-components used:** various
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] How many refinement rounds are allowed?
- [ ] What happens to the original concept while refinement is in progress?

---

### ConceptReviewCards
**File:** `components/ConceptReviewCards.tsx`
**Type:** `"use client"` (inferred)
**Props interface:** (inferred — array of concept variants)
**Variants/states:** card selection, compare mode
**Sub-components used:** `Card`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Can multiple concepts be selected simultaneously?
- [ ] What is the action after selecting a concept?

---

## 4. Blog / Content Components

### BlogPostComposer
**File:** `components/BlogPostComposer.tsx`
**Type:** `"use client"`
**Props interface:** (inferred — site id, initial draft content, template)
**Variants/states:** editing, saving, published, error
**Sub-components used:** `Button`, `Textarea`, `Input`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is there autosave? If so, how frequently?
- [ ] What is the difference between Save and Publish actions?
- [ ] What is the error state if the WP publish fails?

---

### BlogStyleCalibrationBanner
**File:** `components/BlogStyleCalibrationBanner.tsx`
**Type:** `"use client"` (inferred)
**Props interface:** (inferred — calibration status)
**Variants/states:** visible (calibration pending), dismissed
**Sub-components used:** `Button`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Under what condition does the banner appear?
- [ ] Can the user permanently dismiss it?
- [ ] What does the CTA do?

---

### PageHtmlPreview
**File:** `components/PageHtmlPreview.tsx`
**Type:** `"use client"` (inferred — renders iframe or sanitised HTML)
**Props interface:** (inferred — html: string, title?)
**Variants/states:** loading, rendered
**Sub-components used:** none
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is the HTML sandboxed in an iframe or injected into the DOM?
- [ ] What is the fallback if the HTML fails to render?

---

### PagesTable
**File:** `components/PagesTable.tsx`
**Type:** `"use client"` (inferred)
**Props interface:** (inferred — pages array, site id)
**Variants/states:** loading, empty, populated, pagination
**Sub-components used:** `data-table`, `EditPageMetadataButton`, `Button`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What is the empty state copy?
- [ ] Are pages sortable by any column?
- [ ] Does clicking a row navigate to page detail or open a preview?

---

### EditPageMetadataButton / EditPageMetadataModal
**File:** `components/EditPageMetadataButton.tsx`, `components/EditPageMetadataModal.tsx`
**Type:** `"use client"`
**Props interface:** (inferred — page id, current meta values)
**Variants/states:** button idle, modal open/submitting/error/success
**Sub-components used:** `Button`, `Input`, `Dialog`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Which metadata fields are editable (title, description, slug)?
- [ ] Is there a character limit indicator for meta description?
- [ ] Does saving push changes to WordPress immediately?

---

### CopyExistingExtractionWizard
**File:** `components/CopyExistingExtractionWizard.tsx`
**Type:** `"use client"` (inferred — multi-step wizard)
**Props interface:** (inferred — source site, destination site)
**Variants/states:** step 1 (select source), step 2 (confirm), submitting, complete
**Sub-components used:** `Button`, `Dialog`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] How many steps are in the wizard?
- [ ] What data is copied from the source extraction?

---

## 5. Media Library Components

### MediaLibraryClient
**File:** `components/MediaLibraryClient.tsx`
**Type:** `"use client"`
**Props interface:**
- `companyId: string`
- `initialAssets: Asset[]`
- `initialNextCursor: string | null`
- `canEdit: boolean`

**Variants/states:** populated, empty, loading more (cursor pagination), uploading (when `canEdit`)
**Sub-components used:** `Button`, `ImageDetailLightbox`, `BulkUploadPanel`
**Currently tested:** e2e (media library scope spec)

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What is the empty state when no assets have been uploaded?
- [ ] What is the upload size / type limit and how is it surfaced?
- [ ] What happens when "Load more" is clicked and the cursor returns no results?
- [ ] What is the error state for a failed asset upload?
- [ ] Is there a confirmation before deleting an asset?

---

### AdminMediaClient
**File:** `components/AdminMediaClient.tsx`
**Type:** `"use client"` (inferred — admin view of media)
**Props interface:** (inferred — companyId, assets)
**Variants/states:** same as MediaLibraryClient plus admin-only delete/archive actions
**Sub-components used:** `ImagesTable`, `Button`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Does admin media view show assets across all companies or per-company?
- [ ] Are admin delete operations hard-delete or soft-delete?

---

### ImagesTable
**File:** `components/ImagesTable.tsx`
**Type:** `"use client"` (inferred)
**Props interface:** (inferred — images array, canEdit)
**Variants/states:** populated, empty
**Sub-components used:** `data-table`, `EditImageMetadataButton`, `ImageArchiveButton`, `ImageDeleteButton`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What columns are shown in the table vs the card/grid view?
- [ ] What is the row action menu for non-admin users?

---

### ImageDetailLightbox
**File:** `components/ImageDetailLightbox.tsx`
**Type:** `"use client"`
**Props interface:** (inferred — image asset, open, onClose)
**Variants/states:** open, closed, loading image
**Sub-components used:** `Dialog`, `DownloadImageButton`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Does the lightbox show metadata (dimensions, file size, upload date)?
- [ ] Is there keyboard navigation (arrow keys) between images?

---

### ImageLightbox
**File:** `components/ImageLightbox.tsx`
**Type:** `"use client"` (inferred — simpler lightbox without metadata)
**Props interface:** (inferred — src, alt, open, onClose)
**Variants/states:** open, closed
**Sub-components used:** `Dialog`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] How does this differ from `ImageDetailLightbox`?

---

### ImagePickerModal
**File:** `components/ImagePickerModal.tsx`
**Type:** `"use client"`
**Props interface:** (inferred — open, onSelect, companyId, allowMulti)
**Variants/states:** open, loading, empty, populated, selection mode
**Sub-components used:** `MediaLibraryClient` (or subset), `Button`, `Dialog`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Does the picker support multi-select?
- [ ] Can the user upload a new image from within the picker?
- [ ] What is the empty state copy?

---

### BulkImageUpload / BulkUploadButton / BulkUploadPanel
**File:** `components/BulkImageUpload.tsx`, `components/BulkUploadButton.tsx`, `components/BulkUploadPanel.tsx`
**Type:** `"use client"`
**Props interface:** (inferred — companyId, onComplete callback)
**Variants/states:** idle, file-drop active, uploading (per-file progress), complete, error
**Sub-components used:** `Button`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What file types are accepted?
- [ ] Is there a maximum number of files per bulk upload?
- [ ] What is the error state for a partially-failed batch upload?
- [ ] Does the panel close automatically on completion or stay open?

---

### MoodBoardClient / MoodBoardStrip
**File:** `components/MoodBoardClient.tsx`, `components/MoodBoardStrip.tsx`
**Type:** `"use client"`
**Props interface:** (inferred — companyId, images or extractionId)
**Variants/states:** loading, empty, populated
**Sub-components used:** `ImageLightbox`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Where does the mood board data come from — a separate extraction or the media library?
- [ ] Is the strip clickable to open images full-screen?

---

### DownloadImageButton / ImageArchiveButton / ImageDeleteButton
**File:** `components/DownloadImageButton.tsx`, `components/ImageArchiveButton.tsx`, `components/ImageDeleteButton.tsx`
**Type:** `"use client"`
**Props interface:** (inferred — imageId, storageUrl)
**Variants/states:** idle, loading, error
**Sub-components used:** `Button`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Archive vs delete — is archive reversible?
- [ ] What is the confirmation flow for delete?
- [ ] What is the error state when the storage operation fails?

---

### EditImageMetadataButton / EditImageMetadataModal
**File:** `components/EditImageMetadataButton.tsx`, `components/EditImageMetadataModal.tsx`
**Type:** `"use client"`
**Props interface:** (inferred — image id, current alt text / title)
**Variants/states:** button idle, modal open/submitting/error/success
**Sub-components used:** `Button`, `Input`, `Dialog`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Which metadata fields are editable (alt text, title, caption)?
- [ ] Does saving metadata update the asset record in Supabase only, or also in WordPress?

---

## 6. Design System Components

### CreateDesignSystemModal
**File:** `components/CreateDesignSystemModal.tsx`
**Type:** `"use client"`
**Props interface:** (inferred — companyId, onSuccess)
**Variants/states:** idle, submitting, error, success
**Sub-components used:** `Button`, `Input`, `Dialog`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What fields are required to create a design system?
- [ ] Can a company have multiple design systems?
- [ ] What happens after creation — navigate to the new system's settings?

---

### DesignSystemSettingsClient
**File:** `components/DesignSystemSettingsClient.tsx`
**Type:** `"use client"`
**Props interface:** (inferred — designSystemId, current settings)
**Variants/states:** idle, editing, saving, error
**Sub-components used:** `Button`, `Input`, `KadencePaletteDiffTable`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Which settings are editable (palette, typography, spacing)?
- [ ] Is there a preview of changes before saving?
- [ ] What is the error state if a Kadence sync fails?

---

### DesignSystemsTable
**File:** `components/DesignSystemsTable.tsx`
**Type:** `"use client"` (inferred)
**Props interface:** (inferred — designSystems array, companyId)
**Variants/states:** empty, populated
**Sub-components used:** `data-table`, `Button`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What is the empty state copy?
- [ ] Is there a row action to delete a design system?

---

### KadencePaletteDiffTable
**File:** `components/KadencePaletteDiffTable.tsx`
**Type:** `"use client"` (inferred — shows before/after palette diff)
**Props interface:** (inferred — before, after palette arrays)
**Variants/states:** unchanged, additions, removals, modifications
**Sub-components used:** none
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] How are additions/removals visually distinguished?

---

### CustomerBrandProfileEditor
**File:** `components/CustomerBrandProfileEditor.tsx`
**Type:** `"use client"`
**Props interface:** (inferred — companyId, brandProfile)
**Variants/states:** editing, saving, error
**Sub-components used:** `Button`, `Input`, `Textarea`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What brand profile fields are editable (name, voice, colours)?
- [ ] Is there autosave or an explicit save button?

---

### AppearancePanelClient
**File:** `components/AppearancePanelClient.tsx`
**Type:** `"use client"`
**Props interface:** (inferred — site appearance settings)
**Variants/states:** loading, editing, saving, error
**Sub-components used:** `Button`, `KadencePaletteDiffTable`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Does appearance change affect the live site in real time or only after a publish action?

---

### AppearanceEventLog
**File:** `components/AppearanceEventLog.tsx`
**Type:** `"use client"` (inferred)
**Props interface:** (inferred — siteId, events array)
**Variants/states:** empty, populated, loading
**Sub-components used:** none
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What events are logged (publish, rollback, style change)?
- [ ] Is the log paginated?

---

### DesignDirectionInputs
**File:** `components/DesignDirectionInputs.tsx`
**Type:** `"use client"` (inferred — form subcomponent)
**Props interface:** (inferred — value, onChange)
**Variants/states:** editing
**Sub-components used:** `Input`, `Textarea`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What fields does this component control?

---

### DesignUnderstandingPanel
**File:** `components/DesignUnderstandingPanel.tsx`
**Type:** `"use client"` (inferred)
**Props interface:** (inferred — extraction or design system id)
**Variants/states:** loading, empty, populated
**Sub-components used:** `MoodBoardStrip`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What data is shown — extracted palette, typography, mood board?

---

### ExtractedProfilePanel
**File:** `components/ExtractedProfilePanel.tsx`
**Type:** `"use client"` (inferred)
**Props interface:** (inferred — extraction data)
**Variants/states:** populated, loading
**Sub-components used:** none
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What sections are shown in the panel?

---

### ComponentFormModal / ComponentsGrid
**File:** `components/ComponentFormModal.tsx`, `components/ComponentsGrid.tsx`
**Type:** `"use client"`
**Props interface:** (inferred — designSystemId, components array)
**Variants/states:** modal: idle/open/submitting/error; grid: empty/populated
**Sub-components used:** `Button`, `Dialog`, `Card`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What is a "component" in this context — a Kadence block or a design token?
- [ ] What fields are in the component form?

---

## 7. Social Composer Components

### ComposerOverlay
**File:** `components/social/composer/ComposerOverlay.tsx`
**Type:** `"use client"`
**Props interface:**
- `open: boolean`
- `onClose: () => void`
- `initialDraft?: Draft`
- `prefilledDate?: Date`
- `companyId?: string`
- `companyTimezone?: string`
- `availableConnections?: Connection[]`
- `onSubmit?: (draft: Draft, mode: SchedulingMode) => Promise<void>`
- `onSubmitSuccess?: () => void`
- `schedulingSlot?: React.ReactNode`
- `editOriginalState?: DraftState`
- `failureReason?: string`
- `onNavigateToPost?: (postId: string) => void`

**Variants/states:** closed, open (new draft), open (editing existing post), open (editing failed post — shows error banner), read-only (published/failed states), unsaved-changes dialog
**Sub-components used:** `ProfileSelector`, `ComposerEditor`, `PreviewCard`, `SocialCalendarGrid`, `SchedulingCard`, `UnsavedChangesDialog`, `ComposerErrorBoundary`, `PostInfoCard`, `EmptyState`, `Pill`, `SocialPlatformIcon`
**Currently tested:** e2e, component test

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What is the empty state when no connections are available?
- [ ] What is the error banner copy when `editOriginalState === 'failed'`?
- [ ] What does the UnsavedChangesDialog say — specific copy?
- [ ] What keyboard shortcuts should work (⌘↵, ⌘S, ⌘⇧S, ⌘K, ⌘E, ⌘I, ⌘1–5, Esc, ?) and what should the shortcuts panel look like?
- [ ] What is the maximum content length shown to the user?
- [ ] What happens if the submit API returns a 409 (duplicate)?

---

### ComposerEditor
**File:** `components/social/composer/ComposerEditor.tsx`
**Type:** `"use client"`
**Props interface:**
- `draft: Draft`
- `onChange: (d: Draft) => void`
- `onSubmit: (mode: SchedulingMode) => Promise<void>`
- `companyId: string`
- `selectedConnections: Connection[]`
- `schedulingSlot?: React.ReactNode`
- `className?: string`
- `readOnly?: boolean`

**Variants/states:** editing, read-only (published/failed post — tools row hidden), platform-specific customise mode
**Sub-components used:** `ContentEditor`, `CustomizeForRow`, `PlatformActionsList`, `SchedulingCard`
**Currently tested:** component test

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What is visible in read-only mode vs editing mode?
- [ ] How does per-platform customisation work — separate text areas per platform?
- [ ] What is the character limit warning state?

---

### SchedulingCard
**File:** `components/social/composer/SchedulingCard.tsx`
**Type:** `"use client"`
**Props interface:**
- `value: SchedulingCardValue` — `{ mode, scheduledTimes, recurrence, plannedForAt, approvalRequired }`
- `onChange: (v: SchedulingCardValue) => void`
- `onSubmit: () => Promise<void>`
- `submitting?: boolean`
- `disabled?: boolean`
- `disabledTooltip?: string`

**Variants/states:** 4 tabs — Post now / Schedule / Publish regularly / Save as draft; each with its own submit label; disabled with tooltip
**Sub-components used:** `ScheduleRow`, `RecurrencePicker`, `ApprovalToggle`, `Tooltip`
**Currently tested:** component test

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What is the minimum scheduling lead time (can you schedule 1 minute in the future)?
- [ ] What is the maximum recurrence count?
- [ ] What does the approval toggle show when the company has no approval workflow configured?
- [ ] What is the error state if the scheduled time is in the past on submit?

---

### ProfileSelector
**File:** `components/social/composer/ProfileSelector.tsx`
**Type:** `"use client"` (inferred)
**Props interface:** (inferred — connections, selectedIds, onChange)
**Variants/states:** empty (no connections), populated, multi-select
**Sub-components used:** `SocialPlatformIcon`, `Checkbox`
**Currently tested:** component test

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What is shown when there are no connections — a link to connect profiles?
- [ ] Can all profiles be deselected (zero selection)?
- [ ] Is there a maximum number of profiles selectable simultaneously?

---

### PreviewCard
**File:** `components/social/composer/PreviewCard.tsx`
**Type:** `"use client"` (inferred)
**Props interface:** (inferred — draft, activePlatform)
**Variants/states:** per-platform preview, no-connection empty state
**Sub-components used:** `FacebookPreviewCard`, `InstagramPreviewCard`, `LinkedInPreviewCard`, `XPreviewCard`, `GoogleBusinessPreviewCard`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] How does the preview update — live as the user types or debounced?
- [ ] What is the preview state when no platform is selected?

---

### ContentEditor
**File:** `components/social/composer/ContentEditor.tsx`
**Type:** `"use client"` (inferred — rich textarea with hashtag/mention support)
**Props interface:** (inferred — value, onChange, charLimit, readOnly, placeholder)
**Variants/states:** idle, focused, character limit warning, over limit, read-only
**Sub-components used:** `EmojiPickerPanel`, `MediaTray`
**Currently tested:** component test

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] At what character count does the warning colour kick in (e.g. 90%)?
- [ ] Are hashtags and mentions highlighted inline?
- [ ] What happens to over-limit content on submit — blocked or truncated?

---

### EmojiPickerPanel
**File:** `components/social/composer/EmojiPickerPanel.tsx`
**Type:** `"use client"` (inferred — emoji picker popover)
**Props interface:** (inferred — onSelect, open, onClose)
**Variants/states:** open, closed
**Sub-components used:** `Popover`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is there search within the emoji panel?
- [ ] Where does the emoji insert — at cursor position?

---

### MediaPickerModal / MediaTile / MediaTray
**File:** `components/social/composer/MediaPickerModal.tsx`, `MediaTile.tsx`, `MediaTray.tsx`
**Type:** `"use client"`
**Props interface:** (inferred — companyId, selectedMedia, onSelect, onRemove)
**Variants/states:** modal: open/closed/loading; tray: empty/populated; tile: uploading/uploaded/error/removing
**Sub-components used:** `Button`, `Dialog`, `MediaLibraryClient`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What is the maximum number of media items per post?
- [ ] What is the error state for an upload that exceeds platform limits?
- [ ] Can videos be attached? What formats?
- [ ] Can the user reorder media tiles via drag-and-drop?

---

### LinkPreviewCard
**File:** `components/social/composer/LinkPreviewCard.tsx`
**Type:** `"use client"` (inferred — shows OG data)
**Props interface:** (inferred — url, ogData or loading)
**Variants/states:** loading, loaded, error/no-preview, dismissed
**Sub-components used:** none
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Can the user dismiss the link preview?
- [ ] What is the timeout for OG fetch?
- [ ] Is the preview shown for all URLs or only HTTP/HTTPS?

---

### CustomizeForRow
**File:** `components/social/composer/CustomizeForRow.tsx`
**Type:** `"use client"` (inferred — per-platform content override row)
**Props interface:** (inferred — selectedConnections, platformVariants, onChange)
**Variants/states:** collapsed (all platforms share content), expanded per platform
**Sub-components used:** `SocialPlatformIcon`, `Textarea`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Can a platform variant be reset to the base content?
- [ ] Is the character limit per platform or shared?

---

### UtmBuilderPanel
**File:** `components/social/composer/UtmBuilderPanel.tsx`
**Type:** `"use client"` (inferred — UTM parameter form)
**Props interface:** (inferred — value, onChange)
**Variants/states:** collapsed, expanded (form visible)
**Sub-components used:** `Input`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Which UTM parameters are supported (source, medium, campaign, term, content)?
- [ ] Are parameters pre-filled with platform defaults?

---

### RecurrencePicker
**File:** `components/social/composer/RecurrencePicker.tsx`
**Type:** `"use client"` (inferred)
**Props interface:** (inferred — value: RecurrenceRule, onChange)
**Variants/states:** daily / weekly / monthly options
**Sub-components used:** `Input`, `Select`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What recurrence patterns are supported?
- [ ] Is there a recurrence end date?

---

### ScheduleRow / MiniCalendar
**File:** `components/social/composer/ScheduleRow.tsx`, `MiniCalendar.tsx`
**Type:** `"use client"`
**Props interface:** (inferred — value: date/time, onChange)
**Variants/states:** date/time picker open/closed, past-date disabled
**Sub-components used:** `Popover`, `Input`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Are past dates disabled in the calendar?
- [ ] What format is the time displayed in — 24h or 12h based on locale?

---

### ApprovalToggle
**File:** `components/social/composer/ApprovalToggle.tsx`
**Type:** `"use client"` (inferred)
**Props interface:** (inferred — checked, onChange, disabled)
**Variants/states:** on, off, disabled
**Sub-components used:** `Switch`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] When is approval required by default — when the company has an approval workflow, or never?

---

### UnsavedChangesDialog
**File:** `components/social/composer/UnsavedChangesDialog.tsx`
**Type:** `"use client"`
**Props interface:** (inferred — open, onConfirm, onCancel)
**Variants/states:** open, closed
**Sub-components used:** `Dialog`, `Button`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What is the dialog copy — specific wording?
- [ ] Does "Discard" also save a draft automatically?

---

### PostInfoCard
**File:** `components/social/composer/PostInfoCard.tsx`
**Type:** `"use client"` (inferred — shows post metadata when editing existing post)
**Props interface:** (inferred — postId, state, createdAt, scheduledAt)
**Variants/states:** new draft (hidden), editing existing (visible)
**Sub-components used:** `StatusPill`, `Pill`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What post metadata is shown — status, created date, scheduled date?

---

### ComposerErrorBoundary
**File:** `components/social/composer/ComposerErrorBoundary.tsx`
**Type:** Class component (error boundary)
**Props interface:** (inferred — children, fallback?)
**Variants/states:** normal, error caught
**Sub-components used:** `ErrorFallback`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What does the fallback UI show — a retry button or just an error message?
- [ ] Does catching an error inside the composer close the overlay?

---

### PlatformActionsList
**File:** `components/social/composer/PlatformActionsList.tsx`
**Type:** `"use client"` (inferred — per-platform action buttons)
**Props interface:** (inferred — selectedConnections, draft, onChange)
**Variants/states:** per-platform sections shown based on selected profiles
**Sub-components used:** `SocialPlatformIcon`, `Button`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What platform-specific actions exist (first comment on Instagram, article format on LinkedIn)?

---

### ToolsRow
**File:** `components/social/composer/ToolsRow.tsx`
**Type:** `"use client"` (inferred — toolbar with emoji, media, link, UTM buttons)
**Props interface:** (inferred — onEmojiClick, onMediaClick, onLinkClick, onUtmClick, readOnly)
**Variants/states:** active, disabled (readOnly), per-button active state
**Sub-components used:** `IconButton`, `Tooltip`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Which toolbar actions are available for each platform?

---

## 8. Social Dashboard Components

### CalendarShell
**File:** `components/social/dashboard/CalendarShell.tsx`
**Type:** `"use client"`
**Props interface:**
- `availableConnections: Connection[]`
- `companyId: string`
- Internal: uses `useCalendarView` hook, `useComposerState` hook, `useSearchParams`/`useRouter`

**Variants/states:** monthly calendar view, day-detail panel open (split view), composer overlay open, bulk schedule modal open, analytics modal open, DnD drag active, loading posts, empty month, error callout
**Sub-components used:** `SocialCalendarGrid`, `DayDetail`, `PostChip`, `FilterBar`, `ComposerOverlay`, `BulkScheduleModal`, `PostAnalyticsModal`, `Callout`
**Currently tested:** e2e

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What is the empty state for a month with no posts?
- [ ] What is the error state if the posts fetch fails?
- [ ] How does drag-and-drop reschedule work — immediate save or confirmation dialog?
- [ ] What is the maximum number of posts shown per calendar cell before truncation?
- [ ] Can the user navigate to a past month?

---

### PostChip
**File:** `components/social/dashboard/PostChip.tsx`
**Type:** Server Component (no `"use client"`)
**Props interface:**
- `post: CalendarPost`
- `className?: string`
- `highlighted?: boolean`
- `onClick?: (e: React.MouseEvent) => void`

**Variants/states:** published (emerald checkmark), scheduled/recurring (amber clock), failed (red X), draft (no icon), has-media (image icon), has-link (link icon)
**Sub-components used:** `SocialPlatformIcon`
**Currently tested:** component test

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What is the tooltip copy for each state icon?
- [ ] What happens when a chip is clicked — opens day detail or composer?
- [ ] What does the highlighted ring state indicate?

---

### DayDetail / DayDetailPostCard
**File:** `components/social/dashboard/DayDetail.tsx`, `DayDetailPostCard.tsx`
**Type:** `"use client"`
**Props interface:** (inferred — date, posts, companyId, onEditPost, onClose)
**Variants/states:** empty day, populated day, post card loading, post card actions
**Sub-components used:** `PostChip`, `Button`, `StatusPill`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What actions are available per post card in the day detail (edit, delete, publish now)?
- [ ] What is the empty day state copy?
- [ ] Does the panel close when the user clicks outside it?

---

### FilterBar
**File:** `components/social/dashboard/FilterBar.tsx`
**Type:** `"use client"` (inferred)
**Props interface:** (inferred — platforms, statuses, onChange)
**Variants/states:** no filters active, filters active (visual indicator)
**Sub-components used:** `SocialPlatformIcon`, `PillSelect`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What filter dimensions are available (platform, status, assignee)?
- [ ] Does the filter persist across page navigation?

---

### BulkScheduleModal
**File:** `components/social/dashboard/BulkScheduleModal.tsx`
**Type:** `"use client"`
**Props interface:** (inferred — open, selectedPosts, onClose, onSuccess)
**Variants/states:** open, submitting, error, success
**Sub-components used:** `Dialog`, `Button`, `SchedulingCard`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What is the maximum number of posts that can be bulk-scheduled?
- [ ] Does bulk scheduling override individual post schedules?

---

### PostAnalyticsModal
**File:** `components/social/dashboard/PostAnalyticsModal.tsx`
**Type:** `"use client"`
**Props interface:** (inferred — open, postId, onClose)
**Variants/states:** open/loading, loaded with metrics, error, no-data
**Sub-components used:** `Dialog`, `Button`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What analytics metrics are shown (impressions, clicks, engagement rate)?
- [ ] What is the data freshness — real-time or cached daily?

---

### AddProfileDropdown
**File:** `components/social/dashboard/AddProfileDropdown.tsx`
**Type:** `"use client"` (inferred)
**Props interface:** (inferred — companyId, availablePlatforms)
**Variants/states:** closed, open (platform list), initiating OAuth
**Sub-components used:** `SocialPlatformIcon`, `Button`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What platforms are available to connect?
- [ ] What is the error state if OAuth is blocked by the browser?

---

## 9. Social Preview Components

These components render read-only platform-specific post previews.

| Component | File | Type |
|---|---|---|
| `FacebookPreviewCard` | `components/social/preview/FacebookPreviewCard.tsx` | Server Component |
| `InstagramPreviewCard` | `components/social/preview/InstagramPreviewCard.tsx` | Server Component |
| `LinkedInPreviewCard` | `components/social/preview/LinkedInPreviewCard.tsx` | Server Component |
| `XPreviewCard` | `components/social/preview/XPreviewCard.tsx` | Server Component |
| `GoogleBusinessPreviewCard` | `components/social/preview/GoogleBusinessPreviewCard.tsx` | Server Component |

All share a common props shape: `{ draft: Draft; profile?: Connection }`. Render static HTML mimicking the platform's native post layout. No interactive elements.

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] How closely does each preview match the real platform layout (pixel-perfect vs approximate)?
- [ ] What is shown when `draft.content` is empty?
- [ ] How is media rendered in the preview — aspect ratio, max dimensions?
- [ ] Are link previews rendered in the preview card?

---

## 10. CAP (Content Automation Pipeline) Components

### CAPGenerateModal
**File:** `components/CAPGenerateModal.tsx`
**Type:** `"use client"`
**Props interface:**
- `open: boolean`
- `companyId: string`
- `onClose: () => void`
- `onSuccess: (posts: PostMasterListItem[]) => void`

**Variants/states:** idle, submitting, error
**Sub-components used:** `Button`, `Dialog`, `Textarea`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What is the topics field format — free text, comma-separated?
- [ ] What platforms can be selected — all supported platforms?
- [ ] What is the error state if the AI generation quota is exhausted?
- [ ] What does the success transition look like after generation completes?

---

### CapAnalyticsDashboard
**File:** `components/CapAnalyticsDashboard.tsx`
**Type:** `"use client"` (inferred)
**Props interface:** (inferred — companyId, dateRange)
**Variants/states:** loading, empty, populated
**Sub-components used:** `Card`, chart primitives
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What metrics are shown — posts generated, published, engagement?
- [ ] What date ranges are available?

---

### CapCampaignDetail / CapCampaignList
**File:** `components/CapCampaignDetail.tsx`, `components/CapCampaignList.tsx`
**Type:** `"use client"` (inferred)
**Props interface:** (inferred — companyId, campaign data)
**Variants/states:** loading, empty, populated, editing
**Sub-components used:** `Card`, `Button`, `data-table`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What is a "campaign" — a collection of generated posts?
- [ ] What actions are available per campaign?

---

### CapSubscriptionPanel
**File:** `components/CapSubscriptionPanel.tsx`
**Type:** `"use client"` (inferred — subscription management)
**Props interface:** (inferred — companyId, currentPlan)
**Variants/states:** free tier, subscribed, upgrading, error
**Sub-components used:** `Button`, `Card`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What plans are available?
- [ ] What happens when the user upgrades — redirect to payment or inline?

---

## 11. Optimiser Components

### OnboardingWizard
**File:** `components/optimiser/OnboardingWizard.tsx`
**Type:** `"use client"`
**Props interface:** (inferred — clientId, steps config)
**Variants/states:** per-step progress, submitting, complete
**Sub-components used:** `Button`, `NewClientForm`, `TryAutoImportPanel`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] How many steps are in the wizard?
- [ ] Can the user skip optional steps?
- [ ] What is the exit state — redirect to client dashboard?

---

### ProposalReview / ProposalAppliedMoment / ProposalRolloutLink
**File:** `components/optimiser/ProposalReview.tsx`, `ProposalAppliedMoment.tsx`, `ProposalRolloutLink.tsx`
**Type:** `"use client"` (inferred)
**Props interface:** (inferred — proposalId, currentScore, proposedScore)
**Variants/states:** pending review, approved, rejected, applied, rolled-back
**Sub-components used:** `ImportSideBySide`, `Button`, `ScoreBreakdownPanel`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What is the diff view between current and proposed page content?
- [ ] Can a proposal be partially applied?
- [ ] What is the rollback flow?

---

### ScoreSparkline / ScoreHistoryTable / ScoreBreakdownPanel
**File:** `components/optimiser/ScoreSparkline.tsx`, `ScoreHistoryTable.tsx`, `ScoreBreakdownPanel.tsx`
**Type:** `"use client"` (inferred)
**Props interface:** (inferred — clientId, scoreHistory)
**Variants/states:** loading, empty history, populated
**Sub-components used:** none
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What time window does the sparkline show?
- [ ] What score dimensions are shown in the breakdown?

---

### StagedRolloutBanner / RollbackButton
**File:** `components/optimiser/StagedRolloutBanner.tsx`, `RollbackButton.tsx`
**Type:** `"use client"` (inferred)
**Props interface:** (inferred — proposalId, rolloutPercentage)
**Variants/states:** banner: 0%/25%/50%/100% rollout states; button: idle/confirming/rolling back
**Sub-components used:** `Button`, `ConfirmActionModal`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] At what rollout percentages does the banner change copy?
- [ ] Is rollback instantaneous or queued?

---

## 12. Platform Admin Components

### PlatformCompaniesListClient
**File:** `components/PlatformCompaniesListClient.tsx`
**Type:** `"use client"`
**Props interface:** (inferred — companies array, pagination)
**Variants/states:** loading, empty, populated
**Sub-components used:** `data-table`, `Button`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What is the empty state copy?
- [ ] What actions are available per company row?

---

### PlatformCompanyDetail
**File:** `components/PlatformCompanyDetail.tsx`
**Type:** `"use client"` (inferred)
**Props interface:** (inferred — company data, users, sites)
**Variants/states:** loading, populated, editing
**Sub-components used:** `Button`, `PlatformInviteUserModal`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What tabs or sections are shown — overview, users, sites, billing?

---

### AdminSocialConnectionsMaintenance
**File:** `components/AdminSocialConnectionsMaintenance.tsx`
**Type:** `"use client"` (inferred)
**Props interface:** (inferred — connections array, companyId)
**Variants/states:** loading, empty, populated, reconnecting, error
**Sub-components used:** `Button`, `data-table`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What maintenance actions are available (force-refresh token, disconnect, sync)?
- [ ] What is the error state for an expired/invalid connection?

---

### AdminSocialProfilesList
**File:** `components/AdminSocialProfilesList.tsx`
**Type:** `"use client"` (inferred)
**Props interface:** (inferred — profiles array, companyId)
**Variants/states:** loading, empty, populated
**Sub-components used:** `data-table`, `Button`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What profile actions are available to admins vs super_admins?

---

### AdminProfileAnalyticsClient
**File:** `components/AdminProfileAnalyticsClient.tsx`
**Type:** `"use client"` (inferred)
**Props interface:** (inferred — profileId, companyId, dateRange)
**Variants/states:** loading, empty, populated with charts
**Sub-components used:** `CapAnalyticsDashboard` (or standalone charts)
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What analytics metrics are shown per profile?

---

### AdminProfileConnectionsList
**File:** `components/AdminProfileConnectionsList.tsx`
**Type:** `"use client"` (inferred)
**Props interface:** (inferred — connections, profileId)
**Variants/states:** populated, empty
**Sub-components used:** `data-table`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What is shown per connection — status, last sync, error?

---

### ChangeUserRoleModal
**File:** `components/ChangeUserRoleModal.tsx`
**Type:** `"use client"`
**Props interface:** (inferred — userId, currentRole, open, onClose)
**Variants/states:** idle, submitting, error, success
**Sub-components used:** `Dialog`, `Button`, `Select`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What role options are available to the actor?
- [ ] Is downgrading a super_admin allowed?

---

### BundlesocialReconcileSection
**File:** `components/BundlesocialReconcileSection.tsx`
**Type:** `"use client"` (inferred)
**Props interface:** (inferred — companyId, reconcileStatus)
**Variants/states:** in-sync, out-of-sync, reconciling, error
**Sub-components used:** `Button`, `Callout`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What does reconciliation do — re-sync bundle.social team membership?
- [ ] What is the error state if the bundle.social API is unreachable?

---

### PlatformInviteUserModal / PlatformRevokeInvitationButton
**File:** `components/PlatformInviteUserModal.tsx`, `components/PlatformRevokeInvitationButton.tsx`
**Type:** `"use client"`
**Props interface:** (inferred — companyId, open, onClose for modal; inviteId for revoke)
**Variants/states:** modal: idle/submitting/success/error; button: idle/confirming/revoking
**Sub-components used:** `Dialog`, `Button`, `Input`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] How does platform invite differ from the standard InviteUserModal?
- [ ] What is the confirmation for revoke — a dialog or inline?

---

### InviteUserModal / InviteUserButton
**File:** `components/InviteUserModal.tsx`, `components/InviteUserButton.tsx`
**Type:** `"use client"`
**Props interface:**
- `open: boolean`
- `onClose: () => void`
- `actorRole: "super_admin" | "admin" | "user"`

**Variants/states:** idle, submitting ("Inviting…"), success (shows accept URL), error
**Sub-components used:** `Button`, `Input`
**Currently tested:** unit

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What is the success state copy when email delivery succeeded vs failed?
- [ ] Is the accept URL copyable via a dedicated copy button?
- [ ] What happens if the same email is re-invited while a previous invite is pending?

---

### PendingInvitesTable
**File:** `components/PendingInvitesTable.tsx`
**Type:** `"use client"` (inferred)
**Props interface:** (inferred — invites array)
**Variants/states:** empty, populated
**Sub-components used:** `data-table`, `Button`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What columns are shown — email, role, expires_at, status?
- [ ] What is the empty state when no pending invites exist?

---

### CustomerCompanyUsersView
**File:** `components/CustomerCompanyUsersView.tsx`
**Type:** `"use client"` (inferred)
**Props interface:** (inferred — companyId, users array)
**Variants/states:** loading, empty, populated
**Sub-components used:** `data-table`, `ChangeUserRoleModal`, `InviteUserButton`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What user actions are available — role change, remove from company?
- [ ] What is the empty state copy?

---

## 13. User / Account Components

### AccountSecurityForm
**File:** `components/AccountSecurityForm.tsx`
**Type:** `"use client"`
**Props interface:**
- `userEmail: string`

**Variants/states:** idle, submitting ("Updating…"), success ("Password updated"), error
**Sub-components used:** `Button`, `Input`
**Currently tested:** unit

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] After a password change, is the session kept alive or does the user need to re-login?
- [ ] What is the error copy for "current password incorrect"?
- [ ] Is there a throttle on password change attempts?

---

### EmailTestForm
**File:** `components/EmailTestForm.tsx`
**Type:** `"use client"` (inferred — admin-only test email trigger)
**Props interface:** (inferred — admin only)
**Variants/states:** idle, submitting, success, error
**Sub-components used:** `Button`, `Input`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What email templates can be tested?
- [ ] Is the recipient email the logged-in user's email or configurable?

---

### EditTenantBudgetButton
**File:** `components/EditTenantBudgetButton.tsx`
**Type:** `"use client"` (inferred — inline edit of AI budget)
**Props interface:** (inferred — companyId, currentBudget)
**Variants/states:** display, editing (inline form), saving, error
**Sub-components used:** `Button`, `Input`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What is the budget unit — USD per month, API calls per day?
- [ ] What is the effect when the budget is reached — hard block or soft warning?

---

## 14. Notification / Utility Components

### NotificationBell
**File:** `components/NotificationBell.tsx`
**Type:** `"use client"` (inferred)
**Props interface:** (inferred — userId)
**Variants/states:** no unread, unread badge, dropdown open
**Sub-components used:** `Popover`, `Button`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What event types trigger a notification (post approved, post failed, invite accepted)?
- [ ] Are notifications real-time (websocket) or polled?
- [ ] What is the mark-all-read interaction?

---

### OnboardingReminderBanner
**File:** `components/OnboardingReminderBanner.tsx`
**Type:** `"use client"` (inferred)
**Props interface:** (inferred — onboardingStatus, companyId)
**Variants/states:** visible, dismissed
**Sub-components used:** `Button`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What onboarding steps trigger this banner?
- [ ] Can the banner be permanently dismissed?
- [ ] Does the CTA navigate to the onboarding wizard?

---

### CommandPalette
**File:** `components/CommandPalette.tsx`
**Type:** `"use client"`
**Props interface:** (inferred — open, onClose, companyId)
**Variants/states:** closed, open (search input), navigating results
**Sub-components used:** `command` primitive, `Input`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What keyboard shortcut opens the palette?
- [ ] What entities are searchable — pages, posts, batches, companies?
- [ ] What is the empty/no-results state copy?

---

### ConfirmActionModal
**File:** `components/ConfirmActionModal.tsx`
**Type:** `"use client"` (inferred — generic confirmation dialog)
**Props interface:** (inferred — open, title, body, confirmLabel, onConfirm, onCancel, destructive?)
**Variants/states:** open, confirming
**Sub-components used:** `Dialog`, `Button`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is the confirm button red for destructive actions?
- [ ] Does Escape cancel without confirming?

---

### ErrorFallback
**File:** `components/ErrorFallback.tsx`
**Type:** `"use client"` (inferred)
**Props interface:** (inferred — error, reset)
**Variants/states:** shown when error boundary catches
**Sub-components used:** `Button`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What copy is shown — generic or error-specific?
- [ ] Does "Try again" call `reset()` or do a hard navigation?

---

### DebugFooter
**File:** `components/DebugFooter.tsx`
**Type:** `"use client"` (inferred — development-only debug info)
**Props interface:** (inferred — session, env info)
**Variants/states:** visible in dev, hidden in production
**Sub-components used:** none
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is this component gated by `NODE_ENV !== 'production'` or a feature flag?

---

### PopupChannelPicker / ChannelPickerBody / ChannelPickerModal
**File:** `components/PopupChannelPicker.tsx`, `components/ChannelPickerBody.tsx`, `components/ChannelPickerModal.tsx`
**Type:** `"use client"` (inferred)
**Props interface:** (inferred — companyId, selectedChannels, onChange, open, onClose)
**Variants/states:** open, closed, loading channels, empty, populated, multi-select
**Sub-components used:** `Dialog`, `Button`, `SocialPlatformIcon`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What is a "channel" in this context — a social profile or a platform type?
- [ ] Is multi-select supported?

---

### ApproveAutoClose / ApproveCompleteHere / ApprovalDecisionForm
**File:** `components/ApproveAutoClose.tsx`, `components/ApproveCompleteHere.tsx`, `components/ApprovalDecisionForm.tsx`
**Type:** `"use client"` (inferred — external approval link surfaces)
**Props interface:** (inferred — approvalToken, postSummary)
**Variants/states:** pending decision, submitting, approved, rejected, already-decided, expired
**Sub-components used:** `Button`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] These appear on the public approval URL — is authentication required?
- [ ] What is the copy and action when the approval has already been decided?
- [ ] What does "auto-close" mean — close the browser tab?

---

## 15. SEO / Session Components

### seo-length-feedback
**File:** `components/seo/seo-length-feedback.tsx`
**Type:** `"use client"` (inferred — character count feedback for SEO fields)
**Props interface:** (inferred — value, min, max, type: "title" | "description")
**Variants/states:** ok, too short, too long
**Sub-components used:** none
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What are the min/max values for title vs description?
- [ ] Is the feedback colour-coded?

---

### session-expiry-banner / session-expiry-modal / session-expiry-watcher
**File:** `components/session/session-expiry-banner.tsx`, `session-expiry-modal.tsx`, `session-expiry-watcher.tsx`
**Type:** `"use client"`
**Props interface:** (inferred — expiresAt, onRefresh, onSignOut)
**Variants/states:** banner: hidden/visible (approaching expiry); modal: hidden/visible (expired); watcher: background polling
**Sub-components used:** `Button`, `Dialog`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] How many minutes before expiry does the banner appear?
- [ ] Does the watcher extend the session automatically when the user is active?
- [ ] What is the copy in the modal when the session has fully expired?

---

### social-module-shell / ProfileSelector (social)
**File:** `components/social/social-module-shell.tsx`, `components/social/ProfileSelector.tsx`, `components/social/profile-chip.tsx`
**Type:** `"use client"` (inferred)
**Props interface:** (inferred — companyId, activeProfileId, children)
**Variants/states:** loading profiles, profile selected, no profiles
**Sub-components used:** `SocialPlatformIcon`, `Button`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What is the difference between this `ProfileSelector` and the composer-level `ProfileSelector`?
- [ ] Where does the module shell appear — as a sidebar or top-nav element?

---

### PostDetailClient / PostDetailTabbedClient / PostDraftEditor / PostPublishHistorySection / PostScheduleSection / PostVariantsSection / PostDecisionsAudit
**File:** `components/PostDetailClient.tsx` etc.
**Type:** `"use client"`
**Props interface:** (inferred — postId, companyId, initial post data)
**Variants/states:** loading, viewing, editing, publishing, published, failed
**Sub-components used:** `ComposerOverlay`, `PostApprovalSection`, `PostScheduleSection`, various
**Currently tested:** e2e (partial)

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Which tabs are shown on the tabbed view (content, schedule, analytics, audit)?
- [ ] What is the error state for a failed publish attempt?
- [ ] Can a published post be edited — does it create a new version?

---

### PostsNewClient
**File:** `components/PostsNewClient.tsx`
**Type:** `"use client"` (inferred — new post creation surface)
**Props interface:** (inferred — companyId, prefilledDate)
**Variants/states:** empty (composer not yet opened), composer open
**Sub-components used:** `ComposerOverlay`
**Currently tested:** none

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Does this page auto-open the composer or show a button first?

---

---

## 16. UI Primitives

`components/ui/` — condensed reference table.

| Component | File | Key props | Notes |
|---|---|---|---|
| `Alert` | `alert.tsx` | `variant: "default" \| "destructive"`, `children`, `reportContext?` | Used for form-level errors; reportContext feeds observability |
| `Badge` | `badge.tsx` | `variant: "default" \| "secondary" \| "destructive" \| "outline"`, `children` | Inline label |
| `Breadcrumb` | `breadcrumb.tsx` | Composable: `Breadcrumb`, `BreadcrumbList`, `BreadcrumbItem`, `BreadcrumbLink`, `BreadcrumbPage`, `BreadcrumbSeparator` | shadcn/ui breadcrumb |
| `Button` | `button.tsx` | `variant: "default" \| "destructive" \| "outline" \| "secondary" \| "ghost" \| "link"`, `size: "default" \| "sm" \| "lg" \| "icon"`, `asChild?` | Core CTA |
| `Callout` | `callout.tsx` | `variant: "info" \| "warning" \| "error" \| "success"`, `title?`, `children` | Inline alert block |
| `Card` | `card.tsx` | `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter` | shadcn/ui card |
| `Command` | `command.tsx` | shadcn command palette primitives | Used by `CommandPalette` |
| `ConfirmDialog` | `confirm-dialog.tsx` | `open`, `title`, `description`, `onConfirm`, `onCancel`, `destructive?` | Generic confirmation |
| `DataTable` | `data-table.tsx` | `columns`, `data`, `pagination?`, `onRowClick?` | TanStack Table wrapper |
| `Dialog` | `dialog.tsx` | shadcn dialog primitives | Used by most modals |
| `EmptyState` | `empty-state.tsx` | `icon`, `iconLabel?`, `title`, `body`, `cta?`, `density?: "default" \| "compact"` | Dashed-border empty list pattern |
| `IconButton` | `icon-button.tsx` | `icon`, `label`, `size?`, `variant?` | Accessible icon-only button |
| `Input` | `input.tsx` | Standard HTML input props + `suppressHydrationWarning` | Grammarly-safe |
| `Kbd` | `kbd.tsx` | `children` | Keyboard shortcut key display |
| `LoadingButton` | `loading-button.tsx` | `loading: boolean`, all Button props | Button with spinner |
| `MenuItem` | `menu-item.tsx` | `icon?`, `label`, `shortcut?`, `destructive?` | Used in dropdowns |
| `NavIcon` | `nav-icon.tsx` | `name: NavIconName`, `size?` | Navigation icon from design system |
| `PageHeader` | `page-header.tsx` | `title`, `subtitle?`, `actions?` | Consistent page-level header |
| `PageShell` | `page-shell.tsx` | `children` | Max-width + padding wrapper |
| `Pagination` | `pagination.tsx` | `page`, `totalPages`, `onPageChange` | Standard pagination controls |
| `Pill` | `pill.tsx` | `children`, `variant?` | Read-only label chip |
| `PillSelect` | `pill-select.tsx` | `options`, `value`, `onChange`, `multi?` | Pill-style select |
| `PillTabs` | `pill-tabs.tsx` | `tabs`, `active`, `onChange` | Pill-styled tab strip |
| `Popover` | `popover.tsx` | shadcn popover primitives | Used by pickers |
| `RowActions` | `row-actions.tsx` | `actions: Action[]` | Ellipsis menu for table rows |
| `ScrollArea` | `scroll-area.tsx` | `children`, `className?` | Styled scrollable region |
| `SearchInput` | `search-input.tsx` | `value`, `onChange`, `placeholder?` | Debounced search input |
| `SectionHeader` | `section-header.tsx` | `title`, `subtitle?`, `actions?` | Sub-section header |
| `Skeleton` | `skeleton.tsx` | `className?` | Shimmer loading placeholder |
| `SocialPlatformIcon` | `SocialPlatformIcon.tsx` | `platform: SocialPlatformIconKey`, `size?`, `className?` | Platform logo icon |
| `StatusPill` | `status-pill.tsx` | `status: PostState` | Colour-coded post state badge |
| `SuccessMoment` | `success-moment.tsx` | `title`, `body?`, `cta?` | Full-screen celebration state |
| `Switch` | `switch.tsx` | shadcn switch props | Used by ApprovalToggle |
| `TableCell` | `table-cell.tsx` | `children`, `className?` | Styled td wrapper |
| `Tabs` | `tabs.tsx` | shadcn tabs primitives | Used by PostDetailTabbedClient |
| `Textarea` | `textarea.tsx` | Standard textarea props | Multi-line text input |
| `Toaster` | `toaster.tsx` | No props — global toast renderer | sonner-based |
| `Tooltip` | `tooltip.tsx` | shadcn tooltip primitives | Keyboard shortcut hints |
| `Typography` | `typography.tsx` | `variant: "h1" \| "h2" \| "h3" \| "p" \| "muted" \| "lead"`, `children` | Design-system text styles |
