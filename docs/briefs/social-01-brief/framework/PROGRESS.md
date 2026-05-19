## Wave 2c in progress 2026-05-19

- Templates used: T-FORM (6 routes), T-SETTINGS-FLAT (7 routes)
- Routes migrated (T-FORM): /admin/sites/new, /admin/sites/[id]/edit, /admin/sites/[id]/posts/new, /admin/companies/new, /admin/posts/[siteId]/new, /admin/email-test
- Routes migrated (T-SETTINGS-FLAT): /admin/sites/[id]/settings, /admin/settings/design-system, /account/security, /account/devices, /company/settings/brand, /optimiser/clients/[id]/settings, /company/social/sharing
- Deviations: company/settings/brand and optimiser/clients/[id]/settings retain card wrappers inside section content (layout intentional); CustomerBrandProfileEditor gained hidePageHeader prop to avoid duplicate H1

## Wave 2b complete 2026-05-19

- Template updated: TDetailSummarySection.title optional; subtitle widened to ReactNode
- Routes migrated: 10 (T-DETAIL-SUMMARY: /admin/companies/[id], /admin/companies/[id]/social-profiles/[profileId]/connections, /admin/sites/[id], /admin/sites/[id]/appearance, /admin/batches/[siteId]/[batchId], /admin/images/[id], /optimiser/proposals/[id], /optimiser/pages/[id], /optimiser/imports/[brief_id]; TListStandard: /admin/batches/[siteId])
- Deviation: /admin/batches/[siteId] used TListStandard (list semantics better fit than T-DETAIL-SUMMARY)
- Deferred: /admin/sites/[id]/design-system, /admin/sites/[id]/design-system/preview — both "use client" layout-driven; shell from client layout, not PageShell/PageHeader; require layout refactor

## Wave 2a complete 2026-05-19

- Templates added: T-LIST-WIDE, T-DETAIL-SUMMARY, T-FORM, T-SETTINGS-FLAT
- Routes migrated: 11 (T-LIST-WIDE: /admin/users, /admin/users/audit, /admin/companies, /admin/maintenance/social-connections, /admin/images; T-LIST-STANDARD deferred: /optimiser/proposals, /optimiser/change-log, /company/users; T-DASHBOARD-FEED deferred: /admin/_internal/table-examples, /company/internal/autosave-lab)
- Wave 2b (T-DETAIL-SUMMARY) and Wave 2c (T-FORM + T-SETTINGS-FLAT) to follow

## Wave 1 complete 2026-05-19

- Templates shipped: T-DETAIL-TABBED, T-LIST-STANDARD, T-DASHBOARD-FEED, T-DASHBOARD-KPI
- Routes migrated: 15
- R-divergences resolved: RECURRING-2 (D-4 sticky footerActions fix on post detail), R23 (calendar full-bleed PageShell)
- audit:static violations remaining: 0 HIGH, 17 MEDIUM (all pre-existing)
- Notes:
  - T-LIST-STANDARD: company/social/posts and connections pages still wrap SocialModuleShell
    internally — the shell provides the Calendar/Posts/Timeline tab navigation. The deeper
    SocialModuleShell refactoring is deferred to the Wave 2 follow-up PR per WAVE_PLAN note
    ("follow-up PR for the PageShell migration in /company/social modules").
  - T-DASHBOARD-FEED timeline page: SocialModuleShell replaced by TDashboardFeed; PillTabs
    are now in the feed content area (first element) rather than a toolbar slot.
  - T-DETAIL-TABBED: Created PostDetailTabbedClient as the canonical RSC-hole wrapper pattern.
    Server page passes conditional section content as ReactNode props; client component
    assembles the tabs array based on which sections are non-null.
  - audit:static --templates flag does not exist in the actual script; ran without flag.
