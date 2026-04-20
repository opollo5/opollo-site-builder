import Link from "next/link";
import type { ReactNode } from "react";

// Shared shell for every page under /admin.
//
// Matches the h-12 border-b header + max-w-5xl p-6 container pattern that
// /admin/sites/page.tsx pioneered. Introduced as part of M1e-1 because the
// admin surface area is about to quadruple (design-system versions,
// components, templates, preview) and duplicating the header in every page
// was headed toward drift.

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex h-12 flex-none items-center justify-between border-b px-4">
        <div className="flex items-center gap-3">
          <Link href="/admin/sites" className="text-sm font-semibold">
            Opollo Site Builder
          </Link>
          <span className="text-xs text-muted-foreground">· Admin</span>
        </div>
        <Link
          href="/"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← Back to builder
        </Link>
      </header>
      <main className="mx-auto max-w-5xl p-6">{children}</main>
    </div>
  );
}
