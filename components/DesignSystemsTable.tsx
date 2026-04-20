import Link from "next/link";
import type { DesignSystem } from "@/lib/design-systems";
import { Button } from "@/components/ui/button";
import { cn, formatRelativeTime } from "@/lib/utils";

function statusDotClass(status: DesignSystem["status"]): string {
  switch (status) {
    case "active":
      return "bg-green-500";
    case "draft":
      return "bg-slate-400";
    case "archived":
      return "bg-slate-300";
    default:
      return "bg-red-500";
  }
}

function StatusCell({ status }: { status: DesignSystem["status"] }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        aria-hidden="true"
        className={cn(
          "inline-block h-2 w-2 rounded-full",
          statusDotClass(status),
        )}
      />
      <span className="text-sm capitalize">{status}</span>
    </span>
  );
}

export function DesignSystemsTable({
  designSystems,
  siteId,
  onActivate,
  onArchive,
}: {
  designSystems: DesignSystem[];
  siteId: string;
  onActivate: (ds: DesignSystem) => void;
  onArchive: (ds: DesignSystem) => void;
}) {
  if (designSystems.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No design system versions yet. Click &ldquo;New draft&rdquo; to create the
          first one.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-medium">Version</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium">Created</th>
            <th className="px-4 py-2 font-medium">Activated</th>
            <th className="px-4 py-2 font-medium">Created by</th>
            <th className="px-4 py-2 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {designSystems.map((ds) => (
            <tr key={ds.id} className="border-b last:border-b-0">
              <td className="px-4 py-3 font-mono text-sm font-medium">
                v{ds.version}
              </td>
              <td className="px-4 py-3">
                <StatusCell status={ds.status} />
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {formatRelativeTime(ds.created_at)}
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {ds.activated_at ? formatRelativeTime(ds.activated_at) : "—"}
              </td>
              <td className="px-4 py-3 text-muted-foreground">
                {/* created_by is NULL until M2 auth backfill */}
                {ds.created_by ? ds.created_by : "—"}
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Link
                    href={`/admin/sites/${siteId}/design-system/components?ds=${ds.id}`}
                    className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                  >
                    Components →
                  </Link>
                  <Link
                    href={`/admin/sites/${siteId}/design-system/templates?ds=${ds.id}`}
                    className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                  >
                    Templates →
                  </Link>
                  <Link
                    href={`/admin/sites/${siteId}/design-system/preview?ds=${ds.id}`}
                    className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                  >
                    Preview →
                  </Link>
                  {ds.status === "draft" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onActivate(ds)}
                    >
                      Activate
                    </Button>
                  )}
                  {ds.status !== "archived" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onArchive(ds)}
                    >
                      Archive
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
