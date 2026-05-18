# Framework Wave Plan

Four waves. Each wave is ~2 weeks of focused work. Build templates in this order; migrate the routes listed under each template in the same wave.

After each wave, run the verification gate (`FRAMEWORK_BUILD_BRIEF.md` §"Verification gate"). Do not start the next wave until the current one's gate is green.

---

## Wave 0 — Precondition (must complete before Wave 1)

Commission the four shared primitives. These are needed by both the composer workstream PR C and Wave 1 here. If the composer workstream has already shipped PR C, this is done; otherwise build it here.

- [ ] `components/ui/callout.tsx` — per D-10
- [ ] `components/ui/section-header.tsx` — per D-7
- [ ] `components/ui/pagination.tsx` — per D-8
- [ ] `components/ui/empty-state.tsx` — conform to D-9 signature

Verification:
```bash
pnpm test components/ui/{callout,section-header,pagination,empty-state}
```

---

## Wave 1 — Unblock social + critical detail (~30 routes)

The four templates that block the highest-pain current state.

### T-DETAIL-TABBED (1 route)

The composer workstream's `/company/social/posts/[id]` is the canonical implementation. Generalise it into a template after the composer ships PR H.

- [ ] `/company/social/posts/[id]` — *critical, RECURRING-2 fix*

### T-LIST-STANDARD (Wave-1 subset, 7 routes)

- [ ] `/admin/sites` — *critical*
- [ ] `/admin/sites/[id]/content` — *critical*
- [ ] `/admin/sites/[id]/posts` — *critical*
- [ ] `/admin/sites/[id]/pages` — *critical*
- [ ] `/company/social/posts` — *critical*
- [ ] `/company/social/connections` — *critical*

Remaining T-LIST-STANDARD routes (`/admin/posts`, `/admin/batches`, `/admin/sites/[id]/briefs/[brief_id]/run`, `/optimiser/proposals`, `/optimiser/change-log`, `/company/users`, `/admin/sites/[id]/design-system/templates`) move to Wave 2 to reduce first-wave fatigue and concentrate visible wins on the customer-facing social surfaces.

### T-DASHBOARD-FEED (3 routes — Wave 1 subset)

- [ ] `/company/social/calendar` (full-bleed) — *fixes R23*
- [ ] `/company/social/timeline`
- [ ] `/admin/maintenance`

Remaining T-DASHBOARD-FEED routes (`/admin/_internal/table-examples`, `/company/internal/autosave-lab`) move to Wave 2 — internal-facing only, no first-wave urgency.

### T-DASHBOARD-KPI (5 routes)

- [ ] `/company` (adopts PageShell per D-3)
- [ ] `/company/social/analytics`
- [ ] `/admin/companies/[id]/social-profiles/[profileId]/analytics`
- [ ] `/admin/system/jobs`
- [ ] `/optimiser/diagnostics`

### Wave 1 verification gate

```bash
pnpm typecheck
pnpm lint
pnpm build
pnpm test
pnpm audit:static --templates=T-DETAIL-TABBED,T-LIST-STANDARD,T-DASHBOARD-FEED,T-DASHBOARD-KPI
```

Wave 1 routes affected: 15 routes (reduced from 18 to concentrate on customer-facing social surfaces). Plus a follow-up PR for the PageShell migration in `/optimiser` (per D-3, ordered first), `/company`, and `/company/social` modules.

---

## Wave 2 — Cover admin bulk (~35 routes)

The largest volume by route count.

### T-DETAIL-SUMMARY (~12 routes)

- [ ] `/admin/sites/[id]` — *critical*
- [ ] `/admin/sites/[id]/appearance`
- [ ] `/admin/companies/[id]`
- [ ] `/admin/companies/[id]/social-profiles/[profileId]/connections`
- [ ] `/admin/batches/[siteId]`
- [ ] `/admin/batches/[siteId]/[batchId]`
- [ ] `/admin/images/[id]`
- [ ] `/admin/sites/[id]/design-system` (layout-driven)
- [ ] `/admin/sites/[id]/design-system/preview` (layout-driven)
- [ ] `/optimiser/pages/[id]`
- [ ] `/optimiser/proposals/[id]` — *critical*
- [ ] `/optimiser/imports/[brief_id]`

Note: `/admin/sites/[id]/posts/[post_id]` is T-DETAIL-EDITOR per `DECISIONS_LOCKED.md` Q1 — moves to Wave 3.

### T-FORM (~6 routes)

- [ ] `/admin/sites/new`
- [ ] `/admin/sites/[id]/edit`
- [ ] `/admin/sites/[id]/posts/new`
- [ ] `/admin/companies/new`
- [ ] `/admin/posts/[siteId]/new`
- [ ] `/admin/email-test`

### T-LIST-WIDE (~10 routes)

- [ ] `/admin/users`
- [ ] `/admin/users/audit`
- [ ] `/admin/companies`
- [ ] `/admin/companies/[id]/social-profiles`
- [ ] `/admin/maintenance/social-connections`
- [ ] `/admin/images` — migrated from `width=none` per D-11
- [ ] `/admin/posts` (deferred from Wave 1, downgraded from empty-stub)
- [ ] `/admin/batches` (deferred from Wave 1, downgraded from empty-stub)
- [ ] `/admin/sites/[id]/briefs/[brief_id]/run` (deferred from Wave 1)
- [ ] `/admin/sites/[id]/design-system/templates` (layout-driven, deferred from Wave 1)

### Wave 2 additions (deferred from Wave 1 per first-wave-fatigue reduction)

- [ ] `/optimiser/proposals` — *critical*, T-LIST-STANDARD
- [ ] `/optimiser/change-log` — T-LIST-STANDARD
- [ ] `/company/users` — T-LIST-STANDARD
- [ ] `/admin/_internal/table-examples` — T-DASHBOARD-FEED
- [ ] `/company/internal/autosave-lab` — T-DASHBOARD-FEED

### T-SETTINGS-FLAT (~7 routes)

- [ ] `/admin/sites/[id]/settings`
- [ ] `/admin/settings/design-system`
- [ ] `/account/security`
- [ ] `/account/devices`
- [ ] `/company/settings/brand`
- [ ] `/optimiser/clients/[id]/settings` — *critical*
- [ ] `/company/social/sharing`

### Wave 2 verification gate

```bash
pnpm audit:static --templates=T-DETAIL-SUMMARY,T-FORM,T-LIST-WIDE,T-SETTINGS-FLAT
```

Plus the cumulative gate from Wave 1 (those templates still pass).

---

## Wave 3 — Specialised (~11 routes)

Editor + wizard surfaces. Lower volume but each one is non-trivial.

### T-DETAIL-EDITOR (2 routes)

- [ ] `/admin/sites/[id]/posts/[post_id]` — *critical, per DECISIONS_LOCKED.md Q1*
- [ ] `/admin/sites/[id]/pages/[pageId]` — *critical, RECURRING-1 fix*

### T-WIZARD-STEP (~5 routes)

- [ ] `/admin/sites/[id]/setup`
- [ ] `/admin/sites/[id]/setup/extract`
- [ ] `/admin/sites/[id]/onboarding`
- [ ] `/optimiser/onboarding`
- [ ] `/optimiser/onboarding/[id]`

### T-REVIEW-LINK (2 routes)

- [ ] `/admin/sites/[id]/briefs/[brief_id]/review` — *critical*
- [ ] `/admin/sites/[id]/blueprints/review` — *critical*

### T-GRID (2 routes)

- [ ] `/admin/sites/[id]/design-system/components` (layout-driven)
- [ ] `/company/social/media`

### Wave 3 verification gate

```bash
pnpm audit:static --templates=T-DETAIL-EDITOR,T-WIZARD-STEP,T-REVIEW-LINK,T-GRID
```

---

## Wave 4 — Edge (~16 routes)

Public + redirects. Smallest visible impact but closes the audit.

### T-AUTH-CHROME (~10 routes)

- [ ] `/login`
- [ ] `/login/check-email`
- [ ] `/auth/forgot-password`
- [ ] `/auth/reset-password`
- [ ] `/auth/accept-invite`
- [ ] `/invite/[token]`
- [ ] `/auth/approve`
- [ ] `/auth/callback` (full-bleed)
- [ ] `/auth/expired`

### T-FULL-BLEED-EDITOR (1 route)

- [ ] `/company/image/generate`

### T-ERROR-STATE (1 route)

- [ ] `/auth-error`

### T-REDIRECT-STUB (4 routes — no component, just config)

- [ ] `/admin`
- [ ] `/admin/posts/new`
- [ ] `/admin/settings`
- [ ] `/company/social`

Add these to `PAGE_HEADER_EXEMPT_ROUTES` in the audit config.

### Wave 4 final closeout gate

```bash
# Full framework verification
pnpm typecheck
pnpm lint
pnpm build
pnpm test
pnpm audit:static                          # zero violations across the full 82-route audit
pnpm audit:static --r-divergences          # zero R-violations
```

Plus enable `audit:static` as a CI required check on every PR going forward (add to GitHub Actions).

---

## Cumulative progress tracking

Append to `framework/PROGRESS.md` (Claude Code creates if it doesn't exist) after each wave:

```
## Wave 1 complete YYYY-MM-DD
- Templates shipped: T-DETAIL-TABBED, T-LIST-STANDARD, T-DASHBOARD-FEED, T-DASHBOARD-KPI
- Routes migrated: 18
- R-divergences resolved: R3, R4, R5, R23, RECURRING-2 (and partially R8, R10, R14)
- audit:static violations remaining: <number>
- Notes: <any deviations from this plan>
```

The framework is done when Wave 4's gate passes and `audit:static` returns zero violations.
