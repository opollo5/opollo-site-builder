import { SitesListClient } from "@/components/SitesListClient";
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
      <div
        className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
        role="alert"
      >
        Failed to load sites: {result.error.message}
      </div>
    );
  }
  const sites: SiteListItem[] = result.data.sites;
  return (
    <SitesListClient
      sites={sites}
      filter={status}
      sort={sort}
      dir={dir}
      isSuperAdmin={isSuperAdmin}
    />
  );
}
