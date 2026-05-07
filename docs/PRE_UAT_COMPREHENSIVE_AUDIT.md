# PRE-UAT COMPREHENSIVE AUDIT — SECURITY, ENDPOINTS, AND USER JOURNEYS

**MISSION:** Conduct exhaustive audit of Opollo Site Builder before customer UAT. Find every security vulnerability, broken endpoint, data leak, UX bug, and edge case. Fix everything found. Execute autonomously. Report only when complete.

**CONTEXT:** V1 blockers are fixed and in production. 5 customer companies exist (Opollo, Vincovi, ASCII Group, Skyview, Planet6). About to send UAT invitations to real customers (Vincovi, ASCII Group, Skyview, Planet6). Cannot afford ANY bugs, security issues, or data leaks during UAT.

**EXECUTION MODE:** Full autonomous. No checkpoints. No partial reports. Show evidence for every finding. Fix root causes. Test fixes yourself. Present comprehensive final report only when ALL phases complete.

**ONLY EXCEPTION:** Stop only if a fix would cause irreversible production data loss. Otherwise: keep going.

---

## PHASE 1: COMPLETE ENDPOINT INVENTORY

Generate a full map of every API endpoint in the application.

### Tasks:
1. List every file under `app/api/**/route.ts` and `app/api/**/route.tsx`
2. For each endpoint, document:
   - HTTP method(s) supported
   - Path
   - Auth requirements (public, authenticated, staff-only, role-based)
   - Input parameters (query, body, headers)
   - Response shape (success and error)
   - Database tables accessed
   - External services called (WordPress, social platforms, etc.)
   - Rate limiting (if any)
   - Idempotency handling (if any)

3. Identify orphaned/dead endpoints (no callers in `app/`, `components/`, `lib/`)
4. Identify public endpoints (no auth) — verify each is intentionally public
5. Identify staff-only endpoints — verify access checks
6. Identify customer-scoped endpoints — verify company_id scoping

**Output:** `docs/ENDPOINT_INVENTORY.md` with complete map.

---

## PHASE 2: AUTHENTICATION & AUTHORIZATION AUDIT

### 2.1 Authentication Audit

For every endpoint, verify:
- [ ] Returns 401 when no session present (where required)
- [ ] Returns 403 when session exists but role/company doesn't match
- [ ] Session validation uses standard helpers (no bespoke auth logic)
- [ ] Auth tokens validated server-side (not just client-side)
- [ ] No endpoints accept user-controlled `user_id` or `company_id` from body when session has them

### 2.2 Role-Based Access Control

Verify these access boundaries:
- [ ] `is_opollo_staff = false` users CANNOT access `/admin/*` routes
- [ ] `is_opollo_staff = false` users CANNOT call `/api/admin/*` endpoints
- [ ] Customer admins CANNOT access other companies' data
- [ ] Customer editors CANNOT perform admin actions (invite, delete users)
- [ ] Customer viewers CANNOT modify content
- [ ] Magic-link approvers CAN ONLY approve their specific post

### 2.3 Cross-Company Isolation Tests

Programmatically test these scenarios:

**Test A: Direct URL manipulation**
- Login as Vincovi user
- Try GET `/api/companies/[ascii_group_id]` → expect 403/404
- Try GET `/api/sites?company_id=[ascii_group_id]` → expect empty or 403
- Try GET `/api/social/posts?company_id=[ascii_group_id]` → expect empty or 403
- Repeat for every list endpoint

**Test B: Body parameter injection**
- Login as Vincovi user
- POST to create endpoints with `company_id` of ASCII Group in body
- Expect: rejected or auto-overridden to user's actual company

**Test C: Session token reuse**
- Get session token for Vincovi user
- Try to use it to access ASCII Group routes
- Expect: blocked by RLS or app-layer check

**Test D: Staff context switching**
- As Opollo staff, switch to Vincovi via cookie
- Verify can only see Vincovi data
- Switch to ASCII Group
- Verify Vincovi data NOT cached or leaked
- Verify cookie change is enforced server-side, not just client-side

**Test E: Magic link scope**
- Generate magic link for post X in company A
- Try to use it to access post Y in company A → expect rejected
- Try to use it to access post X in company B → expect rejected
- Verify token expires after first use (or appropriate window)
- Verify token expires after time limit

**Test F: API direct access**
- For each API endpoint, attempt unauthenticated access
- Verify 401 returned
- Attempt with low-privilege user
- Verify 403 returned for privileged operations

### 2.4 RLS Policy Verification

For every table with `company_id`:
- [ ] RLS enabled
- [ ] Policy uses `is_opollo_staff()` OR `is_company_member(company_id)`
- [ ] Policy works for SELECT, INSERT, UPDATE, DELETE
- [ ] Service role bypasses RLS only where intended

**Tables to verify:**
- platform_companies
- platform_users
- platform_company_users
- platform_company_invitations
- sites
- social_connections
- social_post_master
- social_post_variants
- social_media_library
- social_scheduled_posts
- social_approval_tokens
- audit_logs (if company-scoped)
- Any other company-scoped table discovered

**Output:** `docs/AUTH_AUDIT.md` with all test results.

---

## PHASE 3: SECURITY VULNERABILITY AUDIT

### 3.1 Input Validation

For every endpoint:
- [ ] Validates input with Zod (or equivalent) schema
- [ ] Rejects invalid types
- [ ] Rejects missing required fields
- [ ] Rejects oversized payloads (max body size limits)
- [ ] Sanitizes string inputs (prevents XSS in stored data)
- [ ] Validates UUIDs are valid UUIDs
- [ ] Validates URLs are valid URLs
- [ ] Validates emails are valid emails

### 3.2 SQL Injection
- [ ] No raw SQL with string concatenation
- [ ] All queries use Supabase client (parameterized)
- [ ] Any RPC functions sanitize inputs

### 3.3 XSS Prevention
- [ ] User-generated HTML is sanitized before rendering
- [ ] React's default escaping is not bypassed with `dangerouslySetInnerHTML` unless content is sanitized
- [ ] CSP headers configured appropriately

### 3.4 CSRF Protection
- [ ] State-changing endpoints require auth tokens
- [ ] No cookie-only auth for state-changing operations (or has CSRF token)
- [ ] SameSite cookie attributes set correctly

### 3.5 Secret Exposure
- [ ] No API keys in client-side code
- [ ] No secrets in error messages
- [ ] No secrets in logs
- [ ] `.env.local` not committed to repo
- [ ] Service role key never exposed to client

### 3.6 File Upload Security
- [ ] File type validation (whitelist, not blacklist)
- [ ] File size limits enforced
- [ ] Files scanned for malware (if applicable)
- [ ] Files stored in isolated buckets per company
- [ ] No path traversal vulnerabilities (`../../../etc/passwd`)
- [ ] Filenames sanitized before storage

### 3.7 Rate Limiting
- [ ] Login endpoint rate-limited (prevent brute force)
- [ ] API endpoints rate-limited (prevent abuse)
- [ ] Magic link generation rate-limited
- [ ] Email send rate-limited

### 3.8 Information Disclosure
- [ ] Error messages don't leak internal IDs, table names, or stack traces in production
- [ ] 404 vs 403 doesn't leak existence of resources user can't access
- [ ] Login errors don't reveal whether email exists ("Invalid credentials" not "User not found")

### 3.9 Dependency Audit
- Run `npm audit`
- Identify HIGH or CRITICAL vulnerabilities
- Update dependencies where safe
- Document any unfixable issues

### 3.10 Audit Logging
- [ ] All sensitive actions logged (auth, role changes, data deletion)
- [ ] Logs include: who, what, when, IP/user-agent
- [ ] Logs are tamper-proof (insert-only, no update/delete by app)
- [ ] Logs are queryable from admin

**Output:** `docs/SECURITY_AUDIT.md` with findings categorized as CRITICAL/HIGH/MEDIUM/LOW.

---

## PHASE 4: DATA INTEGRITY AUDIT

### 4.1 Foreign Key Integrity

For every foreign key relationship:
- [ ] FK constraint exists in DB
- [ ] CASCADE rules are appropriate (CASCADE vs SET NULL vs RESTRICT)
- [ ] Orphaned records check: count rows pointing to non-existent parents
- [ ] Soft-delete vs hard-delete consistency

### 4.2 Required Field Enforcement

For every required field:
- [ ] NOT NULL constraint in DB
- [ ] Application validates before insert
- [ ] Default values where appropriate
- [ ] No fields silently NULL when they shouldn't be

### 4.3 Unique Constraint Verification
- [ ] Email uniqueness on platform_users
- [ ] Slug uniqueness on platform_companies
- [ ] Any other expected uniqueness

### 4.4 Data Consistency Checks

Run these queries against production:

```sql
-- Orphan checks
SELECT 'platform_company_users orphans (no user)' as check, COUNT(*) FROM platform_company_users pcu LEFT JOIN platform_users pu ON pu.id = pcu.user_id WHERE pu.id IS NULL;
SELECT 'platform_company_users orphans (no company)' as check, COUNT(*) FROM platform_company_users pcu LEFT JOIN platform_companies pc ON pc.id = pcu.company_id WHERE pc.id IS NULL;
SELECT 'sites with invalid company_id' as check, COUNT(*) FROM sites s LEFT JOIN platform_companies pc ON pc.id = s.company_id WHERE s.company_id IS NOT NULL AND pc.id IS NULL;
SELECT 'social_connections with invalid company_id' as check, COUNT(*) FROM social_connections sc LEFT JOIN platform_companies pc ON pc.id = sc.company_id WHERE pc.id IS NULL;
SELECT 'social_post_master with invalid company_id' as check, COUNT(*) FROM social_post_master spm LEFT JOIN platform_companies pc ON pc.id = spm.company_id WHERE pc.id IS NULL;
SELECT 'social_post_variants with invalid post_id' as check, COUNT(*) FROM social_post_variants spv LEFT JOIN social_post_master spm ON spm.id = spv.post_id WHERE spm.id IS NULL;
```

All should return 0. Investigate any that don't.

### 4.5 Status Field Consistency
- [ ] All status enum values valid (no rogue strings)
- [ ] State machines respected (can't skip from draft to published without intermediate states)

**Output:** `docs/DATA_INTEGRITY_AUDIT.md` with findings.

---

## PHASE 5: USER JOURNEY AUDIT

For each user role, walk through complete journeys end-to-end. Test in production preview deployment.

### 5.1 Opollo Staff User Journeys

**Journey A: Initial Login**
1. Login at `/login` with staff credentials
2. Verify redirect to `/admin` (or wherever default lands)
3. Verify sidebar shows admin sections
4. Verify can see all 5 companies

**Journey B: Company Switching**
1. From `/admin`, navigate to `/company/social` (or any company route)
2. Verify company selector dropdown shows all 5 companies
3. Select Vincovi
4. Verify URL updates and data scoped to Vincovi
5. Switch to ASCII Group
6. Verify ASCII Group data shows
7. Verify NO Vincovi data leaks
8. Refresh page — verify still on ASCII Group context

**Journey C: Site Management**
1. Visit `/admin/sites`
2. Verify all sites visible with company column
3. Click a site → verify detail page loads
4. Try to add new site → verify form works
5. Verify new site auto-assigns to current company context

**Journey D: Posting a Blog**
1. Visit `/admin/posts/new`
2. Verify editor is wide (~1200px+, NOT 896px)
3. Select a site
4. Write title and content
5. Add SEO fields
6. Click "Publish to WordPress"
7. Verify success state shows immediately
8. Verify error displays at TOP if it fails (not bottom)
9. Verify redirect to confirmation/post detail page
10. Verify post visible on WordPress site
11. Try to publish again with stale state → verify 409 handling

**Journey E: Social Post Creation**
1. Switch to Vincovi company
2. Visit `/company/social/posts`
3. Click "New Post"
4. Verify ProfileSelector appears
5. Verify can only select Vincovi's connected profiles (not other companies')
6. Write content
7. Schedule for future date
8. Submit for approval (if required)
9. Verify status changes correctly
10. Generate magic link for external approval

**Journey F: Calendar Navigation**
1. Visit `/company/social/calendar`
2. Verify current month displayed (May 2026)
3. Click "Next" → URL updates to `?month=2026-06`
4. Refresh page → still shows June 2026
5. Click "Today" → resets to May 2026
6. Verify scheduled posts appear on correct dates
7. Verify timezone handling correct

**Journey G: Company Management**
1. Visit `/admin/companies`
2. Verify all 5 companies visible
3. Click Vincovi
4. Verify company detail page loads
5. Verify default tab is "Overview" (PR #729 fix)
6. Verify stats cards show
7. Switch to Settings tab → verify settings render
8. Switch to Members tab → verify members render
9. Click "Invite User"
10. Fill form and submit
11. Verify invitation created
12. Verify accept URL generated

**Journey H: User Invitation Flow (Customer Side)**
1. Open generated accept URL in incognito browser
2. Verify URL works
3. Set password
4. Verify redirect to `/company/social` for that company
5. Verify only see that company's data

### 5.2 Customer User Journeys (e.g., Vincovi Admin)

**Journey I: Customer Login**
1. Login as Vincovi user
2. Verify NO admin sidebar items visible
3. Verify NO company selector (or selector shows only Vincovi)
4. Verify lands on `/company/social` or appropriate customer landing page

**Journey J: Customer Trying to Access Forbidden Routes**
1. Try to visit `/admin/companies` → expect 403 or redirect
2. Try to visit `/admin/sites` → expect 403 or redirect
3. Try `/company/social?company_id=ascii-group-id` → expect blocked
4. Try API call: `GET /api/admin/users` → expect 403
5. Verify no error messages leak forbidden data

**Journey K: Customer Post Approval**
1. Receive email with magic link
2. Click magic link
3. Verify post snapshot loads
4. Approve / Request Changes / Reject
5. Verify token can't be reused
6. Try to access different post via URL manipulation → blocked

**Journey L: Customer Creating Own Posts**
1. Visit `/company/social/posts/new`
2. Verify can only select own company's profiles
3. Write content
4. Submit for approval
5. Verify cannot bypass approval flow
6. Verify cannot publish directly without approval (if company requires it)

### 5.3 Edge Case Journeys

**Edge Case 1: Logged-out user**
- Try every page → expect redirect to login
- Try every API endpoint → expect 401

**Edge Case 2: Session expiry**
- Login, wait for session to expire
- Try action → verify graceful re-auth flow

**Edge Case 3: Concurrent edits**
- Two tabs editing same post
- Save in tab 1
- Try to save in tab 2 → verify 409 conflict handled

**Edge Case 4: Empty states**
- New company with no posts → verify empty state renders
- New company with no sites → verify empty state renders
- New company with no users → verify empty state renders

**Edge Case 5: Large data sets**
- Company with 100+ posts → verify pagination works
- Company with 50+ sites → verify list performant
- Calendar with many scheduled posts → verify renders correctly

**Edge Case 6: Network failures**
- Simulate slow network → verify loading states
- Simulate offline → verify graceful degradation
- Simulate API timeout → verify retry/error UI

**Edge Case 7: Browser back button**
- Navigate through several pages
- Click back → verify state restored correctly
- Click forward → verify state restored

**Edge Case 8: Mobile viewport**
- Test all critical journeys on 375px width
- Verify navigation collapses appropriately
- Verify forms usable on mobile
- Verify magic link approval works on mobile

### 5.4 Cross-Browser Testing

Test critical journeys on:
- [ ] Chrome (latest)
- [ ] Firefox (latest)
- [ ] Safari (latest)
- [ ] Edge (latest)
- [ ] Mobile Safari (iOS)
- [ ] Mobile Chrome (Android)

**Output:** `docs/USER_JOURNEY_AUDIT.md` with PASS/FAIL for every scenario.

---

## PHASE 6: UI/UX AUDIT

### 6.1 Visual Consistency
- [ ] All buttons use consistent component
- [ ] All buttons have proper text fit (no overflow)
- [ ] All inputs use consistent styling
- [ ] All forms have consistent layout
- [ ] All loading states use same pattern
- [ ] All error states use same pattern
- [ ] All empty states use same pattern

### 6.2 Layout Audit
- [ ] Editor pages use `max-w-7xl` or wider
- [ ] List pages use appropriate widths
- [ ] No horizontal scroll on standard viewports
- [ ] Sidebar collapses appropriately on mobile
- [ ] Modals are responsive

### 6.3 Notification/Toast System
- [ ] All toasts at top-right (not bottom)
- [ ] Errors are red and prominent
- [ ] Success messages auto-dismiss
- [ ] Errors persist until dismissed
- [ ] Toast queue handles multiple notifications

### 6.4 Form UX
- [ ] All forms have validation feedback
- [ ] All errors at top of form (or inline near fields)
- [ ] Submit buttons disabled during submission
- [ ] Loading states visible during async operations
- [ ] Success feedback after save

### 6.5 Navigation UX
- [ ] Active route highlighted in nav
- [ ] Breadcrumbs where appropriate
- [ ] Back buttons or clear navigation paths
- [ ] No dead-ends (every page has navigation out)

### 6.6 Accessibility
- [ ] Keyboard navigation works on all interactive elements
- [ ] Tab order is logical
- [ ] Focus states visible
- [ ] Color contrast sufficient (WCAG AA minimum)
- [ ] Screen reader compatible (ARIA labels)
- [ ] Form labels properly associated with inputs
- [ ] Error messages announced to screen readers

### 6.7 Browser Console
- [ ] No console errors on any page
- [ ] No console warnings (or only known acceptable ones)
- [ ] No 404s in network tab
- [ ] No 500s in network tab

**Output:** `docs/UI_AUDIT.md` with findings.

---

## PHASE 7: PERFORMANCE AUDIT

### 7.1 Page Load Performance
- [ ] Run Lighthouse on all critical pages
- [ ] Target: Performance > 80, Accessibility > 90
- [ ] No images > 500KB without optimization
- [ ] Fonts loaded efficiently
- [ ] JavaScript bundles reasonable size

### 7.2 Database Query Performance
- [ ] Run EXPLAIN on common queries
- [ ] Identify queries > 100ms
- [ ] Add missing indexes
- [ ] Identify N+1 query problems

### 7.3 API Response Times
- [ ] All endpoints < 1 second p95
- [ ] Identify endpoints > 2 seconds (publish endpoint had 8.8s issue)
- [ ] Add timeout handling

### 7.4 Background Jobs
- [ ] Failed jobs visible in admin
- [ ] Retry logic works
- [ ] Dead letter queue for permanently failed jobs

**Output:** `docs/PERFORMANCE_AUDIT.md` with findings.

---

## PHASE 8: ERROR HANDLING AUDIT

### 8.1 Error Boundaries
- [ ] React Error Boundaries on all major route segments
- [ ] Graceful error pages (not white screens)
- [ ] Error details logged to Sentry
- [ ] User-friendly error messages

### 8.2 API Error Handling
- [ ] All API routes return structured errors
- [ ] Client handles all error codes (400, 401, 403, 404, 409, 422, 500)
- [ ] Network failures handled
- [ ] Timeout handling

### 8.3 Specific Error Scenarios
Test these and verify proper UX:
- [ ] WordPress API down during publish → user sees clear error
- [ ] Supabase connection drops → graceful retry
- [ ] Session expires mid-action → re-auth prompt
- [ ] Validation fails → inline errors
- [ ] Permission denied → clear message
- [ ] Resource not found → 404 page
- [ ] Stale state conflict → 409 handling with refresh option

**Output:** `docs/ERROR_HANDLING_AUDIT.md` with findings.

---

## PHASE 9: INTEGRATION AUDIT

### 9.1 WordPress Integration
- [ ] Connection test endpoint works
- [ ] Publish flow works for: post, page, custom post types
- [ ] Image upload works
- [ ] Media library sync works
- [ ] Permalink structure detected correctly
- [ ] Categories/tags sync
- [ ] Featured image set correctly
- [ ] Errors from WordPress API handled gracefully

### 9.2 Social Platform Integrations
For each connected platform (LinkedIn, Facebook, X, GBP):
- [ ] OAuth flow works
- [ ] Connection refresh works
- [ ] Posting works (text, image, video, link)
- [ ] Disconnection works cleanly
- [ ] Token expiry handled
- [ ] Rate limit handling
- [ ] Errors surface to user

### 9.3 Email Integration
- [ ] Invitation emails send
- [ ] Magic link emails send
- [ ] Password reset emails send
- [ ] Email templates render correctly
- [ ] Bounce handling

### 9.4 Bundle.social Integration
- [ ] Connection works
- [ ] Webhook receiving works
- [ ] Status updates flow correctly
- [ ] Error handling

**Output:** `docs/INTEGRATION_AUDIT.md` with findings.

---

## PHASE 10: PRODUCTION READINESS CHECKS

### 10.1 Environment Variables
- [ ] All required env vars set in Vercel production
- [ ] No `localhost` URLs in production env
- [ ] No development credentials in production
- [ ] Service role keys not exposed to client

### 10.2 Monitoring & Alerting
- [ ] Sentry capturing errors
- [ ] Critical error alerts configured
- [ ] Uptime monitoring configured
- [ ] Database backup verified
- [ ] Recent backup tested for restore

### 10.3 Documentation
- [ ] BUILD.md up to date
- [ ] RUNBOOK.md has current procedures
- [ ] API documentation current
- [ ] Onboarding docs for new customers

### 10.4 Legal/Compliance
- [ ] Privacy policy linked
- [ ] Terms of service linked
- [ ] Cookie consent (if applicable)
- [ ] Data retention policies documented
- [ ] GDPR data export capability (if applicable)

**Output:** `docs/PRODUCTION_READINESS.md` with checklist results.

---

## PHASE 11: REGRESSION TESTING

### 11.1 Run Full Test Suite
- [ ] `npm run test` — Vitest passes
- [ ] `npm run test:e2e` — Playwright passes
- [ ] `npm run typecheck` — TypeScript clean
- [ ] `npm run lint` — ESLint clean
- [ ] `npm run audit:static` — 0 HIGH issues
- [ ] `npm run build` — production build succeeds

### 11.2 Visual Regression
- [ ] Take screenshots of all critical pages
- [ ] Compare to baseline (if exists)
- [ ] Document any unintentional visual changes

### 11.3 Previously Fixed Bugs
For each bug fixed in PRs #722, #725, #726, #727, #728, #729:
- [ ] Re-test the original bug scenario
- [ ] Verify still fixed
- [ ] Verify no regression

**Output:** `docs/REGRESSION_TEST_RESULTS.md` with all results.

---

## PHASE 12: FIX EVERYTHING FOUND

For every issue found in Phases 1-11:

1. Categorize severity:
   - 🔴 CRITICAL — blocks UAT, fixes immediately
   - 🟠 HIGH — major bug or security issue, fix before UAT
   - 🟡 MEDIUM — should fix, can defer if needed
   - 🟢 LOW — nice to have, defer to post-UAT

2. For CRITICAL and HIGH issues:
   - Fix immediately
   - Add tests to prevent regression
   - Update documentation
   - Open PR with clear description

3. For MEDIUM issues:
   - Document in issue tracker
   - Fix if time permits
   - Get explicit approval to defer if needed

4. For LOW issues:
   - Document in backlog
   - Defer to post-UAT

---

## PHASE 13: FINAL VERIFICATION

After all fixes applied:

1. Re-run all tests from Phase 11
2. Re-run critical user journeys from Phase 5
3. Verify zero CRITICAL issues remain
4. Verify zero HIGH issues remain (or all approved deferrals documented)
5. Confirm production deployment matches latest main
6. Confirm database state matches expected

---

## FINAL REPORT FORMAT

```markdown
# OPOLLO PRE-UAT COMPREHENSIVE AUDIT — FINAL REPORT

## Executive Summary
- Total endpoints audited: X
- Total user journeys tested: Y
- Total issues found: Z
- Critical issues: A (all fixed: YES/NO)
- High issues: B (all fixed: YES/NO)
- Medium issues: C
- Low issues: D
- Production-ready for UAT: YES/NO

## Phase Completion Status
- Phase 1 (Endpoint Inventory): COMPLETE
- Phase 2 (Auth Audit): COMPLETE
- Phase 3 (Security Audit): COMPLETE
- Phase 4 (Data Integrity): COMPLETE
- Phase 5 (User Journeys): COMPLETE
- Phase 6 (UI/UX): COMPLETE
- Phase 7 (Performance): COMPLETE
- Phase 8 (Error Handling): COMPLETE
- Phase 9 (Integrations): COMPLETE
- Phase 10 (Production Readiness): COMPLETE
- Phase 11 (Regression): COMPLETE
- Phase 12 (Fixes Applied): COMPLETE
- Phase 13 (Final Verification): COMPLETE

## Critical Findings & Resolutions

### 🔴 CRITICAL (X issues)
[For each: description, root cause, fix applied, PR/commit, test added]

### 🟠 HIGH (Y issues)
[For each: description, root cause, fix applied, PR/commit, test added]

### 🟡 MEDIUM (Z issues — deferred or fixed)
[List with disposition]

### 🟢 LOW (A issues — deferred to post-UAT)
[List for backlog]

## Endpoint Inventory Summary
- Total endpoints: X
- Public endpoints: Y (intentional: YES/NO)
- Auth-required endpoints: Z
- Staff-only endpoints: A
- Customer-scoped endpoints: B

## Security Audit Summary
- Auth bypasses found: X (fixed: Y)
- Cross-company leaks found: X (fixed: Y)
- XSS vulnerabilities: X (fixed: Y)
- SQL injection: X (fixed: Y)
- CSRF: X (fixed: Y)
- Information disclosure: X (fixed: Y)
- Rate limiting issues: X (fixed: Y)

## User Journey Test Results
[Table of all journeys with PASS/FAIL]

## Performance Findings
- Slowest page: X (Yms)
- Slowest API: X (Yms)
- Database queries optimized: Z

## Database State
- Production company count: 5
- Total users: X
- Total sites: Y
- Orphaned records: 0
- Data integrity issues: 0

## PR Summary
[List all PRs created during this audit]

## Files Changed
- Created: X
- Modified: Y
- Deleted: Z

## Documentation Created
[List all audit docs in /docs]

## Tests Added
- Unit tests: X
- E2E tests: Y
- Integration tests: Z

## Recommendations Before UAT
1. [Specific actions you recommend]
2. [Any monitoring to set up]
3. [Any customer communications needed]

## Recommendations Post-UAT
1. [LOW priority items deferred]
2. [Future improvements]

## Sign-off

Ready for UAT with real customers (Vincovi, ASCII Group, Skyview, Planet6): YES/NO

If NO, blocking issues:
[List]

If YES, send invitations using:
DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config lib/scripts/invite-uat-user.ts <slug> <email> <role>

For each customer.
```

---

## CRITICAL RULES

1. **DO NOT STOP** — Execute all 13 phases without interruption
2. **DO NOT ASK** — Make decisions autonomously based on best practices
3. **DO NOT REPORT PROGRESS** — Work silently, present comprehensive final report only
4. **DO FIX ROOT CAUSES** — Not just symptoms
5. **DO TEST EVERY FIX** — Verify it works before marking done
6. **DO PROVIDE EVIDENCE** — Show file content, query results, test output for every claim
7. **DO BE THOROUGH** — Better to find too many issues than miss one
8. **DO PRIORITIZE CORRECTLY** — Critical/High/Medium/Low based on actual impact

## EXCEPTION: WHEN TO STOP

Only stop if:
- Fix would cause irreversible production data loss
- Discovery of active security breach in progress
- External service credentials missing for required testing

Otherwise: KEEP GOING.

---

## START COMMAND

If you understand and accept this comprehensive audit, respond with:

"PRE-UAT COMPREHENSIVE AUDIT STARTING - FULL EXECUTION"

Then execute all 13 phases silently and present the final report when complete.

This audit is the final gate before sending UAT invitations to real customers. Find everything. Fix everything. Document everything. Test everything.

Be paranoid. Customers will find what we miss.
