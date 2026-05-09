import Link from "next/link";

import { SitesListClient } from "@/components/SitesListClient";
import { Button } from "@/components/ui/button";
import { NavIcon } from "@/components/ui/nav-icon";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { checkAdminAccess } from "@/lib/admin-gate";
import {
  SITE_SORTABLE_COLUMNS,
  listSites,
  type SiteSortColumn,
  type SiteSortDir,
  type ListSitesOptions,
} from "@/lib/sites";
import type { SiteListItem } from "@/lib/tool-schemas";

// Server component. Reads the site list at request time via
// lib/sites.listSites (service-role; bypasses RLS) and passes it into
// the client shell that owns modal state + create button. The
// previous implementation was a client component that fetched
// /api/sites/list on mount — under Next's default caching for static
// page shells, stale responses could persist even across full
// reloads. Reading on the server eliminates every layer between
// Supabase and the DOM where a stale list could survive.
//
// Spec 01 — `?status=`, `?sort=`, `?dir=` URL search params drive
// filter + sort. Read here and threaded through to the data layer so
// the table renders pre-sorted/pre-filtered rows on first paint.

export const dynamic = "force-dynamic";

const FILTER_VALUES = new Set([
  "active",
  "pending_pairing",
  "paused",
  "removed",
] as const);

function readStatusFilter(
  value: string | string[] | undefined,
): ListSitesOptions["status"] {
  const v = Array.isArray(value) ? value[0] : value;
  if (!v) return null;
  return FILTER_VALUES.has(v as never)
    ? (v as ListSitesOptions["status"])
    : null;
}

function readSortColumn(
  value: string | string[] | undefined,
): SiteSortColumn | null {
  const v = Array.isArray(value) ? value[0] : value;
  if (!v) return null;
  return (SITE_SORTABLE_COLUMNS as readonly string[]).includes(v)
    ? (v as SiteSortColumn)
    : null;
}

function readSortDir(value: string | string[] | undefined): SiteSortDir | null {
  const v = Array.isArray(value) ? value[0] : value;
  if (v === "asc" || v === "desc") return v;
  return null;
}

export default async function ManageSitesPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  // Read the operator's role so the per-row dropdown can hide the
  // Delete (purge) item from non-super_admin tiers. Mirrors the
  // !user || user.role === "super_admin" pattern in app/admin/layout.tsx
  // — feature-flag-off / kill-switch sessions (user === null) get the
  // benefit of the doubt and see the full menu.
  const access = await checkAdminAccess();
  const isSuperAdmin =
    !access || access.kind !== "allow"
      ? false
      : !access.user || access.user.role === "super_admin";

  const status = readStatusFilter(searchParams?.status);
  const sort = readSortColumn(searchParams?.sort);
  const dir = readSortDir(searchParams?.dir);

  const result = await listSites({ status, sort, dir });
  if (!result.ok) {
    return (
      <PageShell>
        <PageHeader>
          <PageHeader.Breadcrumb
            segments={[
              { label: "Admin", href: "/admin/sites" },
              { label: "Sites" },
            ]}
          />
          <PageHeader.Title>Sites</PageHeader.Title>
        </PageHeader>
        <div
          className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
          role="alert"
        >
          Failed to load sites: {result.error.message}
        </div>
      </PageShell>
    );
  }
  const sites: SiteListItem[] = result.data.sites;
  const subtitle =
    sites.length === 0
      ? "No WordPress sites connected yet."
      : `${sites.length} WordPress ${sites.length === 1 ? "site" : "sites"} connected to this builder.`;
  return (
    <PageShell>
      <PageHeader>
        <PageHeader.Breadcrumb
          segments={[
            { label: "Admin", href: "/admin/sites" },
            { label: "Sites" },
          ]}
        />
        <PageHeader.Title>Sites</PageHeader.Title>
        <PageHeader.Subtitle>{subtitle}</PageHeader.Subtitle>
        <PageHeader.Actions>
          <Button asChild data-testid="add-site-button">
            <Link href="/admin/sites/new">
              <NavIcon name="plus" size={16} />
              New site
            </Link>
          </Button>
        </PageHeader.Actions>
      </PageHeader>
      <SitesListClient
        sites={sites}
        filter={status}
        sort={sort}
        dir={dir}
        isSuperAdmin={isSuperAdmin}
      />
    </PageShell>
  );
}
