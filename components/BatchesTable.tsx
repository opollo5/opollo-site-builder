"use client";

import { useRouter } from "next/navigation";

import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { NavIcon } from "@/components/ui/nav-icon";
import { Pill, type PillVariant } from "@/components/ui/pill";
import { TableCell } from "@/components/ui/table-cell";

// ---------------------------------------------------------------------------
// Spec 18 PR C — BatchesTable client component.
//
// Pulled out of `app/admin/batches/page.tsx` as a "use client" island so
// the canonical DataTable (which relies on `useRouter` for row click +
// React state for hover/selection) can drive presentation. The server
// component continues to fetch + project the rows; this component only
// handles the table chrome.
//
// Visual contract:
//   - Site / Template → TableCell.Stack (site_name + template_name).
//   - Status          → Pill keyed off the job_status taxonomy.
//   - Progress        → tabular-nums, secondary muted text.
//   - Cost            → TableCell.Mono ($0.42 etc.).
//   - Created         → TableCell.Secondary.
//   - By              → TableCell.Secondary OR TableCell.Empty.
// ---------------------------------------------------------------------------

export type BatchRow = {
  id: string;
  site_id: string;
  site_name: string;
  template_name: string;
  status: string;
  requested_count: number;
  succeeded_count: number;
  failed_count: number;
  created_at: string;
  created_by_email: string | null;
  total_cost_usd_cents: number;
};

const STATUS_VARIANT: Record<string, PillVariant> = {
  queued: "neutral",
  running: "info",
  partial: "warning",
  succeeded: "success",
  failed: "danger",
  cancelled: "neutral",
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    });
  } catch {
    return iso;
  }
}

function formatCost(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

interface BatchesTableProps {
  rows: BatchRow[];
  siteId: string;
}

export function BatchesTable({ rows, siteId }: BatchesTableProps) {
  const router = useRouter();

  const columns: ColumnDef<BatchRow>[] = [
    {
      key: "site_template",
      header: "Site / Template",
      cell: (r) => (
        <TableCell.Stack primary={r.site_name} secondary={r.template_name} />
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => (
        <Pill variant={STATUS_VARIANT[r.status] ?? "neutral"}>{r.status}</Pill>
      ),
    },
    {
      key: "progress",
      header: "Progress",
      cell: (r) => (
        <span className="text-sm tabular-nums text-muted-foreground">
          {r.succeeded_count} ok · {r.failed_count} fail · {r.requested_count}{" "}
          total
        </span>
      ),
    },
    {
      key: "cost",
      header: "Cost",
      align: "right",
      cell: (r) => (
        <TableCell.Mono>{formatCost(r.total_cost_usd_cents)}</TableCell.Mono>
      ),
    },
    {
      key: "created",
      header: "Created",
      cell: (r) => <TableCell.Secondary>{formatDate(r.created_at)}</TableCell.Secondary>,
    },
    {
      key: "by",
      header: "By",
      cell: (r) =>
        r.created_by_email ? (
          <TableCell.Secondary>{r.created_by_email}</TableCell.Secondary>
        ) : (
          <TableCell.Empty />
        ),
    },
  ];

  return (
    <DataTable
      data={rows}
      columns={columns}
      rowKey={(r) => r.id}
      onRowClick={(r) => router.push(`/admin/batches/${siteId}/${r.id}`)}
      testId="batches-table"
      emptyState={{
        icon: <NavIcon name="tree" size={20} />,
        iconLabel: "No batches",
        title: "No batches yet",
        body: (
          <>
            Run a batch to generate multiple pages from a template against the
            active design system.
          </>
        ),
      }}
    />
  );
}
