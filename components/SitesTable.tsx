"use client";

import Link from "next/link";

import { SiteActionsMenu } from "@/components/SiteActionsMenu";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { NavIcon } from "@/components/ui/nav-icon";
import {
  StatusPill,
  siteStatusKind,
} from "@/components/ui/status-pill";
import type {
  ListSitesOptions,
  SiteSortColumn,
  SiteSortDir,
} from "@/lib/sites";
import type { SiteListItem } from "@/lib/tool-schemas";
import { cn, formatRelativeTime } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Spec 01 — Sites admin cleanup.
//
// - StatusCell now defers to StatusPill (the centralised pill primitive)
//   so the operator-visible label respects STATUS_MAP. No more inline
//   `status.replace(/_/g, " ")` leaking the enum value as English.
// - Pending-pairing rows render an inline `Connect →` link in the
//   Status cell, deep-linking to the edit page with ?focus=credentials
//   so the credentials section auto-scrolls + focuses on mount.
// - Headers are clickable: ?sort=<col>&dir=<asc|desc>. Three-state
//   toggle: idle → asc → desc → cleared (revert to default order).
//   Filter params are preserved when changing sort.
// - "Updated" column dropped; replaced by "Last tested" backed by
//   sites.last_connection_test_at (migration 0106).
// ---------------------------------------------------------------------------

interface SitesTableProps {
  sites: SiteListItem[];
  sort: SiteSortColumn | null;
  dir: SiteSortDir | null;
  filter: ListSitesOptions["status"];
  isSuperAdmin: boolean;
  onCreateClick?: () => void;
}

type Column = {
  key: SiteSortColumn;
  label: string;
};

const SORTABLE_HEADERS: Column[] = [
  { key: "name", label: "Name" },
  { key: "company_name", label: "Company" },
  { key: "wp_url", label: "WP URL" },
  { key: "status", label: "Status" },
  { key: "last_connection_test_at", label: "Last tested" },
];

function buildHeaderHref(
  column: SiteSortColumn,
  currentSort: SiteSortColumn | null,
  currentDir: SiteSortDir | null,
  filter: ListSitesOptions["status"],
): string {
  // Three-state toggle:
  //   no sort on this column      → ?sort=col&dir=asc
  //   sort=col & dir=asc          → ?sort=col&dir=desc
  //   sort=col & dir=desc         → clear sort (revert to default)
  const params = new URLSearchParams();
  if (filter) params.set("status", filter);

  if (currentSort !== column) {
    params.set("sort", column);
    params.set("dir", "asc");
  } else if (currentDir === "asc") {
    params.set("sort", column);
    params.set("dir", "desc");
  } // else: leave sort/dir off → default order

  const qs = params.toString();
  return qs.length > 0 ? `/admin/sites?${qs}` : "/admin/sites";
}

function StatusCell({ status, siteId }: { status: string; siteId: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <StatusPill
        kind={siteStatusKind(status as Parameters<typeof siteStatusKind>[0])}
      />
      {status === "pending_pairing" && (
        <Link
          href={`/admin/sites/${encodeURIComponent(siteId)}/edit?focus=credentials`}
          data-testid={`site-connect-link-${siteId}`}
          className="text-sm text-primary underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
        >
          Connect →
        </Link>
      )}
    </span>
  );
}

function LastTestedCell({ value }: { value: string | null }) {
  if (!value) {
    return <span className="text-sm text-muted-foreground">Never tested</span>;
  }
  let iso: string;
  try {
    iso = new Date(value).toISOString();
  } catch {
    iso = value;
  }
  return (
    <span
      className="text-sm text-muted-foreground"
      title={iso}
      data-screenshot-mask
    >
      Tested {formatRelativeTime(value)}
    </span>
  );
}

function SortHeader({
  column,
  label,
  sort,
  dir,
  filter,
}: {
  column: SiteSortColumn;
  label: string;
  sort: SiteSortColumn | null;
  dir: SiteSortDir | null;
  filter: ListSitesOptions["status"];
}) {
  const active = sort === column;
  const href = buildHeaderHref(column, sort, dir, filter);
  return (
    <Link
      href={href}
      scroll={false}
      data-testid={`sites-sort-${column}`}
      aria-sort={
        active ? (dir === "desc" ? "descending" : "ascending") : "none"
      }
      className="inline-flex items-center gap-1 transition-smooth hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
    >
      {label}
      {active && dir === "desc" && (
        <NavIcon name="arrow-down" size={20} />
      )}
      {active && dir !== "desc" && (
        <NavIcon name="arrow-up" size={20} />
      )}
    </Link>
  );
}

export function SitesTable({
  sites,
  sort,
  dir,
  filter,
  isSuperAdmin,
  onCreateClick,
}: SitesTableProps) {
  if (sites.length === 0) {
    return (
      <EmptyState
        icon={<NavIcon name="earth" size={20} />}
        iconLabel="No sites"
        title="No sites connected yet"
        body={
          <>
            Sites become available after you connect a WordPress install
            with the Opollo plugin. Add your first site to start
            generating pages.
          </>
        }
        cta={
          onCreateClick && (
            <Button onClick={onCreateClick}>
              <NavIcon name="plus" size={16} />
              Add a site
            </Button>
          )
        }
      />
    );
  }

  // BACKLOG fix (2026-04-29): the wrapper used `overflow-hidden` to
  // mask the table's corners against the rounded border, but it also
  // created a clipping context that hid the SiteActionsMenu pop-out
  // on rows near the bottom of the list. Drop overflow-hidden so the
  // menu can extend past the table.
  return (
    <div className="rounded-md border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40 text-left text-sm uppercase tracking-wide text-muted-foreground">
          <tr>
            {SORTABLE_HEADERS.map((col) => (
              <th key={col.key} className="px-3 py-2 font-medium">
                <SortHeader
                  column={col.key}
                  label={col.label}
                  sort={sort}
                  dir={dir}
                  filter={filter}
                />
              </th>
            ))}
            <th className="w-10 px-2 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {sites.map((s) => (
            <tr
              key={s.id}
              className={cn(
                "group border-b transition-smooth last:border-b-0 hover:bg-muted/40",
              )}
              data-status={s.status}
              data-testid={`sites-row-${s.id}`}
            >
              <td className="px-3 py-2 font-medium">
                <Link
                  href={`/admin/sites/${s.id}`}
                  className="block transition-smooth hover:text-foreground hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
                  data-testid={`site-row-link-${s.id}`}
                >
                  {s.name}
                </Link>
              </td>
              <td className="px-3 py-2 text-sm text-muted-foreground">
                {s.company_name ?? (
                  <span className="italic text-destructive/70">Unassigned</span>
                )}
              </td>
              <td className="px-3 py-2 text-muted-foreground">
                <a
                  href={s.wp_url}
                  target="_blank"
                  rel="noreferrer"
                  className="transition-smooth hover:text-foreground hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
                  onClick={(e) => e.stopPropagation()}
                >
                  {s.wp_url}
                </a>
              </td>
              <td className="px-3 py-2">
                <StatusCell status={s.status} siteId={s.id} />
              </td>
              <td className="px-3 py-2">
                <LastTestedCell value={s.last_connection_test_at} />
              </td>
              <td
                className="px-2 py-2 text-right"
                onClick={(e) => e.stopPropagation()}
              >
                <SiteActionsMenu
                  siteId={s.id}
                  name={s.name}
                  wpUrl={s.wp_url}
                  canDelete={isSuperAdmin}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
