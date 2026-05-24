// ---------------------------------------------------------------------------
// Single source of truth for ALL navigation items.
//
// DO NOT render nav items anywhere else — add them here and let
// PrimaryNav + SectionNav read this config.
//
// Icons are Linearicons class names (without the `icon-` prefix). Browse
// `assets/Linearicons/demo.html` for the full list of 1097 available icons.
// ---------------------------------------------------------------------------

export type NavUserContext = {
  email: string | null;
  role: "super_admin" | "admin" | "user" | null;
  isOpolloStaff: boolean;
  isCompanyAdmin: boolean;
  companyId: string | null;
  companyName: string | null;
};

export type SectionNavItem = {
  label: string;
  href: string;
  testId?: string;
  requiresCompanyAdmin?: boolean;
  requiresSuperAdmin?: boolean;
};

export type SectionNavGroup = {
  label: string | null;
  items: SectionNavItem[];
};

export type SectionNavConfig = {
  title: string;
  showCompanySelector?: boolean;
  showSiteSelector?: boolean;
  /** Index of the siteId in pathname.split("/") — used to extract the active site from the URL. */
  siteIdSegment?: number;
  /** Href template for site-switch navigation. "{siteId}" is replaced with the selected site's id. */
  siteSelectPath?: string;
  groups: SectionNavGroup[];
};

export type PrimaryNavItem = {
  key: string;
  label: string;
  icon: string;
  href: string;
  pathPrefixes: string[];
  testId?: string;
  sectionNav: SectionNavConfig | null;
  requiresAdminTier?: boolean;
  requiresSuperAdmin?: boolean;
};

export const primaryNavItems: PrimaryNavItem[] = [
  {
    key: "sites",
    label: "Sites",
    icon: "earth",
    href: "/admin/sites",
    pathPrefixes: ["/admin/sites"],
    testId: "nav-sites",
    sectionNav: null,
  },
  {
    key: "posts",
    label: "Blog",
    icon: "blog",
    href: "/admin/posts",
    pathPrefixes: ["/admin/posts"],
    testId: "nav-post-blog",
    sectionNav: {
      title: "Blog",
      showSiteSelector: true,
      siteIdSegment: 3,
      siteSelectPath: "/admin/posts/{siteId}/new",
      groups: [
        {
          label: null,
          items: [
            { label: "New post", href: "/admin/posts/{siteId}/new", testId: "cnav-new-post" },
            { label: "Bulk upload", href: "/admin/posts/{siteId}/new", testId: "cnav-bulk-upload" },
          ],
        },
      ],
    },
  },
  {
    key: "batches",
    label: "Batches",
    icon: "layers",
    href: "/admin/batches",
    pathPrefixes: ["/admin/batches"],
    testId: "nav-batches",
    sectionNav: {
      title: "Batches",
      showSiteSelector: true,
      siteIdSegment: 3,
      siteSelectPath: "/admin/batches/{siteId}",
      groups: [
        {
          label: null,
          items: [
            { label: "All batches", href: "/admin/batches/{siteId}", testId: "cnav-batches" },
          ],
        },
      ],
    },
  },
  {
    key: "images",
    label: "Images",
    icon: "picture",
    href: "/admin/images",
    pathPrefixes: ["/admin/images"],
    testId: "nav-images",
    sectionNav: null,
  },
  {
    key: "social",
    label: "Social",
    icon: "share2",
    href: "/company/social/calendar",
    pathPrefixes: ["/company/"],
    testId: "nav-social",
    sectionNav: {
      title: "Social",
      showCompanySelector: true,
      groups: [
        {
          label: null,
          items: [
            { label: "Calendar", href: "/company/social/calendar", testId: "cnav-calendar" },
            { label: "Posts", href: "/company/social/posts", testId: "cnav-posts" },
            { label: "Connections", href: "/company/social/connections", testId: "cnav-connections" },
            { label: "Media", href: "/company/social/media", testId: "cnav-media" },
            { label: "Sharing", href: "/company/social/sharing", testId: "cnav-sharing", requiresCompanyAdmin: true },
            { label: "Analytics", href: "/company/social/analytics", testId: "cnav-analytics" },
            { label: "Insights", href: "/company/social/insights", testId: "cnav-insights" },
          ],
        },
        {
          label: "Account",
          items: [
            { label: "Users", href: "/company/users", testId: "cnav-users" },
            { label: "Brand", href: "/company/settings/brand", testId: "cnav-brand", requiresCompanyAdmin: true },
          ],
        },
      ],
    },
  },
  {
    key: "optimiser",
    label: "Optimiser",
    icon: "chart-growth",
    href: "/optimiser",
    pathPrefixes: ["/optimiser"],
    testId: "nav-optimiser",
    requiresAdminTier: true,
    sectionNav: {
      title: "Optimiser",
      groups: [
        {
          label: null,
          items: [
            { label: "Pages", href: "/optimiser", testId: "nav-opt-pages" },
            { label: "Proposals", href: "/optimiser/proposals", testId: "nav-opt-proposals" },
            { label: "Change log", href: "/optimiser/change-log", testId: "nav-opt-changelog" },
            { label: "Onboarding", href: "/optimiser/onboarding", testId: "nav-opt-onboarding" },
            { label: "Diagnostics", href: "/optimiser/diagnostics", testId: "nav-opt-diagnostics" },
          ],
        },
      ],
    },
  },
  {
    key: "users",
    label: "Users",
    icon: "users",
    href: "/admin/users",
    pathPrefixes: ["/admin/users"],
    testId: "nav-users",
    sectionNav: null,
    requiresAdminTier: true,
  },
  {
    key: "companies",
    label: "Companies",
    icon: "apartment",
    href: "/admin/companies",
    pathPrefixes: ["/admin/companies"],
    testId: "nav-companies",
    sectionNav: null,
    requiresAdminTier: true,
  },
  {
    key: "admin-tools",
    label: "Admin",
    icon: "shield-check",
    href: "/admin/users/audit",
    pathPrefixes: [
      "/admin/users/audit",
      "/admin/system",
      "/admin/email-test",
      "/admin/settings",
      "/admin/maintenance",
      "/admin/insights",
    ],
    testId: "nav-admin-tools",
    sectionNav: {
      title: "Admin",
      groups: [
        {
          label: null,
          items: [
            { label: "Insights", href: "/admin/insights", testId: "nav-admin-insights" },
            { label: "Audit log", href: "/admin/users/audit", testId: "nav-audit-log" },
            { label: "System jobs", href: "/admin/system/jobs", testId: "nav-system-jobs" },
            { label: "Maintenance", href: "/admin/maintenance", testId: "nav-maintenance" },
            { label: "Email test", href: "/admin/email-test", testId: "nav-email-test" },
            { label: "Design system", href: "/admin/settings/design-system", testId: "nav-design-system-settings" },
          ],
        },
      ],
    },
    requiresSuperAdmin: true,
  },
];

// Bottom-rail items — per spec, ONLY ⌘K and Sign out.
// Account surfaces (Security, Devices) live behind the avatar/dropdown
// or under the Admin section nav, not in the always-visible footer rail.
export type BottomNavItem = {
  key: string;
  label: string;
  icon: string;
  href?: string;
  pathPrefixes?: string[];
  kind: "link" | "signout" | "cmdpalette";
  testId?: string;
  requiresUser?: boolean;
};

export const bottomNavItems: BottomNavItem[] = [
  {
    key: "cmdpalette",
    label: "Search",
    icon: "magnifier",
    kind: "cmdpalette",
  },
  {
    key: "signout",
    label: "Sign out",
    icon: "exit",
    kind: "signout",
    testId: "nav-sign-out",
    requiresUser: true,
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the key of the primary nav item that best matches the current path.
 * Uses longest-prefix-match so /admin/users/audit → admin-tools (not users).
 */
export function getActiveSectionKey(
  pathname: string,
  items: PrimaryNavItem[],
): string | null {
  let bestKey: string | null = null;
  let bestLen = -1;

  for (const item of items) {
    for (const prefix of item.pathPrefixes) {
      if (pathname === prefix || pathname.startsWith(prefix + "/") || pathname.startsWith(prefix)) {
        if (prefix.length > bestLen) {
          bestLen = prefix.length;
          bestKey = item.key;
        }
      }
    }
  }

  return bestKey;
}

export function filterPrimaryItems(
  items: PrimaryNavItem[],
  ctx: NavUserContext,
): PrimaryNavItem[] {
  const isAdminTier =
    ctx.role === "admin" || ctx.role === "super_admin";
  const isSuperAdmin = ctx.role === "super_admin";

  return items.filter((item) => {
    if (item.requiresSuperAdmin && !isSuperAdmin) return false;
    if (item.requiresAdminTier && !isAdminTier) return false;
    return true;
  });
}

export function filterSectionItems(
  items: SectionNavItem[],
  ctx: NavUserContext,
): SectionNavItem[] {
  const isSuperAdmin = ctx.role === "super_admin";
  return items.filter((item) => {
    if (item.requiresCompanyAdmin && !ctx.isCompanyAdmin) return false;
    if (item.requiresSuperAdmin && !isSuperAdmin) return false;
    return true;
  });
}
