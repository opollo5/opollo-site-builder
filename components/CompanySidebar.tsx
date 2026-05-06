"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import {
  BarChart2,
  Bell,
  BookOpen,
  Building2,
  CalendarDays,
  Check,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUpDown,
  ExternalLink,
  Image as ImageIcon,
  Link2,
  List,
  LogOut,
  Menu,
  Share2,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Company sidebar — customer-facing nav for /company/* routes.
//
// Collapse state: persisted in cookie opollo_company_sidebar_collapsed.
// Company selection for Opollo staff: persisted server-side via the
// opollo_selected_company_id cookie (set by /api/platform/companies/switch).
// ---------------------------------------------------------------------------

export const COMPANY_SIDEBAR_COLLAPSED_COOKIE = "opollo_company_sidebar_collapsed";
const LS_KEY = "opollo:company:sidebar:collapsed";

type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  testId?: string;
};

type Company = {
  id: string;
  name: string;
  domain: string | null;
  is_opollo_internal: boolean;
};

type Props = {
  email: string;
  isOpolloStaff: boolean;
  isAdmin: boolean;
  companyId: string | null;
  companyName: string | null;
  initialCollapsed?: boolean;
};

export function CompanySidebar({
  email,
  isOpolloStaff,
  isAdmin,
  companyId,
  companyName,
  initialCollapsed = false,
}: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Company selector state (Opollo staff only)
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companiesLoading, setCompaniesLoading] = useState(false);
  const [switching, setSwitching] = useState(false);
  const selectorRef = useRef<HTMLDivElement>(null);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(LS_KEY, next ? "1" : "0");
      } catch { /* localStorage disabled */ }
      try {
        document.cookie = `${COMPANY_SIDEBAR_COLLAPSED_COOKIE}=${next ? "1" : "0"}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
      } catch { /* cookieless context */ }
      return next;
    });
  }

  useEffect(() => {
    setMobileOpen(false);
    setSelectorOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  // Close selector on outside click
  useEffect(() => {
    if (!selectorOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (selectorRef.current && !selectorRef.current.contains(e.target as Node)) {
        setSelectorOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [selectorOpen]);

  // Fetch company list on first open (staff only)
  async function openSelector() {
    if (!isOpolloStaff) return;
    setSelectorOpen((v) => !v);
    if (companies.length === 0 && !companiesLoading) {
      setCompaniesLoading(true);
      try {
        const res = await fetch("/api/platform/companies/list");
        const json = (await res.json()) as { ok: boolean; data?: { companies: Company[] } };
        if (json.ok && json.data) setCompanies(json.data.companies);
      } finally {
        setCompaniesLoading(false);
      }
    }
  }

  async function selectCompany(id: string | null) {
    if (switching) return;
    setSwitching(true);
    setSelectorOpen(false);
    try {
      await fetch("/api/platform/companies/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_id: id }),
      });
      // Full page reload so the server re-reads the cookie and re-renders.
      router.refresh();
    } finally {
      setSwitching(false);
    }
  }

  function isActive(href: string): boolean {
    return pathname === href || pathname.startsWith(href + "/");
  }

  function NavLink({ label, href, icon: Icon, testId }: NavItem) {
    const active = isActive(href);
    return (
      <li className="relative">
        {active && (
          <span aria-hidden className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-pk" />
        )}
        <Link
          href={href}
          data-testid={testId}
          aria-current={active ? "page" : undefined}
          title={collapsed ? label : undefined}
          className={cn(
            "group flex h-9 items-center gap-3 rounded-md px-2.5 text-sm transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-gr focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            active
              ? "bg-nav-active text-pk font-medium"
              : "text-m2 hover:bg-nav-hover hover:text-gr",
          )}
        >
          <Icon
            aria-hidden
            className={cn(
              "h-4 w-4 shrink-0",
              active ? "text-pk" : "text-icon-dim group-hover:text-gr",
            )}
          />
          {!collapsed && <span className="truncate">{label}</span>}
        </Link>
      </li>
    );
  }

  const socialLinks: NavItem[] = [
    { label: "Calendar", href: "/company/social/calendar", icon: CalendarDays, testId: "cnav-calendar" },
    { label: "Posts", href: "/company/social/posts", icon: List, testId: "cnav-posts" },
    { label: "Connections", href: "/company/social/connections", icon: Link2, testId: "cnav-connections" },
    { label: "Media", href: "/company/social/media", icon: ImageIcon, testId: "cnav-media" },
    ...(isAdmin ? [{ label: "Sharing", href: "/company/social/sharing", icon: Share2, testId: "cnav-sharing" } as NavItem] : []),
    { label: "Analytics", href: "/company/social/analytics", icon: BarChart2, testId: "cnav-analytics" },
  ];

  // -- Company selector button (collapsed: icon only, expanded: name + chevron)
  function CompanySelectorButton() {
    const hasCompany = !!companyName;

    if (!isOpolloStaff) {
      // Non-staff: static display only
      return (
        <div
          className={cn(
            "flex items-center gap-2 rounded-md px-2.5 py-1.5",
            collapsed ? "justify-center" : "",
          )}
          title={collapsed ? (companyName ?? "No company") : undefined}
        >
          <Building2 aria-hidden className="h-4 w-4 shrink-0 text-icon-dim" />
          {!collapsed && (
            <span className="truncate text-sm font-medium text-foreground">
              {companyName ?? "No company"}
            </span>
          )}
        </div>
      );
    }

    // Staff: interactive selector
    return (
      <button
        type="button"
        onClick={openSelector}
        disabled={switching}
        aria-haspopup="listbox"
        aria-expanded={selectorOpen}
        aria-label={`Company: ${companyName ?? "None selected"}`}
        title={collapsed ? (companyName ?? "Select company") : undefined}
        className={cn(
          "group flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-smooth",
          "hover:bg-nav-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-gr",
          hasCompany ? "text-foreground" : "text-m2",
          collapsed ? "justify-center" : "",
        )}
      >
        <Building2 aria-hidden className="h-4 w-4 shrink-0 text-icon-dim group-hover:text-gr" />
        {!collapsed && (
          <>
            <span className="flex-1 truncate text-left font-medium">
              {switching ? "Switching…" : (companyName ?? "Select company")}
            </span>
            <ChevronsUpDown aria-hidden className="h-3.5 w-3.5 shrink-0 opacity-50" />
          </>
        )}
      </button>
    );
  }

  // -- Dropdown list of companies
  function CompanySelectorDropdown() {
    if (!selectorOpen || !isOpolloStaff) return null;

    return (
      <div
        className={cn(
          "absolute z-50 mt-1 overflow-hidden rounded-md border border-border",
          "bg-popover text-popover-foreground shadow-xl",
          collapsed ? "left-16 w-56" : "left-2 right-2",
        )}
        role="listbox"
        aria-label="Select company"
      >
        {/* Clear / no company option */}
        <button
          role="option"
          aria-selected={!companyId}
          type="button"
          onClick={() => selectCompany(null)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-m3 transition-colors hover:bg-muted hover:text-foreground"
        >
          {!companyId && <Check className="h-3 w-3 shrink-0 text-pk" aria-hidden />}
          {companyId && <span className="h-3 w-3 shrink-0" aria-hidden />}
          <span className="italic">No company selected</span>
        </button>
        <div className="border-t border-border" />

        {companiesLoading ? (
          <p className="px-3 py-2 text-xs text-m3">Loading…</p>
        ) : companies.length === 0 ? (
          <p className="px-3 py-2 text-xs text-m3">No companies found.</p>
        ) : (
          <ul className="max-h-64 overflow-y-auto">
            {companies.map((c) => {
              const isSelected = c.id === companyId;
              return (
                <li key={c.id}>
                  <button
                    role="option"
                    aria-selected={isSelected}
                    type="button"
                    onClick={() => selectCompany(c.id)}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
                      "hover:bg-muted",
                      isSelected ? "text-pk" : "text-m2 hover:text-foreground",
                    )}
                  >
                    {isSelected
                      ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      : <span className="h-3.5 w-3.5 shrink-0" aria-hidden />}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{c.name}</p>
                      {c.domain && (
                        <p className="truncate text-xs opacity-50">{c.domain}</p>
                      )}
                    </div>
                    {c.is_opollo_internal && (
                      <span className="shrink-0 rounded px-1 py-0.5 text-xs font-medium bg-gr/20 text-gr">
                        Internal
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  const sidebarBody = (
    <div className="flex h-full flex-col">
      {/* Wordmark + collapse toggle */}
      <div className="flex h-14 items-center justify-between border-b border-border px-3">
        {!collapsed && (
          <Link
            href="/company/social/calendar"
            className="focus:outline-none focus-visible:ring-2 focus-visible:ring-gr"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logos/opollo-logo-dark.png"
              alt="Opollo"
              width={120}
              className="h-7 w-auto"
            />
          </Link>
        )}
        {/* Mobile close */}
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          aria-label="Close navigation"
          className="inline-flex h-10 w-10 items-center justify-center rounded-md text-m2 transition-smooth hover:bg-b1 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-gr sm:hidden"
        >
          <X aria-hidden className="h-5 w-5" />
        </button>
        {/* Desktop collapse toggle */}
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "hidden h-8 w-8 items-center justify-center rounded-md text-icon-dim transition-smooth hover:bg-b1 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-gr sm:inline-flex",
            collapsed && "mx-auto",
          )}
        >
          {collapsed ? (
            <ChevronsRight aria-hidden className="h-4 w-4" />
          ) : (
            <ChevronsLeft aria-hidden className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto p-2" aria-label="Company navigation">
        {/* Company selector */}
        <div className="mb-3 mt-1 relative" ref={selectorRef}>
          {!collapsed && (
            <p className="lbl px-2.5 mb-1">
              {isOpolloStaff ? "Client" : "Company"}
            </p>
          )}
          <CompanySelectorButton />
          <CompanySelectorDropdown />
        </div>

        {/* Social section */}
        <div className="mb-1 mt-2">
          {!collapsed && <p className="lbl px-2.5">Social</p>}
        </div>
        <ul className="space-y-0.5">
          {socialLinks.map((item) => (
            <NavLink key={item.href} {...item} />
          ))}
        </ul>

        {/* Account section */}
        <div className="mb-1 mt-4">
          {!collapsed && <p className="lbl px-2.5">Account</p>}
        </div>
        <ul className="space-y-0.5">
          <NavLink label="Users" href="/company/users" icon={Users} testId="cnav-users" />
          {isAdmin && (
            <NavLink label="Brand" href="/company/settings/brand" icon={BookOpen} testId="cnav-brand" />
          )}
        </ul>
      </nav>

      {/* Footer rail */}
      <div className="border-t border-border p-2 space-y-0.5">
        {/* Notification bell — only when user has a company context */}
        {companyId && !collapsed && (
          <Link
            href="/company/social/posts?notifications=1"
            className="group flex h-9 items-center gap-3 rounded-md px-2.5 text-sm text-m2 transition-smooth hover:bg-nav-hover hover:text-gr focus:outline-none focus-visible:ring-2 focus-visible:ring-gr"
            data-testid="cnav-notifications"
          >
            <Bell aria-hidden className="h-4 w-4 shrink-0 text-icon-dim group-hover:text-gr" />
            <span className="truncate">Notifications</span>
          </Link>
        )}
        {companyId && collapsed && (
          <Link
            href="/company/social/posts?notifications=1"
            title="Notifications"
            className="group flex h-9 w-full items-center justify-center rounded-md text-m2 transition-smooth hover:bg-nav-hover hover:text-gr focus:outline-none focus-visible:ring-2 focus-visible:ring-gr"
            data-testid="cnav-notifications"
          >
            <Bell aria-hidden className="h-4 w-4 shrink-0 text-icon-dim group-hover:text-gr" />
          </Link>
        )}
        {/* Admin panel link — Opollo staff only */}
        {isOpolloStaff && (
          <Link
            href="/admin/companies"
            title={collapsed ? "Admin panel" : undefined}
            className="group flex h-9 items-center gap-3 rounded-md px-2.5 text-sm text-m2 transition-smooth hover:bg-nav-hover hover:text-gr focus:outline-none focus-visible:ring-2 focus-visible:ring-gr"
            data-testid="cnav-admin-panel"
          >
            <ExternalLink aria-hidden className="h-4 w-4 shrink-0 text-icon-dim group-hover:text-gr" />
            {!collapsed && <span className="truncate">Admin panel</span>}
          </Link>
        )}
        {/* Sign out */}
        <form action="/logout" method="POST">
          <button
            type="submit"
            title={collapsed ? "Sign out" : undefined}
            className="group flex h-9 w-full items-center gap-3 rounded-md px-2.5 text-left text-sm text-destructive transition-smooth hover:bg-destructive/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-gr"
            data-testid="cnav-sign-out"
          >
            <LogOut aria-hidden className="h-4 w-4 shrink-0" />
            {!collapsed && <span className="truncate">Sign out</span>}
          </button>
        </form>
        {/* Email label */}
        {!collapsed && (
          <p
            className="mt-1 truncate border-t border-border pt-2 px-2.5 text-xs text-m3"
            title={email}
          >
            {email}
          </p>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile top bar */}
      <div className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-topbar px-4 backdrop-blur-[18px] sm:hidden">
        <Link
          href="/company/social/calendar"
          className="focus:outline-none focus-visible:ring-2 focus-visible:ring-gr"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logos/opollo-logo-dark.png"
            alt="Opollo"
            width={120}
            className="h-7 w-auto"
          />
        </Link>
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation"
          aria-expanded={mobileOpen}
          aria-controls="company-sidebar"
          className="inline-flex h-10 w-10 items-center justify-center rounded-md text-m2 transition-smooth hover:bg-b1 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-gr"
          data-testid="company-mobile-nav-button"
        >
          <Menu aria-hidden className="h-5 w-5" />
        </button>
      </div>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          className="opollo-fade-in fixed inset-0 z-40 bg-black/60 sm:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        id="company-sidebar"
        aria-label="Primary navigation"
        className={cn(
          "border-r border-border transition-all duration-200",
          "bg-[linear-gradient(180deg,var(--d1)_0%,var(--bg)_100%)]",
          "fixed inset-y-0 left-0 z-50 w-72 shrink-0 -translate-x-full",
          mobileOpen && "translate-x-0",
          "sm:sticky sm:top-0 sm:h-screen sm:translate-x-0",
          collapsed ? "sm:w-16" : "sm:w-60",
        )}
      >
        {sidebarBody}
      </aside>
    </>
  );
}
