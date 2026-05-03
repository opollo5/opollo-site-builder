"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  PLATFORM_LABEL,
  STATUS_LABEL,
  STATUS_PILL,
  type SocialConnection,
  type SocialPlatform,
} from "@/lib/platform/social/connections/types";

// ---------------------------------------------------------------------------
// S1-12 / S1-16 — connections roster for /company/social/connections.
//
// V1 (S1-12) was read-only with a stubbed Reconnect button. S1-16 wires
// the real bundle.social hosted-portal flow:
//   - Top: "Connect new account" button (admin-only) → POST /connect →
//     redirect browser to bundle.social portal → bundle.social redirects
//     back to /callback → callback syncs new accounts → admin lands
//     back here with ?connect=success|error|noop.
//   - Top: "Refresh" button (admin-only) → POST /sync → re-reads bundle.
//     social's account list, refreshes display_name + status.
//   - Per-row: Reconnect button (admin-only, when status='auth_required'
//     or 'disconnected') → POST /connect with the row's platform.
// ---------------------------------------------------------------------------

type Props = {
  companyId: string;
  connections: SocialConnection[];
  // Admin-or-Opollo-staff. Drives create/reconnect/sync visibility.
  canManage: boolean;
};

export function SocialConnectionsList({
  companyId,
  connections,
  canManage,
}: Props) {
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [busyTop, setBusyTop] = useState<"connect" | "sync" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function initiateConnect(platforms?: SocialPlatform[]) {
    setError(null);
    const res = await fetch("/api/platform/social/connections/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company_id: companyId,
        ...(platforms ? { platforms } : {}),
      }),
    });
    const json = (await res.json()) as
      | { ok: true; data: { url: string } }
      | { ok: false; error: { message: string } };
    if (!res.ok || !json.ok) {
      const msg = !json.ok ? json.error.message : "Failed to start connect.";
      setError(msg);
      return;
    }
    window.location.href = json.data.url;
  }

  async function handleConnectAll() {
    setBusyTop("connect");
    try {
      await initiateConnect();
    } finally {
      setBusyTop(null);
    }
  }

  async function handleReconnect(rowId: string, platform: SocialPlatform) {
    setBusyRow(rowId);
    try {
      await initiateConnect([platform]);
    } finally {
      // No need to clear busyRow — the redirect happens on success.
      setBusyRow(null);
    }
  }

  async function handleSync() {
    setBusyTop("sync");
    setError(null);
    try {
      const res = await fetch("/api/platform/social/connections/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_id: companyId }),
      });
      const json = (await res.json()) as
        | {
            ok: true;
            data: {
              inserted: number;
              updated: number;
              marked_disconnected: number;
            };
          }
        | { ok: false; error: { message: string } };
      if (!res.ok || !json.ok) {
        const msg = !json.ok ? json.error.message : "Failed to sync.";
        setError(msg);
        return;
      }
      // Re-render via full reload so the server-rendered list reflects
      // the new statuses + display names.
      window.location.reload();
    } finally {
      setBusyTop(null);
    }
  }

  return (
    <div data-testid="connections-list-wrapper">
      {canManage ? (
        <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={handleSync}
            disabled={busyTop !== null}
            data-testid="connections-sync-button"
          >
            {busyTop === "sync" ? "Refreshing…" : "Refresh"}
          </Button>
          <Button
            onClick={handleConnectAll}
            disabled={busyTop !== null}
            data-testid="connections-connect-button"
          >
            {busyTop === "connect" ? "Opening portal…" : "Connect new account"}
          </Button>
        </div>
      ) : null}

      {error ? (
        <p
          className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
          data-testid="connections-error"
        >
          {error}
        </p>
      ) : null}

      {connections.length === 0 ? (
        <div
          className="rounded-md border bg-card p-8 text-center text-sm text-muted-foreground"
          data-testid="connections-empty"
        >
          No social connections yet.{" "}
          {canManage
            ? "Click Connect new account to start the bundle.social hosted flow."
            : "Ask an admin to connect your team's social accounts."}
        </div>
      ) : (
        <div
          className="overflow-hidden rounded-lg border bg-card"
          data-testid="connections-table"
        >
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30 text-left text-sm uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Platform</th>
                <th className="px-4 py-2 font-medium">Account</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Connected</th>
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {connections.map((c) => (
                <tr
                  key={c.id}
                  className="border-b last:border-b-0 hover:bg-muted/20"
                  data-testid={`connection-row-${c.id}`}
                >
                  <td className="px-4 py-3 font-medium">
                    {PLATFORM_LABEL[c.platform] ?? c.platform}
                  </td>
                  <td className="px-4 py-3">
                    <div>
                      {c.display_name ?? (
                        <span className="text-muted-foreground">
                          {c.bundle_social_account_id}
                        </span>
                      )}
                    </div>
                    {c.last_error ? (
                      <div
                        className="mt-1 text-sm text-rose-700"
                        data-testid={`connection-error-${c.id}`}
                      >
                        {c.last_error}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-sm font-medium ${STATUS_PILL[c.status]}`}
                      data-testid={`connection-status-${c.id}`}
                    >
                      {STATUS_LABEL[c.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground tabular-nums">
                    {new Date(c.connected_at).toLocaleString("en-AU", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canManage &&
                    (c.status === "auth_required" ||
                      c.status === "disconnected") ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleReconnect(c.id, c.platform)}
                        disabled={busyRow === c.id || busyTop !== null}
                        data-testid={`connection-reconnect-${c.id}`}
                      >
                        {busyRow === c.id ? "Opening portal…" : "Reconnect"}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
