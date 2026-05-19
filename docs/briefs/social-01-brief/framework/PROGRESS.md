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
