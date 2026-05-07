# OPOLLO SITE BUILDER — ISSUES LOG

**Last updated:** 2026-05-07  
**Reporter:** Steven Morey  
**Status:** All issues marked CRITICAL must be resolved before V1 UAT

---

## RECURRING ISSUES (RAISED MULTIPLE TIMES — STILL NOT FIXED)

These issues have been reported multiple times in previous sessions and continue to recur. Root causes have NOT been addressed.

### 🔴 RECURRING-1: Post Editor Width Too Narrow

**Status:** Critical, recurring  
**Times reported:** 3+  
**Location:** `/admin/posts/new`

**Problem:**
Post editor uses `mx-auto max-w-4xl` which constrains content to 896px. WordPress backend uses much wider layout (~70-75% of viewport).

**Root cause hypothesis:**
- Shared layout component applying max-w-4xl globally
- OR: Tailwind class hardcoded in post editor specifically
- OR: Both — needs investigation

**Required fix:**
1. Find ALL instances of `max-w-4xl` in admin/post layouts
2. Replace with `max-w-7xl` or remove constraint
3. Match WordPress proportions exactly
4. Test at 1920px viewport: content area ~1200-1400px wide
5. **Document the fix to prevent recurrence**
6. Add visual regression test

**Reference:** WordPress backend HTML provided shows correct proportions

**Acceptance criteria:**
- Content area width at 1920px: 1200-1400px (NOT 896px)
- Side-by-side comparison with WordPress matches
- Cannot regress (test in CI)

---

### 🔴 RECURRING-2: Post-Publish Dead-End

**Status:** Critical, recurring  
**Times reported:** 2+  
**Location:** Post a blog → Publish to WordPress

**Problem:**
Click "Publish to WordPress" → Button shows "Saving..." → Nothing happens. No confirmation, no redirect, no feedback.

**Root cause hypothesis:**
- Missing success handler
- Missing redirect logic
- API call may succeed but UI doesn't react

**Required fix:**
1. Implement success handler with redirect to confirmation page
2. Create `/admin/posts/published/[postId]` confirmation page
3. Show: success message, post URL, optional iframe preview, action buttons
4. Handle errors gracefully (show retry option)
5. Test full flow end-to-end

**Acceptance criteria:**
- Click publish → see confirmation page within 2-3 seconds
- Confirmation shows post details and live URL
- "Post another" button works
- "View on WordPress" opens published post
- Error states show actionable messages

---

## CURRENT BATCH OF ISSUES (THIS SESSION)

### 🔴 ISSUE-1: Company Dashboard Missing Asset Overview

**Status:** Critical  
**Location:** `/admin/companies/[id]`

**Problem:**
Company detail page only shows:
- Company settings (slug, timezone, approval rules)
- Members list
- Pending invitations
- "Go to platform" button

**Missing:**
- Sites owned by company
- Brand assets (logos, colors, fonts, voice)
- Connected social accounts
- Posts count (by status)
- Media library count
- Activity feed

**Required fix:**
Build comprehensive company overview tab showing all owned assets in dashboard format.

**Acceptance criteria:**
- Overview tab is default landing
- Shows quick stats cards (sites, social, posts, media, team)
- Each section has list/preview + action button
- Clicking through navigates to scoped views

---

### 🔴 ISSUE-2: Sites Not Assigned to Companies

**Status:** Critical (data integrity)  
**Location:** `/admin/sites`

**Problem:**
7 sites in the list with no company association:
- testme
- Opollo testme
- Test Site 2
- LeadSource
- test1.leftleads.co
- testme (duplicate)
- add me

These sites are orphaned — no `company_id` assignment.

**Required fix:**
1. Audit all sites for missing `company_id`
2. Assign all orphaned sites to "Opollo Internal" company
3. Add `company_id NOT NULL` constraint on sites table
4. Add foreign key constraint to platform_companies
5. Update Sites list UI to show company column
6. Add company filter to Sites page
7. Enforce company assignment in site creation flow (auto-assign to current selected company)

**Acceptance criteria:**
- Zero sites with NULL company_id
- Cannot create site without company assignment
- Sites list shows company column
- Filtering by company works
- RLS prevents cross-company site access

---

### 🔴 ISSUE-3: Post Editor Width (SEE RECURRING-1)

This is the same recurring issue. See RECURRING-1 above.

---

### 🔴 ISSUE-4: Button Text Overflow

**Status:** Critical (UI quality)  
**Location:** Throughout application, specifically "PUBLISH TO WORDPRESS" button

**Problem:**
Button text doesn't fit nicely within button container. Looks unprofessional.

**Specific case:**
"PUBLISH TO WORDPRESS" button in post publish sidebar is too narrow for the text.

**Required fix:**
1. Audit EVERY button in entire application
2. Apply consistent padding standards (`px-4` or `px-6` minimum)
3. Use proper button component with auto-width
4. Test at multiple viewport sizes
5. Create button component standards document

**Pattern to enforce:**
```tsx
<Button variant="primary" size="md">
  {/* Text auto-fits with proper padding */}
  Publish to WordPress
</Button>
```

**Buttons to specifically check:**
- Publish to WordPress
- Save Draft
- Save as Draft
- Submit for Review
- Schedule for Later
- New Post
- Connect [Platform]
- Invite User
- Go to Platform
- All modal/dialog buttons
- All form submission buttons

**Acceptance criteria:**
- No button has text overflow or cramping
- All buttons use consistent component
- Padding/spacing standardized
- Cannot regress (visual regression test)

---

### 🔴 ISSUE-5: Post-Publish Dead-End (SEE RECURRING-2)

This is the same recurring issue. See RECURRING-2 above.

---

### 🔴 ISSUE-6: Error Display Pattern — Errors Hidden in Footer

**Status:** Critical (UX, error handling)  
**Location:** Throughout application, specifically post publish flow

**Problem:**
When errors occur, they're displayed at the **bottom of the page** in the footer area where users miss them. Specifically:
- Publishing a blog post returned 409 conflict error
- Error "The post was edited while you were publishing. Refresh and retry." appeared at bottom of page
- User had no idea publish failed
- This explains the "Saving... then nothing" pattern from RECURRING-2

**Debug context (from production):**
- Route: `/admin/posts/new`
- API: `POST /api/sites/[id]/posts/[postId]/publish` returned 409 in 8.8s
- User: hi@opollo.com (super_admin)
- Build: 198578a4b0f9b9437e15c2da3e6ddc9ebde09087

**Required fix — Global Notification System:**

#### Components to Build:
1. **NotificationBanner component**
   - Position: Top of page, below header, sticky
   - Variants: error, warning, success, info
   - Dismissible
   - Optional action button
   - Auto-dismiss for success after 5s

2. **NotificationProvider/Context**
   - Global notification state
   - `useNotification()` hook
   - Methods: showError, showSuccess, showWarning, showInfo
   - Queue management for multiple notifications

3. **Integration with all error sources:**
   - API errors (catch in queries/mutations)
   - Network errors
   - Permission errors (403)
   - Stale state errors (409)
   - Validation errors (where appropriate)
   - Session errors

#### Specific 409 Handling:
```tsx
catch (error) {
  if (error.status === 409) {
    showError('The post was edited while you were publishing.', {
      action: { 
        label: 'Refresh and retry', 
        onClick: () => refetchPost().then(retry) 
      },
      persistent: true
    });
  }
}
```

#### Audit Requirements:
- [ ] Find ALL current error display locations
- [ ] Identify all error sources (API, validation, network, etc.)
- [ ] Move all important errors to top banner
- [ ] Keep field-level validation errors inline
- [ ] Test all error scenarios

**Acceptance criteria:**
- Errors appear at TOP of page, not bottom
- Errors are visible without scrolling
- Errors persist until user dismisses or takes action
- Errors include clear next action where applicable
- 409 conflicts handled gracefully with refresh option
- Success messages also appear at top (and auto-dismiss)

**Performance concern:**
The publish endpoint took 8.8 seconds. Investigate:
- WordPress API call latency
- Database operations during publish
- Sync operations
- Add timeout handling and progress indicator

---

## PREVIOUSLY REPORTED CRITICAL ISSUES (FROM EARLIER SESSIONS)

### 🔴 ISSUE-A: Missing Company/Client Selector

**Status:** Critical, blocks UAT  
**Reference:** `docs/COMPANY_HIERARCHY_PROPOSAL.md` (if exists)

**Problem:**
No company/client dropdown to switch between client accounts (like Semrush has). Users can't tell which client they're working on.

---

### 🔴 ISSUE-B: Navigation Hierarchy Broken

**Status:** Critical  

**Problem:**
When in `/company/social/*` routes, the social submenu replaces the main platform navigation. Users get trapped in social section.

---

### 🔴 ISSUE-C: Calendar Date Inconsistency

**Status:** Critical  

**Problem:**
Calendar shows different months (May 2025 vs May 2026) on same route. State management broken.

---

### 🔴 ISSUE-D: Missing Profile Selection on Posts

**Status:** Critical  

**Problem:**
Post creation form missing profile/account selector. Can't choose which social accounts to post to.

---

### 🔴 ISSUE-E: Orphaned Assets (Multiple Tables)

**Status:** Critical (data integrity)  

**Problem:**
Sites, social accounts, posts, media all potentially have records without company_id assignment. Same root cause as ISSUE-2 but across all asset tables.

---

## ADDITIONAL CONCERNS RAISED

### Architecture & Hierarchy
> "We need to ensure that there is a dropdown throughout the application to show which client we are working on"

> "make sure that in the future we can setup new client companies and the hierarchy is set so each asset is for a company/brand/client"

> "So a Client has an account, they have a business, in that business is their brand, their social media, their assets like social posting etc. And social posts."

**Required hierarchy:**
```
Company (Client/Brand)
├── Users (with roles)
├── Sites/Domains
├── Brand Assets (logos, colors, fonts, voice)
├── Social Connections (LinkedIn, Facebook, X, GBP)
├── Social Posts
├── Media Library
├── Blog Posts
└── Activity/Audit Log
```

### Data Integrity
> "We need to run a script and assign every single asset to the opollo company"

**Required:**
- Audit script to find orphaned assets
- Migration script to assign to Opollo Internal
- Schema constraints to prevent future orphans
- RLS policies for company isolation

### UAT Readiness
> "I want to force it to build everything before UAT is complete"

**Required:**
- Stop accepting "marked as complete" without proper testing
- Fix all blockers before UAT
- No more deferring fixes to "V1.5"

---

## DEFINITION OF DONE

For ANY fix to be considered complete:

1. ✅ Root cause identified and addressed
2. ✅ Fix applied to ALL affected places (not just one instance)
3. ✅ Test added to prevent regression
4. ✅ Documentation updated
5. ✅ Verified in staging environment
6. ✅ Cannot recur (architectural prevention, not just patches)

---

## ANTI-PATTERNS TO AVOID

Based on patterns observed in previous fixes:

❌ Fixing one instance of a bug while leaving others untouched  
❌ Patching symptoms without fixing root causes  
❌ Marking complete without proper testing  
❌ Deferring fixes to future versions  
❌ Adding workarounds instead of solving issues  
❌ Inconsistent solutions across similar problems  
❌ Skipping documentation  

---

## REQUIRED DELIVERABLES

For complete remediation:

1. **Audit reports** (in `/docs`):
   - PLATFORM_INVENTORY.md
   - DATABASE_AUDIT.md
   - SECURITY_AUDIT.md
   - USER_JOURNEY_AUDIT.md
   - UI_CONSISTENCY_AUDIT.md
   - API_AUDIT.md
   - PERFORMANCE_AUDIT.md

2. **Database migrations** (in `/supabase/migrations`):
   - Data integrity fixes
   - Constraints and RLS
   - Table consolidation
   - Index optimization

3. **Code fixes** (across codebase):
   - All issues from this log
   - Component library updates
   - Layout standardization
   - Error handling improvements

4. **Tests** (in `/tests`):
   - End-to-end user journeys
   - Cross-company isolation
   - Visual regression
   - API endpoint tests

5. **Documentation updates**:
   - BUILD.md
   - Component library docs
   - Coding standards
   - API reference
