import Link from "next/link";

import type { PageListItem } from "@/lib/pages";
import { formatRelativeTime } from "@/lib/utils";

// ---------------------------------------------------------------------------
// M6-1 — pure presentation of the pages list.
//
// Each row links to the detail page (M6-2 wires the target route);
// until that ships, the link points at the placeholder route. Actions
// column is reserved for M6-3 (edit) and a future "Open in WP admin"
// shortcut.
// ---------------------------------------------------------------------------

function statusBadgeClass(status: string): string {
  switch (status) {
    case "published":
      return "bg-emerald-500/10 text-emerald-700";
    case "draft":
      return "bg-muted text-muted-foreground";
    default:
      return "bg-muted";
  }
}

type PagesTableProps = {
  items: PageListItem[];
  siteId: string;
  backHref?: string;
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
  if (items.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No pages match these filters.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-medium">Title</th>
            <th className="px-4 py-2 font-medium">Type</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium">DS version</th>
            <th className="px-4 py-2 font-medium">Updated</th>
          </tr>
        </thead>
        <tbody>
          {items.map((p) => (
            <tr
              key={p.id}
              className="border-b last:border-b-0 hover:bg-muted/40"
              data-testid="page-row"
              data-page-id={p.id}
            >
              <td className="px-4 py-3 align-top">
                <Link
                  href={buildDetailHref(siteId, p.id, backHref)}
                  className="font-medium hover:underline"
                  data-testid="page-row-link"
                >
                  {p.title}
                </Link>
                <div className="mt-1 text-xs text-muted-foreground">
                  /{p.slug}
                </div>
              </td>
              <td className="px-4 py-3 align-top text-xs text-muted-foreground">
                {p.page_type.replace(/_/g, " ")}
              </td>
              <td className="px-4 py-3 align-top">
                <span
                  className={`inline-flex rounded px-2 py-0.5 text-xs font-medium capitalize ${statusBadgeClass(p.status)}`}
                >
                  {p.status}
                </span>
              </td>
              <td className="px-4 py-3 align-top text-xs text-muted-foreground">
                v{p.design_system_version}
              </td>
              <td className="px-4 py-3 align-top text-xs text-muted-foreground">
                {formatRelativeTime(p.updated_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
