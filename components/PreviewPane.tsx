"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

const WP_URL = (process.env.NEXT_PUBLIC_LEADSOURCE_WP_URL ?? "").replace(
  /\/+$/,
  "",
);

function buildPreviewUrl(pageId: number): string {
  return `${WP_URL}/?page_id=${pageId}&preview=true`;
}

function buildAdminUrl(pageId: number): string {
  return `${WP_URL}/wp-admin/post.php?post=${pageId}&action=edit`;
}

export function PreviewPane({ pageId }: { pageId: number | null }) {
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (pageId !== null) setLoading(true);
  }, [pageId]);

  if (pageId === null) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-sm text-muted-foreground">
          Preview will appear here once a page is drafted.
        </p>
      </div>
    );
  }

  if (!WP_URL) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
        <p className="text-sm text-muted-foreground">
          NEXT_PUBLIC_LEADSOURCE_WP_URL is not configured.
        </p>
        <p className="text-sm text-muted-foreground">
          Set it in your deployment environment to enable the preview iframe.
        </p>
      </div>
    );
  }

  const previewUrl = buildPreviewUrl(pageId);
  const adminUrl = buildAdminUrl(pageId);

  return (
    <div className="flex h-full flex-col">
      <div className="relative flex-1 bg-background">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-muted/60">
            <p className="text-sm text-muted-foreground">Loading preview…</p>
          </div>
        )}
        <iframe
          key={pageId}
          src={previewUrl}
          className="h-full w-full border-0"
          onLoad={() => setLoading(false)}
          title={`WordPress preview for page ${pageId}`}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      </div>
      <div className="flex flex-none items-center gap-2 border-t bg-background p-2">
        <Button asChild variant="outline" size="sm">
          <a href={adminUrl} target="_blank" rel="noreferrer">
            Open in WordPress
          </a>
        </Button>
        <Button asChild variant="outline" size="sm">
          <a href={previewUrl} target="_blank" rel="noreferrer">
            Open in new tab
          </a>
        </Button>
        <span className="ml-auto text-sm text-muted-foreground">
          page_id: {pageId}
        </span>
      </div>
    </div>
  );
}
