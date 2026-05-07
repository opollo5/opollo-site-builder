"use client";

import { useRouter } from "next/navigation";

import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { NavIcon } from "@/components/ui/nav-icon";
import { Pill, type PillVariant } from "@/components/ui/pill";
import { TableCell } from "@/components/ui/table-cell";
import type { PageListItem } from "@/lib/pages";
import { formatRelativeTime } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Spec 18 PR C — PagesTable migration.
//
// Replaced bespoke <table> + StatusPill with the canonical DataTable.
//
// Visual contract:
//   - Title / Slug → TableCell.Stack (title + /slug as secondary).
//   - Type         → Pill (info) — page_type is taxonomic, treat as
//                    `info` (blue) since neutral is reserved for "no
//                    semantic value" and these all carry meaning.
//   - Status       → Pill (success Published, neutral Draft, warning
//                    Scheduled). Status comes from the M6-1 page-status
//                    enum which mirrors post-status.
//   - DS version   → TableCell.Mono.
//   - Updated      → TableCell.Secondary (relative time).
//
// Row click navigates to the page detail surface.
// ---------------------------------------------------------------------------

type PagesTableProps = {
  items: PageListItem[];
  siteId: string;
  backHref?: string;
};

const STATUS_VARIANT: Record<string, PillVariant> = {
  published: "success",
  draft: "neutral",
  scheduled: "warning",
};

function buildDetailHref(
  siteId: string,
  pageId: string,
  backHref: string | undefined,
): string {
  const base = `/admin/sites/${siteId}/pages/${pageId}`;
  if (!backHref || backHref === `/admin/sites/${siteId}/pages`) return base;
  const params = new URLSearchParams({ from: backHref });
  return `${base}?${params.toString()}`;
}

export function PagesTable({ items, siteId, backHref }: PagesTableProps) {
  const router = useRouter();

  const columns: ColumnDef<PageListItem>[] = [
    {
      key: "title",
      header: "Title",
      cell: (p) => (
        <TableCell.Stack primary={p.title} secondary={`/${p.slug}`} />
      ),
    },
    {
      key: "type",
      header: "Type",
      cell: (p) => <Pill variant="info">{p.page_type.replace(/_/g, " ")}</Pill>,
    },
    {
      key: "status",
      header: "Status",
      cell: (p) => (
        <Pill variant={STATUS_VARIANT[p.status] ?? "neutral"}>{p.status}</Pill>
      ),
    },
    {
      key: "ds_version",
      header: "DS version",
      cell: (p) => <TableCell.Mono>v{p.design_system_version}</TableCell.Mono>,
    },
    {
      key: "updated",
      header: "Updated",
      cell: (p) => (
        <TableCell.Secondary>{formatRelativeTime(p.updated_at)}</TableCell.Secondary>
      ),
    },
  ];

  return (
    <DataTable
      data={items}
      columns={columns}
      rowKey={(p) => p.id}
      onRowClick={(p) =>
        router.push(buildDetailHref(siteId, p.id, backHref))
      }
      testId="pages-table"
      emptyState={{
        icon: <NavIcon name="file-empty" size={20} />,
        iconLabel: "No pages",
        title: "No pages match these filters",
        body: <>Adjust the filters above or run a batch to generate pages.</>,
      }}
    />
  );
}
