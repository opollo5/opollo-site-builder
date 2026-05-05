"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/company", label: "Dashboard", exact: true },
  { href: "/company/social", label: "Social" },
  { href: "/company/users", label: "Users" },
  { href: "/company/settings/brand", label: "Brand" },
] as const;

export function CompanyTopNav() {
  const pathname = usePathname();

  function isActive(href: string, exact: boolean): boolean {
    return exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <ul className="flex items-center gap-1">
      {NAV.map((item) => {
        const active = isActive(item.href, "exact" in item ? item.exact : false);
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
