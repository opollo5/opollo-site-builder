# Feature Inventory — Phase 1

**Status:** Phase 1 complete. Ready for Phase 2 (Steven fills EXPECTED BEHAVIOUR).
**Generated:** 2026-05-26
**Branch:** `docs/feature-inventory-phase-1`

This inventory is the foundation for behavioural UAT coverage. It catalogs
every page, component, route, state machine, form, endpoint, and user-facing
action across the platform so that Phase 2 can systematically define correct
behaviour and Phase 3 can write UAT specs to enforce it.

---

## Documents

| Document | Items | Phase 2 fill | Status |
|---|---|---|---|
| [routes-and-pages.md](routes-and-pages.md) | 100 routes | 0 / 100 | ✅ Phase 1 complete |
| [state-machines.md](state-machines.md) | 16 entities | 0 / 16 | ✅ Phase 1 complete |
| [api-endpoints.md](api-endpoints.md) | 284 endpoints | 0 / 284 | ✅ Phase 1 complete |
| [components-catalog.md](components-catalog.md) | 108 components | 0 / 108 | ✅ Phase 1 complete |
| [forms-and-validation.md](forms-and-validation.md) | 29 forms | 0 / 29 | ✅ Phase 1 complete |
| [roles-and-permissions.md](roles-and-permissions.md) | 2 role systems | 0 / 2 | ✅ Phase 1 complete |
| [discovered-issues.md](discovered-issues.md) | 10 issues | — | ✅ See below |

---

## Feature Area Coverage

### Routes (100 total)

| Feature area | Routes | Phase 2 priority |
|---|---|---|
| Auth & Onboarding | 14 | P0 — every auth bug = lost user |
| Company — Social Calendar & Composer | 5 | P0 — core product surface |
| Company — Social Posts | 3 | P1 |
| Company — Connections | 3 | P1 |
| Company — Settings & Users | 5 | P1 |
| Admin — Sites | 17 | P1 |
| Admin — Batches & Posts | 5 | P2 |
| Admin — Companies & CAP | 8 | P1 |
| Admin — Images & Media | 3 | P2 |
| Admin — Social Profiles | 4 | P2 |
| Admin — Insights | 5 | P2 |
| Admin — Users & System | 5 | P1 |
| Admin — Design System & Settings | 6 | P2 |
| Optimiser | 9 | P1 |
| Public & Token-gated | 7 | P0 — approval flows |
| Dev/Internal | 1 | P2 |

### State Machines (16 entities)

| Entity | States | Phase 2 priority |
|---|---|---|
| social_post_drafts | 9 | P0 — core social product |
| social_connections | 4 | P0 — publishing depends on this |
| opt_proposals | 10 | P1 — Optimiser revenue |
| cap_subscriptions | 4 | P1 — CAP billing |
| cap_campaigns / cap_campaign_posts | 8 each | P1 |
| brief_runners | 6 | P1 — brief generation |
| briefs | 4 | P2 |
| sites | 4 | P2 |
| generation_jobs / generation_job_pages | 6 / 8 | P2 |
| opt_landing_pages | 4 | P2 |
| opt_staged_rollouts | 5 | P2 |
| design_systems | 3 | P3 |
| invites / platform_event_deliveries | 4 / 5 | P2 |

### API Endpoints (284 total)

| Area | Count | Risk breakdown |
|---|---|---|
| Platform Social (posts, drafts, connections, media) | ~60 | Many CRITICAL/HIGH |
| Admin (sites, companies, images, users, insights) | ~80 | HIGH |
| Optimiser | ~25 | MEDIUM/HIGH |
| CAP | ~12 | MEDIUM |
| Auth | ~10 | CRITICAL |
| Cron & Internal | ~43 | HIGH |
| Webhooks | 3 | CRITICAL |
| Briefs & Chat | ~20 | HIGH |
| Design Systems & Sites | ~30 | MEDIUM |
| Utility (health, debug, ops) | ~8 | LOW |

### Components (108 total)

| Category | Count |
|---|---|
| Social Composer | 22 |
| Social Dashboard (calendar, timeline) | 8 |
| Social Preview Cards | 5 |
| Admin / Site management | 35 |
| Platform (companies, invites, users) | 12 |
| Optimiser | 17 |
| UI Primitives | 33 |
| Other (session, SEO, review) | 5 |

### Forms (29 total)

| Category | Count |
|---|---|
| Auth (login, reset, forgot, accept invite) | 5 |
| Site management | 5 |
| Social composer & scheduling | 4 |
| Platform (company create, invite) | 4 |
| Admin (batch, design system, user invite) | 5 |
| Account settings | 2 |
| Optimiser | 4 |

### Roles (2 systems)

| System | Roles |
|---|---|
| Opollo staff (opollo_users) | super_admin, admin, user |
| Company member (platform_company_users) | admin, approver, editor, viewer |

---

## Discovered Issues (10)

Issues found during Phase 1 investigation. None are fixed here — they are
logged for future PRs.

| ID | Title | Severity | Related to |
|---|---|---|---|
| DI-001 | `user` role declared but never granted | P2 | roles |
| DI-002 | Connect platform page is a stub redirect | P1 | routes |
| DI-003 | Bulk CSV upload bypasses `schedule_post` permission | P0 | permissions + API |
| DI-004 | 97 of 100 routes missing `loading.tsx` | P2 | routes |
| DI-005 | CLAUDE-ASSUMPTION stub label in production code | P2 | routes |
| DI-006 | V1 and V2 post models coexist with different state enums | P1 | state machines |
| DI-007 | Implicit Opollo staff admin grant not audit-logged | P1 | permissions |
| DI-008 | CAP campaign_post state machine has no UI affordances | P2 | state machines |
| DI-009 | Review token revocation not documented | P1 | routes + state |
| DI-010 | ApprovalToggle + schedule_post permission gap | P1 | permissions + components |

Full details: [discovered-issues.md](discovered-issues.md)

---

## Phase 2 — How to fill EXPECTED BEHAVIOUR

Every document in this inventory contains sections like:

```markdown
**EXPECTED BEHAVIOUR (Steven to fill):**
- [ ] What should happen when clicking a published post?
- [ ] What's the empty state for a month with zero posts?
```

**Instructions for Steven:**
1. Open each document and search for `- [ ]`
2. Replace `- [ ]` with `- [x]` and fill in the expected behaviour as a brief rule
3. Where behaviour is "it depends", note the conditions
4. Skip items that are clearly not a UAT concern (dev-only, internal tooling)
5. Flag items that require design/product decisions with `⚠️ DECISION NEEDED`

**Suggested order (highest Phase 2 ROI first):**
1. `routes-and-pages.md` — Auth section (14 routes, P0 security)
2. `state-machines.md` — social_post_drafts (9 states, core product)
3. `state-machines.md` — social_connections (4 states, publishing depends on this)
4. `roles-and-permissions.md` — company roles section
5. `routes-and-pages.md` — Company Social section (5 routes)
6. `forms-and-validation.md` — Auth forms (5 forms)
7. `api-endpoints.md` — Platform Social section (critical endpoints)

---

## Phase 3 — Converting to UAT Specs

Once Steven fills EXPECTED BEHAVIOUR in Phase 2, a Phase 3 session will:

1. Read all filled checkboxes
2. Convert each filled rule into a Playwright `test()` spec in `e2e/uat/`
3. Group by feature area into spec files (e.g. `e2e/uat/social-calendar.spec.ts`)
4. Run against staging to verify the rules are true today
5. Commit as the baseline UAT suite

**Spec naming convention:** `e2e/uat/<feature-area>.spec.ts`
**Config:** `playwright.uat.config.ts` (targets staging, uses UAT bot credentials)

---

## Current UAT Coverage Baseline

The existing UAT harness (before this inventory) has ~54 passing specs:

| Area | Specs |
|---|---|
| Auth (login, 2FA, logout) | ~8 |
| Composer (open, close, state-aware read-only) | ~15 |
| Calendar (render, navigation) | ~6 |
| Admin page loads | ~10 |
| Social connections (connect, disconnect) | ~8 |
| Misc | ~7 |

After Phase 2 + Phase 3, the target is comprehensive coverage of all
P0 and P1 items in this inventory.
