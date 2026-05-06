# Company Hierarchy & Client Selector — Master Implementation Proposal

**Status:** MANDATORY PRE-UAT FIXES — V1 cannot be tested until these are resolved  
**Priority:** CRITICAL BLOCKERS — these issues prevent meaningful UAT with real customers  
**Estimated complexity:** 3–4 days (data audit + schema changes + UI + testing)  
**Owner:** Claude Code  
**Context:** Opollo Site Builder N-Series Social Module V1

---

## Executive Summary: Why This Can't Wait for UAT

**V1 is marked "complete" but has critical UX/data integrity issues that make UAT impossible.**

The current state:
- Users cannot tell which client they're working on → will create posts for wrong clients
- Navigation is broken → users get trapped in social section
- Assets have no company ownership → data integrity issues, potential leaks
- Calendar shows inconsistent dates → creates confusion and mistrust

**These are not "nice to have" improvements. These are blocking defects that must be fixed BEFORE asking real customers (Vincovi, ASCII Group, Skyview, Planet6) to test.**

V1.5 is on the roadmap, but V1 must be **actually functional** first. This proposal addresses the minimum viable fixes to make V1 testable.

---

## Problem Statement

### V1 vs V1.5 — What Must Be Fixed NOW

**V1 Status:** Code marked "complete" but has fundamental UX/architecture issues that block testing
**V1.5 Roadmap:** Planned enhancements, but V1 must be functional first

**This proposal covers V1 MANDATORY FIXES ONLY:**
- Company context visibility (blocker)
- Navigation hierarchy (blocker)
- Data integrity/company scoping (blocker)
- Calendar state consistency (blocker)
- Profile selection on post creation (blocker)

**NOT in this proposal (can wait for V1.5):**
- Advanced post scheduling features
- Bulk upload CSV improvements
- Analytics dashboards
- Content calendar advanced views
- AI-powered post suggestions

**The principle:** V1 must be **usable and safe** before asking customers to test. Right now it's neither. These fixes make it both.

### Current Critical Issues

**Issue 1: Navigation Hierarchy Broken**
- When navigating to `/company/social/*` routes, the social submenu (Posts, Connections, Media, Sharing, Analytics) **completely replaces** the main platform navigation (Sites, Images, Social, Users, Companies, etc.)
- Users are trapped in the social section with no visual way back to other platform features except "Back to admin" link at bottom
- Mental model is broken — users expect social to be a **sub-section** of the platform, not a replacement

**Issue 2: No Client Context Visibility**
- Users cannot see **which company/client** they're currently working on when creating posts, connecting accounts, or viewing calendars
- No company selector dropdown visible anywhere in the social module
- Creates high risk of posting to wrong client's accounts or connecting wrong social profiles

**Issue 3: Orphaned Assets (Data Integrity)**
- Current implementation likely has assets (sites, social accounts, posts, media) that are **not assigned to any company**
- No database-level enforcement preventing creation of company-less assets
- As we add real customer companies (Vincovi, ASCII Group, Skyview, Planet6), orphaned assets will cause confusion and data leaks

**Issue 4: Inconsistent Date State**
- Calendar view shows different months (May 2025 vs May 2026) when navigating to the same route
- Suggests state management issues or lack of proper initialization

---

## Reference Implementation: Semrush Social Poster

See uploaded screenshots showing Semrush's implementation:

**Company Selector (top-left dropdown):**
- Shows currently selected company: "Vincovi"
- Dropdown reveals all available client accounts:
  - stellar.com.au
  - tct.com.au
  - vectec.com.au
  - Vincovi (with multiple workspaces/projects)
  - www.csp.global
  - www.epicit.com.au
- "Create folder" option at bottom
- Persistent across all views (Calendar, Posts, Content ideas tabs)
- User always knows which client they're working in

**Navigation Structure:**
- Main navigation sidebar always visible (Home, SEO, Local, Content, Social, Advanced, Traffic & Market, AI, Reports, App Center, Account)
- Social section expands to show sub-items (Dashboard, Social Poster, Social Tracker, Social Content Insights, Social Analytics, Social Content AI)
- Current location highlighted (Social Poster)
- Main nav never gets replaced or hidden

**Calendar View:**
- Shows current/selected month consistently
- "Today" button to reset to current date
- Month navigation (< >) to move forward/backward
- Profile selector ("All profiles" dropdown) to filter calendar by account

---

## Solution Architecture

### Core Principle: Platform Layer Owns Company Context

From `platform-customer-management` skill:
> "The platform layer answers: Who is this user? Which company do they belong to? What role do they have?"

All features (Social, future LeadSource, future CAP) use the platform layer for company scoping. The company selector is a **platform-level UI component**, not a social-specific one.

---

## Implementation Forcing Function

**Problem pattern:** V1 marked complete → waits for UAT → UAT reveals blockers → blockers get deferred because "V1.5 is coming"

**This proposal breaks that cycle:**

### Non-Negotiable Acceptance Criteria (Cannot Mark Complete Without These)

Claude Code: You **must** implement ALL of the following before considering this work done. Do not ask Steven to test incrementally. Do not wait for feedback on partial implementations. Build it all, test it yourself, THEN present for UAT.

**Required completions:**
1. ✅ Audit script run, orphaned assets identified, counts reported
2. ✅ Migration script run, all assets assigned to companies
3. ✅ Database constraints applied (company_id NOT NULL on all asset tables)
4. ✅ RLS policies updated and verified
5. ✅ Company selector component built and visible on all routes
6. ✅ Company context provider implemented and working
7. ✅ Navigation hierarchy fixed (two-level nav, social doesn't replace main)
8. ✅ "Back to admin" link removed
9. ✅ Calendar date state fixed (URL params, Today button added)
10. ✅ Profile selector added to post creation form
11. ✅ All 4 UAT scenarios pass (test yourself before presenting)
12. ✅ Zero console errors, zero broken links, zero obvious visual bugs

**Self-testing checklist for Claude Code:**
- [ ] Can you switch between 3 different companies and see different data each time?
- [ ] Can you navigate from Social → Sites → Social without losing context?
- [ ] Can you create a post, assign it to specific profiles, and save it?
- [ ] Does the calendar show the correct month every time you visit it?
- [ ] Try to break it: can you access Company A's data while Company B is selected? (Should be blocked by RLS)

**Only when ALL checkboxes are ticked:** Present to Steven for UAT with real customers.

---

## Implementation Plan

### Phase 1: Data Audit & Cleanup (Day 1)

#### Step 1.1: Audit Script — Find Orphaned Assets

Create `/lib/scripts/audit-orphaned-assets.ts`:

```typescript
/**
 * Audit all asset tables for rows without company_id
 * 
 * Tables to check:
 * - social_connections
 * - social_post_master
 * - social_post_variants
 * - social_media_library
 * - sites (if using platform layer)
 * - any other company-scoped tables
 * 
 * Output: CSV report showing:
 * - table_name
 * - orphaned_count
 * - total_count
 * - orphaned_percentage
 * - sample_ids (first 5 orphaned record IDs)
 */
```

**Run this script first.** Report results before proceeding. Expected findings:
- Social connections without `company_id`
- Posts without `company_id`
- Media library items without `company_id`

#### Step 1.2: Create Opollo Internal Company (if not exists)

From platform skill:
> "Special 'Opollo Internal' company that all staff belong to."

Ensure `platform_companies` has an Opollo Internal company row:

```sql
INSERT INTO platform_companies (id, name, slug, domain, is_opollo_internal, timezone)
VALUES (
  gen_random_uuid(),
  'Opollo Internal',
  'opollo-internal',
  'opollo.com',
  true,
  'Australia/Melbourne'
)
ON CONFLICT (slug) DO NOTHING
RETURNING id;
```

Store this `id` as the default company for migration.

#### Step 1.3: Migration Script — Assign Orphaned Assets

Create `/lib/scripts/migrate-orphaned-assets.ts`:

```typescript
/**
 * Assign all orphaned assets to Opollo Internal company
 * 
 * For each table with company_id:
 * - UPDATE table SET company_id = '[opollo_internal_id]' WHERE company_id IS NULL
 * 
 * Tables:
 * - social_connections
 * - social_post_master
 * - social_post_variants
 * - social_media_library
 * - sites
 * 
 * Log each update:
 * - table_name
 * - updated_count
 * - timestamp
 * 
 * Create audit trail in new table: platform_data_migrations
 */
```

**Test first on staging/dev.** Once verified, run on production.

---

### Phase 2: Schema Enforcement (Day 1–2)

#### Step 2.1: Add company_id Constraints

For every asset table that should be company-scoped:

```sql
-- Example for social_connections
ALTER TABLE social_connections
  ALTER COLUMN company_id SET NOT NULL,
  ADD CONSTRAINT fk_social_connections_company
    FOREIGN KEY (company_id) REFERENCES platform_companies(id)
    ON DELETE CASCADE;

-- Repeat for:
-- - social_post_master
-- - social_post_variants
-- - social_media_library
-- - social_scheduled_posts
-- - any other asset tables
```

**CRITICAL:** Only run these after Step 1.3 completes and all orphaned assets are assigned.

#### Step 2.2: Update RLS Policies

From platform skill:
> "Every table that contains company-scoped data has the same shape of RLS"

Ensure all asset tables have proper RLS:

```sql
-- Read policy: Opollo staff see all, company members see their company's data
CREATE POLICY social_connections_read ON social_connections FOR SELECT
  USING (
    is_opollo_staff()
    OR is_company_member(company_id)
  );

-- Write policy: same, plus permission checks
-- (Application layer handles granular role checks via canDo())
```

Apply to all asset tables. Reference `platform-customer-management` skill for pattern.

#### Step 2.3: Create Migration Audit Table

```sql
CREATE TABLE platform_data_migrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  migration_name text NOT NULL,
  table_name text NOT NULL,
  records_affected integer NOT NULL,
  executed_by uuid REFERENCES platform_users(id),
  executed_at timestamptz DEFAULT now(),
  notes jsonb
);
```

---

### Phase 3: Company Selector UI Component (Day 2)

#### Step 3.1: Create CompanySelector Component

Location: `components/platform/CompanySelector.tsx`

**Requirements:**
- Dropdown showing current company name + logo (if available)
- List all companies the current user has access to
- Opollo staff see all companies
- Customer users see only their company (V1 constraint: one company per user)
- Clicking a company updates session state and refreshes current page
- Dropdown styled to match Semrush reference (clean, professional, accessible)
- Loading states while fetching companies
- Error states if company fetch fails

**State Management:**
- Store selected `companyId` in React Context: `CompanyContext`
- Persist selected company in localStorage (key: `opollo_selected_company`)
- On mount, restore from localStorage or default to user's primary company
- Provide `useCompany()` hook for components to access current company

**API Endpoint:**
```typescript
// app/api/platform/companies/list/route.ts
// GET /api/platform/companies/list
// Returns: { companies: Company[] }
// 
// Logic:
// - If is_opollo_staff: return all companies
// - Else: return companies user is member of (via platform_company_users)
```

#### Step 3.2: Company Context Provider

Location: `lib/platform/context/CompanyContext.tsx`

```typescript
interface CompanyContextValue {
  currentCompanyId: string | null;
  currentCompany: Company | null;
  setCompany: (companyId: string) => Promise<void>;
  isLoading: boolean;
  companies: Company[];
}

export function CompanyProvider({ children }: { children: React.ReactNode }) {
  // Implementation
}

export function useCompany() {
  const context = useContext(CompanyContext);
  if (!context) {
    throw new Error('useCompany must be used within CompanyProvider');
  }
  return context;
}
```

Wrap the entire app layout in `CompanyProvider`:
```tsx
// app/layout.tsx or app/(platform)/layout.tsx
<CompanyProvider>
  {children}
</CompanyProvider>
```

#### Step 3.3: Integration Points

**Where to show CompanySelector:**
- Top of main platform navigation sidebar (above Sites, Images, Social, etc.)
- OR in header bar if using horizontal header layout
- Must be visible on **all platform routes**, not just social

**Update all data-fetching hooks/functions:**
```typescript
// Before:
const { data: connections } = useSocialConnections();

// After:
const { currentCompanyId } = useCompany();
const { data: connections } = useSocialConnections(currentCompanyId);
```

Every query that fetches company-scoped data must accept and use `companyId` parameter.

---

### Phase 4: Fix Navigation Hierarchy (Day 2–3)

#### Step 4.1: Understand Current Layout Structure

Review these files:
- `app/(platform)/layout.tsx` — main platform shell
- `app/(platform)/company/[companyId]/layout.tsx` — company-scoped routes wrapper (if exists)
- `app/(platform)/company/[companyId]/social/layout.tsx` — social section wrapper (likely culprit)

**Current problem:** Social layout is likely doing:
```tsx
// WRONG — replaces entire platform nav
export default function SocialLayout({ children }) {
  return (
    <>
      <SocialNav /> {/* Posts, Connections, Media, etc. */}
      {children}
    </>
  );
}
```

#### Step 4.2: Implement Two-Level Navigation

**Option A: Nested sidebar (recommended)**

```tsx
// app/(platform)/layout.tsx
<div className="flex h-screen">
  <PlatformNav> {/* Main nav: Sites, Images, Social, Users, etc. */}
    <CompanySelector />
    <NavItems />
  </PlatformNav>
  
  <div className="flex-1 flex">
    {/* Conditional sub-nav appears here when in social section */}
    {isSocialSection && <SocialSubNav />}
    
    <main className="flex-1">
      {children}
    </main>
  </div>
</div>
```

**Option B: Accordion-style (simpler but less visual space)**

```tsx
// app/(platform)/layout.tsx
<PlatformNav>
  <CompanySelector />
  <NavItem label="Sites" />
  <NavItem label="Images" />
  <NavItem label="Social" expanded={isSocialSection}>
    <SubNavItem label="Posts" />
    <SubNavItem label="Calendar" />
    <SubNavItem label="Connections" />
    <SubNavItem label="Media" />
    <SubNavItem label="Sharing" />
    <SubNavItem label="Analytics" />
  </NavItem>
  <NavItem label="Users" />
  <NavItem label="Companies" />
</PlatformNav>
```

**Recommendation:** Option A (nested sidebar). Provides more space for sub-nav items and matches Semrush's pattern.

#### Step 4.3: Remove Route-Based Nav Replacement

Delete or refactor `app/(platform)/company/[companyId]/social/layout.tsx` if it's replacing the main nav.

Social routes should **not** have their own layout that replaces platform nav. Instead:
- Platform layout always renders
- Social sub-nav conditionally appears when route matches `/company/*/social/*`
- Use route detection: `usePathname()` to determine if sub-nav should show

#### Step 4.4: Remove "Back to admin" Link

The "Back to admin" link at the bottom of the social nav is a **workaround for broken navigation**. Once the two-level nav is implemented:
- Remove "Back to admin" link entirely
- Main platform nav is always visible, so no need to "go back"
- If users need a quick way to collapse/expand sidebar, add a collapse toggle icon instead
- "Sign out" link can remain at bottom of main platform nav (not social sub-nav)

---

### Phase 5: Fix Calendar Date Inconsistency (Day 3)

#### Step 5.1: Root Cause Analysis

The calendar is showing different months (May 2025 vs May 2026) when navigating to the same route. Likely causes:

1. **State not resetting on mount:** Calendar component reads from URL params or localStorage and doesn't reset to "today" when params are missing
2. **URL params not being set correctly:** Navigation to calendar doesn't include a month parameter
3. **localStorage persisting old date:** User viewed May 2026 in a previous session, and it's restoring that instead of current month

#### Step 5.2: Calendar State Management Rules

**On initial load to `/company/social/calendar`:**
- Default to current month unless URL has `?month=YYYY-MM` param
- Ignore localStorage for month state (or only use as fallback if it's within ±1 month of today)

**When navigating between views (Posts → Calendar → Posts → Calendar):**
- Preserve month selection in URL params
- Clicking "Calendar" tab/button should include current month param: `/company/social/calendar?month=2026-05`
- Month navigation (< >) updates URL param

**Add "Today" button:**
- Resets calendar to current month
- Updates URL to remove month param or set to current month
- Visible at all times in calendar header

#### Step 5.3: Implementation

```tsx
// app/(platform)/company/[companyId]/social/calendar/page.tsx

export default function CalendarPage({
  searchParams,
}: {
  searchParams: { month?: string };
}) {
  const today = new Date();
  const currentMonth = format(today, 'yyyy-MM');
  
  // Default to current month if no param or invalid param
  const selectedMonth = searchParams.month && isValidMonthString(searchParams.month)
    ? searchParams.month
    : currentMonth;
  
  const handleMonthChange = (newMonth: string) => {
    // Update URL with new month param
    router.push(`/company/${companyId}/social/calendar?month=${newMonth}`);
  };
  
  const handleTodayClick = () => {
    router.push(`/company/${companyId}/social/calendar?month=${currentMonth}`);
  };
  
  return (
    <div>
      <CalendarHeader
        month={selectedMonth}
        onPrevMonth={() => handleMonthChange(getPrevMonth(selectedMonth))}
        onNextMonth={() => handleMonthChange(getNextMonth(selectedMonth))}
        onToday={handleTodayClick}
      />
      <CalendarGrid month={selectedMonth} />
    </div>
  );
}
```

**Remove any localStorage reads for month state.** URL params are the single source of truth.

---

### Phase 6: Add Profile Selection to Posts Page (Day 3–4)

From Issue #2, the Posts page is missing profile/account selection. Users need to choose which social accounts to post to.

#### Step 6.1: Update Post Creation UI

Current state (screenshot 1):
- Simple "Post copy" textarea
- "Link URL (optional)" field
- "SAVE DRAFT" button

**Missing:**
- Profile/account selection (which LinkedIn/Facebook/X/GBP accounts to post to)
- Media upload
- Scheduling date/time picker
- Platform-specific previews

#### Step 6.2: Add Profile Selector Component

Location: `components/social/ProfileSelector.tsx`

**Requirements:**
- Multi-select checkboxes for social accounts
- Group by platform (LinkedIn, Facebook, X, Google Business Profile)
- Show account name, profile picture, connection status
- "All profiles" checkbox to select/deselect all
- Disabled state for disconnected accounts with reconnect prompt
- Fetch profiles for current company via `useCompany().currentCompanyId`

**API Endpoint:**
```typescript
// app/api/social/connections/list/route.ts
// GET /api/social/connections/list?companyId={id}
// Returns: { connections: SocialConnection[] }
// Grouped by platform, sorted by status (connected first)
```

#### Step 6.3: Update Post Creation Flow

**Expand the post creation form to include:**

1. **Profile Selection** (new)
   - Multi-select, grouped by platform
   - Required field — cannot save draft without selecting at least one profile

2. **Post Copy** (exists)
   - Textarea with character counters per selected platform
   - LinkedIn: 3,000 chars
   - Facebook: 63,206 chars
   - X: 280 chars
   - Google Business Profile: 1,500 chars

3. **Media Upload** (new)
   - Drag-and-drop or click to upload
   - Image, video, document support (varies by platform)
   - Preview thumbnails
   - Alt text input for accessibility

4. **Link Preview** (exists as "Link URL")
   - Auto-fetch Open Graph metadata when URL entered
   - Show preview card (image, title, description)

5. **Scheduling** (new)
   - Date picker
   - Time picker
   - Timezone display (from company settings)
   - "Post now" vs "Schedule for later" toggle

6. **Actions** (exists as "SAVE DRAFT")
   - Save Draft
   - Submit for Approval (if `requires_approval` is true for company)
   - Schedule Now (if approved and time selected)

#### Step 6.4: Reference N-Series Layer Rules

From `n-series-layer-rules` skill:

> "L1 (Editorial): Posts, variants, media, validation"
> "L2 (Approval): Magic-link review, snapshots, events"
> "L3 (Scheduling): Calendar, scheduled times, publish-job creation"

When building post creation UI:
- Call L1 functions (`editorial.createPost()`) to create post records
- If company has `requires_approval`, submit to L2 approval flow
- If approved and scheduled, L3 creates the publish job
- **Never bypass layers** — follow the dependency graph

---

### Phase 7: Testing & Validation (Day 4)

#### Step 7.1: Data Integrity Tests

**Pre-migration checks:**
- Run audit script on production snapshot
- Verify orphaned asset counts
- Export list of orphaned assets to CSV for manual review if needed

**Post-migration checks:**
- Verify all asset tables have 0 NULL `company_id` rows
- Verify all orphaned assets now assigned to Opollo Internal company
- Verify constraints applied successfully (try to INSERT without company_id — should fail)
- Verify RLS policies working (non-staff user cannot see other company's data)

#### Step 7.2: UI/UX Tests

**Company Selector:**
- [ ] Visible on all platform routes
- [ ] Shows correct list of companies for logged-in user
- [ ] Opollo staff see all companies
- [ ] Selecting a company updates context and refreshes current view
- [ ] Selected company persists across page reloads (localStorage)
- [ ] Loading states render correctly
- [ ] Error states render correctly

**Navigation Hierarchy:**
- [ ] Main platform nav always visible (Sites, Images, Social, Users, Companies)
- [ ] Social sub-nav appears when in `/company/*/social/*` routes
- [ ] Social sub-nav does NOT replace main nav
- [ ] "Back to admin" link replaced with proper nav structure
- [ ] Active route highlighted in both main nav and sub-nav
- [ ] Navigation responsive on mobile (if applicable)

**Calendar Date Consistency:**
- [ ] Calendar defaults to current month on first load
- [ ] Calendar preserves month selection when navigating away and back
- [ ] Month navigation (< >) updates URL param
- [ ] "Today" button resets to current month
- [ ] No inconsistency between multiple visits to same route
- [ ] URL param takes precedence over localStorage

**Profile Selection:**
- [ ] Profile selector appears on post creation form
- [ ] Shows all connected social accounts for current company
- [ ] Groups by platform (LinkedIn, Facebook, X, GBP)
- [ ] "All profiles" toggle works
- [ ] Disconnected accounts show reconnect prompt
- [ ] Cannot save draft without selecting at least one profile
- [ ] Selected profiles persist when saving draft and returning

#### Step 7.3: UAT Scenarios

Test with **real customer companies** (Vincovi, ASCII Group, Skyview, Planet6):

**Scenario 1: Opollo Staff Switching Companies**
1. Log in as Opollo staff user
2. Verify company selector shows all companies
3. Select "Vincovi"
4. Navigate to Social → Posts
5. Verify posts list shows only Vincovi's posts
6. Create a draft post, assign to Vincovi's LinkedIn profile
7. Switch to "ASCII Group" via company selector
8. Verify posts list now shows only ASCII Group's posts
9. Verify Vincovi's draft is not visible

**Scenario 2: Customer User (Non-Staff)**
1. Log in as customer user (e.g., Vincovi Admin)
2. Verify company selector shows only "Vincovi" (no other companies)
3. Navigate to Social → Calendar
4. Verify calendar shows only Vincovi's scheduled posts
5. Try to directly access ASCII Group's posts via URL manipulation: `/company/[ascii_id]/social/posts`
6. Verify RLS blocks access (403 or redirects)

**Scenario 3: Navigation Persistence**
1. Log in as Opollo staff
2. Select "Skyview Technology"
3. Navigate to Social → Connections
4. Navigate to Sites (main platform feature)
5. Verify main nav always visible, social sub-nav hidden
6. Navigate back to Social → Calendar
7. Verify social sub-nav reappears
8. Verify Skyview still selected in company selector

**Scenario 4: Calendar Date Consistency**
1. Navigate to Social → Calendar
2. Note current month displayed (should be May 2026 if that's today's month)
3. Navigate to Posts
4. Navigate back to Calendar
5. Verify same month still displayed (no jump to different year)
6. Click "Next month" (>)
7. Refresh page
8. Verify month persisted in URL param
9. Click "Today" button
10. Verify calendar resets to current month

---

## Success Criteria

### Must-Have (V1 Blocker)
- [ ] Zero orphaned assets in production (all assigned to a company)
- [ ] `company_id` NOT NULL constraint on all asset tables
- [ ] Company selector visible and functional on all platform routes
- [ ] Navigation hierarchy preserved (social submenu does not replace main nav)
- [ ] Calendar date state consistent across navigation
- [ ] Profile selection working on post creation form
- [ ] RLS policies prevent cross-company data leaks
- [ ] All UAT scenarios pass with real customer companies

### Nice-to-Have (Can defer to V1.1)
- [ ] Company logo upload and display in selector
- [ ] "Create new company" option in selector (Opollo staff only)
- [ ] Company search/filter in selector (if >20 companies)
- [ ] Keyboard shortcuts for company switching (Cmd+K → company name)

---

## Rollout Plan

### Pre-Deployment
1. Merge all code to `main` branch
2. Run audit script on production database (via read replica or snapshot)
3. Review orphaned asset counts with Steven
4. Schedule deployment for low-traffic window (if possible)

### Deployment
1. Run migration script on production:
   - Assign orphaned assets to Opollo Internal company
   - Apply NOT NULL constraints
   - Update RLS policies
2. Deploy Next.js app with new UI components
3. Clear all user localStorage keys (to force fresh company selection)
4. Monitor Sentry for errors in first 2 hours

### Post-Deployment
1. Run validation queries to confirm zero orphaned assets
2. Test company selector with Opollo staff account
3. Test with one customer account (Vincovi)
4. Monitor for RLS-related errors (users unable to access their own data)
5. If critical issues found, rollback migration (revert constraints, set company_id back to NULL where assigned by migration)

---

## File Checklist for Claude Code

### Scripts (create these first)
- [ ] `/lib/scripts/audit-orphaned-assets.ts`
- [ ] `/lib/scripts/migrate-orphaned-assets.ts`
- [ ] `/lib/scripts/ensure-opollo-internal-company.ts`

### Database Migrations (Supabase SQL editor)
- [ ] `migrations/20XX_add_company_constraints.sql`
- [ ] `migrations/20XX_update_rls_policies.sql`
- [ ] `migrations/20XX_create_data_migrations_table.sql`

### Platform Components
- [ ] `components/platform/CompanySelector.tsx`
- [ ] `lib/platform/context/CompanyContext.tsx`
- [ ] `lib/platform/hooks/useCompany.ts`

### API Routes
- [ ] `app/api/platform/companies/list/route.ts`
- [ ] `app/api/social/connections/list/route.ts` (update to require companyId)

### Layout Updates
- [ ] `app/(platform)/layout.tsx` — add CompanyProvider, fix nav hierarchy
- [ ] `app/(platform)/company/[companyId]/social/layout.tsx` — remove or refactor
- [ ] `components/platform/PlatformNav.tsx` — add company selector slot
- [ ] `components/social/SocialSubNav.tsx` — create if doesn't exist

### Social Components
- [ ] `components/social/ProfileSelector.tsx`
- [ ] `components/social/PostComposer.tsx` — update to include profile selector, media upload, scheduling
- [ ] `app/(platform)/company/[companyId]/social/calendar/page.tsx` — fix date state management
- [ ] `app/(platform)/company/[companyId]/social/posts/page.tsx` — update post creation form

### Tests
- [ ] `__tests__/platform/company-selector.test.tsx`
- [ ] `__tests__/platform/company-context.test.tsx`
- [ ] `__tests__/scripts/audit-orphaned-assets.test.ts`
- [ ] `__tests__/rls/company-scoping.test.sql`

### Documentation
- [ ] Update `BUILD.md` with company hierarchy section
- [ ] Update `lib/platform/README.md` with company selector usage
- [ ] Update `lib/social/README.md` with company-scoping requirements
- [ ] Create `/docs/COMPANY_HIERARCHY.md` for future reference

---

## Open Questions for Steven

1. **Company creation:** Should Opollo staff be able to create new companies via UI, or is this an admin-only operation via Supabase dashboard?

2. **Multi-tenancy in V2:** Current constraint is one company per user. Is V2 still planned to support users belonging to multiple companies? (Affects CompanyContext design)

3. **Company logos:** Should company selector show logos? If yes, need to add `logo_url` column to `platform_companies` and upload UI.

4. **Default company for Opollo staff:** When Opollo staff log in, which company should be selected by default? Last-used (localStorage) or always prompt to choose?

5. **Post creation permissions:** Current proposal requires profile selection before saving draft. Should users be able to save "unassigned" drafts that aren't tied to specific profiles yet? Or is profile selection mandatory from the start?

6. **Calendar view scope:** Should calendar show posts for **all profiles in the company**, or should there be a profile filter (like Semrush's "All profiles" dropdown)?

---

## Summary for Claude Code

**You are tasked with implementing a complete company hierarchy and client selector system for Opollo Site Builder.**

**THIS IS NOT A PROTOTYPE. THIS IS NOT A PARTIAL IMPLEMENTATION. THIS IS THE FULL, PRODUCTION-READY FEATURE.**

Do not ask Steven to test until ALL acceptance criteria are met. Do not present partial work. Do not wait for incremental feedback. Build it completely, test it thoroughly yourself, then present for UAT.

**Start here:**
1. Read this entire proposal document
2. Read `/mnt/skills/user/n-series-layer-rules/SKILL.md`
3. Read `/mnt/skills/user/platform-customer-management/SKILL.md`
4. Create audit script (`audit-orphaned-assets.ts`) and run it
5. Report findings to Steven before proceeding with migration
6. Once approved, execute ALL remaining phases without stopping
7. Test yourself using the 4 UAT scenarios
8. Verify all 12 non-negotiable acceptance criteria pass
9. ONLY THEN present to Steven as "ready for UAT with customers"

**Critical rules:**
- Never bypass the platform layer for identity/company logic
- Follow N-Series layer rules (L1–L7 + Platform)
- All company-scoped data must have `company_id NOT NULL`
- All company-scoped data must have RLS policies
- Company selector must be visible on all platform routes
- Social submenu never replaces main platform nav
- Profile selection required for post creation
- Calendar month state managed via URL params only

**Style reference:**
- Semrush Social Poster screenshots show the target UX
- Clean, professional, accessible UI
- Company selector at top-left or in header
- Nested/two-level navigation (main + sub)

**Questions?**
- Ask Steven via this chat before proceeding with irreversible changes (database migrations)
- Flag any conflicts with existing code/patterns
- Propose alternatives if this design doesn't fit discovered constraints
- But **do not ask for permission to skip acceptance criteria** — they're all mandatory

**The goal:** V1 that is actually testable with real customers. Not perfect. Not V1.5. Just functional, safe, and usable.

Good luck. This unblocks UAT with Vincovi, ASCII Group, Skyview, and Planet6.
