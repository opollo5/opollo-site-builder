"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  ChevronsLeft,
  ChevronsRight,
  Activity,
  Globe,
  Image as ImageIcon,
  KeyRound,
  Laptop,
  LogOut,
  Mail,
  Menu,
  PenSquare,
  Settings,
  ShieldCheck,
  Users,
  Workflow,
  X,
  type LucideIcon,
} from "lucide-react";

import type { SessionUser } from "@/lib/auth";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Opollo sidebar — dark gradient rail, pink active indicator, green hover.
// 240px expanded / 64px icon-only collapsed. Off-canvas drawer on mobile.
//
// Persistence: cookie `opollo_sidebar_collapsed` (1 / 0) set by server layout
// so SSR + first client paint match (no hydration flash). localStorage mirrors
// for legacy readers.
// ---------------------------------------------------------------------------

const SIDEBAR_COLLAPSED_LS_KEY = "opollo:sidebar:collapsed";
export const SIDEBAR_COLLAPSED_COOKIE = "opollo_sidebar_collapsed";

type NavLink = {
  label: string;
  href: string;
  icon: LucideIcon;
  testId?: string;
};

interface AdminSidebarProps {
  user: SessionUser | null;
  isAdminTier: boolean;
  isSuperAdmin: boolean;
  initialCollapsed?: boolean;
}

export function AdminSidebar({
  user,
  isAdminTier,
  isSuperAdmin,
  initialCollapsed = false,
}: AdminSidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_LS_KEY, next ? "1" : "0");
      } catch {
        /* localStorage disabled — change applies in-memory */
      }
      try {
        document.cookie = `${SIDEBAR_COLLAPSED_COOKIE}=${next ? "1" : "0"}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
      } catch {
        /* cookieless context — change applies in-memory */
      }
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

  const navLinks: NavLink[] = [
    { label: "Sites", href: "/admin/sites", icon: Globe, testId: "nav-sites" },
    {
      label: "Post a blog",
      href: "/admin/posts/new",
      icon: PenSquare,
      testId: "nav-post-blog",
    },
    {
      label: "Batches",
      href: "/admin/batches",
      icon: Workflow,
      testId: "nav-batches",
    },
    {
      label: "Images",
      href: "/admin/images",
      icon: ImageIcon,
      testId: "nav-images",
    },
    ...(isAdminTier
      ? [
          {
            label: "Users",
            href: "/admin/users",
            icon: Users,
            testId: "nav-users",
          },
          {
            label: "Companies",
            href: "/admin/companies",
            icon: Building2,
            testId: "nav-companies",
          },
        ]
      : []),
  ];

  const adminLinks: NavLink[] = isSuperAdmin
    ? [
        {
          label: "Audit log",
          href: "/admin/users/audit",
          icon: ShieldCheck,
          testId: "nav-audit-log",
        },
        {
          label: "System jobs",
          href: "/admin/system/jobs",
          icon: Activity,
          testId: "nav-system-jobs",
        },
        {
          label: "Email test",
          href: "/admin/email-test",
          icon: Mail,
          testId: "nav-email-test",
        },
      ]
    : [];

  function isActiveRoute(href: string): boolean {
    return pathname === href || pathname.startsWith(href + "/");
  }

  function NavItem({
    label,
    href,
    icon: Icon,
    testId,
  }: NavLink) {
    const active = isActiveRoute(href);
    return (
      <li className="relative">
        {active && (
          <span
            aria-hidden
            className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-[#FF03A5]"
          />
        )}
        <Link
          href={href}
          data-testid={testId}
          aria-current={active ? "page" : undefined}
          title={collapsed ? label : undefined}
          className={cn(
            "group flex h-9 items-center gap-3 rounded-md px-2.5 text-sm transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00e5a0] focus-visible:ring-offset-2 focus-visible:ring-offset-[#07070f]",
            active
              ? "bg-[rgba(255,3,165,0.10)] text-white font-medium"
              : "text-[rgba(255,255,255,0.58)] hover:bg-[rgba(0,229,160,0.06)] hover:text-[#00e5a0]",
          )}
        >
          <Icon
            aria-hidden
            className={cn(
              "h-4 w-4 shrink-0",
              active
                ? "text-white"
                : "text-[rgba(255,255,255,0.40)] group-hover:text-[#00e5a0]",
            )}
          />
          {!collapsed && <span className="truncate">{label}</span>}
        </Link>
      </li>
    );
  }

  return (
    <>
      {/* Mobile top bar */}
      <div className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-white/[0.06] bg-[rgba(4,4,10,0.85)] px-4 backdrop-blur-[18px] sm:hidden">
        <Link
          href="/admin/sites"
          className="font-display text-sm font-semibold text-white tracking-tight focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00e5a0]"
        >
          Opo<span className="text-[#FF03A5]">llo</span>
        </Link>
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation"
          aria-expanded={mobileOpen}
          aria-controls="admin-sidebar"
          className="inline-flex h-10 w-10 items-center justify-center rounded-md text-[rgba(255,255,255,0.58)] transition-smooth hover:bg-[rgba(255,255,255,0.06)] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00e5a0]"
          data-testid="admin-mobile-nav-button"
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
        id="admin-sidebar"
        aria-label="Primary"
        className={cn(
          // Opollo sidebar: dark gradient bg, rgba-white right border
          "border-r border-white/[0.06] transition-all duration-200",
          "bg-[linear-gradient(180deg,#07070f_0%,#04040a_100%)]",
          // Mobile: fixed off-canvas
          "fixed inset-y-0 left-0 z-50 w-72 shrink-0 -translate-x-full",
          mobileOpen && "translate-x-0",
          // Desktop: pinned full-height
          "sm:sticky sm:top-0 sm:h-screen sm:translate-x-0",
          collapsed ? "sm:w-16" : "sm:w-60",
        )}
      >
        <div className="flex h-full flex-col">
          {/* Wordmark + collapse toggle */}
          <div className="flex h-14 items-center justify-between border-b border-white/[0.06] px-3">
            {!collapsed && (
              <Link
                href="/admin/sites"
                className="font-display text-sm font-semibold text-white tracking-tight focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00e5a0]"
              >
                Opo<span className="text-[#FF03A5]">llo</span>
              </Link>
            )}
            {/* Mobile close */}
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Close navigation"
              className="inline-flex h-10 w-10 items-center justify-center rounded-md text-[rgba(255,255,255,0.58)] transition-smooth hover:bg-[rgba(255,255,255,0.06)] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00e5a0] sm:hidden"
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
                "hidden h-8 w-8 items-center justify-center rounded-md text-[rgba(255,255,255,0.40)] transition-smooth hover:bg-[rgba(255,255,255,0.06)] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00e5a0] sm:inline-flex",
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

          {/* Primary nav */}
          <nav className="flex-1 overflow-y-auto p-2">
            <ul className="space-y-0.5">
              {navLinks.map((link) => (
                <NavItem key={link.href} {...link} />
              ))}
            </ul>

            {/* Super_admin Admin sub-section */}
            {adminLinks.length > 0 && (
              <>
                <div className="mt-4 mb-1 px-2.5">
                  {!collapsed && (
                    <p className="lbl text-[10px]">Admin</p>
                  )}
                </div>
                <ul className="space-y-0.5">
                  {adminLinks.map((link) => (
                    <NavItem key={link.href} {...link} />
                  ))}
                </ul>
              </>
            )}
          </nav>

          {/* Footer rail */}
          <div className="border-t border-white/[0.06] p-2">
            {!collapsed && (
              <div className="mb-2 flex items-center justify-between rounded-md bg-white/[0.04] px-2 py-1.5">
                <span className="text-sm text-[rgba(255,255,255,0.40)]">
                  Command palette
                </span>
                <span
                  className="flex items-center gap-0.5 text-sm text-[rgba(255,255,255,0.32)]"
                  aria-hidden
                >
                  <kbd className="rounded border border-white/[0.12] bg-white/[0.06] px-1 font-mono text-[10px]">
                    ⌘
                  </kbd>
                  <kbd className="rounded border border-white/[0.12] bg-white/[0.06] px-1 font-mono text-[10px]">
                    K
                  </kbd>
                </span>
              </div>
            )}
            {user && (
              <Link
                href="/account/security"
                title={collapsed ? "Account security" : undefined}
                className={cn(
                  "group flex h-9 items-center gap-3 rounded-md px-2.5 text-sm text-[rgba(255,255,255,0.58)] transition-smooth hover:bg-[rgba(0,229,160,0.06)] hover:text-[#00e5a0] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00e5a0]",
                  isActiveRoute("/account/security") &&
                    "bg-[rgba(255,3,165,0.10)] text-white font-medium",
                )}
                data-testid="nav-security"
              >
                <KeyRound aria-hidden className="h-4 w-4 shrink-0 text-[rgba(255,255,255,0.40)] group-hover:text-[#00e5a0]" />
                {!collapsed && <span className="truncate">Account security</span>}
              </Link>
            )}
            {user && (
              <Link
                href="/account/devices"
                title={collapsed ? "Trusted devices" : undefined}
                className={cn(
                  "group flex h-9 items-center gap-3 rounded-md px-2.5 text-sm text-[rgba(255,255,255,0.58)] transition-smooth hover:bg-[rgba(0,229,160,0.06)] hover:text-[#00e5a0] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00e5a0]",
                  isActiveRoute("/account/devices") &&
                    "bg-[rgba(255,3,165,0.10)] text-white font-medium",
                )}
                data-testid="nav-devices"
              >
                <Laptop aria-hidden className="h-4 w-4 shrink-0 text-[rgba(255,255,255,0.40)] group-hover:text-[#00e5a0]" />
                {!collapsed && <span className="truncate">Trusted devices</span>}
              </Link>
            )}
            <Link
              href="/"
              title={collapsed ? "Back to builder" : undefined}
              className="group flex h-9 items-center gap-3 rounded-md px-2.5 text-sm text-[rgba(255,255,255,0.58)] transition-smooth hover:bg-[rgba(0,229,160,0.06)] hover:text-[#00e5a0] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00e5a0]"
              data-testid="nav-back-to-builder"
            >
              <Settings aria-hidden className="h-4 w-4 shrink-0 text-[rgba(255,255,255,0.40)] group-hover:text-[#00e5a0]" />
              {!collapsed && <span className="truncate">Back to builder</span>}
            </Link>
            {user && (
              <form action="/logout" method="POST">
                <button
                  type="submit"
                  title={collapsed ? "Sign out" : undefined}
                  className="group flex h-9 w-full items-center gap-3 rounded-md px-2.5 text-left text-sm text-destructive transition-smooth hover:bg-destructive/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#00e5a0]"
                  data-testid="nav-sign-out"
                >
                  <LogOut aria-hidden className="h-4 w-4 shrink-0" />
                  {!collapsed && <span className="truncate">Sign out</span>}
                </button>
              </form>
            )}
            {user && !collapsed && (
              <p
                className="mt-2 truncate border-t border-white/[0.06] pt-2 px-2.5 text-[11px] text-[rgba(255,255,255,0.32)]"
                title={user.email}
              >
                {user.email}
              </p>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
