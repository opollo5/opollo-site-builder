"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// ---------------------------------------------------------------------------
// S1-28 — client nav for /company/social/*.
//
// Highlights the active link based on the current pathname.
// Exact match for the root segments; prefix match would falsely
// highlight /posts when visiting /posts/[id].
// ---------------------------------------------------------------------------

const NAV = [
  { href: "/company/social/posts", label: "Posts" },
  { href: "/company/social/calendar", label: "Calendar" },
  { href: "/company/social/connections", label: "Connections" },
  { href: "/company/social/media", label: "Media" },
  { href: "/company/social/sharing", label: "Sharing" },
] as const;

export function SocialNavClient() {
  const pathname = usePathname();

  function isActive(href: string): boolean {
    // Exact match for the nav root; also match sub-routes like /posts/[id].
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <ul className="flex items-center gap-1">
      {NAV.map((item) => {
        const active = isActive(item.href);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`block rounded-md px-3 py-1.5 text-sm transition-colors ${
                active
                  ? "bg-primary/10 font-medium text-primary"
                  : "hover:bg-muted text-foreground/80"
              }`}
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
