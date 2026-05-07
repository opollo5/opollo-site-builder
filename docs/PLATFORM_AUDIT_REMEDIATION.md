# OPOLLO SITE BUILDER — FULL PLATFORM AUDIT & REMEDIATION

**MISSION:** Conduct an exhaustive audit of the entire Opollo Site Builder platform. Identify and fix ALL issues including those previously reported but never resolved. Execute autonomously without checkpoints. Do not present partial work.

---

## CRITICAL CONTEXT FOR CLAUDE CODE

**You are being deployed because previous fixes have failed.** Issues have been raised multiple times and keep recurring. Steven's frustration is at maximum level. This is not a small bug fix — this is a comprehensive platform remediation.

**The pattern that must stop:**
- Issues get "fixed" but recur in different forms
- Surface-level fixes that don't address root causes
- Inconsistencies between admin panel and customer-facing views
- Data integrity problems (orphaned assets, missing company associations)
- UX dead-ends (clicking buttons that go nowhere)
- Recurring layout/styling issues that should be solved system-wide

**Your job:** Find every instance of every problem, fix root causes, prevent recurrence.

---

## EXECUTION MODE: FULL AUTONOMOUS AUDIT + REMEDIATION

You will execute 12 phases sequentially without interruption. Work silently. Present comprehensive final report only when ALL phases complete.

**The only exception:** Stop only if you discover something that would cause irreversible production data loss. Otherwise: keep going.

---

## CONFIRMED ISSUES TO FIX (FROM RECENT REPORTS)

### Issue #1: Company Dashboard Missing Asset Overview
**Location:** `/admin/companies/[id]`
**Problem:** Company detail page only shows settings and members. No overview of company's:
- Sites
- Brand assets
- Social accounts
- Posts (count by status)
- Media library
- Team members count

**Fix:** Build comprehensive company overview with all owned assets in a dashboard view.

### Issue #2: Sites Not Assigned to Companies
**Location:** `/admin/sites`
**Problem:** Sites table shows 7 sites with no company association. Orphaned data.
**Fix:**
- Audit all sites for missing `company_id`
- Assign all orphaned sites to "Opollo Internal" company
- Add `company_id NOT NULL` constraint
- Update Sites list UI to show company column
- Add company filter to Sites page
- Enforce company assignment in site creation flow

### Issue #3: Post Editor Width — RECURRING CRITICAL BUG
**Location:** `/admin/posts/new`
**Problem:** Post editor uses `mx-auto max-w-4xl` (896px width). User has reported this MULTIPLE TIMES. Must look like WordPress backend.
**Fix:**
- Find ALL instances of `max-w-4xl` in editor/admin layouts
- Replace with `max-w-7xl` or remove constraint
- Match WordPress editor proportions: ~70-75% viewport for content, ~25-30% for sidebar
- Test at 1920px viewport: content area should be ~1200-1400px wide, NOT 896px
- Compare side-by-side with WordPress backend
- Document the fix to prevent recurrence

**Reference:** WordPress backend HTML provided shows correct proportions. Match this exactly.

### Issue #4: Button Text Overflow
**Location:** All buttons throughout application, specifically "PUBLISH TO WORDPRESS"
**Problem:** Button text doesn't fit nicely within button containers
**Fix:**
- Audit EVERY button in entire application
- Apply consistent padding (`px-4` or `px-6` minimum)
- Ensure auto-width or sufficient fixed width
- No hardcoded narrow widths
- Test at multiple viewport sizes
- Create button component standards (if not exists)

### Issue #5: Post-Publish Dead-End Flow — RECURRING
**Location:** Post a blog → Publish to WordPress
**Problem:** User clicks publish, sees "Saving...", then nothing. No confirmation, no next step.
**Fix:**
- Implement success handler with redirect
- Create confirmation page showing:
  - Success message with site name
  - WordPress URL link
  - Optional iframe preview
  - Post metadata
- Provide clear CTAs: View on WordPress, Post another, Edit, Back to list
- Handle error states gracefully
- Test full publish flow end-to-end

### Issue #6: Error Display Pattern — Errors Hidden in Footer
**Location:** Throughout application
**Problem:** Errors appear at bottom of page where users miss them. 409 conflict errors during publish are hidden in footer.

**Debug context:**
- POST /api/sites/[id]/posts/[postId]/publish returned 409 in 8.8s
- Error message hidden at bottom of page
- User has no idea publish failed
- This is part of why publish flow appears broken

**Fix:**
- Build global NotificationBanner component (top of page, sticky)
- Build NotificationProvider with useNotification() hook
- Variants: error, warning, success, info
- Move ALL errors from footer/inline to top banner (except field validation)
- Implement proper 409 conflict handling with refresh action
- Investigate 8.8 second publish time (performance issue)
- Add timeout handling and progress indicators

**Acceptance criteria:**
- Errors visible at TOP of page without scrolling
- Errors include clear next action
- 409 conflicts gracefully handled
- Success messages auto-dismiss after 5s
- Banner system used consistently across application

---

## PREVIOUSLY REPORTED ISSUES (FROM EARLIER SESSIONS)

### Critical: Company Hierarchy & Client Selector
- Missing company/client selector throughout application
- Navigation hierarchy broken (social menu replaces main nav)
- Calendar date inconsistency
- Missing profile selection on post creation
- Orphaned assets without company ownership

(Reference: `docs/COMPANY_HIERARCHY_PROPOSAL.md` and `AUTONOMOUS_FIX_PROMPT.md` if they exist)

---

## FULL AUDIT PHASES (EXECUTE ALL)

### PHASE 1: COMPLETE PLATFORM INVENTORY

Walk through and document:
- [ ] Every route in the application
- [ ] Every page/component
- [ ] Every API endpoint
- [ ] Every database table and its relationships
- [ ] Every form and its validation
- [ ] Every button and its action
- [ ] Every data flow between layers

**Output:** `docs/PLATFORM_INVENTORY.md` with complete map.

---

### PHASE 2: DATABASE INTEGRITY AUDIT

#### 2.1 Schema Audit
For every table, check:
- [ ] Has `company_id` foreign key (if company-scoped)
- [ ] Has NOT NULL constraints where required
- [ ] Has proper foreign key constraints with CASCADE rules
- [ ] Has appropriate indexes for query performance
- [ ] Has RLS policies enabled and enforced
- [ ] Has audit columns (created_at, updated_at, created_by)
- [ ] Has soft delete capability where needed

#### 2.2 Data Integrity Audit
For every company-scoped table:
- [ ] Count rows with NULL company_id (orphaned)
- [ ] Count rows pointing to non-existent companies
- [ ] Count rows with invalid foreign keys
- [ ] Identify duplicate records that should be unique
- [ ] Find inconsistent status values

**Tables to audit (minimum):**
- platform_companies
- platform_users
- platform_company_users
- sites
- social_connections
- social_post_master
- social_post_variants
- social_media_library
- social_scheduled_posts
- blog_posts (if exists)
- post_batches (if exists)
- images / media (if separate from social_media_library)
- brand_assets (if exists)
- audit_logs
- system_jobs

#### 2.3 Database Normalization Review
- [ ] Identify tables that should be merged
- [ ] Identify tables that should be split
- [ ] Identify denormalized data causing inconsistency
- [ ] Identify missing junction tables for many-to-many
- [ ] Check for proper use of UUIDs vs auto-increment IDs

#### 2.4 Migration Plan
Create comprehensive migration plan to:
1. Fix orphaned data (assign to Opollo Internal)
2. Add missing constraints
3. Update RLS policies to enforce company scoping
4. Add missing indexes
5. Consolidate duplicate tables
6. Document each migration with rollback

**Output:**
- `docs/DATABASE_AUDIT.md` with findings
- `supabase/migrations/[timestamp]_data_integrity_fix.sql`
- `supabase/migrations/[timestamp]_constraints_and_rls.sql`
- `supabase/migrations/[timestamp]_table_consolidation.sql`

---

### PHASE 3: SECURITY AUDIT

#### 3.1 Authentication & Authorization
- [ ] Verify all routes have proper auth checks
- [ ] Verify RLS policies prevent cross-company data access
- [ ] Test that non-staff users cannot access other companies' data
- [ ] Test that customer users cannot access admin routes
- [ ] Verify session management (timeout, refresh, logout)
- [ ] Check for any hardcoded credentials or secrets

#### 3.2 Data Leak Prevention
For every API endpoint, verify:
- [ ] Returns only data scoped to current user's company
- [ ] Validates user has permission for requested operation
- [ ] Sanitizes inputs to prevent injection
- [ ] Uses parameterized queries (Supabase does this automatically)
- [ ] Doesn't expose internal IDs in error messages

#### 3.3 Cross-Company Test Scenarios
Test these scenarios programmatically:
1. User from Company A tries to GET /api/sites/[site_id] where site belongs to Company B → should return 403/404
2. User from Company A tries to POST a social post with company_id of Company B → should be rejected
3. Customer user tries to access /admin/* routes → should be redirected
4. Logged out user tries to access protected routes → should be redirected to login
5. Magic link tokens for approval — verify they're scoped and time-limited
6. File uploads — verify they're scoped to company and user can't upload to other companies

**Output:** `docs/SECURITY_AUDIT.md` with findings and fixes.

---

### PHASE 4: USER JOURNEY AUDIT

For each user role, walk through complete journeys:

#### 4.1 Opollo Staff User Journeys
- [ ] Login → Dashboard → Switch companies → Create site → Add social account → Schedule post → Approve post → View analytics
- [ ] Login → Companies list → Select company → View company assets → Invite user → Manage permissions
- [ ] Login → Sites list → Create site → Configure → Test publishing
- [ ] Login → Post a blog → Select site → Write content → Publish → See confirmation → Go to next action
- [ ] Login → Social → Posts → Create draft → Add profiles → Schedule → Get approved → Verify published
- [ ] Login → Social → Calendar → Navigate months → View scheduled posts → Edit a post → Reschedule

#### 4.2 Customer User Journeys (e.g., Vincovi Admin)
- [ ] Login → See only Vincovi data → Cannot switch to other companies
- [ ] View social posts → Approve/reject pending posts
- [ ] View sites → Cannot access admin routes
- [ ] View company users → Add team member with appropriate role
- [ ] Logout → Verify session cleared

#### 4.3 External Approver (Magic Link)
- [ ] Receive magic link email
- [ ] Click link → See post snapshot
- [ ] Approve / Request changes / Reject
- [ ] Verify token expires after use
- [ ] Verify token expires after time limit
- [ ] Cannot access other posts via URL manipulation

**For each journey, document:**
- Step-by-step actions
- Expected outcome
- Actual outcome
- Bugs found
- UX friction points
- Dead-ends

**Output:** `docs/USER_JOURNEY_AUDIT.md` with findings.

---

### PHASE 5: UI/UX CONSISTENCY AUDIT

#### 5.1 Layout Consistency
- [ ] Audit all page widths — find every `max-w-*` class usage
- [ ] Document which pages use which width (post editor should be wider than post list)
- [ ] Standardize layout widths by page type
- [ ] Fix Issue #3: post editor must match WordPress proportions

#### 5.2 Button Audit (Issue #4)
For every button in the application:
- [ ] Check text fits within button
- [ ] Check padding is consistent (px-4 or px-6 minimum)
- [ ] Check height is consistent (h-10 or h-11 standard)
- [ ] Check icon alignment if button has icon
- [ ] Check disabled states render correctly
- [ ] Check loading states show spinner/text properly

**Create button component library if not exists:**
```tsx
<Button variant="primary" size="md">Publish to WordPress</Button>
<Button variant="secondary" size="md">Save Draft</Button>
<Button variant="danger" size="md">Delete</Button>
```

#### 5.3 Form Consistency
- [ ] All forms use same input/textarea/select styling
- [ ] All forms have consistent label positioning
- [ ] All forms show validation errors consistently
- [ ] All forms have consistent submit button placement
- [ ] All forms handle loading/error states

#### 5.4 Navigation Consistency
- [ ] Main nav present on ALL admin/platform routes
- [ ] Sub-navigation appears correctly when nested
- [ ] Active route highlighted consistently
- [ ] Breadcrumbs where appropriate
- [ ] Back buttons or clear navigation paths

#### 5.5 Color/Typography Consistency
- [ ] Use design tokens, not hardcoded colors
- [ ] Consistent typography scale
- [ ] Consistent spacing scale
- [ ] Dark mode considerations (if applicable)

**Output:** `docs/UI_CONSISTENCY_AUDIT.md` and refactored components.

---

### PHASE 6: ENDPOINT AUDIT

For every API endpoint:

#### 6.1 Endpoint Inventory
List all endpoints with:
- HTTP method
- Path
- Purpose
- Auth requirements
- Parameters
- Response schema
- Error responses

#### 6.2 Endpoint Testing
For each endpoint:
- [ ] Auth check works (401 if not logged in)
- [ ] Authorization check works (403 if not allowed)
- [ ] Input validation works (400 if invalid)
- [ ] Returns correct data structure
- [ ] Handles errors gracefully (500 with logged details)
- [ ] Proper HTTP status codes
- [ ] Proper CORS headers if needed
- [ ] Rate limiting where appropriate

#### 6.3 Endpoint Standardization
- [ ] Consistent response format (envelope vs raw)
- [ ] Consistent error format
- [ ] Consistent pagination pattern
- [ ] Consistent filtering/sorting parameters

**Output:** `docs/API_AUDIT.md` and OpenAPI spec if possible.

---

### PHASE 7: PUBLISH FLOW DEEP DIVE (Issue #5)

The "Post a blog → Publish to WordPress" flow is broken. Fix completely:

#### 7.1 Backend Flow
- [ ] Verify WordPress API integration works
- [ ] Verify error handling for WordPress API failures
- [ ] Verify post is saved to database before WordPress call
- [ ] Verify status is updated after successful publish
- [ ] Verify error states are persisted (so user sees them)

#### 7.2 Frontend Flow
- [ ] Click publish → loading state shows
- [ ] On success → redirect to confirmation page
- [ ] On error → show error message with retry option
- [ ] Don't allow double-submission
- [ ] Disable form during submission

#### 7.3 Confirmation Page
Create `/admin/posts/published/[postId]` page showing:
- Success message
- Post title and URL
- Iframe preview of WordPress post (if URL available)
- Site name
- Published timestamp
- Action buttons:
  - View on WordPress (opens new tab)
  - Post another (returns to /admin/posts/new)
  - Edit this post (returns to editor)
  - Back to posts list

#### 7.4 Posts List Page
Verify `/admin/posts` shows:
- All recent posts
- Status (draft, published, failed)
- Site name
- Published date
- Quick actions (view, edit, delete)
- Filter by site, status, date range
- Search by title

**Output:** Working publish flow with full confirmation page.

---

### PHASE 8: COMPANY DASHBOARD ENHANCEMENT (Issue #1)

Build comprehensive company detail page:

```
/admin/companies/[companyId]
├── Header: Company name, slug, badge (Internal/Customer)
├── Tabs:
│   ├── Overview (NEW - default)
│   ├── Settings (existing)
│   ├── Members (existing)
│   └── Activity (NEW)
├── Overview Tab:
│   ├── Quick Stats Cards:
│   │   - Sites (count + link)
│   │   - Social accounts (count by platform)
│   │   - Posts (scheduled + published counts)
│   │   - Media items (count)
│   │   - Team members (count)
│   ├── Sites Section:
│   │   - List of sites with status
│   │   - "Add new site" button
│   ├── Brand Assets Section:
│   │   - Logo, colors, fonts, voice
│   │   - "Edit brand" button
│   ├── Social Accounts Section:
│   │   - Connected platforms grouped
│   │   - Connection status
│   │   - "Connect new account" button
│   ├── Recent Activity Section:
│   │   - Last 10 actions in this company
│   │   - Filter by activity type
```

**Required components:**
- StatsCard
- AssetSection
- ActivityFeed
- BrandPreview

---

### PHASE 9: PERFORMANCE AUDIT

#### 9.1 Frontend Performance
- [ ] Lighthouse audit on key pages
- [ ] Bundle size analysis
- [ ] Identify large imports
- [ ] Code splitting opportunities
- [ ] Image optimization
- [ ] Font loading strategy

#### 9.2 Backend Performance
- [ ] Identify slow database queries
- [ ] Add missing indexes
- [ ] Identify N+1 query problems
- [ ] Add caching where appropriate
- [ ] Background job optimization

#### 9.3 Database Performance
Run EXPLAIN ANALYZE on common queries:
- Get all posts for a company
- Get calendar view for a month
- Get connected social accounts
- Get media library items
- Get user's accessible companies

Add indexes for frequently queried columns:
- `company_id` on all asset tables
- `created_at` for sorting
- `status` for filtering
- Composite indexes for common query patterns

**Output:** `docs/PERFORMANCE_AUDIT.md` with optimizations.

---

### PHASE 10: ERROR HANDLING & MONITORING

#### 10.1 Error Boundaries
- [ ] Add React Error Boundaries to all major route segments
- [ ] Graceful error pages (not white screen)
- [ ] Log errors to Sentry/monitoring

#### 10.2 API Error Handling
- [ ] All API routes return structured errors
- [ ] All API errors logged with context
- [ ] User-friendly error messages on frontend
- [ ] Retry logic for transient failures

#### 10.3 Background Job Monitoring
- [ ] Failed jobs are visible in admin
- [ ] Retry mechanism for failed jobs
- [ ] Alert on high failure rate
- [ ] Dead letter queue for permanently failed jobs

---

### PHASE 11: TESTING & VALIDATION

#### 11.1 Critical User Flow Tests
Run end-to-end on these scenarios:

**Scenario A: Create site → Publish blog**
1. Login as Opollo staff
2. Navigate to Sites → New Site
3. Connect WordPress site
4. Verify site appears in list with company association
5. Navigate to Post a blog
6. Select the new site
7. Write content with title
8. Click "Publish to WordPress"
9. Verify confirmation page appears
10. Click "View on WordPress" — verify post is live
11. Return to posts list — verify post appears with "Published" status

**Scenario B: Social post lifecycle**
1. Login as Opollo staff
2. Select Vincovi company in selector
3. Navigate to Social → Connections
4. Verify Vincovi's connections show
5. Navigate to Social → Posts → New Post
6. Select profiles (LinkedIn + X)
7. Write content
8. Schedule for tomorrow 9am
9. Submit for approval
10. Generate magic link
11. Open magic link in incognito
12. Approve the post
13. Verify post moves to "Approved" status
14. Wait for scheduled time
15. Verify post publishes to LinkedIn and X
16. Check analytics for the post

**Scenario C: Cross-company isolation**
1. Login as Vincovi customer user
2. Verify only see Vincovi data
3. Try to access /company/[ascii_group_id]/social/posts via URL
4. Verify blocked (403 or redirect)
5. Try API call with different company_id
6. Verify rejected
7. Logout
8. Try to access /admin route
9. Verify redirect to login

**Scenario D: Post a blog confirmation flow (Issue #5)**
1. Login as Opollo staff
2. Post a blog
3. Click Publish to WordPress
4. Verify loading state
5. Verify redirect to confirmation page
6. Verify all elements present (preview, links, CTAs)
7. Click "Post another"
8. Verify clean form
9. Test error case (disconnect WP) — verify error message appears

**Scenario E: Width/Layout (Issue #3)**
1. Login at 1920px viewport
2. Navigate to Post a blog
3. Inspect content area width
4. Verify > 1200px (NOT 896px)
5. Compare side-by-side with WordPress backend screenshot
6. Verify proportions match

**Scenario F: Button Audit (Issue #4)**
1. Take screenshots of every page with buttons
2. Verify all button text fits within buttons
3. Verify consistent padding
4. Test at 1280px, 1440px, 1920px viewports
5. No truncation or overflow

#### 11.2 Regression Test Suite
Create automated tests for:
- All scenarios above
- Previously fixed bugs (so they don't recur)
- Critical paths (login, post, publish, approve)

**Output:** Test results + fixes for any failures.

---

### PHASE 12: DOCUMENTATION & PREVENTION

#### 12.1 Update BUILD.md
Document:
- Current architecture
- All layers and their responsibilities
- Key decisions and patterns
- Known issues and workarounds
- Roadmap for V1.5+

#### 12.2 Component Library Documentation
Document standard components:
- Button (with variants and sizes)
- Input fields
- Form components
- Modal/Dialog
- Toast/Notification
- Loading states
- Error states
- Empty states

#### 12.3 Standards Documentation
Create `docs/CODING_STANDARDS.md`:
- Layout widths (when to use what)
- Color usage
- Spacing
- Typography
- Component composition rules
- API patterns
- Database patterns

#### 12.4 Prevention Mechanisms
- [ ] ESLint rules for common mistakes
- [ ] Pre-commit hooks for type checking
- [ ] CI checks for accessibility
- [ ] Automated visual regression tests
- [ ] Database constraint tests

**Output:** Updated documentation throughout.

---

## ADDITIONAL ITEMS TO CONSIDER (THINK CRITICALLY)

Beyond the explicit issues, audit for these:

### Data Architecture
- [ ] Is there a clear separation between platform data (companies, users) and tenant data (their content)?
- [ ] Are there proper boundaries between layers (L1-L7, Platform)?
- [ ] Is data flow predictable and traceable?
- [ ] Are there any circular dependencies?

### Multi-tenancy
- [ ] Can the platform truly support multiple customer companies safely?
- [ ] Are there any shared resources that could leak data?
- [ ] Is tenant isolation enforced at database, API, and UI levels?

### Audit Trail
- [ ] Every important action logged?
- [ ] Logs include who, what, when, why?
- [ ] Logs are queryable and filterable?
- [ ] Logs are retained appropriately?

### Backup & Recovery
- [ ] Database backups configured?
- [ ] Tested recovery process?
- [ ] Point-in-time recovery available?
- [ ] Rollback strategy for failed deployments?

### Compliance & Privacy
- [ ] User data handling complies with privacy laws (GDPR, etc.)?
- [ ] Data retention policies defined?
- [ ] User data deletion capability?
- [ ] PII identified and protected?

### Onboarding & Empty States
- [ ] First-time user experience polished?
- [ ] Empty states guide users to next action?
- [ ] Help text and tooltips where needed?
- [ ] Error messages actionable?

### Mobile Responsiveness
- [ ] Admin works on mobile?
- [ ] Approval flow works on mobile (magic link)?
- [ ] Calendar view responsive?
- [ ] Forms usable on touch devices?

### Accessibility
- [ ] Keyboard navigation works?
- [ ] Screen reader compatible?
- [ ] Color contrast sufficient?
- [ ] Focus states visible?

### Internationalization (Future-proofing)
- [ ] Strings extractable for translation?
- [ ] Date/time formatting respects locale?
- [ ] Timezone handling correct?

---

## SELF-VERIFICATION CHECKLIST

Before presenting final report, verify:

### Issue Resolution
- [ ] All 5 explicitly reported issues fixed and tested
- [ ] All previously reported issues fixed and tested
- [ ] Fix prevents recurrence (root cause addressed)

### Database
- [ ] Zero orphaned records
- [ ] All constraints applied
- [ ] All RLS policies verified
- [ ] Migrations tested with rollback

### Security
- [ ] Cross-company isolation verified
- [ ] Auth/authz checked on all routes
- [ ] No data leaks in API responses
- [ ] Session management secure

### UI/UX
- [ ] All buttons have proper text fit
- [ ] All layouts use correct widths
- [ ] All flows have clear success/error states
- [ ] Navigation consistent

### Testing
- [ ] All critical user journeys pass
- [ ] No console errors
- [ ] No broken links
- [ ] Performance acceptable

### Documentation
- [ ] BUILD.md updated
- [ ] Standards documented
- [ ] Component library documented
- [ ] Migration plan documented

---

## FINAL REPORT FORMAT

```markdown
# OPOLLO PLATFORM AUDIT — FINAL REPORT

## Executive Summary
- Total issues found: X
- Issues fixed: Y
- Critical bugs resolved: Z
- Database changes: A
- Files modified: B
- New components created: C
- Tests added: D
- Ready for production: YES / NO

## Phase Completion
[Status for all 12 phases]

## Critical Issues Resolution

### Issue #1: Company Dashboard Missing Asset Overview
- Status: FIXED
- Root cause: [explanation]
- Fix applied: [description]
- Files changed: [list]
- Tests added: [list]

[Repeat for issues #2-#5 and any others discovered]

## Database Changes Summary
- Orphaned records found: X
- Records migrated: Y
- Constraints added: Z
- RLS policies updated: A
- Tables consolidated: B
- Indexes added: C

## Security Findings
- Vulnerabilities found: X
- Vulnerabilities fixed: Y
- Cross-company isolation: VERIFIED
- Test scenarios passed: Z/Z

## UI/UX Improvements
- Buttons audited: X
- Buttons fixed: Y
- Layouts standardized: Z
- New component library: [link]

## Performance Improvements
- Slow queries optimized: X
- Indexes added: Y
- Bundle size reduction: Z%
- Page load improvement: A%

## User Journey Test Results
- Scenario A (Create site → Publish blog): PASS / FAIL
- Scenario B (Social post lifecycle): PASS / FAIL
- Scenario C (Cross-company isolation): PASS / FAIL
- Scenario D (Publish confirmation flow): PASS / FAIL
- Scenario E (Editor width): PASS / FAIL
- Scenario F (Button audit): PASS / FAIL

## Documentation Updates
[List all docs created or updated]

## Known Limitations / Deferred Items
[Anything that couldn't be fixed in this round]

## Deployment Plan
1. [Step-by-step deployment instructions]
2. [Rollback procedure]
3. [Post-deployment validation]

## Next Steps for Steven
1. Review this report
2. Test in staging
3. Approve deployment
4. Monitor post-deployment

## Files Changed
- Created: X files
- Modified: Y files
- Deleted: Z files

PR ready: [URL or "Ready to create"]
Branch: [branch name]
```

---

## CRITICAL RULES

1. **DO NOT STOP** — Execute all 12 phases without interruption
2. **DO NOT ASK** — Make decisions autonomously based on best practices
3. **DO NOT REPORT PROGRESS** — Work silently, present comprehensive final report only
4. **DO FIX ROOT CAUSES** — Not just symptoms
5. **DO PREVENT RECURRENCE** — Add tests, constraints, documentation
6. **DO TEST THOROUGHLY** — Every fix must be verified
7. **DO DOCUMENT EVERYTHING** — Future you needs to understand decisions

## EXCEPTION: WHEN TO STOP

Only stop if:
- Migration would delete production data (not just assign)
- Discovery of critical security breach in progress
- Required external service credentials missing

Otherwise: KEEP GOING.

---

## START COMMAND

Respond with: "PLATFORM AUDIT EXECUTION STARTING - FULL REMEDIATION"

Then execute all 12 phases silently.

Present final report only when ALL phases complete and ALL self-verification items pass.

This is the comprehensive remediation Steven has been waiting for. Don't disappoint.
