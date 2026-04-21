import Link from "next/link";

import { SiteActionsMenu } from "@/components/SiteActionsMenu";
import type { SiteListItem } from "@/lib/tool-schemas";
import { cn, formatRelativeTime } from "@/lib/utils";

function statusDotClass(status: string): string {
  switch (status) {
    case "active":
      return "bg-green-500";
    case "pending_pairing":
      return "bg-slate-400";
    case "paused":
      return "bg-yellow-500";
    case "removed":
      return "bg-slate-300";
    default:
      return "bg-red-500";
  }
}

function StatusCell({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        aria-hidden="true"
        className={cn("inline-block h-2 w-2 rounded-full", statusDotClass(status))}
      />
      <span className="text-sm capitalize">{status.replace(/_/g, " ")}</span>
    </span>
  );
}

// Sites table with row-level navigation + action menu. The row <a>
// wrapper covers the primary cells; the actions column stops event
// propagation so the menu doesn't double-fire with a row click.
export function SitesTable({ sites }: { sites: SiteListItem[] }) {
  if (sites.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No sites yet. Click &ldquo;Add new site&rdquo; to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-medium">Name</th>
            <th className="px-4 py-2 font-medium">WP URL</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium">Updated</th>
            <th className="w-10 px-2 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {sites.map((s) => (
            <tr
              key={s.id}
              className="group border-b last:border-b-0 hover:bg-muted/40"
            >
              <td className="px-4 py-3 font-medium">
                <Link
                  href={`/admin/sites/${s.id}`}
                  className="block hover:underline"
                >
                  {s.name}
                </Link>
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                <a
                  href={s.wp_url}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {s.wp_url}
                </a>
              </td>
              <td className="px-4 py-3">
                <StatusCell status={s.status} />
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {formatRelativeTime(s.updated_at)}
              </td>
              <td
                className="px-2 py-3 text-right"
                onClick={(e) => e.stopPropagation()}
              >
                <SiteActionsMenu
                  siteId={s.id}
                  name={s.name}
                  wpUrl={s.wp_url}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
