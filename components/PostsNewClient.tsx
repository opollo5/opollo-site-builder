"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { BlogPostComposer } from "@/components/BlogPostComposer";
import { NavIcon } from "@/components/ui/nav-icon";
import { BulkUploadPanel } from "@/components/BulkUploadPanel";
import { cn, formatRelativeTime } from "@/lib/utils";

// BL-1 — Client shell for /admin/posts/[siteId]/new.
//
// Site selection is handled by the SiteSelector in the section rail; this
// component only manages the mode tabs (Single post / Bulk upload) and the
// pending-drafts banner. The siteId is guaranteed by the server component.

type Mode = "single" | "bulk";

interface PostsNewClientProps {
  siteId: string;
  siteName: string;
}

export function PostsNewClient({ siteId, siteName: _siteName }: PostsNewClientProps) {
  const [mode, setMode] = useState<Mode>("single");

  return (
    <div className="space-y-6">
      <ModeTabs mode={mode} onModeChange={setMode} />

      <PendingDraftsNotice currentSiteId={siteId} />

      {mode === "single" ? (
        <div className="rounded-md border bg-background p-6">
          <BlogPostComposer siteId={siteId} />
        </div>
      ) : (
        <div className="rounded-md border bg-background p-6">
          <BulkUploadPanel siteId={siteId} />
        </div>
      )}
    </div>
  );
}

function ModeTabs({
  mode,
  onModeChange,
}: {
  mode: Mode;
  onModeChange: (next: Mode) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Post creation mode"
      className="inline-flex items-center gap-1 rounded-md border bg-muted/40 p-1"
    >
      <ModeTab
        id="single"
        active={mode === "single"}
        onClick={() => onModeChange("single")}
        iconName="file-empty"
        label="Single post"
      />
      <ModeTab
        id="bulk"
        active={mode === "bulk"}
        onClick={() => onModeChange("bulk")}
        iconName="layers"
        label="Bulk upload"
      />
    </div>
  );
}

function ModeTab({
  id,
  active,
  onClick,
  iconName,
  label,
}: {
  id: Mode;
  active: boolean;
  onClick: () => void;
  iconName: string;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      data-testid={`posts-new-tab-${id}`}
      className={cn(
        "relative inline-flex h-8 items-center gap-1.5 rounded px-3 text-sm font-medium transition-smooth focus:outline-none focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        active
          ? "bg-background text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <NavIcon name={iconName} size={14} />
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// PendingDraftsNotice — shows banners for drafts belonging to OTHER sites.
// The current site's draft is restored silently by BlogPostComposer on mount.
// Resume navigates to the other site's composer page via the URL.
// ---------------------------------------------------------------------------

interface PendingDraft {
  siteId: string;
  siteName?: string;
  savedAt: number;
}

function PendingDraftsNotice({ currentSiteId }: { currentSiteId: string }) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<PendingDraft[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const found: PendingDraft[] = [];
    const PREFIX = "opollo:post-draft:";
    try {
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (!key?.startsWith(PREFIX)) continue;
        const id = key.slice(PREFIX.length);
        if (!id) continue;
        try {
          const raw = window.localStorage.getItem(key);
          if (!raw) continue;
          const snap = JSON.parse(raw) as {
            v?: number;
            savedAt?: number;
            siteName?: string;
            composerText?: string;
            title?: { value?: string };
          };
          if (snap?.v !== 1) continue;
          const hasContent =
            (snap.title?.value?.trim().length ?? 0) > 0 ||
            (snap.composerText?.replace(/<[^>]+>/g, "").trim().length ?? 0) > 0;
          if (!hasContent) continue;
          // Skip current site — its draft is restored silently by BlogPostComposer.
          if (id === currentSiteId) continue;
          found.push({ siteId: id, siteName: snap.siteName, savedAt: snap.savedAt ?? 0 });
        } catch {
          // Corrupt entry — skip.
        }
      }
    } catch {
      // localStorage inaccessible.
    }
    setDrafts(found);
  }, [currentSiteId]);

  function discard(siteId: string) {
    try {
      window.localStorage.removeItem(`opollo:post-draft:${siteId}`);
    } catch {}
    setDrafts((prev) => prev.filter((d) => d.siteId !== siteId));
  }

  if (drafts.length === 0) return null;

  return (
    <div className="space-y-2" data-testid="pending-drafts-notice">
      {drafts.map((draft) => (
        <div
          key={draft.siteId}
          role="alert"
          className="flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm"
        >
          <span className="text-amber-900">
            Unsaved draft
            {draft.siteName ? (
              <>
                {" "}
                for <span className="font-medium">{draft.siteName}</span>
              </>
            ) : null}
            {draft.savedAt > 0 ? (
              <> from {formatRelativeTime(new Date(draft.savedAt).toISOString())}</>
            ) : null}
            .
          </span>
          <div className="flex shrink-0 items-center gap-3">
            <button
              type="button"
              onClick={() => router.push(`/admin/posts/${draft.siteId}/new`)}
              className="font-medium text-amber-900 underline underline-offset-2 hover:text-amber-700"
            >
              Resume
            </button>
            <span aria-hidden className="text-amber-400">
              ·
            </span>
            <button
              type="button"
              onClick={() => discard(draft.siteId)}
              className="text-amber-700 underline underline-offset-2 hover:text-amber-900"
            >
              Discard
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
