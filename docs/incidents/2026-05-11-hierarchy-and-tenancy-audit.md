# Incident — Hierarchy and tenancy audit (investigation)

**Status:** Investigation complete. Two findings: one nav-placement defect (low risk), one latent publish-path bug (medium risk). No customer data leak found.
**Reporter:** Steven Morey
**Investigator:** Claude (autonomous)
**Date:** 2026-05-11
**Branch:** `investigate/hierarchy-and-tenancy-audit`
**Severity:** See individual findings below. No production customer data exposure confirmed.

---

## 1. Executive summary

This audit was triggered by two follow-on concerns raised after the bundle.social cross-tenant LinkedIn investigation (see `docs/incidents/2026-05-11-bundle-social-cross-tenant-leak.md`):

1. **Concern 1 — Brand hierarchy:** Brand settings are reached from within the Social section nav, suggesting they might be scoped to Social. Investigation confirms this is a **nav placement bug**, not a data-layer mis-scoping. `platform_brand_profiles` correctly uses `company_id NOT NULL`; the route lives at `/company/settings/brand` (outside social); only the nav places the link inside the Social section panel.

2. **Concern 2 — Cross-tenant safety across all modules:** All API endpoints use the `requireCanDoForApi` gate. No exploitable cross-tenant leak found across social, brand, media, invitations, or AI generation endpoints. One **latent publish-path bug** was found: `fire.ts` resolves the bundle.social team via the company-level team id rather than the profile-level team id, which means any future publish attempt on Planet6 or Skyview (the two companies with a company↔profile team mismatch) would silently fail at bundle.social level (no account on that team). This is a functional correctness bug, not a security issue. Zero publishes have ever been attempted in production.

No cross-tenant data leaks were found at the DB layer, route layer, or API gate layer.

---

## 2. Concern 1 — Brand settings navigation placement

### 2.1 Finding: nav mismatch, not data mismatch

The brand settings page is at:

```
app/(platform)/company/settings/brand/page.tsx
```

The Social section nav is defined in `components/nav/nav-config.ts`. The Brand item is listed *inside* the Social section panel:

```ts
// nav-config.ts (social section sectionNav.items)
{ label: "Brand", href: "/company/settings/brand", testId: "cnav-brand", requiresCompanyAdmin: true },
```

Surrounding items: Calendar, Posts, Connections, Media, Sharing, Analytics. Brand appears at the bottom of this same list. From the user's perspective, Brand is a leaf item under Social.

### 2.2 Data-layer result: correct

`platform_brand_profiles` schema (migration `0074_platform_audit_and_brand.sql`):

```sql
CREATE TABLE platform_brand_profiles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES platform_companies(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL DEFAULT 1,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  ...
  UNIQUE (company_id) WHERE is_active = true,
  ...
);
```

`company_id NOT NULL` with a unique-active constraint. Brand profiles are correctly scoped per company at the data layer.

Production state (2026-05-11):

| company | versions | active |
|---|---|---|
| Opollo | 1 | 1 |
| Vincovi | 0 | 0 |
| ASCII Group | 0 | 0 |
| Planet6 | 0 | 0 |
| Skyview | 0 | 0 |

Only the Opollo company (Steven's own) has a brand profile. No cross-company contamination possible.

### 2.3 Route-layer result: correct

`/company/settings/brand` is served by `app/(platform)/company/settings/brand/page.tsx`. It is **not** under `app/(platform)/company/social/`. No social-specific layout wraps it. The page reads brand data scoped to the current session's `company_id`.

### 2.4 Verdict: nav placement defect

The brand item was added to the Social section nav for convenience (it relates to the look-and-feel of social content). This is a UX hierarchy issue — brand logically belongs under a "Company Settings" section — but carries zero data risk. No platform_brand_profiles row can be read or mutated across company boundaries by the current code.

**Recommended fix (not blocking, lower-priority):** Move the Brand nav item from the Social section to either a dedicated `company/settings` section or a top-level Company Settings primary nav item. See follow-up ticket if created.

---

## 3. Concern 2 — Cross-tenant safety across all modules

### 3.1 API gate coverage

All platform API routes use `requireCanDoForApi(companyId, action)`, which gates on the authenticated session's company membership. Routes surveyed:

| Route | Gate | Cross-tenant input validated? |
|---|---|---|
| `POST /connections/connect` | `manage_connections` | BSP-10 guard verifies `profile.company_id === company_id` before `initiateProfileConnect` |
| `POST /connections/reconnect` | `manage_connections` | DB lookup `.eq("company_id", companyId)` on connection row |
| `POST /connections/sync` | `manage_connections` | `companyId` from body, gated |
| `POST /connections/disconnect` | `manage_connections` | DB lookup `.eq("company_id", companyId)` on connection row |
| `GET /connections/callback` | `manage_connections` | `company_id` from query param, gated |
| Brand read/update | `manage_brand` (or equivalent) | RLS + service-role scoped to company |
| Media upload/list | `manage_media` | `company_id` from body, gated |
| Invitations | admin-only | Session-derived company_id |
| AI image generation | Operator-only | `company_id` from body, gated |
| Publish schedule/fire | DB-derived | `company_id` resolved from schedule_entry → variant → post_master (no user input) |

No route accepts a cross-tenant resource reference without a DB-backed ownership check.

### 3.2 RLS coverage

All platform tables are RLS-enabled with `company_id`-scoped policies. The service-role client is used only in server-only modules; the Supabase anon/authenticated roles hit RLS on all platform tables. Key tables:

- `social_connections` — SELECT/INSERT/UPDATE require `company_id = auth.uid()` (via session)
- `platform_social_profiles` — same
- `platform_brand_profiles` — same
- `social_post_master` / `social_post_variant` — company_id on master; variant inherits via FK
- `platform_companies` — admin-only mutations

### 3.3 Sync.ts identity-fingerprint guard (fix/social-identity-fingerprints branch)

The current `fix/social-identity-fingerprints` branch (not yet merged) introduces a Layer 2 cross-tenant guard in `sync.ts`. On every incoming INSERT, `checkCrossTenantConflict` hashes the platform-side identity (`externalId`, `userId`) and blocks the insert if the same identity is already owned by a different company. This directly addresses the `userId` reuse finding from the first investigation (Steven's LinkedIn on 4 teams). Until that branch merges, the guard is absent in production.

### 3.4 Production social connections state (2026-05-11)

| company | connections | platform(s) | status |
|---|---|---|---|
| Planet6 | 2 | linkedin_personal, gbp | healthy |
| Skyview | 1 | linkedin_personal | healthy |
| Opollo | 0 | — | — |
| Vincovi | 0 | — | — |
| ASCII Group | 0 | — | — |

No `bundle_social_account_id` appears under more than one `company_id` in `social_connections`. Confirmed by Part 10 query: 3 unique account ids, 0 cross-company duplicates.

### 3.5 Latent publish-path bug: company team vs profile team

**File:** `lib/platform/social/publishing/fire.ts:218`

```ts
// Step 2: resolve the per-company bundle.social team id.
teamId = await getOrCreateBundleSocialTeam(claim.company_id!);
```

`getOrCreateBundleSocialTeam` reads (or provisions) `platform_companies.bundle_social_team_id` — the **company-level** team. But since BSP-1 (migration `0119`), new connections are attributed to **per-profile** teams. For Planet6 and Skyview, the company-level team and the profile-level team are **different** bundle.social team IDs, and the accounts are on the profile teams:

| company | company_team (fire.ts resolves) | profile_team (accounts live here) | mismatch |
|---|---|---|---|
| Opollo | `2960f6ea` | `2960f6ea` | no |
| Vincovi | `13e01e42` | `13e01e42` | no |
| ASCII Group | NULL | `e7d0cc78` | yes (company team is null) |
| Planet6 | `ba9ca0b2` | `ca1fbd1c` | yes |
| Skyview | `1acf9761` | `5313a67d` | yes |

**Impact:** If any publish were attempted for Planet6 or Skyview, `postCreate` would be called against the empty/null company-level team. bundle.social would return an error ("no account of that type on this team"), and `markMasterFailed` would fire immediately. The post master would land in `failed` state. No cross-tenant data exposure — the failure is local to the originating company's publish pipeline.

**Blast radius:** Limited to Planet6 and Skyview. Opollo and Vincovi are unaffected. ASCII Group would fail even earlier (company team is NULL → `getOrCreateBundleSocialTeam` would provision a fresh empty team, then postCreate would fail the same way).

**Zero publishes in production:** As of 2026-05-11, `social_post_master`, `social_post_variant`, `social_schedule_entries`, `social_publish_jobs`, and `social_publish_attempts` all have **zero rows**. The publish path has never been exercised. The bug is latent.

**Severity:** Medium. Any attempt to publish on Planet6/Skyview/ASCII Group would immediately fail loudly — no silent data corruption, no cross-tenant leak. Fix is to resolve the profile team id instead of the company team id in `fire.ts`. Tracked as a follow-up fix before publishing is enabled for customers.

### 3.6 Verdict: no exploitable cross-tenant leak found

All modules correctly gate on `company_id`. DB-layer invariants hold. The only active security gap (LinkedIn `userId` reuse) is a testing artefact and is being addressed by `fix/social-identity-fingerprints`. The only production risk is the latent publish-path bug, which is functional correctness, not a security issue.

---

## 4. DB evidence — key queries

All queries run against production at 2026-05-11T12:00:13Z using service-role client.

### Q1 — Companies + team ids

```
[Opollo]       company_team=2960f6ea  profile_team=2960f6ea  mismatch=no
[Vincovi]      company_team=13e01e42  profile_team=13e01e42  mismatch=no
[ASCII Group]  company_team=NULL      profile_team=e7d0cc78  mismatch=yes
[Planet6]      company_team=ba9ca0b2  profile_team=ca1fbd1c  mismatch=yes
[Skyview]      company_team=1acf9761  profile_team=5313a67d  mismatch=yes
```

### Q2 — social_connections rows

3 rows total: Planet6 ×2 (LinkedIn + GBP), Skyview ×1 (LinkedIn). All `deleted_at = NULL`, all `status = healthy`. No connections for Opollo, Vincovi, ASCII Group.

### Q3 — Publishing state

- `social_post_master`: 0 rows
- `social_post_variant`: 0 rows
- `social_schedule_entries`: 0 rows
- `social_publish_jobs`: 0 rows
- `social_publish_attempts`: 0 rows

### Q4 — Brand profiles

1 row in `platform_brand_profiles`, belonging to Opollo (is_active=true, version=1). No other companies have brand profiles.

### Q5 — Cross-tenant account-id duplicates

0 rows: no `bundle_social_account_id` appears under more than one `company_id`.

---

## 5. Summary of findings

| # | Finding | Severity | Fix required before | Status |
|---|---|---|---|---|
| F1 | Brand nav item placed in Social section nav (`nav-config.ts`) | Low (UX only) | Customer launch | Open — needs separate PR |
| F2 | `fire.ts` uses company-level bundle.social team; accounts are on profile teams for 3 companies | Medium (functional) | Publishing goes live | Latent — no publish rows exist yet |
| F3 | LinkedIn `userId` reuse across 4 teams (Steven's UAT accounts) | Medium (security — testing artefact) | Next customer onboards | In progress — `fix/social-identity-fingerprints` branch |

---

## 6. Open actions

| Action | Owner | Priority |
|---|---|---|
| Move Brand from Social section nav to Company Settings section | Engineering | Low |
| Fix `fire.ts` to resolve profile team id instead of company team id | Engineering | Medium — before first customer publish |
| Merge `fix/social-identity-fingerprints` to add identity-fingerprint guard | Engineering | High — before next customer social connect |

---

*Investigation script: `scripts/_tmp_hierarchy_investigation.ts` (not committed; run from project root with `npx tsx scripts/_tmp_hierarchy_investigation.ts`).*
