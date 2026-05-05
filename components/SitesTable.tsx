import Link from "next/link";
import { Globe, Plus } from "lucide-react";

import { SiteActionsMenu } from "@/components/SiteActionsMenu";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { SiteListItem } from "@/lib/tool-schemas";
import { cn, formatRelativeTime } from "@/lib/utils";

// ---------------------------------------------------------------------------
// B-2 — Sites list polish.
//
// Density: row height tightened to ~44px (px-3 py-2). Status cell
// keeps the dot + text pattern (distinct from StatusPill — chosen for
// the list-density, single-state context).
// Empty state folded to A-6's EmptyState primitive.
// Hover surface uses the .transition-smooth token for a less abrupt
// background flip.
// Status colors lean on A-2's success/warning tokens for AA-pass
// contrast against tinted backgrounds.
// ---------------------------------------------------------------------------

function statusDotClass(status: string): string {
  switch (status) {
    case "active":
      return "bg-success";
    case "pending_pairing":
      return "bg-muted-foreground/40";
    case "paused":
      return "bg-warning";
    case "removed":
      return "bg-muted-foreground/30";
    default:
      return "bg-destructive";
  }
}

function StatusCell({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span
        aria-hidden="true"
        className={cn(
          "inline-block h-2 w-2 rounded-full",
          statusDotClass(status),
        )}
      />
      <span className="capitalize">{status.replace(/_/g, " ")}</span>
    </span>
  );
}

interface SitesTableProps {
  sites: SiteListItem[];
  onCreateClick?: () => void;
}

export function SitesTable({ sites, onCreateClick }: SitesTableProps) {
  if (sites.length === 0) {
    return (
      <EmptyState
        icon={Globe}
        iconLabel="No sites"
        title="No sites connected yet"
        body={
          <>
            Sites become available after you connect a WordPress install
            with the Opollo plugin. Add your first site to start
            generating pages.
          </>
        }
        cta={
          onCreateClick && (
            <Button onClick={onCreateClick}>
              <Plus aria-hidden className="h-4 w-4" />
              Add a site
            </Button>
          )
        }
      />
    );
  }

  // BACKLOG fix (2026-04-29): the wrapper used `overflow-hidden` to
  // mask the table's corners against the rounded border, but it also
  // created a clipping context that hid the SiteActionsMenu pop-out
  // on rows near the bottom of the list. Drop overflow-hidden so the
  // menu can extend past the table.
  return (
    <div className="rounded-md border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40 text-left text-sm uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">WP URL</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Updated</th>
            <th className="w-10 px-2 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {sites.map((s) => (
            <tr
              key={s.id}
              className="group border-b transition-smooth last:border-b-0 hover:bg-muted/40"
            >
              <td className="px-3 py-2 font-medium">
                <Link
                  href={`/admin/sites/${s.id}`}
                  className="block transition-smooth hover:text-foreground hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
                  data-testid={`site-row-link-${s.id}`}
                >
                  {s.name}
                </Link>
              </td>
              <td className="px-3 py-2 text-muted-foreground">
                <a
                  href={s.wp_url}
                  target="_blank"
                  rel="noreferrer"
                  className="transition-smooth hover:text-foreground hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
                  onClick={(e) => e.stopPropagation()}
                >
                  {s.wp_url}
                </a>
              </td>
              <td className="px-3 py-2">
                <StatusCell status={s.status} />
              </td>
              <td className="px-3 py-2 text-sm text-muted-foreground">
                <span data-screenshot-mask>
                  {formatRelativeTime(s.updated_at)}
                </span>
              </td>
              <td
                className="px-2 py-2 text-right"
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
