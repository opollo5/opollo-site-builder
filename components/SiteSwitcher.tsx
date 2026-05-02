"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import type { SiteListItem } from "@/lib/tool-schemas";

export const ACTIVE_SITE_STORAGE_KEY = "opollo.activeSiteId";
export const ACTIVE_SITE_EVENT = "opollo:active-site-changed";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; sites: SiteListItem[] }
  | { status: "error"; message: string };

export type ActiveSiteEventDetail = {
  activeSiteId: string | null;
  site: SiteListItem | null;
};

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

export function readStoredActiveSiteId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(ACTIVE_SITE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredActiveSiteId(id: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (id === null) window.localStorage.removeItem(ACTIVE_SITE_STORAGE_KEY);
    else window.localStorage.setItem(ACTIVE_SITE_STORAGE_KEY, id);
  } catch {
    /* ignore quota/denied */
  }
}

function dispatchChange(detail: ActiveSiteEventDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<ActiveSiteEventDetail>(ACTIVE_SITE_EVENT, { detail }),
  );
}

export function SiteSwitcher() {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [activeSiteId, setActiveSiteId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const loadSites = useCallback(async () => {
    setLoadState({ status: "loading" });
    try {
      const res = await fetch("/api/sites/list", { cache: "no-store" });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) {
        setLoadState({
          status: "error",
          message:
            payload?.error?.message ??
            `Failed to load sites (HTTP ${res.status}).`,
        });
        return;
      }
      const sites = (payload.data?.sites ?? []) as SiteListItem[];
      setLoadState({ status: "ready", sites });

      const stored = readStoredActiveSiteId();
      const storedExists =
        stored !== null && sites.some((s) => s.id === stored);
      const chosen = storedExists ? stored : sites[0]?.id ?? null;

      if (chosen !== stored) writeStoredActiveSiteId(chosen);
      setActiveSiteId(chosen);
      const site = chosen ? sites.find((s) => s.id === chosen) ?? null : null;
      dispatchChange({ activeSiteId: chosen, site });
    } catch (err) {
      setLoadState({
        status: "error",
        message: `Network error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }, []);

  useEffect(() => {
    void loadSites();
  }, [loadSites]);

  useEffect(() => {
    if (!open) return;
    const onClickAway = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClickAway);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClickAway);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const sites = loadState.status === "ready" ? loadState.sites : [];
  const activeSite = activeSiteId
    ? sites.find((s) => s.id === activeSiteId) ?? null
    : null;

  const selectSite = (id: string) => {
    if (id === activeSiteId) {
      setOpen(false);
      return;
    }
    setActiveSiteId(id);
    writeStoredActiveSiteId(id);
    const site = sites.find((s) => s.id === id) ?? null;
    dispatchChange({ activeSiteId: id, site });
    setOpen(false);
  };

  let triggerLabel: React.ReactNode;
  let triggerDotClass = "bg-slate-300";
  if (loadState.status === "loading") {
    triggerLabel = (
      <span className="text-sm text-muted-foreground">Loading sites…</span>
    );
  } else if (loadState.status === "error") {
    triggerLabel = (
      <span className="text-sm text-destructive">Failed to load sites</span>
    );
  } else if (activeSite) {
    triggerLabel = (
      <span className="text-sm font-semibold">{activeSite.name}</span>
    );
    triggerDotClass = statusDotClass(activeSite.status);
  } else if (sites.length === 0) {
    triggerLabel = (
      <span className="text-sm text-muted-foreground">
        No site selected — click Manage sites to add one
      </span>
    );
  } else {
    triggerLabel = (
      <span className="text-sm text-muted-foreground">Select a site</span>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "flex items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring",
        )}
      >
        <span
          aria-hidden="true"
          className={cn("inline-block h-2 w-2 rounded-full", triggerDotClass)}
        />
        {triggerLabel}
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-3 w-3 text-muted-foreground"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.24 4.38a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-full z-50 mt-1 w-72 rounded-md border bg-popover p-1 shadow-md"
        >
          {loadState.status === "loading" && (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              Loading…
            </div>
          )}
          {loadState.status === "error" && (
            <div className="px-3 py-2 text-sm text-destructive">
              {loadState.message}
            </div>
          )}
          {loadState.status === "ready" && sites.length === 0 && (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              No sites registered yet.
            </div>
          )}
          {loadState.status === "ready" &&
            sites.map((s) => {
              const selected = s.id === activeSiteId;
              return (
                <button
                  key={s.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => selectSite(s.id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted",
                    selected && "bg-muted",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "inline-block h-2 w-2 rounded-full",
                      statusDotClass(s.status),
                    )}
                  />
                  <span className="flex-1 truncate">{s.name}</span>
                  {selected && (
                    <span className="text-sm text-muted-foreground">✓</span>
                  )}
                </button>
              );
            })}
          <div className="my-1 border-t" />
          <Link
            href="/admin/sites"
            className="block rounded-sm px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => setOpen(false)}
          >
            + Manage sites
          </Link>
        </div>
      )}
    </div>
  );
}
