"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";
import { NavIcon } from "@/components/ui/nav-icon";

type Site = {
  id: string;
  name: string;
  wp_url: string;
};

interface SiteSelectorProps {
  currentSiteId: string | null;
  currentSiteName: string | null;
  siteSelectPath: string;
}

export function SiteSelector({
  currentSiteId,
  currentSiteName,
  siteSelectPath,
}: SiteSelectorProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sites, setSites] = useState<Site[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [switching, setSwitching] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (sites !== null) return;
    setLoading(true);
    fetch("/api/sites/list")
      .then((r) => r.json())
      .then((json: { ok: boolean; data?: { sites: Site[] } }) => {
        if (json.ok && json.data) setSites(json.data.sites);
        else setSites([]);
      })
      .catch(() => setSites([]))
      .finally(() => setLoading(false));
  }, [sites]);

  function selectSite(id: string) {
    if (switching || id === currentSiteId) {
      setOpen(false);
      return;
    }
    setSwitching(true);
    setOpen(false);
    router.push(siteSelectPath.replace("{siteId}", id));
    setSwitching(false);
  }

  // Single-site users get a read-only pill — no picker needed.
  if (sites !== null && sites.length === 1) {
    return (
      <div className="flex items-center gap-2 px-3 py-2">
        <NavIcon name="earth" size={14} className="shrink-0 text-icon-dim" />
        <span className="truncate text-sm font-medium text-foreground">
          {currentSiteName ?? sites[0]?.name ?? "Loading…"}
        </span>
      </div>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={switching}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Site: ${currentSiteName ?? "None selected"}`}
        className="group flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-smooth hover:bg-nav-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-gr"
      >
        <NavIcon
          name="earth"
          size={14}
          className="shrink-0 text-icon-dim group-hover:text-gr"
        />
        <span
          className={cn(
            "flex-1 truncate text-left font-medium",
            currentSiteName ? "text-foreground" : "text-tx-secondary",
          )}
        >
          {switching ? "Switching…" : (currentSiteName ?? "Select site")}
        </span>
        <NavIcon
          name="chevrons-expand-vertical"
          size={12}
          className="shrink-0 opacity-50"
        />
      </button>

      {open && (
        <div
          className="absolute left-0 right-0 z-50 mt-1 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-xl"
          role="listbox"
          aria-label="Select site"
        >
          {loading || sites === null ? (
            <p className="px-3 py-2 text-xs text-tx-muted">Loading…</p>
          ) : sites.length === 0 ? (
            <p className="px-3 py-2 text-xs text-tx-muted">No sites found.</p>
          ) : (
            <ul className="max-h-64 overflow-y-auto">
              {sites.map((s) => {
                const isSelected = s.id === currentSiteId;
                let hostname = s.wp_url;
                try { hostname = new URL(s.wp_url).hostname; } catch {}
                return (
                  <li key={s.id}>
                    <button
                      role="option"
                      aria-selected={isSelected}
                      type="button"
                      onClick={() => selectSite(s.id)}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted",
                        isSelected ? "text-pk" : "text-tx-secondary hover:text-foreground",
                      )}
                    >
                      {isSelected ? (
                        <NavIcon name="check" size={14} className="shrink-0" />
                      ) : (
                        <span className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{s.name}</p>
                        <p className="truncate text-xs opacity-50">{hostname}</p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
