"use client";

import { useEffect, useState } from "react";

import { NavIcon } from "@/components/ui/nav-icon";
import type { SocialConnection } from "@/lib/platform/social/connections/types";
import { PLATFORM_LABEL } from "@/lib/platform/social/variants/types";

interface ProfileSelectorProps {
  companyId: string;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  onConnectionsLoaded?: (connections: SocialConnection[]) => void;
  disabled?: boolean;
}

export function ProfileSelector({
  companyId,
  selectedIds,
  onChange,
  onConnectionsLoaded,
  disabled,
}: ProfileSelectorProps) {
  const [connections, setConnections] = useState<SocialConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/platform/social/connections?company_id=${companyId}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json.ok) {
          // Show all non-disconnected connections with visual indicators for degraded/auth_required.
          const loaded = (json.data.connections as SocialConnection[]).filter(
            (c) => c.status !== "disconnected",
          );
          setConnections(loaded);
          onConnectionsLoaded?.(loaded);
        } else {
          setError("Failed to load connections.");
        }
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load connections.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  function toggleAll() {
    if (selectedIds.length === connections.length) {
      onChange([]);
    } else {
      onChange(connections.map((c) => c.id));
    }
  }

  function toggle(id: string) {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((s) => s !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[40px] items-center gap-2 text-xs text-muted-foreground">
        <NavIcon name="sync" size={14} className="animate-spin" />
        Loading accounts…
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-xs text-destructive">{error}</p>
    );
  }

  if (connections.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-white/20 px-3 py-2 text-xs text-muted-foreground">
        No connected accounts. Add one in{" "}
        <a href="/company/social/connections" className="underline hover:text-foreground">
          Connections
        </a>
        .
      </div>
    );
  }

  const allSelected = selectedIds.length === connections.length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Post to</span>
        <button
          type="button"
          onClick={toggleAll}
          disabled={disabled}
          className="text-xs text-pk hover:text-pk/80 disabled:opacity-40"
        >
          {allSelected ? "Deselect all" : "Select all"}
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {connections.map((c) => {
          const active = selectedIds.includes(c.id);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => toggle(c.id)}
              disabled={disabled}
              aria-pressed={active}
              title={c.status === "auth_required" ? "Reconnect required" : undefined}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-40 ${
                active
                  ? "border-pk bg-pk/10 text-pk"
                  : "border-white/15 text-muted-foreground hover:border-white/30 hover:text-foreground"
              }`}
            >
              <NavIcon name="user" size={12} />
              {c.display_name ?? PLATFORM_LABEL[c.platform]}
              {c.status === "auth_required" && (
                <span className="ml-0.5 font-bold text-amber-400">!</span>
              )}
            </button>
          );
        })}
      </div>
      {selectedIds.length === 0 && (
        <p className="text-xs text-amber-400">Select at least one account to post.</p>
      )}
    </div>
  );
}
