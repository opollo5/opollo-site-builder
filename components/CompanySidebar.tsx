"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart2,
  Bell,
  BookOpen,
  CalendarDays,
  ChevronsLeft,
  ChevronsRight,
  Image as ImageIcon,
  Link2,
  LogOut,
  Menu,
  Share2,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Company sidebar — matches the admin sidebar's dark gradient rail visually
// (same tokens: d1/bg gradient, pk active, gr hover) but is purpose-built
// for /company/* routes.
//
// Collapse state: persisted in cookie opollo_company_sidebar_collapsed
// so SSR + first client paint match (no hydration flash).
// ---------------------------------------------------------------------------

export const COMPANY_SIDEBAR_COLLAPSED_COOKIE = "opollo_company_sidebar_collapsed";
const LS_KEY = "opollo:company:sidebar:collapsed";

type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  testId?: string;
};

type Props = {
  email: string;
  isOpolloStaff: boolean;
  isAdmin: boolean;
  companyId: string | null;
  initialCollapsed?: boolean;
};

export function CompanySidebar({
  email,
  isOpolloStaff,
  isAdmin,
  companyId,
  initialCollapsed = false,
}: Props) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);

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
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

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
            "group flex h-9 items-center gap-3 rounded-md px-2.5 text-sm transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-gr focus-visible:ring-offset-2 focus-visible:ring-offset-d1",
            active
              ? "bg-nav-active text-white font-medium"
              : "text-m2 hover:bg-nav-hover hover:text-gr",
          )}
        >
          <Icon
            aria-hidden
            className={cn(
              "h-4 w-4 shrink-0",
              active ? "text-white" : "text-icon-dim group-hover:text-gr",
            )}
          />
          {!collapsed && <span className="truncate">{label}</span>}
        </Link>
      </li>
    );
  }

  const socialLinks: NavItem[] = [
    { label: "Posts", href: "/company/social/calendar", icon: CalendarDays, testId: "cnav-posts" },
    { label: "Connections", href: "/company/social/connections", icon: Link2, testId: "cnav-connections" },
    { label: "Media", href: "/company/social/media", icon: ImageIcon, testId: "cnav-media" },
    ...(isAdmin ? [{ label: "Sharing", href: "/company/social/sharing", icon: Share2, testId: "cnav-sharing" } as NavItem] : []),
    { label: "Analytics", href: "/company/social/analytics", icon: BarChart2, testId: "cnav-analytics" },
  ];

  const sidebarBody = (
    <div className="flex h-full flex-col">
      {/* Wordmark + collapse toggle */}
      <div className="flex h-14 items-center justify-between border-b border-white/[0.06] px-3">
        {!collapsed && (
          <Link
            href="/company/social/calendar"
            className="focus:outline-none focus-visible:ring-2 focus-visible:ring-gr"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://opollo.com/wp-content/uploads/2024/05/opollo-logo.svg"
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
          className="inline-flex h-10 w-10 items-center justify-center rounded-md text-m2 transition-smooth hover:bg-b1 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-gr sm:hidden"
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
            "hidden h-8 w-8 items-center justify-center rounded-md text-icon-dim transition-smooth hover:bg-b1 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-gr sm:inline-flex",
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
        {/* Social section */}
        <div className="mb-1 mt-2">
          {!collapsed && <p className="lbl px-2.5">Social</p>}
        </div>
        <ul className="space-y-0.5">
          {socialLinks.map((item) => (
            <NavLink key={item.href} {...item} />
          ))}
        </ul>

        {/* Top-level links */}
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
      <div className="border-t border-white/[0.06] p-2 space-y-0.5">
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
        {/* Back to admin — Opollo staff only */}
        {isOpolloStaff && (
          <Link
            href="/admin/companies"
            title={collapsed ? "Back to admin" : undefined}
            className="group flex h-9 items-center gap-3 rounded-md px-2.5 text-sm text-m2 transition-smooth hover:bg-nav-hover hover:text-gr focus:outline-none focus-visible:ring-2 focus-visible:ring-gr"
            data-testid="cnav-back-to-admin"
          >
            <ChevronsLeft aria-hidden className="h-4 w-4 shrink-0 text-icon-dim group-hover:text-gr" />
            {!collapsed && <span className="truncate">Back to admin</span>}
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
            className="mt-1 truncate border-t border-white/[0.06] pt-2 px-2.5 text-xs text-m3"
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
      <div className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-white/[0.06] bg-topbar px-4 backdrop-blur-[18px] sm:hidden">
        <Link
          href="/company/social/calendar"
          className="focus:outline-none focus-visible:ring-2 focus-visible:ring-gr"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://opollo.com/wp-content/uploads/2024/05/opollo-logo.svg"
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
          className="inline-flex h-10 w-10 items-center justify-center rounded-md text-m2 transition-smooth hover:bg-b1 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-gr"
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
          "border-r border-white/[0.06] transition-all duration-200",
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
