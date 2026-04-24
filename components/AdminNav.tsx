"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useState, useRef, useEffect } from "react";
import type { SessionUser } from "@/lib/auth";

type NavLink = {
  label: string;
  href: string;
  testId?: string;
};

export function AdminNav({ user, showUsersLink }: { user: SessionUser | null; showUsersLink: boolean }) {
  const pathname = usePathname();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const navLinks: NavLink[] = [
    { label: "Sites", href: "/admin/sites", testId: "nav-sites" },
    { label: "Batches", href: "/admin/batches", testId: "nav-batches" },
    { label: "Images", href: "/admin/images", testId: "nav-images" },
    ...(showUsersLink ? [{ label: "Users", href: "/admin/users", testId: "nav-users" }] : []),
  ];

  function isActiveRoute(href: string): boolean {
    return pathname === href || pathname.startsWith(href + "/");
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    }

    if (userMenuOpen) {
      document.addEventListener("click", handleClickOutside);
      return () => document.removeEventListener("click", handleClickOutside);
    }
  }, [userMenuOpen]);

  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 gap-8">
        {/* Left: Logo + Primary nav */}
        <div className="flex items-center gap-6">
          <Link href="/admin/sites" className="font-semibold text-sm whitespace-nowrap">
            Opollo Site Builder
          </Link>
          <nav className="flex items-center gap-1">
            {navLinks.map(({ label, href, testId }) => {
              const active = isActiveRoute(href);
              return (
                <Link
                  key={href}
                  href={href}
                  data-testid={testId}
                  className={`px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                    active
                      ? "text-foreground border-b-2 border-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Right: User menu dropdown */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="flex items-center gap-2 rounded px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="User menu"
            data-testid="admin-user-menu-button"
          >
            {user?.email ?? "Admin"}
            <span className={`transition-transform ${userMenuOpen ? "rotate-180" : ""}`}>▼</span>
          </button>

          {userMenuOpen && (
            <div
              className="absolute right-0 top-full mt-1 w-48 rounded-md border bg-background shadow-lg z-50"
              role="menu"
            >
              {user && (
                <>
                  <div className="px-3 py-2 text-xs text-muted-foreground border-b">
                    {user.email}
                  </div>
                  <Link
                    href="/account/security"
                    className="block px-3 py-2 text-xs hover:bg-muted text-left"
                    onClick={() => setUserMenuOpen(false)}
                    data-testid="nav-security"
                  >
                    Security
                  </Link>
                </>
              )}
              <Link
                href="/"
                className="block px-3 py-2 text-xs hover:bg-muted text-left"
                onClick={() => setUserMenuOpen(false)}
                data-testid="nav-back-to-builder"
              >
                ← Back to builder
              </Link>
              {user && (
                <form action="/logout" method="POST" className="border-t">
                  <button
                    type="submit"
                    className="w-full px-3 py-2 text-xs hover:bg-muted text-left text-destructive"
                    data-testid="nav-sign-out"
                  >
                    Sign out
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
