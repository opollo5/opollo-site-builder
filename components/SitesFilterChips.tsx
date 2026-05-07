"use client";

import Link from "next/link";

import { cn } from "@/lib/utils";
import type { ListSitesOptions, SiteSortColumn, SiteSortDir } from "@/lib/sites";

// Spec 01 §5 — Filter chip row above the sites table.
//
// Chips: All · Active · Not Connected · Paused · Archived
// URL search param: ?status=active|pending_pairing|paused|removed
// (no param = All; default view hides removed rows).
//
// Sort params (?sort, ?dir) are preserved when changing the chip — sort
// and filter are orthogonal in URL state per the spec.

type ChipValue =
  | "active"
  | "pending_pairing"
  | "paused"
  | "removed"
  | null;

type ChipDef = {
  label: string;
  value: ChipValue; // null = All
  testId: string;
};

const CHIPS: ChipDef[] = [
  { label: "All", value: null, testId: "sites-filter-all" },
  { label: "Active", value: "active", testId: "sites-filter-active" },
  {
    label: "Not Connected",
    value: "pending_pairing",
    testId: "sites-filter-pending-pairing",
  },
  { label: "Paused", value: "paused", testId: "sites-filter-paused" },
  { label: "Archived", value: "removed", testId: "sites-filter-removed" },
];

export function SitesFilterChips({
  activeFilter,
  sort,
  dir,
}: {
  activeFilter: ListSitesOptions["status"];
  sort: SiteSortColumn | null;
  dir: SiteSortDir | null;
}) {
  return (
    <nav
      aria-label="Filter sites by status"
      className="flex flex-wrap items-center gap-1.5"
      data-testid="sites-filter-chips"
    >
      {CHIPS.map((chip) => {
        const isActive =
          (chip.value === null && activeFilter === null) ||
          (chip.value !== null && chip.value === activeFilter);
        const params = new URLSearchParams();
        if (chip.value !== null) params.set("status", chip.value);
        if (sort) params.set("sort", sort);
        if (dir) params.set("dir", dir);
        const href = params.toString().length > 0
          ? `/admin/sites?${params.toString()}`
          : "/admin/sites";
        return (
          <Link
            key={chip.label}
            href={href}
            data-testid={chip.testId}
            aria-pressed={isActive}
            className={cn(
              "inline-flex items-center rounded-full px-3 py-1 text-sm transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              isActive
                ? "bg-[var(--brand-pink,#FF03A5)] text-white shadow-sm"
                : "border border-border text-muted-foreground hover:bg-muted",
            )}
          >
            {chip.label}
          </Link>
        );
      })}
    </nav>
  );
}
