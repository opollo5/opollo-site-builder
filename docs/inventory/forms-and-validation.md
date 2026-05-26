# Forms and Validation Inventory

Inventory of every form surface in the Opollo Site Builder codebase. Generated 2026-05-26.

Each entry documents the actual fields, submission mechanism, and current client-side validation as observed in source. The "EXPECTED BEHAVIOUR" checkboxes are intentionally empty — Steven to fill.

---

## Table of Contents

1. [Auth Forms](#1-auth-forms)
2. [Site Management Forms](#2-site-management-forms)
3. [Batch / Brief Forms](#3-batch--brief-forms)
4. [Media Upload Forms](#4-media-upload-forms)
5. [Social Composer Forms](#5-social-composer-forms)
6. [Social Review / Approval Forms](#6-social-review--approval-forms)
7. [User / Invite Management Forms](#7-user--invite-management-forms)
8. [Platform Admin Forms](#8-platform-admin-forms)
9. [Blog / Page Metadata Forms](#9-blog--page-metadata-forms)
10. [Design System / Brand Forms](#10-design-system--brand-forms)
11. [CAP Forms](#11-cap-forms)

---

## Validation Patterns Reference

Current patterns used across the codebase:

| Pattern | Where used | Details |
|---|---|---|
| HTML `required` attribute | All forms | Browser-native required field enforcement |
| HTML `type="email"` | Email fields | Browser-native email format check |
| HTML `minLength` / `maxLength` | Password, name, slug fields | Browser-native length enforcement |
| Client-side JS validation before submit | `AddSiteModal`, `AcceptInviteForm`, etc. | `validateClient()` runs before `fetch`, shows field-level errors |
| `useFormState` + server action | `LoginForm` | React 18 progressive-enhancement pattern; server action returns `{ error }` or `{ redirectTo }` |
| `fetch POST` with JSON response | Most forms | Response shape `{ ok: true, data } \| { ok: false, error: { code, message } }` |
| Password strength meter | `AcceptInviteForm` | 0–4 score heuristic; min 12 chars; bonus for uppercase, digits, symbols |
| Idempotency-Key header | `NewBatchModal` | Prevents duplicate batch creation on double-submit |

---

## 1. Auth Forms

### LoginForm (Surface: `/login`)
**File:** `components/LoginForm.tsx`
**Surface:** `/login`
**Submission mechanism:** Server action (`loginAction` from `app/login/actions.ts`) via `useFormState`

**Fields:**
| Field | Type | Required | Current validation |
|---|---|---|---|
| `email` | `type="email"` | yes | HTML type=email; `autoComplete="email"` |
| `password` | `type="password"` | yes | HTML required; `autoComplete="current-password"` |
| `next` | hidden | yes | Injected from prop; not user-editable |

**Submission flow:** `formAction` → server action → returns `{ error }` (shown inline) or `{ redirectTo }` (triggers `window.location.assign` for full-page nav to guarantee middleware re-reads cookies)

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What if submission returns a 422 (validation error) — same inline error or a different message?
- [ ] What if submission returns a 500 — what copy is shown?
- [ ] What if the user lacks permission for the `next` route after login?
- [ ] What happens on browser back after a successful login redirect?
- [ ] Is there an account lockout after N failed attempts, and is that surfaced in the UI?
- [ ] Is there an optimistic update (e.g. optimistic redirect)?
- [ ] What fields are editable after creation — N/A (login is stateless)?

---

### AcceptInviteForm (Surface: `/auth/accept-invite`)
**File:** `components/AcceptInviteForm.tsx`
**Surface:** `/auth/accept-invite?token=...`
**Submission mechanism:** `fetch POST /api/auth/accept-invite`

**Fields:**
| Field | Type | Required | Current validation |
|---|---|---|---|
| `email` | text, read-only | yes | Read-only; not submitted (token carries email) |
| `password` | `type="password"` | yes | min 12 chars; `aria-invalid` when too short |
| `confirm` (confirm password) | `type="password"` | yes | Must match `password`; `aria-invalid` on mismatch |
| `token` | Not a form field — passed via component prop | yes | Included in request body |

**Client validation:**
- Password min length: 12 chars (constant `MIN_LENGTH`)
- Confirm must equal password
- Strength score 0–4 shown via `StrengthMeter` (0 = too short to score)
- Submit button disabled until `password.length >= 12 && password === confirm`

**Success:** `router.push('/login?invite=accepted&email=...')`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What if submission returns a 422 — token already used?
- [ ] What if the token has expired — what error copy is shown?
- [ ] What if submission returns a 500?
- [ ] What if the user lacks permission (e.g. invite was for a different email)?
- [ ] What happens if the user submits without a duplicate — N/A unique path?
- [ ] What is the success state — redirect to /login with a toast?
- [ ] Is there an optimistic update?
- [ ] What fields are editable after creation — N/A (one-time form)?

---

### ForgotPasswordForm (Surface: `/auth/forgot-password`)
**File:** `components/ForgotPasswordForm.tsx`
**Surface:** `/auth/forgot-password`
**Submission mechanism:** `fetch POST /api/auth/forgot-password`

**Fields:**
| Field | Type | Required | Current validation |
|---|---|---|---|
| `email` | `type="email"` | yes | HTML type=email; button disabled when empty |

**Known API response codes handled:**
- `RATE_LIMITED` → "Too many reset requests for this email. Try again in a bit."
- `VALIDATION_FAILED` → "Please enter a valid email address."
- Other errors → raw server message or HTTP status fallback

**Success:** Form replaced with "Check your email" confirmation block (no-enumeration — same copy regardless of whether email exists)

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What if submission returns a 500 — what copy is shown?
- [ ] What if the user lacks permission — N/A (public route)?
- [ ] What if the user submits a duplicate request quickly — RATE_LIMITED?
- [ ] What is the success state — is email address shown in the confirmation?
- [ ] Is there an optimistic update?
- [ ] What fields are editable after creation — N/A?

---

### AccountSecurityForm (Surface: `/account/security`)
**File:** `components/AccountSecurityForm.tsx`
**Surface:** `/account/security`
**Submission mechanism:** `fetch POST /api/auth/change-password` (inferred from M14-4 context)

**Fields:**
| Field | Type | Required | Current validation |
|---|---|---|---|
| `current` (current password) | `type="password"` | yes | Required; non-empty |
| `next` (new password) | `type="password"` | yes | Passes `validatePassword()` from `lib/password-policy`; strength hint shown |
| `confirm` | `type="password"` | yes | Must match `next`; mismatch error shown |

**Additional checks:**
- New password must differ from current (`sameAsCurrent` guard)
- Submit disabled until all three are valid and non-empty

**Success:** Inline "Password updated" confirmation; fields cleared; session remains active

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What if submission returns a 422 — current password wrong?
- [ ] What if submission returns a 500?
- [ ] What if the user lacks permission?
- [ ] What if the user submits a duplicate (same password as current) — caught client-side?
- [ ] What is the success state — inline message, toast, or both?
- [ ] Is there an optimistic update?
- [ ] What fields are editable after creation — all fields reset on success?

---

### PlatformAcceptInviteForm (Surface: platform invite URL)
**File:** `components/PlatformAcceptInviteForm.tsx`
**Surface:** Platform-specific accept-invite URL
**Submission mechanism:** `fetch POST` (inferred — similar to `AcceptInviteForm` but platform-tenant scoped)

**Fields:** (inferred — same shape as `AcceptInviteForm`)
| Field | Type | Required | Current validation |
|---|---|---|---|
| `email` | text, read-only | yes | Read-only |
| `password` | `type="password"` | yes | Min length enforced |
| `confirm` | `type="password"` | yes | Must match |

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What if submission returns a 422?
- [ ] What if submission returns a 500?
- [ ] What if the user lacks permission (wrong company)?
- [ ] What is the success redirect target?
- [ ] Is there an optimistic update?
- [ ] What fields are editable after creation?

---

## 2. Site Management Forms

### AddSiteModal (Surface: modal on `/sites` or site list page)
**File:** `components/AddSiteModal.tsx`
**Surface:** Modal opened from site list page
**Submission mechanism:** `fetch POST /api/sites/register`

**Fields:**
| Field | Type | Required | Current validation |
|---|---|---|---|
| `name` | text | yes | 1–100 chars (client + server); trim |
| `wp_url` | `type="url"` | yes | `new URL()` parse check; placeholder "https://example.com" |
| `wp_user` | text | yes | 1–100 chars; trim |
| `wp_app_password` | password (show/hide toggle) | yes | Min 8 chars; `autoComplete="off"` |

**Known API response codes handled:**
- `PREFIX_TAKEN` → form-level error
- `VALIDATION_FAILED` with `details.issues` → maps to per-field errors
- Other errors → form-level fallback message

**Success:** `onSuccess()` + `onClose()` callbacks called

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What if submission returns a 422 (validation error)?
- [ ] What if submission returns a 500?
- [ ] What if the user lacks permission to register a site?
- [ ] What happens if the WP URL is a duplicate (already registered)?
- [ ] What is the success state — toast, navigation, or modal close only?
- [ ] Is there an optimistic update?
- [ ] What fields are editable after creation — use `EditSiteModal`?

---

### EditSiteModal (Surface: modal on site detail or site list)
**File:** `components/EditSiteModal.tsx`
**Surface:** Modal opened from site edit action
**Submission mechanism:** `fetch PATCH /api/sites/[id]` (inferred)

**Fields:** (inferred — same as AddSiteModal but pre-populated)
| Field | Type | Required | Current validation |
|---|---|---|---|
| `name` | text | yes | 1–100 chars |
| `wp_url` | url | yes | Valid URL |
| `wp_user` | text | yes | Non-empty |
| `wp_app_password` | password | no | Blank = keep existing credential |

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What if submission returns a 422?
- [ ] What if submission returns a 500?
- [ ] What if the user lacks permission?
- [ ] What if the site ID no longer exists?
- [ ] What is the success state?
- [ ] Is there an optimistic update?
- [ ] Is the app password required for an edit or can it be left blank to keep the current one?

---

### SiteCreateForm / SiteEditForm / SiteOnboardingForm / SiteVoiceSettingsForm
**Files:** `components/SiteCreateForm.tsx`, `components/SiteEditForm.tsx`, `components/SiteOnboardingForm.tsx`, `components/SiteVoiceSettingsForm.tsx`
**Surface:** Various site setup pages
**Submission mechanism:** `fetch POST/PATCH` (inferred per form)

**SiteCreateForm fields** (inferred):
| Field | Type | Required | Current validation |
|---|---|---|---|
| `name` | text | yes | Non-empty |
| `wp_url` | url | yes | Valid URL |

**SiteOnboardingForm fields** (inferred — extended setup):
| Field | Type | Required | Current validation |
|---|---|---|---|
| `name` | text | yes | Non-empty |
| `wp_url` | url | yes | Valid URL |
| `wp_user` | text | yes | Non-empty |
| `wp_app_password` | password | yes | Min length |
| `timezone` | select | no | IANA timezone string |

**SiteVoiceSettingsForm fields** (inferred — tone/voice settings):
| Field | Type | Required | Current validation |
|---|---|---|---|
| `voice_style` | select/textarea | no | Free text or preset |
| `audience` | textarea | no | Free text |

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What if submission returns a 422?
- [ ] What if submission returns a 500?
- [ ] What if the user lacks permission?
- [ ] What is the success redirect for SiteOnboardingForm?
- [ ] Is there an optimistic update on any of these forms?
- [ ] What fields are editable after creation?

---

## 3. Batch / Brief Forms

### NewBatchModal (Surface: modal on batches list page)
**File:** `components/NewBatchModal.tsx`
**Surface:** Modal opened from "Run batch" button on batches page
**Submission mechanism:** `fetch POST /api/admin/batch` with `Idempotency-Key` header

**Fields:**
| Field | Type | Required | Current validation |
|---|---|---|---|
| `templateId` | select | yes | Pre-selected to first template; validated non-empty |
| `slugsText` | textarea | yes | One slug per line; parsed into array on submit |

**Notes:**
- `site` prop is required context; submit blocked when site is null
- Idempotency key prevents double-submission
- On success: `router.push('/batches/[id]')` (navigates to new batch detail)

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What if submission returns a 422 (e.g. invalid slug format)?
- [ ] What if submission returns a 500?
- [ ] What if the user lacks permission?
- [ ] What if a duplicate batch is submitted (idempotency key matches existing)?
- [ ] What is the success state — auto-navigate to batch detail?
- [ ] Is there an optimistic update?
- [ ] What is the maximum number of slugs per batch?

---

## 4. Media Upload Forms

### MediaLibraryClient — upload form (Surface: `/company/[id]/media` or `/company/[id]/image-library`)
**File:** `components/MediaLibraryClient.tsx`
**Surface:** `/company/[companyId]/image-library`
**Submission mechanism:** `fetch POST /api/platform/social/media/upload` (inferred) or direct Supabase Storage upload

**Fields:**
| Field | Type | Required | Current validation |
|---|---|---|---|
| File input (via `BulkUploadPanel`) | `type="file"` multi | yes | MIME type and size enforced server-side |

**Notes:**
- `canEdit` prop gates the upload UI (hidden for read-only users)
- Cursor pagination via `initialNextCursor`; "Load more" appends assets

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What if submission returns a 422 (unsupported file type)?
- [ ] What if submission returns a 500?
- [ ] What if the user lacks permission to upload?
- [ ] What if a duplicate file is uploaded (same name/hash)?
- [ ] What is the success state — asset appears immediately or after refresh?
- [ ] Is there an optimistic update (ghost tile while uploading)?
- [ ] What file types and sizes are accepted?

---

### EditImageMetadataModal (Surface: modal on image detail or images table)
**File:** `components/EditImageMetadataModal.tsx`
**Surface:** Modal opened from image row or detail
**Submission mechanism:** `fetch PATCH /api/platform/social/media/[id]` (inferred)

**Fields** (inferred):
| Field | Type | Required | Current validation |
|---|---|---|---|
| `alt_text` | textarea | no | Free text; max length unknown |
| `title` | text | no | Free text; max length unknown |

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What if submission returns a 422?
- [ ] What if submission returns a 500?
- [ ] What if the user lacks permission?
- [ ] What is the success state — toast or inline confirmation?
- [ ] Is there an optimistic update?
- [ ] What fields are editable?

---

## 5. Social Composer Forms

### ComposerEditor (Surface: ComposerOverlay — `/company/[id]/social/*`)
**File:** `components/social/composer/ComposerEditor.tsx`
**Surface:** Inside `ComposerOverlay` on all social routes
**Submission mechanism:** Internal `onSubmit(mode)` callback → `ComposerOverlay` → `fetch POST /api/platform/social/drafts`

**Fields:**
| Field | Type | Required | Current validation |
|---|---|---|---|
| `content` (base text) | `ContentEditor` (rich textarea) | yes (unless draft) | Platform char limits from `PLATFORM_CHAR_LIMITS`; over-limit warning |
| `platform_variants` (per-platform content overrides) | `CustomizeForRow` | no | Same char limits per platform |
| `media_urls` | `MediaTray` | no | Platform-specific media count limits |
| `target_profile_ids` | `ProfileSelector` | yes | At least one required for post now / schedule |
| `link_url` | `LinkPreviewCard` | no | Valid URL |
| UTM params | `UtmBuilderPanel` | no | Optional; appended to link_url |
| `approval_required` | `ApprovalToggle` | no | Boolean |

**readOnly mode:** `textarea` + media tray still render; tools row, link editors, `CustomizeForRow`, per-tile remove buttons hidden. Used for `published` / `failed` states.

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What if submission returns a 422 (content too long, missing profiles)?
- [ ] What if submission returns a 500?
- [ ] What if the user lacks permission (e.g. read-only role)?
- [ ] What if the user submits a duplicate post (same content to same profiles)?
- [ ] What is the success state — overlay closes, calendar refreshes, toast?
- [ ] Is there an optimistic update on the calendar?
- [ ] What fields are editable after a post is scheduled (before publish)?

---

### SchedulingCard (Surface: inside ComposerOverlay)
**File:** `components/social/composer/SchedulingCard.tsx`
**Surface:** Bottom of `ComposerEditor` in `ComposerOverlay`
**Submission mechanism:** Calls `onSubmit()` which propagates to `ComposerEditor.onSubmit`

**Fields:**
| Field | Type | Required | Current validation |
|---|---|---|---|
| `mode` | tab select: `post_now \| schedule \| recurring \| draft` | yes | Tab selection |
| `scheduledTimes` | `ScheduleRow[]` (date + time pickers) | yes when mode=schedule | Future dates only (inferred) |
| `recurrence` | `RecurrencePicker` (pattern, frequency, end) | yes when mode=recurring | Rule structure |
| `plannedForAt` | `ScheduleRow` | no (draft mode) | Optional planned date |
| `approvalRequired` | `ApprovalToggle` (Switch) | no | Boolean |

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What if the scheduled time is in the past on submit?
- [ ] What if submission returns a 422?
- [ ] What if submission returns a 500?
- [ ] What if the user lacks permission to schedule?
- [ ] What is the success state per mode (post now / schedule / recurring / draft)?
- [ ] Is there an optimistic update?
- [ ] Can a scheduled post be rescheduled after saving?

---

## 6. Social Review / Approval Forms

### ReviewDecisionForm (Surface: public approval link)
**File:** `components/social/review/ReviewDecisionForm.tsx`
**Surface:** Public approval URL (no auth required — token-gated)
**Submission mechanism:** `fetch POST /api/platform/social/drafts/[draftId]/approve`

**Fields:**
| Field | Type | Required | Current validation |
|---|---|---|---|
| `decision` | radio/button: `approved \| rejected` | yes | Must select before submit |
| `rejection_reason` | textarea | yes when rejected | Min 30 chars; submit blocked when too short |

**Success:** Component replaces itself with a confirmation message ("Post approved." / "Post rejected.")

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What if submission returns a 422 (post already approved/rejected)?
- [ ] What if submission returns a 500?
- [ ] What if the approval token has expired?
- [ ] What if the reviewer submits a duplicate decision?
- [ ] What is the success state — is there a redirect or does the page stay?
- [ ] Is there an optimistic update?
- [ ] Can an approved post be re-rejected by the same reviewer?

---

### PostApprovalSection — add recipient form (Surface: post detail page)
**File:** `components/PostApprovalSection.tsx`
**Surface:** Post detail page (approval recipients section)
**Submission mechanism:** `fetch POST /api/platform/social/posts/[id]/recipients` (inferred)

**Fields:**
| Field | Type | Required | Current validation |
|---|---|---|---|
| `email` | `type="email"` | yes | HTML type=email |
| `name` | text | no | Optional display name |
| `requires_otp` | checkbox | no | Boolean |

**Note:** `canManage` prop gates the add/revoke actions. Only visible to editor+ on `pending_client_approval` posts.

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What if submission returns a 422 (email already a recipient)?
- [ ] What if submission returns a 500?
- [ ] What if the user lacks permission?
- [ ] What is the success state — new row appears in the list immediately?
- [ ] Is there an optimistic update?
- [ ] What fields are editable after a recipient is added?

---

### ApprovalDecisionForm (Surface: public approval URL, alternate surface)
**File:** `components/ApprovalDecisionForm.tsx`
**Surface:** Public-facing approval URL
**Submission mechanism:** `fetch POST` to approval endpoint (inferred)

**Fields** (inferred — similar to `ReviewDecisionForm`):
| Field | Type | Required | Current validation |
|---|---|---|---|
| `decision` | button: approve / reject | yes | Must select |
| `rejection_reason` | textarea | yes when rejected | Min length |

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] How does this differ from `ReviewDecisionForm`?
- [ ] What if submission returns a 422?
- [ ] What if submission returns a 500?
- [ ] What if the token is expired or already used?
- [ ] What is the success state?

---

## 7. User / Invite Management Forms

### InviteUserModal (Surface: modal on users/team page)
**File:** `components/InviteUserModal.tsx`
**Surface:** Modal opened from "Invite user" button on team/users page
**Submission mechanism:** `fetch POST /api/admin/invites`

**Fields:**
| Field | Type | Required | Current validation |
|---|---|---|---|
| `email` | `type="email"` | yes | HTML type=email; `autoComplete="email"` |
| `role` | select: `admin \| user` | yes | Available options restricted by `actorRole` (super_admin sees both; admin sees user only) |

**Success:** Shows accept URL (for out-of-band sharing) + email delivery status; `router.refresh()` to update pending invites table

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What if submission returns a 422 (email already a member or already invited)?
- [ ] What if submission returns a 500?
- [ ] What if the user lacks permission (e.g. user role tries to invite)?
- [ ] What if the user submits a duplicate invite for the same email?
- [ ] What is the success state — is there a copy-URL button?
- [ ] Is there an optimistic update (pending row appears before modal closes)?
- [ ] What fields are editable after invite is sent — can the role be changed?

---

### PlatformInviteUserModal (Surface: modal on platform company detail)
**File:** `components/PlatformInviteUserModal.tsx`
**Surface:** Modal on platform admin company detail page
**Submission mechanism:** `fetch POST` (inferred — platform-scoped invite endpoint)

**Fields** (inferred):
| Field | Type | Required | Current validation |
|---|---|---|---|
| `email` | `type="email"` | yes | HTML type=email |
| `role` | select | yes | Platform role options |
| `company_id` | hidden | yes | From context |

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What if submission returns a 422?
- [ ] What if submission returns a 500?
- [ ] What if the user lacks permission?
- [ ] What if the email is already a member of the company?
- [ ] What is the success state?
- [ ] Is there an optimistic update?

---

### ChangeUserRoleModal (Surface: modal on user management pages)
**File:** `components/ChangeUserRoleModal.tsx`
**Surface:** Modal on team/users page
**Submission mechanism:** `fetch PATCH /api/admin/users/[id]` (inferred)

**Fields** (inferred):
| Field | Type | Required | Current validation |
|---|---|---|---|
| `role` | select: `admin \| user` | yes | Constrained by actor role |

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What if submission returns a 422?
- [ ] What if submission returns a 500?
- [ ] What if the user lacks permission?
- [ ] Can an admin downgrade their own role?
- [ ] What is the success state — toast + table refresh?
- [ ] Is there an optimistic update?

---

## 8. Platform Admin Forms

### PlatformCompanyCreateForm (Surface: `/admin/companies/new`)
**File:** `components/PlatformCompanyCreateForm.tsx`
**Surface:** `/admin/companies/new`
**Submission mechanism:** `fetch POST /api/admin/companies`

**Fields:**
| Field | Type | Required | Current validation |
|---|---|---|---|
| `name` | text | yes | Non-empty; max 200 chars; button disabled when blank |
| `slug` | text | no | Max 60 chars; auto-generated from name if blank; lowercase/digits/hyphens only (server-side) |
| `domain` | text | no | Max 253 chars; free text (no URL validation client-side) |

**Success:** `router.push('/admin/companies?created=<id>&name=<name>')` — triggers `FirstCustomerOnboardedMoment` on list page

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What if submission returns a 422 (slug already taken)?
- [ ] What if submission returns a 500?
- [ ] What if the user lacks permission (non-admin)?
- [ ] What if a company with the same name already exists?
- [ ] What is the success state?
- [ ] Is there an optimistic update?
- [ ] What fields are editable after creation?

---

### EmailTestForm (Surface: admin diagnostics page)
**File:** `components/EmailTestForm.tsx`
**Surface:** Admin tools/diagnostics page
**Submission mechanism:** `fetch POST /api/admin/email/test` (inferred)

**Fields** (inferred):
| Field | Type | Required | Current validation |
|---|---|---|---|
| `template` | select | yes | Available email templates |
| `to` | `type="email"` | no | Defaults to logged-in user's email |

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What if submission returns a 422?
- [ ] What if submission returns a 500?
- [ ] What if the email delivery fails (SendGrid error)?
- [ ] What is the success state — inline confirmation or toast?

---

### EditTenantBudgetButton (Surface: inline on company detail or settings page)
**File:** `components/EditTenantBudgetButton.tsx`
**Surface:** Company detail / settings page (inline edit)
**Submission mechanism:** `fetch PATCH /api/admin/companies/[id]/budget` (inferred)

**Fields** (inferred):
| Field | Type | Required | Current validation |
|---|---|---|---|
| `budget` | number input | yes | Positive number; unit unknown |

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What is the budget unit (USD/month, API credits/month)?
- [ ] What if submission returns a 422?
- [ ] What if submission returns a 500?
- [ ] What if the user lacks permission?
- [ ] What is the success state — inline update?
- [ ] Is there an optimistic update?

---

## 9. Blog / Page Metadata Forms

### EditPageMetadataModal (Surface: modal on pages table or page detail)
**File:** `components/EditPageMetadataModal.tsx`
**Surface:** Modal on pages list or page detail
**Submission mechanism:** `fetch PATCH /api/sites/[siteId]/pages/[pageId]` (inferred)

**Fields** (inferred):
| Field | Type | Required | Current validation |
|---|---|---|---|
| `title` | text | yes | Max ~60 chars (SEO title) |
| `meta_description` | textarea | no | Max ~160 chars (SEO description) |
| `slug` | text | no | URL-safe |

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What if submission returns a 422?
- [ ] What if submission returns a 500?
- [ ] What if the user lacks permission?
- [ ] What if a duplicate slug is submitted?
- [ ] What is the success state — does the change push to WordPress immediately?
- [ ] Is there an optimistic update?
- [ ] Are there `seo-length-feedback` indicators for title/description?

---

### BlogPostComposer (Surface: blog post editing page)
**File:** `components/BlogPostComposer.tsx`
**Surface:** Blog post editing page
**Submission mechanism:** `fetch POST/PATCH` to WordPress via site credentials (inferred)

**Fields** (inferred):
| Field | Type | Required | Current validation |
|---|---|---|---|
| `title` | text | yes | Non-empty |
| `content` | rich text / markdown | yes | Non-empty |
| `slug` | text | no | Auto-derived from title |
| `meta_description` | textarea | no | SEO field |
| `status` | select: draft / publish | yes | Enum |

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What if submission returns a 422 (duplicate slug on WP)?
- [ ] What if submission returns a 500 (WP API unreachable)?
- [ ] What if the user lacks permission?
- [ ] What is the success state for Save vs Publish?
- [ ] Is there autosave? If so, what interval?
- [ ] Is there an optimistic update?

---

## 10. Design System / Brand Forms

### CreateDesignSystemModal (Surface: modal on design systems list)
**File:** `components/CreateDesignSystemModal.tsx`
**Surface:** Modal on design systems page
**Submission mechanism:** `fetch POST /api/admin/sites/[siteId]/design-systems` (inferred)

**Fields** (inferred):
| Field | Type | Required | Current validation |
|---|---|---|---|
| `name` | text | yes | Non-empty; max length unknown |

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What if submission returns a 422?
- [ ] What if submission returns a 500?
- [ ] What if the user lacks permission?
- [ ] What if a design system with the same name already exists?
- [ ] What is the success state?
- [ ] Is there an optimistic update?

---

### CustomerBrandProfileEditor (Surface: brand profile settings page)
**File:** `components/CustomerBrandProfileEditor.tsx`
**Surface:** Brand profile settings
**Submission mechanism:** `fetch PATCH` (inferred)

**Fields** (inferred):
| Field | Type | Required | Current validation |
|---|---|---|---|
| `brand_name` | text | no | Free text |
| `brand_voice` | textarea | no | Free text |
| `target_audience` | textarea | no | Free text |
| `tone_keywords` | text/tag input | no | Comma-separated |

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What if submission returns a 422?
- [ ] What if submission returns a 500?
- [ ] What if the user lacks permission?
- [ ] Is there autosave or an explicit save button?
- [ ] What is the success state?
- [ ] Is there an optimistic update?

---

### ComponentFormModal (Surface: modal on design system components page)
**File:** `components/ComponentFormModal.tsx`
**Surface:** Modal on design system components
**Submission mechanism:** `fetch POST/PATCH` (inferred)

**Fields** (inferred):
| Field | Type | Required | Current validation |
|---|---|---|---|
| `name` | text | yes | Non-empty |
| `type` | select | yes | Component type enum |
| `config` | JSON textarea or structured form | no | Valid JSON |

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What if submission returns a 422?
- [ ] What if submission returns a 500?
- [ ] What if the user lacks permission?
- [ ] What is the success state?

---

## 11. CAP Forms

### CAPGenerateModal (Surface: modal on CAP dashboard)
**File:** `components/CAPGenerateModal.tsx`
**Surface:** Modal on `/company/[id]/social/cap` or similar
**Submission mechanism:** `fetch POST /api/platform/social/cap/generate`

**Fields:**
| Field | Type | Required | Current validation |
|---|---|---|---|
| `topics` | textarea | no | Free text; optional |
| `platforms` | checkbox group (all supported platforms) | yes | At least one must be selected |
| `count` | number (1–5) | yes | Range 1–5 (inferred from UI) |
| `company_id` | hidden | yes | From prop |

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What if submission returns a 422 (no platforms selected)?
- [ ] What if submission returns a 500?
- [ ] What if the user lacks permission?
- [ ] What if the AI quota is exhausted?
- [ ] What is the success state — overlay closes and posts appear in list?
- [ ] Is there an optimistic update?
- [ ] What does the error state look like for a generation timeout?

---

### PostScheduleSection (Surface: post detail page)
**File:** `components/PostScheduleSection.tsx`
**Surface:** Post detail page (schedule management section)
**Submission mechanism:** `fetch PATCH /api/platform/social/posts/[id]/schedule` (inferred)

**Fields** (inferred):
| Field | Type | Required | Current validation |
|---|---|---|---|
| `scheduled_at` | datetime picker | yes | Future date required |
| `mode` | select: schedule / recurring | yes | Enum |

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What if submission returns a 422 (past date)?
- [ ] What if submission returns a 500?
- [ ] What if the user lacks permission?
- [ ] What is the success state?
- [ ] Is there an optimistic update?
- [ ] Can a published post's schedule be edited?

---

*End of inventory.*
