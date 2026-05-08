"use client";

import { useState } from "react";

import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { NavIcon } from "@/components/ui/nav-icon";
import { Pill, type PillVariant } from "@/components/ui/pill";
import { TableCell } from "@/components/ui/table-cell";
import { toast } from "sonner";

import { toastSuccess } from "@/lib/toast-success";

// ---------------------------------------------------------------------------
// Spec 18 — DataTable + Pill visual reference page (client island).
//
// Each section below illustrates one canonical state. When migrating a
// real table, find the closest example here, copy the column config
// shape, and adapt.
// ---------------------------------------------------------------------------

interface SiteSample {
  id: string;
  name: string;
  company: string;
  wpUrl: string;
  status: "Connected" | "Not Connected";
  lastTested: string | null;
}

const SITE_SAMPLES: SiteSample[] = [
  {
    id: "1",
    name: "Test Site 2",
    company: "Acme Corp",
    wpUrl: "https://test2.acme.test",
    status: "Connected",
    lastTested: "2 hours ago",
  },
  {
    id: "2",
    name: "Acme Marketing",
    company: "Acme Corp",
    wpUrl: "https://marketing.acme.test",
    status: "Not Connected",
    lastTested: null,
  },
  {
    id: "3",
    name: "Planet6 Blog",
    company: "Planet6",
    wpUrl: "https://blog.planet6.test",
    status: "Connected",
    lastTested: "5 days ago",
  },
];

const PILL_VARIANTS: Array<{ variant: PillVariant; label: string; example: string }> = [
  { variant: "success", label: "success", example: "Connected" },
  { variant: "neutral", label: "neutral", example: "Customer" },
  { variant: "warning", label: "warning", example: "Scheduled" },
  { variant: "danger", label: "danger", example: "Removed" },
  { variant: "info", label: "info", example: "iStock" },
  { variant: "accent", label: "accent", example: "Opollo internal" },
];

export function ExampleTablesClient() {
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);

  const siteCols: ColumnDef<SiteSample>[] = [
    {
      key: "name",
      header: "Name",
      cell: (r) => <TableCell.Primary>{r.name}</TableCell.Primary>,
    },
    {
      key: "company",
      header: "Company",
      cell: (r) => <TableCell.Secondary>{r.company}</TableCell.Secondary>,
    },
    {
      key: "wpUrl",
      header: "WP URL",
      cell: (r) => <TableCell.Mono>{r.wpUrl}</TableCell.Mono>,
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => (
        <Pill variant={r.status === "Connected" ? "success" : "neutral"}>
          {r.status}
        </Pill>
      ),
    },
    {
      key: "lastTested",
      header: "Last tested",
      cell: (r) =>
        r.lastTested ? (
          <TableCell.Secondary>Tested {r.lastTested}</TableCell.Secondary>
        ) : (
          <TableCell.Secondary>Never tested</TableCell.Secondary>
        ),
    },
  ];

  return (
    <div className="mt-6 space-y-12">
      <Section
        title="Pill variants"
        description="The six canonical variants. Use Pill for every status / type / role indicator inside table cells."
      >
        <div className="flex flex-wrap items-center gap-3">
          {PILL_VARIANTS.map((p) => (
            <div key={p.variant} className="flex items-center gap-2 text-sm">
              <Pill variant={p.variant}>{p.example}</Pill>
              <span className="text-muted-foreground">{p.label}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Populated table with row click + row actions"
        description="Default pattern: rows are clickable and the trailing column is a `...` overflow menu."
      >
        <DataTable
          data={SITE_SAMPLES}
          columns={siteCols}
          rowKey={(r) => r.id}
          onRowClick={(r) => {
            toast.info(`Row clicked: ${r.name}`);
          }}
          rowActions={(r) => [
            {
              label: "Test connection",
              icon: <NavIcon name="cloud-lightning" size={14} />,
              onClick: () => {
                toastSuccess(`Tested: ${r.name}`);
              },
            },
            {
              label: "Edit",
              icon: <NavIcon name="pencil" size={14} />,
              onClick: () => {
                toast.info(`Edit: ${r.name}`);
              },
            },
            {
              label: "Delete",
              icon: <NavIcon name="trash2" size={14} />,
              variant: "destructive",
              onClick: () => {
                toast.error(`Delete: ${r.name}`);
              },
            },
          ]}
        />
      </Section>

      <Section
        title="Selectable rows"
        description="Pass `selectable` and `onSelectionChange` to surface a checkbox column."
      >
        <DataTable
          data={SITE_SAMPLES}
          columns={siteCols}
          rowKey={(r) => r.id}
          selectable
          selectedKeys={selectedKeys}
          onSelectionChange={setSelectedKeys}
        />
        <p className="mt-2 text-sm text-muted-foreground">
          Selected: {selectedKeys.length === 0 ? "none" : selectedKeys.join(", ")}
        </p>
      </Section>

      <Section
        title="Empty state"
        description="When `data.length === 0`, render an EmptyState block in place of the table body."
      >
        <DataTable<SiteSample>
          data={[]}
          columns={siteCols}
          rowKey={(r) => r.id}
          emptyState={{
            icon: <NavIcon name="earth" size={20} />,
            title: "No sites yet",
            body: "Connect your first WordPress site to start publishing.",
          }}
        />
      </Section>

      <Section
        title="Loading skeletons"
        description="Pass `loading` to render placeholder rows while data is in flight."
      >
        <DataTable<SiteSample>
          data={[]}
          columns={siteCols}
          rowKey={(r) => r.id}
          loading
          loadingRowCount={4}
        />
      </Section>

      <Section
        title="Stack cell (title + secondary line)"
        description="Use TableCell.Stack for the 'Test Site 2 / never tested' pattern — primary headline + muted secondary line."
      >
        <DataTable
          data={SITE_SAMPLES}
          columns={[
            {
              key: "stack",
              header: "Site",
              cell: (r) => (
                <TableCell.Stack
                  primary={r.name}
                  secondary={r.lastTested ? `Tested ${r.lastTested}` : "Never tested"}
                />
              ),
            },
            {
              key: "status",
              header: "Status",
              cell: (r) => (
                <Pill variant={r.status === "Connected" ? "success" : "neutral"}>
                  {r.status}
                </Pill>
              ),
            },
          ]}
          rowKey={(r) => r.id}
        />
      </Section>

      <Section
        title="Empty cell sentinel"
        description="Use TableCell.Empty (em-dash) for null / missing values. Never blank."
      >
        <DataTable
          data={[
            { id: "1", name: "Site with domain", domain: "example.com" },
            { id: "2", name: "Site without domain", domain: null },
          ]}
          columns={[
            {
              key: "name",
              header: "Name",
              cell: (r) => <TableCell.Primary>{r.name}</TableCell.Primary>,
            },
            {
              key: "domain",
              header: "Domain",
              cell: (r) =>
                r.domain ? (
                  <TableCell.Mono>{r.domain}</TableCell.Mono>
                ) : (
                  <TableCell.Empty />
                ),
            },
          ]}
          rowKey={(r) => r.id}
        />
      </Section>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <header>
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </header>
      {children}
    </section>
  );
}
