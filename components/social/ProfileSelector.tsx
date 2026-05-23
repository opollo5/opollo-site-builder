"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { NavIcon } from "@/components/ui/nav-icon";
import {
  PLATFORM_LABEL,
  STATUS_LABEL,
  STATUS_PILL,
  type SocialConnection,
  type SocialPlatform,
} from "@/lib/platform/social/connections/types";

// ---------------------------------------------------------------------------
// ProfileSelector — multi-select for social connections on the post
// creation form.
//
// Fetches connections for the given company from the existing
// GET /api/platform/social/connections?company_id=... endpoint.
// Groups by platform. Allows "All profiles" toggle.
// Disabled states for disconnected accounts show a reconnect hint.
//
// Usage:
//   <ProfileSelector
//     companyId={companyId}
//     selected={selectedConnectionIds}
//     onChange={setSelectedConnectionIds}
//   />
// ---------------------------------------------------------------------------

type Props = {
  companyId: string;
  selected: string[];
  onChange: (ids: string[]) => void;
  error?: string | null;
};

const PLATFORM_ORDER: SocialPlatform[] = [
  "linkedin_personal",
  "linkedin_company",
  "facebook_page",
  "x",
  "gbp",
];

export function ProfileSelector({ companyId, selected, onChange, error }: Props) {
  const [connections, setConnections] = useState<SocialConnection[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFetchError(null);

    fetch(`/api/platform/social/connections?company_id=${encodeURIComponent(companyId)}`)
      .then((r) => r.json())
      .then((json: { ok: boolean; data?: { connections: SocialConnection[] }; error?: { message: string } }) => {
        if (cancelled) return;
        if (json.ok && json.data) {
          setConnections(json.data.connections);
        } else {
          setFetchError(json.error?.message ?? "Failed to load connections.");
        }
      })
      .catch((err) => {
        if (!cancelled) setFetchError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [companyId]);

  const healthy = connections.filter((c) => c.status === "healthy" || c.status === "degraded");
  const disconnected = connections.filter((c) => c.status === "auth_required" || c.status === "disconnected");

  const allHealthyIds = healthy.map((c) => c.id);
  const allSelected = allHealthyIds.length > 0 && allHealthyIds.every((id) => selected.includes(id));

  function toggleAll() {
    if (allSelected) {
      onChange([]);
    } else {
      onChange(allHealthyIds);
    }
  }

  function toggle(id: string) {
    if (selected.includes(id)) {
      onChange(selected.filter((x) => x !== id));
    } else {
      onChange([...selected, id]);
    }
  }

  // Group healthy connections by platform in display order
  const grouped: Array<{ platform: SocialPlatform; conns: SocialConnection[] }> = PLATFORM_ORDER
    .map((platform) => ({
      platform,
      conns: healthy.filter((c) => c.platform === platform),
    }))
    .filter((g) => g.conns.length > 0);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
        <NavIcon name="sync" size={16} className="animate-spin" />
        Loading profiles…
      </div>
    );
  }

  if (fetchError) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {fetchError}
      </p>
    );
  }

  if (connections.length === 0) {
    return (
      <div className="rounded-md border border-warning-border bg-warning-bg p-3 text-sm text-warning-fg">
        No social accounts connected yet.{" "}
        <a href="/company/social/connections" className="font-medium underline hover:no-underline">
          Connect an account
        </a>{" "}
        to start posting.
      </div>
    );
  }

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Post to profiles</legend>

      {/* All profiles toggle */}
      {healthy.length > 1 && (
        <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/40">
          <div
            className={cn(
              "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
              allSelected
                ? "border-primary bg-primary"
                : "border-muted-foreground/30",
            )}
            aria-hidden
          >
            {allSelected && <NavIcon name="check" size={12} className="text-white" />}
          </div>
          <input
            type="checkbox"
            className="sr-only"
            checked={allSelected}
            onChange={toggleAll}
          />
          <span className="text-sm font-medium">All profiles</span>
        </label>
      )}

      {/* Per-platform groups */}
      {grouped.map(({ platform, conns }) => (
        <div key={platform} className="space-y-0.5">
          <p className="px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {PLATFORM_LABEL[platform]}
          </p>
          {conns.map((conn) => {
            const checked = selected.includes(conn.id);
            return (
              <label
                key={conn.id}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/40"
              >
                <div
                  className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                    checked
                      ? "border-primary bg-primary"
                      : "border-muted-foreground/30",
                  )}
                  aria-hidden
                >
                  {checked && <NavIcon name="check" size={12} className="text-white" />}
                </div>
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={checked}
                  onChange={() => toggle(conn.id)}
                  data-testid={`profile-checkbox-${conn.id}`}
                />
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-sm">
                    {conn.display_name ?? PLATFORM_LABEL[conn.platform]}
                  </span>
                </div>
              </label>
            );
          })}
        </div>
      ))}

      {/* Disconnected accounts — greyed out with reconnect hint */}
      {disconnected.length > 0 && (
        <div className="mt-1 space-y-0.5 border-t pt-2">
          {disconnected.map((conn) => (
            <div
              key={conn.id}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 opacity-50"
            >
              <div
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-muted-foreground/30"
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <span className="block truncate text-sm">
                  {conn.display_name ?? PLATFORM_LABEL[conn.platform]}
                </span>
                <span className={cn("text-xs", STATUS_PILL[conn.status])}>
                  {STATUS_LABEL[conn.status]}
                </span>
              </div>
              <a
                href="/company/social/connections"
                className="flex items-center gap-1 text-xs text-primary hover:underline"
                title="Reconnect this account"
              >
                <NavIcon name="sync" size={12} />
                Reconnect
              </a>
            </div>
          ))}
        </div>
      )}

      {/* Validation error */}
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
