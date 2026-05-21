"use client";

import * as React from "react";

// ---------------------------------------------------------------------------
// AdminMediaClient — C1
//
// Client component rendered in /admin/media. Lists all social_media_assets
// across companies. Staff can click "Promote" to set scope='global' on any
// company-scoped asset.
// ---------------------------------------------------------------------------

type AdminMediaAsset = {
  id: string;
  company_id: string;
  source_url: string | null;
  mime_type: string;
  bytes: number;
  scope: "company" | "global";
  created_at: string;
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AdminMediaClient({ initialAssets }: { initialAssets: AdminMediaAsset[] }) {
  const [assets, setAssets] = React.useState(initialAssets);
  const [promoting, setPromoting] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function promote(id: string) {
    setPromoting(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/media/${id}/promote`, { method: "POST" });
      const json = (await res.json()) as { ok: boolean; error?: { message: string } };
      if (!json.ok) {
        setError(json.error?.message ?? "Promote failed.");
      } else {
        setAssets((prev) =>
          prev.map((a) => (a.id === id ? { ...a, scope: "global" as const } : a)),
        );
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setPromoting(null);
    }
  }

  if (assets.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">No media assets found.</p>
    );
  }

  return (
    <div className="space-y-2">
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="px-4 py-2 text-left font-medium text-muted-foreground">Preview</th>
              <th className="px-4 py-2 text-left font-medium text-muted-foreground">Type</th>
              <th className="px-4 py-2 text-left font-medium text-muted-foreground">Size</th>
              <th className="px-4 py-2 text-left font-medium text-muted-foreground">Scope</th>
              <th className="px-4 py-2 text-left font-medium text-muted-foreground">Company</th>
              <th className="px-4 py-2 text-left font-medium text-muted-foreground">Uploaded</th>
              <th className="px-4 py-2 text-right font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {assets.map((asset) => (
              <tr
                key={asset.id}
                data-testid={`admin-media-row-${asset.id}`}
                className="border-b border-border last:border-0 hover:bg-muted/20 transition-colors"
              >
                <td className="px-4 py-2">
                  {asset.source_url && asset.mime_type.startsWith("image/") ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={asset.source_url}
                      alt=""
                      className="h-10 w-10 rounded object-cover"
                    />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded bg-muted text-xs text-muted-foreground">
                      {asset.mime_type.split("/")[1]?.toUpperCase().slice(0, 3) ?? "FILE"}
                    </div>
                  )}
                </td>
                <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                  {asset.mime_type}
                </td>
                <td className="px-4 py-2 text-muted-foreground">{formatBytes(asset.bytes)}</td>
                <td className="px-4 py-2">
                  <span
                    data-testid={`scope-badge-${asset.id}`}
                    className={
                      asset.scope === "global"
                        ? "rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700"
                        : "rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
                    }
                  >
                    {asset.scope}
                  </span>
                </td>
                <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                  {asset.company_id.slice(0, 8)}…
                </td>
                <td className="px-4 py-2 text-muted-foreground">{formatDate(asset.created_at)}</td>
                <td className="px-4 py-2 text-right">
                  {asset.scope === "company" ? (
                    <button
                      type="button"
                      data-testid={`promote-btn-${asset.id}`}
                      disabled={promoting === asset.id}
                      onClick={() => void promote(asset.id)}
                      className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                    >
                      {promoting === asset.id ? "Promoting…" : "Promote to global"}
                    </button>
                  ) : (
                    <span className="text-xs text-muted-foreground">Global</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
