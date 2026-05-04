"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// S1-23 — media library client component.
// S1-57 — cursor pagination; "Load more" fetches the next page from the API
//          using the created_at cursor returned by the server.
// ---------------------------------------------------------------------------

type Asset = {
  id: string;
  source_url: string | null;
  storage_path: string;
  mime_type: string;
  bytes: number;
  width: number | null;
  height: number | null;
  bundle_upload_id: string | null;
  created_at: string;
};

type Props = {
  companyId: string;
  initialAssets: Asset[];
  initialNextCursor: string | null;
  canEdit: boolean;
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
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function MediaLibraryClient({
  companyId,
  initialAssets,
  initialNextCursor,
  canEdit,
}: Props) {
  const [assets, setAssets] = useState(initialAssets);
  const [nextCursor, setNextCursor] = useState<string | null>(initialNextCursor);
  const [showForm, setShowForm] = useState(false);
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/platform/social/media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_id: companyId,
          source_url: url.trim(),
        }),
      });
      const json = (await res.json()) as
        | { ok: true; data: { asset: Asset } }
        | { ok: false; error: { message: string } };
      if (!res.ok || !json.ok) {
        const msg = !json.ok ? json.error.message : "Failed to add asset.";
        setError(msg);
        return;
      }
      setAssets([json.data.asset, ...assets]);
      setUrl("");
      setShowForm(false);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLoadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({ company_id: companyId, before: nextCursor });
      const res = await fetch(`/api/platform/social/media?${params.toString()}`);
      const json = (await res.json()) as
        | { ok: true; data: { assets: Asset[]; next_cursor: string | null } }
        | { ok: false; error: { message: string } };
      if (!res.ok || !json.ok) return;
      setAssets((prev) => [...prev, ...json.data.assets]);
      setNextCursor(json.data.next_cursor);
    } finally {
      setLoadingMore(false);
    }
  }

  function copyId(id: string) {
    navigator.clipboard?.writeText(id);
    setCopiedId(id);
    window.setTimeout(() => setCopiedId(null), 1500);
  }

  return (
    <div data-testid="media-library">
      {canEdit ? (
        <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
          {showForm ? null : (
            <Button
              onClick={() => setShowForm(true)}
              data-testid="media-add-button"
            >
              Add asset
            </Button>
          )}
        </div>
      ) : null}

      {showForm ? (
        <form
          onSubmit={handleAdd}
          className="mb-4 rounded-md border bg-card p-4"
          data-testid="media-add-form"
        >
          <label className="block text-sm font-medium">
            Asset URL
            <input
              type="url"
              required
              placeholder="https://cdn.example.com/image.jpg"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm"
              data-testid="media-url-input"
            />
          </label>
          <p className="mt-1 text-sm text-muted-foreground">
            Must be an https URL accessible from bundle.social.
          </p>
          {error ? (
            <p className="mt-2 text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <div className="mt-3 flex items-center gap-2">
            <Button type="submit" disabled={submitting}>
              {submitting ? "Adding…" : "Add asset"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setShowForm(false);
                setUrl("");
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {assets.length === 0 ? (
        <div
          className="rounded-md border bg-card p-8 text-center text-sm text-muted-foreground"
          data-testid="media-empty"
        >
          No media assets yet.
          {canEdit ? " Click Add asset to upload your first." : ""}
        </div>
      ) : (
        <>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {assets.map((a) => (
              <li
                key={a.id}
                className="overflow-hidden rounded-lg border bg-card"
                data-testid={`media-row-${a.id}`}
              >
                {a.source_url && a.mime_type.startsWith("image/") ? (
                  // Use <img> rather than next/image — these are external
                  // URLs we don't control + they don't go through the Next
                  // image optimiser.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={a.source_url}
                    alt=""
                    className="h-40 w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-40 w-full items-center justify-center bg-muted text-sm text-muted-foreground">
                    {a.mime_type}
                  </div>
                )}
                <div className="p-3">
                  <div className="break-all text-sm">
                    {a.source_url ?? a.storage_path}
                  </div>
                  <div className="mt-1 flex items-center justify-between text-sm text-muted-foreground">
                    <span>{formatBytes(a.bytes)}</span>
                    <span>{formatDate(a.created_at)}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-sm">
                    <button
                      type="button"
                      className="text-primary underline"
                      onClick={() => copyId(a.id)}
                      data-testid={`media-copy-${a.id}`}
                    >
                      {copiedId === a.id ? "Copied" : "Copy id"}
                    </button>
                    {a.bundle_upload_id ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900">
                        uploaded
                      </span>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {nextCursor ? (
            <div className="mt-6 flex justify-center" data-testid="media-load-more">
              <Button
                variant="outline"
                onClick={handleLoadMore}
                disabled={loadingMore}
              >
                {loadingMore ? "Loading…" : "Load more"}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
