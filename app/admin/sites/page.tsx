import { SitesListClient } from "@/components/SitesListClient";
import { listSites } from "@/lib/sites";
import type { SiteListItem } from "@/lib/tool-schemas";

// Server component. Reads the site list at request time via
// lib/sites.listSites (service-role; bypasses RLS) and passes it into
// the client shell that owns modal state + create button. The
// previous implementation was a client component that fetched
// /api/sites/list on mount — under Next's default caching for static
// page shells, stale responses could persist even across full
// reloads. Reading on the server eliminates every layer between
// Supabase and the DOM where a stale list could survive.

export const dynamic = "force-dynamic";

export default async function ManageSitesPage() {
  const result = await listSites();
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
  return <SitesListClient sites={sites} />;
}
