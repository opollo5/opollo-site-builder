# Forms and Validation

**Generated:** 2026-05-25 via codebase analysis.
**Status:** Phase 1 skeleton — field lists and validation rules extracted from source. `EXPECTED BEHAVIOUR` sections are empty for Steven to fill.

---

## Table of Contents

1. [Auth Forms](#auth-forms)
   - [Login Form](#login-form)
   - [Forgot Password Form](#forgot-password-form)
   - [Change Password Form](#change-password-form)
2. [Admin Forms](#admin-forms)
   - [Invite User Form](#invite-user-form)
3. [Social Composer Forms](#social-composer-forms)
   - [Create / Edit Draft (V2 composer)](#create--edit-draft-v2-composer)
   - [Scheduling Card](#scheduling-card)
   - [AI Assist Form](#ai-assist-form)
   - [UTM Builder Form](#utm-builder-form)
   - [Add-by-URL Media Form](#add-by-url-media-form)
4. [Approval / Review Forms](#approval--review-forms)
   - [External Approval Decision Form](#external-approval-decision-form)
   - [Viewer Link Create Form](#viewer-link-create-form)
   - [Approval Recipients Add Form](#approval-recipients-add-form)
5. [V1 Post List Forms](#v1-post-list-forms)
   - [Inline Post Create Form (V1 legacy)](#inline-post-create-form-v1-legacy)

---

## Platform Character Limits

Used across social composer validation:

| Platform | Max characters |
|----------|---------------|
| LinkedIn | 3,000 |
| Facebook | 63,206 |
| Instagram | 2,200 |
| X (Twitter) | 280 |
| Google Business Profile | 1,500 |
| Pinterest | 500 |
| TikTok | 2,200 |

**Source:** `lib/social/types.ts` — `PLATFORM_CHAR_LIMITS`; `lib/social/schemas/create-draft.ts`

---

## Auth Forms

### Login Form

**Surface:** `/login` — email + password sign-in
**File:** `components/LoginForm.tsx`
**Library:** React Server Actions + `useFormState` / `useFormStatus` (Next.js, not React Hook Form)

**Fields:**
| Field | Type | Validation | Required |
|-------|------|------------|---------|
| email | `<input type="email">` | HTML5 email validation; server-side: Supabase `signInWithPassword` | Yes |
| password | `<input type="password">` | None client-side; server validates via Supabase | Yes |
| next | `<input type="hidden">` | URL to redirect after successful login | System-set |

**Server-side validation:**
- `loginAction` server action in `app/login/actions.ts`
- On success: returns `{ redirectTo }` → client does `window.location.assign(state.redirectTo)` (hard navigation to force middleware session cookie re-read)
- On failure: returns `{ error }` string surfaced via `useFormState`

**Special notes:**
- `suppressHydrationWarning` on email + password inputs (Grammarly compatibility)
- Submit button disabled while `pending` (useFormStatus) or `isRedirecting`
- Uses `<form action={formAction}>` — works without JS (progressive enhancement)

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What error message is shown for wrong email/password?
- [ ] Is there a rate-limit on login attempts? What does the error message say?
- [ ] What is the default `?next=` redirect destination after login?
- [ ] Is "Forgot password?" link visible on this page?

---

### Forgot Password Form

**Surface:** `/auth/forgot-password`
**File:** `components/ForgotPasswordForm.tsx`
**Library:** Custom `useState` / `fetch` (no library)

**Fields:**
| Field | Type | Validation | Required |
|-------|------|------------|---------|
| email | `<input type="email">` | Non-empty; `POST /api/auth/forgot-password` validates format | Yes |

**Server-side validation:**
- `POST /api/auth/forgot-password`
- No-enumeration contract: response shape is identical whether email is registered or not
- On 200: form shows success copy ("check your inbox and spam") regardless of whether email exists
- On error codes:
  - `RATE_LIMITED` → "Too many reset requests for this email. Try again in a bit."
  - `VALIDATION_FAILED` → "Please enter a valid email address."
  - Other → raw `error.message` from server, or `Request failed (HTTP N).`

**Form states:**
- `idle` → `submitting` → `success` | `error`
- In `success` state: form is replaced by success copy
- In `submitting` state: button disabled

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What does the success copy say exactly?
- [ ] How long is the rate-limit window?
- [ ] Does the success state allow the user to try a different email without refreshing?

---

### Change Password Form

**Surface:** `/account/security`
**File:** `components/AccountSecurityForm.tsx`
**Library:** Custom `useState` / `fetch`

**Fields:**
| Field | Type | Validation | Required |
|-------|------|------------|---------|
| current | `<input type="password">` | Non-empty; verified against Supabase server-side | Yes |
| next (new password) | `<input type="password">` | `>= PASSWORD_MIN_LENGTH` chars; `validatePassword()` policy; must differ from current | Yes |
| confirm (repeat) | `<input type="password">` | Must equal `next`; mismatch shown inline when `confirm.length > 0` | Yes |

**Client-side validation (before submit):**
- `validatePassword(next)` from `lib/password-policy` — returns `{ ok: boolean, message: string }`
- `passwordStrengthHint(next)` — returns hint string shown to user as they type
- `mismatch = confirm.length > 0 && confirm !== next` — inline mismatch indicator
- `sameAsCurrent = next.length > 0 && next === current` — blocks same-password submit
- Submit disabled unless: `current.length > 0 && next.length >= PASSWORD_MIN_LENGTH && next === confirm && next !== current`

**Server-side validation:**
- `POST /api/account/security` (inferred)
- Re-validates policy + confirmation match + verifies current password against Supabase before update

**Server-side schema:** None found as a standalone Zod schema; logic is in the form + route handler.

**Form states:** `idle` | `submitting` | `success` | `error`

**On success:**
- Shows inline "Password updated" confirmation
- Clears all fields
- Session does NOT end (Supabase keeps refresh token valid across password change)

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What is `PASSWORD_MIN_LENGTH`? (Check `lib/password-policy.ts`)
- [ ] What does the password strength hint look like — text only, or with a visual meter?
- [ ] Does the mismatch indicator appear in real time while typing, or only on blur?
- [ ] What is the success copy?

---

## Admin Forms

### Invite User Form

**Surface:** `/admin/users` (within the admin panel)
**File:** `components/PendingInvitesTable.tsx` — table with row-level revoke; the invite create form is elsewhere
**Library:** Custom via DataTable + ConfirmDialog

**Note:** `PendingInvitesTable` handles the revoke action, not the create action. The create form is part of the users admin page (not a separate component in this file). The table rows represent pending invites.

**Revoke action:**
| Interaction | Validation | Required |
|-------------|------------|---------|
| Click "…" → Revoke | Opens ConfirmDialog | — |
| ConfirmDialog confirm | — | — |
| API call | `DELETE /api/admin/invites/[id]` | — |

**Invite row shape:**
```typescript
interface PendingInvite {
  id: string;
  email: string;
  role: "admin" | "user";
  invited_by_email: string | null;
  created_at: string;
  expires_at: string;
}
```

**Sub-components used:**
- `DataTable`, `ConfirmDialog`, `NavIcon`, `Pill`, `TableCell`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Where is the "Invite user" create form — same page, modal, or separate route?
- [ ] What roles can be assigned when inviting (`admin` and `user` only, or also `super_admin`)?
- [ ] What is the invite expiry duration (shown in `expires_at`)?
- [ ] Can a revoked invite be re-sent?

---

## Social Composer Forms

### Create / Edit Draft (V2 composer)

**Surface:** Triggered from any `/company/social/*` route via `?compose=new` or `?compose=[id]`
**File:** `components/social/composer/ComposerOverlay.tsx` + API schema `lib/social/schemas/create-draft.ts`
**Library:** Controlled React state (`useState`); Zod on the server

**Fields (controlled by ComposerOverlay state):**
| Field | Type | Validation | Required |
|-------|------|------------|---------|
| content | text | max 63,206 chars (Facebook limit); platform-specific limits enforced per-platform | Yes (for non-draft) |
| target_profile_ids | uuid[] | min 1 connection selected (for non-draft) | Yes (for non-draft) |
| media_urls | url[] | each item must be a valid URL | No |
| platform_variants | Record<platform, {content?, link?, cta?}> | per-platform content max 63,206; link must be URL; cta max 100 | No |
| mode | enum | `post_now` \| `schedule` \| `recurring` \| `draft` | Yes |
| scheduled_at_list | datetime[] | required when `mode = 'schedule'`; ISO 8601 UTC strings | Conditional |
| recurrence.rule | string | RFC 5545 RRULE; min 1 char; required when `mode = 'recurring'` | Conditional |
| recurrence.starting_at | datetime | ISO 8601 UTC; required when `mode = 'recurring'` | Conditional |
| recurrence.until | datetime | ISO 8601 UTC; optional end date | No |
| planned_for_at | datetime | ISO 8601 UTC; optional when `mode = 'draft'` | No |
| approval_required | boolean | — | Yes (default false) |
| approver_user_id | uuid | optional; not required even when `approval_required=true` | No |

**Server-side schema:** `CreateDraftSchema` in `lib/social/schemas/create-draft.ts`
- `POST /api/platform/social/drafts`

**PATCH (edit existing draft) — V2SaveBodySchema:**
| Field | Type | Notes |
|-------|------|-------|
| draft_version | int | Positive integer; used for optimistic concurrency (CAS). 409 `VERSION_CONFLICT` if stale |
| content | string | max 63,206 |
| media_urls | url[] | defaults to `[]` |
| target_profile_ids | uuid[] | defaults to `[]` |
| platform_variants | Record | same as create |
| mode | enum | `post_now` \| `schedule` \| `recurring` \| `draft` |
| scheduled_at | datetime \| null | single datetime (V2 path uses this not `scheduled_at_list`) |
| planned_for_at | datetime \| null | for draft mode |
| approval_required | boolean | default false |
| approver_user_id | uuid \| null | optional |

**PATCH endpoint:** `PATCH /api/platform/social/drafts/[id]`
- Returns 409 `VERSION_CONFLICT` when `draft_version` is stale
- Returns `INVALID_STATE` for terminal states (`published`, `publishing`)
- Requires `edit_post` permission in the draft's company

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is content required for `mode = 'post_now'`? Can the user post without any text (media only)?
- [ ] Is at least one profile required for `mode = 'post_now'` and `mode = 'schedule'`?
- [ ] What client-side error message is shown when `VERSION_CONFLICT` is returned?
- [ ] Are platform character limits shown as a counter in the editor?
- [ ] Can a user submit if the content exceeds the character limit for one platform but not others?

---

### Scheduling Card

**Surface:** Inside ComposerOverlay (bottom of left pane)
**File:** `components/social/composer/SchedulingCard.tsx`
**Library:** Controlled React state

**Fields:**
| Field | Type | Validation | Required |
|-------|------|------------|---------|
| mode | tab | `post_now` \| `schedule` \| `recurring` \| `draft` | Yes |
| scheduledTimes[] | date + time | At least one required when `mode = 'schedule'`; must be future | Conditional |
| recurrence.rule | RRULE string | RFC 5545 format; required when `mode = 'recurring'` | Conditional |
| recurrence.starting_at | date | Must be future; required when `mode = 'recurring'` | Conditional |
| recurrence.until | date | Optional; must be after `starting_at` | No |
| plannedForAt | date + time | Optional when `mode = 'draft'` | No |
| approvalRequired | boolean | — | Yes (default false) |

**Submit button label per mode:**
| Mode | Label |
|------|-------|
| `post_now` | Post now |
| `schedule` | Schedule post |
| `recurring` | Save schedule |
| `draft` | Save draft |

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Can multiple scheduled times be added for a single post (multi-slot scheduling)?
- [ ] What is the minimum scheduling lead time (must be N minutes in the future)?
- [ ] When `approvalRequired=true` but no `approver_user_id` is set, what happens — does the post go to a general queue?

---

### AI Assist Form

**Surface:** Inside ToolsRow in ComposerOverlay (AI panel)
**File:** `components/social/composer/ToolsRow.tsx`
**Library:** Custom `useState` / `fetch`

**Fields:**
| Field | Type | Validation | Required |
|-------|------|------------|---------|
| prompt | textarea | Non-empty; server enforces content policy | Yes |

**API call:** `POST /api/platform/social/cap/assist`

**Cost estimate:** Displayed to user before submission — calculated from prompt character count:
- Input: ~250 system tokens + `Math.ceil(promptChars / 4)` tokens
- Output: ~200 tokens assumed
- Model: claude-haiku-4-5 ($0.08/MTok input, $0.40/MTok output)

**Error categories and handling:**
| Category | User-facing behaviour |
|----------|-----------------------|
| `rate_limit` | Message + `retry_after` countdown if provided |
| `timeout` | Message + retry button (if `can_retry=true`) |
| `content_rejected` | Message (no retry) |
| `invalid_request` | Message (no retry) |
| `network` | Message + retry button |
| `overloaded` | Message + retry button |
| `unknown` | Message + retry button |

**data-testid values:**
- `ai-trace-id` — trace ID badge (for error reporting)

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What is the rate limit (requests per minute per user or per company)?
- [ ] Does the AI result replace the current content or insert at cursor position?
- [ ] Is the cost estimate visible to all users or only super_admin?
- [ ] Can the user adjust the AI output before inserting?

---

### UTM Builder Form

**Surface:** Inside ToolsRow in ComposerOverlay (UTM panel)
**File:** `components/social/composer/UtmBuilderPanel.tsx` (referenced from ToolsRow)
**Library:** Custom controlled state

**Fields (inferred from UTM standard):**
| Field | Type | Validation | Required |
|-------|------|------------|---------|
| utm_source | text | Non-empty | Yes |
| utm_medium | text | — | No |
| utm_campaign | text | — | No |
| utm_term | text | — | No |
| utm_content | text | — | No |

**On submit:** Builds a UTM-tagged URL and calls `onInsertText(url)` to insert into editor.

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Does the UTM builder append to an existing URL in the editor, or insert a new URL?
- [ ] Are the UTM parameters pre-populated from any company settings?

---

### Add-by-URL Media Form

**Surface:** Inside MediaLibraryClient at `/company/social/media` (and inside composer MediaTray)
**File:** `components/MediaLibraryClient.tsx` (inline form toggled by showForm state)
**Library:** Custom `useState` / `fetch`

**Fields:**
| Field | Type | Validation | Required |
|-------|------|------------|---------|
| url | `<input type="url">` | Must be a valid URL (HTML5 + server validates `z.string().url()`) | Yes |

**API call:** `POST /api/platform/social/media`

**On success:** Added asset appears at the top of the asset grid; form clears.

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What happens when the URL is a non-image (e.g. a PDF)?
- [ ] Is there a max file size for remote-URL assets?
- [ ] Does the API download and re-host the image, or just store the URL reference?

---

## Approval / Review Forms

### External Approval Decision Form

**Surface:** `/viewer/[token]` — magic-link approver page (public, no auth required)
**File:** `components/ApprovalDecisionForm.tsx`
**Library:** Custom `useState` / `fetch`

**Fields:**
| Field | Type | Validation | Required |
|-------|------|------------|---------|
| decision | button group | `approved` \| `rejected` \| `changes_requested` | Yes (one button click) |
| comment | textarea | Required when `decision = 'rejected'`: min 30, max 500 chars (server enforces via `ApproveSchema`) | Conditional |

**Server-side schema:** `ApproveSchema` in `lib/social/schemas/approve.ts`
```
- decision: enum("approved" | "rejected")
- rejection_reason?: string
  - Required when decision = "rejected"
  - Min 30 chars
  - Max 500 chars
```

**Note:** `changes_requested` is a client-side Decision type but does NOT appear in `ApproveSchema`. The server schema only accepts `approved` | `rejected`. This discrepancy may indicate `changes_requested` maps to `rejected` at the API layer, or uses a separate code path.

**API call:** `POST /api/approve/[token]/decision`

**States:**
- Form idle: three decision buttons + comment textarea (always visible)
- Submitting: selected button shows loading; others disabled
- Done: "thanks" confirmation panel (replaces form)
- Error: inline error message (form remains)
- `alreadyDecided=true`: "This request has already been resolved" panel (no form rendered)

**data-testid values:**
- `approval-already-decided` (line 50) — "already resolved" panel

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is the comment textarea always visible, or only shown after choosing "Reject"?
- [ ] Can an approver re-open a decided approval request?
- [ ] What does the "thanks" confirmation panel say for each decision type?
- [ ] Does the `changes_requested` decision actually call the same `/api/approve/[token]/decision` endpoint? If so, what `decision` value is sent?
- [ ] Does the rejection reason text appear in the post detail page for the editor?

---

### Viewer Link Create Form

**Surface:** `/company/social/sharing` — inside ViewerLinksManager
**File:** `components/ViewerLinksManager.tsx` (inline form toggled by `adding` state)
**Library:** Custom `useState` / `fetch`

**Fields:**
| Field | Type | Validation | Required |
|-------|------|------------|---------|
| recipient_email | `<input type="email">` | Optional; trimmed to null if empty | No |
| recipient_name | text | Optional; trimmed to null if empty | No |

**Server-side validation:**
- `POST /api/platform/social/viewer-links`
- Body: `{ company_id, recipient_email: string | null, recipient_name: string | null }`

**On success:**
- New link row added to table
- One-time URL shown inline for copy (never stored client-side after this)
- Form fields clear

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Can a link be created with no email and no name (fully anonymous)?
- [ ] Is there a maximum number of active viewer links per company?
- [ ] What is the default expiry period for new links?

---

### Approval Recipients Add Form

**Surface:** `/company/social/posts/[id]` — inside PostApprovalSection (when `canManage=true`)
**File:** `components/PostApprovalSection.tsx` (inline form)
**Library:** Custom `useState` / `fetch`

**Fields:**
| Field | Type | Validation | Required |
|-------|------|------------|---------|
| email | `<input type="email">` | Non-empty; server validates format | Yes |
| name | text | Optional | No |

**API call:** `POST /api/platform/social/posts/{postId}/recipients`

**On success:** New recipient row added to the list; form fields clear.

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Does adding a recipient immediately send them an email notification?
- [ ] Can the same email be added twice to the same approval request?
- [ ] What is the maximum number of recipients per approval request?

---

## V1 Post List Forms

### Inline Post Create Form (V1 legacy)

**Surface:** `/company/social/posts` — when `useComposerFlow=false` (legacy path)
**File:** `components/SocialPostsListClient.tsx`
**Library:** Custom controlled state

**Note:** This is the V1 inline create form. As of Spec 22, when `useComposerFlow=true`, "New post" opens `?compose=new` instead of this inline form. The inline form is still present for the legacy path.

**Fields (V1 minimal):**
| Field | Type | Validation | Required |
|-------|------|------------|---------|
| master_text | textarea | No character limit enforced client-side in V1 | No |
| link_url | `<input type="url">` | Optional URL | No |

**API call:** `POST /api/platform/social/posts`

**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] Is the V1 inline form still reachable in production, or has `useComposerFlow=true` been set everywhere?
- [ ] What validation does the V1 post create API apply to `master_text`?
