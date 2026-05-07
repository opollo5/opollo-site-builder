"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { SiteActionsMenu } from "@/components/SiteActionsMenu";
import { Button } from "@/components/ui/button";
import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { NavIcon } from "@/components/ui/nav-icon";
import { Pill } from "@/components/ui/pill";
import { TableCell } from "@/components/ui/table-cell";
import type {
  ListSitesOptions,
  SiteSortColumn,
  SiteSortDir,
} from "@/lib/sites";
import type { SiteListItem } from "@/lib/tool-schemas";
import { formatRelativeTime } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Spec 18 PR B — Sites table migration.
//
// Migrated from bespoke <table> + StatusPill to the canonical
// DataTable. The status column keeps the dual treatment from Spec 01:
//
//   - When status === "active":           Pill (success) "Connected"
//                                         + actions in the `...` menu.
//   - When status === "pending_pairing":  Pill (neutral) "Not Connected"
//                                         + inline "Connect →" link
//                                         (the documented single-primary-
//                                         action exception).
//
// Sortable headers preserved via SortHeader rendered inside ColumnDef
// `header` slots; clicking a header navigates with the new sort param
// without mutating row state.
// ---------------------------------------------------------------------------

interface SitesTableProps {
  sites: SiteListItem[];
  sort: SiteSortColumn | null;
  dir: SiteSortDir | null;
  filter: ListSitesOptions["status"];
  isSuperAdmin: boolean;
  onCreateClick?: () => void;
}

type SortColumn = {
  key: SiteSortColumn;
  label: string;
};

const SORTABLE_HEADERS: SortColumn[] = [
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
  // Three-state toggle (Spec 01):
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
  }

  const qs = params.toString();
  return qs.length > 0 ? `/admin/sites?${qs}` : "/admin/sites";
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
      aria-sort={active ? (dir === "desc" ? "descending" : "ascending") : "none"}
      className="inline-flex items-center gap-1 transition-smooth hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
    >
      {label}
      {active && dir === "desc" && <NavIcon name="arrow-down" size={14} />}
      {active && dir !== "desc" && <NavIcon name="arrow-up" size={14} />}
    </Link>
  );
}

function StatusCell({ status, siteId }: { status: string; siteId: string }) {
  if (status === "pending_pairing") {
    return (
      <span className="inline-flex items-center gap-2 text-sm">
        <Pill variant="neutral">Not Connected</Pill>
        <Link
          href={`/admin/sites/${encodeURIComponent(siteId)}/edit?focus=credentials`}
          data-testid={`site-connect-link-${siteId}`}
          // Stop the row click from intercepting the connect link.
          onClick={(e) => e.stopPropagation()}
          className="text-sm text-primary underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
        >
          Connect →
        </Link>
      </span>
    );
  }
  if (status === "active") {
    return <Pill variant="success">Connected</Pill>;
  }
  if (status === "paused") {
    return <Pill variant="warning">Paused</Pill>;
  }
  if (status === "removed") {
    return <Pill variant="danger">Removed</Pill>;
  }
  return <Pill variant="neutral">{status}</Pill>;
}

function LastTestedCell({ value }: { value: string | null }) {
  if (!value) return <TableCell.Secondary>Never tested</TableCell.Secondary>;
  let iso: string;
  try {
    iso = new Date(value).toISOString();
  } catch {
    iso = value;
  }
  return (
    <TableCell.Secondary>
      <span title={iso} data-screenshot-mask>
        Tested {formatRelativeTime(value)}
      </span>
    </TableCell.Secondary>
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
  const router = useRouter();

  const columns: ColumnDef<SiteListItem>[] = [
    {
      key: "name",
      header: (
        <SortHeader column="name" label="Name" sort={sort} dir={dir} filter={filter} />
      ),
      cell: (s) => (
        <Link
          href={`/admin/sites/${s.id}`}
          onClick={(e) => e.stopPropagation()}
          className="block transition-smooth hover:text-foreground hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
          data-testid={`site-row-link-${s.id}`}
        >
          <TableCell.Primary>{s.name}</TableCell.Primary>
        </Link>
      ),
    },
    {
      key: "company_name",
      header: (
        <SortHeader
          column="company_name"
          label="Company"
          sort={sort}
          dir={dir}
          filter={filter}
        />
      ),
      cell: (s) =>
        s.company_name ? (
          <TableCell.Secondary>{s.company_name}</TableCell.Secondary>
        ) : (
          <span className="text-sm italic text-destructive/70">Unassigned</span>
        ),
    },
    {
      key: "wp_url",
      header: (
        <SortHeader
          column="wp_url"
          label="WP URL"
          sort={sort}
          dir={dir}
          filter={filter}
        />
      ),
      cell: (s) => (
        <a
          href={s.wp_url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-sm text-muted-foreground transition-smooth hover:text-foreground hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
        >
          {s.wp_url}
        </a>
      ),
    },
    {
      key: "status",
      header: (
        <SortHeader
          column="status"
          label="Status"
          sort={sort}
          dir={dir}
          filter={filter}
        />
      ),
      cell: (s) => <StatusCell status={s.status} siteId={s.id} />,
    },
    {
      key: "last_connection_test_at",
      header: (
        <SortHeader
          column="last_connection_test_at"
          label="Last tested"
          sort={sort}
          dir={dir}
          filter={filter}
        />
      ),
      cell: (s) => <LastTestedCell value={s.last_connection_test_at} />,
    },
    // Custom actions column rendered as a regular cell so we can keep
    // SiteActionsMenu's `...` portal — DataTable's built-in rowActions
    // expects RowAction[], and SiteActionsMenu carries its own modal
    // state. Keep the existing component as-is.
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      width: "40px",
      align: "right",
      cell: (s) => (
        <span onClick={(e) => e.stopPropagation()}>
          <SiteActionsMenu
            siteId={s.id}
            name={s.name}
            wpUrl={s.wp_url}
            canDelete={isSuperAdmin}
          />
        </span>
      ),
    },
  ];

  return (
    <DataTable
      data={sites}
      columns={columns}
      rowKey={(s) => s.id}
      onRowClick={(s) => router.push(`/admin/sites/${s.id}`)}
      testId="sites-table"
      emptyState={{
        icon: <NavIcon name="earth" size={20} />,
        iconLabel: "No sites",
        title: "No sites connected yet",
        body: (
          <>
            Sites become available after you connect a WordPress install with
            the Opollo plugin. Add your first site to start generating pages.
          </>
        ),
        cta: onCreateClick ? (
          <Button onClick={onCreateClick}>
            <NavIcon name="plus" size={16} />
            Add a site
          </Button>
        ) : undefined,
      }}
    />
  );
}

// Suppress unused-import lint of SORTABLE_HEADERS — kept as documentation
// for the column→header mapping but rendered via inline ColumnDef config.
void SORTABLE_HEADERS;
