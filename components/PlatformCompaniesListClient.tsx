"use client";

import { useRouter } from "next/navigation";

import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { NavIcon } from "@/components/ui/nav-icon";
import { Pill } from "@/components/ui/pill";
import { TableCell } from "@/components/ui/table-cell";
import type { PlatformCompanyListItem } from "@/lib/platform/companies";

// ---------------------------------------------------------------------------
// Spec 18 PR B — Companies table migration.
//
// Replaced the bespoke <table> markup with the canonical DataTable
// primitive. Visual contract:
//
//   - Slug    → TableCell.Mono.
//   - Domain  → TableCell.Mono OR TableCell.Empty (never blank).
//   - Members → right-aligned tabular-nums, primary cell text.
//   - Type    → Pill (`accent` for "Opollo internal", `neutral` otherwise).
//
// Row actions intentionally omitted: edit / manage-members / delete are
// not yet exposed via individual API routes for companies, so the
// canonical pattern (`...` menu) has nothing to call. Action lives on
// the company detail page reached via row click. Documented in the
// Spec 18 PR B description.
// ---------------------------------------------------------------------------

const COLUMNS: ColumnDef<PlatformCompanyListItem>[] = [
  {
    key: "name",
    header: "Name",
    cell: (c) => <TableCell.Primary>{c.name}</TableCell.Primary>,
  },
  {
    key: "slug",
    header: "Slug",
    cell: (c) => <TableCell.Mono>{c.slug}</TableCell.Mono>,
  },
  {
    key: "domain",
    header: "Domain",
    cell: (c) =>
      c.domain ? <TableCell.Mono>{c.domain}</TableCell.Mono> : <TableCell.Empty />,
  },
  {
    key: "members",
    header: "Members",
    align: "right",
    cell: (c) => (
      <span className="text-sm tabular-nums text-foreground">
        {c.member_count}
      </span>
    ),
  },
  {
    key: "type",
    header: "Type",
    cell: (c) => (
      <Pill variant={c.is_opollo_internal ? "accent" : "neutral"}>
        {c.is_opollo_internal ? "Opollo internal" : "Customer"}
      </Pill>
    ),
  },
];

export function PlatformCompaniesListClient({
  companies,
}: {
  companies: PlatformCompanyListItem[];
}) {
  const router = useRouter();

  return (
    <DataTable
      data={companies}
      columns={COLUMNS}
      rowKey={(c) => c.id}
      onRowClick={(c) => router.push(`/admin/companies/${c.id}`)}
      testId="platform-companies-table"
      emptyState={{
        icon: <NavIcon name="apartment" size={20} />,
        iconLabel: "No companies",
        title: "No companies yet",
        body: (
          <>
            Companies group sites and members under a single billing /
            access tenant. Click <strong>New company</strong> to add one.
          </>
        ),
      }}
    />
  );
}
