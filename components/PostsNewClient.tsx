"use client";

import { useEffect, useState } from "react";
import { ChevronDown, FileText, Layers } from "lucide-react";

import { BlogPostComposer } from "@/components/BlogPostComposer";
import { BulkUploadPanel } from "@/components/BulkUploadPanel";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { SiteListItem } from "@/lib/tool-schemas";
import { cn, formatRelativeTime } from "@/lib/utils";

// BL-1 — Client shell for /admin/posts/new.
//
// Two responsibilities:
//   1. A site picker that gates the composer. The composer needs a
//      siteId; until the operator picks one we render a quiet shell.
//   2. A tabs row with "Single post" + "Bulk upload". Bulk is a
//      parked stub today (BL-5 fills it). Tabs ride above the picker
//      so the operator sees the available modes before committing to
//      a site.

type Mode = "single" | "bulk";

interface PostsNewClientProps {
  sites: SiteListItem[];
}

export function PostsNewClient({ sites }: PostsNewClientProps) {
  const [mode, setMode] = useState<Mode>("single");
  const [siteId, setSiteId] = useState<string | null>(null);

  const selectedSite = sites.find((s) => s.id === siteId) ?? null;

  return (
    <div className="space-y-6">
      <ModeTabs mode={mode} onModeChange={setMode} />

      <PendingDraftsNotice
        onResume={(id) => {
          setSiteId(id);
          setMode("single");
        }}
      />

      <SitePicker
        sites={sites}
        value={selectedSite}
        onChange={(s) => setSiteId(s?.id ?? null)}
      />

      {mode === "single" ? (
        selectedSite ? (
          <div className="rounded-md border bg-background p-6">
            <BlogPostComposer siteId={selectedSite.id} />
          </div>
        ) : (
          <EmptyShell label="Pick a site to start drafting your post." />
        )
      ) : selectedSite ? (
        <div className="rounded-md border bg-background p-6">
          <BulkUploadPanel siteId={selectedSite.id} />
        </div>
      ) : (
        <EmptyShell label="Pick a site to start a bulk upload." />
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
        icon={FileText}
        label="Single post"
      />
      <ModeTab
        id="bulk"
        active={mode === "bulk"}
        onClick={() => onModeChange("bulk")}
        icon={Layers}
        label="Bulk upload"
      />
    </div>
  );
}

function ModeTab({
  id,
  active,
  onClick,
  icon: Icon,
  label,
}: {
  id: Mode;
  active: boolean;
  onClick: () => void;
  icon: typeof FileText;
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
      <Icon aria-hidden className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function SitePicker({
  sites,
  value,
  onChange,
}: {
  sites: SiteListItem[];
  value: SiteListItem | null;
  onChange: (next: SiteListItem | null) => void;
}) {
  const [open, setOpen] = useState(false);

  if (sites.length === 0) {
    return (
      <div
        role="status"
        className="rounded-md border bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
      >
        No sites available. Pair a WordPress install in
        <code className="mx-1 font-mono text-sm">/admin/sites</code>
        before posting.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <label
        htmlFor="posts-new-site-picker"
        className="block text-sm font-medium"
      >
        Site
      </label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            id="posts-new-site-picker"
            type="button"
            data-testid="posts-new-site-picker"
            className="flex h-10 w-full max-w-md items-center justify-between rounded-md border bg-background px-3 text-sm transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-haspopup="listbox"
            aria-expanded={open}
          >
            <span className={value ? "" : "text-muted-foreground"}>
              {value ? value.name : "Pick a site…"}
            </span>
            <ChevronDown
              aria-hidden
              className="ml-2 h-4 w-4 text-muted-foreground"
            />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={4}
          className="w-[var(--radix-popover-trigger-width)] p-0"
        >
          <Command>
            <CommandInput placeholder="Search sites by name or URL" />
            <CommandList>
              <CommandEmpty>No sites match.</CommandEmpty>
              {sites.map((s) => (
                <CommandItem
                  key={s.id}
                  value={`${s.name} ${s.wp_url}`}
                  onSelect={() => {
                    onChange(s);
                    setOpen(false);
                  }}
                  data-testid={`posts-new-site-option-${s.id}`}
                >
                  <span className="flex-1 truncate">{s.name}</span>
                  <span className="ml-2 shrink-0 truncate text-sm text-muted-foreground">
                    {hostnameOf(s.wp_url)}
                  </span>
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value && (
        <p className="text-sm text-muted-foreground">
          Posting to <span className="font-medium text-foreground">{value.name}</span>{" "}
          ({hostnameOf(value.wp_url)}).
        </p>
      )}
    </div>
  );
}

function EmptyShell({
  label,
  description,
}: {
  label: string;
  description?: string;
}) {
  return (
    <div className="rounded-md border border-dashed bg-muted/20 px-6 py-12 text-center text-sm">
      <p className="font-medium">{label}</p>
      {description && (
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------------------
// Issue 17 — PendingDraftsNotice.
//
// Scans localStorage for opollo:post-draft:* keys on mount and shows a
// banner for any draft that has content. The operator can resume (which
// selects that site + opens the composer) or discard the saved state.
// ---------------------------------------------------------------------------

interface PendingDraft {
  siteId: string;
  siteName?: string;
  savedAt: number;
}

function PendingDraftsNotice({ onResume }: { onResume: (siteId: string) => void }) {
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
          // Only surface drafts that have actual content.
          const hasContent =
            (snap.title?.value?.trim().length ?? 0) > 0 ||
            (snap.composerText?.replace(/<[^>]+>/g, "").trim().length ?? 0) > 0;
          if (!hasContent) continue;
          found.push({ siteId: id, siteName: snap.siteName, savedAt: snap.savedAt ?? 0 });
        } catch {
          // Corrupt entry — skip.
        }
      }
    } catch {
      // localStorage inaccessible in some contexts.
    }
    setDrafts(found);
  }, []);

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
          className="flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm dark:border-amber-800/40 dark:bg-amber-900/20"
        >
          <span className="text-amber-900 dark:text-amber-200">
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
              onClick={() => onResume(draft.siteId)}
              className="font-medium text-amber-900 underline underline-offset-2 hover:text-amber-700 dark:text-amber-200 dark:hover:text-amber-100"
            >
              Resume
            </button>
            <span aria-hidden className="text-amber-400">
              ·
            </span>
            <button
              type="button"
              onClick={() => discard(draft.siteId)}
              className="text-amber-700 underline underline-offset-2 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-100"
            >
              Discard
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
