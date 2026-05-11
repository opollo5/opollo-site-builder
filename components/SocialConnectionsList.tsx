"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toastSuccess } from "@/lib/toast-success";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  PLATFORM_LABEL,
  STATUS_LABEL,
  STATUS_PILL,
  type SocialConnection,
} from "@/lib/platform/social/connections/types";

// ---------------------------------------------------------------------------
// S1-12 / S1-16 / BSP-6-CUSTOMER — connections roster for
// /company/social/connections.
//
// Connect flow (popup):
//   1. "Connect new account" → inline platform-picker lightbox
//   2. User picks a platform → POST /connect { company_id, profile_id, platform }
//      → receives bundle.social direct-OAuth URL
//   3. window.open() opens that URL in a 600×700 popup
//   4. bundle.social OAuth runs; redirects to /callback?popup=1
//   5. Callback syncs accounts → postMessage { type:"bundle-connect-complete" }
//      → parent router.refresh()
//   6. Fallback: setInterval polling popup.closed for abandoned popups
// ---------------------------------------------------------------------------

const POPUP_FEATURES =
  "width=600,height=700,scrollbars=yes,resizable=yes,noopener=no";

const PLATFORMS: Array<{ value: string; label: string }> = [
  { value: "LINKEDIN", label: "LinkedIn" },
  { value: "FACEBOOK", label: "Facebook" },
  { value: "INSTAGRAM", label: "Instagram" },
  { value: "TWITTER", label: "X (Twitter)" },
  { value: "GOOGLE_BUSINESS", label: "Google Business" },
  { value: "TIKTOK", label: "TikTok" },
  { value: "YOUTUBE", label: "YouTube" },
  { value: "PINTEREST", label: "Pinterest" },
  { value: "THREADS", label: "Threads" },
  { value: "REDDIT", label: "Reddit" },
];

type ConnectMessage = {
  type: "bundle-connect-complete";
  connect: "success" | "noop" | "error" | "sync-failed";
  reason?: string;
};

function isConnectMessage(v: unknown): v is ConnectMessage {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as Record<string, unknown>)["type"] === "bundle-connect-complete"
  );
}

type Props = {
  companyId: string;
  // BSP-9: when set, connect/reconnect calls scope to this profile so
  // new accounts land on the profile's bundle.social team. When
  // omitted (legacy callers), the connect flow is unavailable.
  profileId?: string;
  connections: SocialConnection[];
  // Admin-or-Opollo-staff. Drives create-new / sync visibility.
  canManage: boolean;
  // Editor+. Drives per-row Reconnect button for auth_required/disconnected
  // connections. Admins already have this via canManage; editors can
  // reconnect but not create new connections (S8).
  canReconnect: boolean;
};

export function SocialConnectionsList({
  companyId,
  profileId,
  connections,
  canManage,
  canReconnect,
}: Props) {
  const router = useRouter();
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [busySync, setBusySync] = useState(false);
  const [showLightbox, setShowLightbox] = useState(false);
  const [busyPlatform, setBusyPlatform] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [popupBlockedUrl, setPopupBlockedUrl] = useState<string | null>(null);

  const popupRef = useRef<Window | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function clearPopupState(activeRowId?: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    popupRef.current = null;
    setBusyPlatform(null);
    if (activeRowId) setBusyRow(null);
  }

  function openConnectPopup(url: string, rowId?: string) {
    if (popupRef.current && !popupRef.current.closed) {
      popupRef.current.focus();
      return;
    }

    const popup = window.open(url, "bundle-connect", POPUP_FEATURES);

    if (!popup || popup.closed) {
      setPopupBlockedUrl(url);
      clearPopupState(rowId);
      return;
    }

    setPopupBlockedUrl(null);
    popupRef.current = popup;

    pollRef.current = setInterval(() => {
      if (popup.closed) {
        clearPopupState(rowId);
        router.refresh();
      }
    }, 500);
  }

  useEffect(() => {
    const expectedOrigin = window.location.origin;

    function handleMessage(evt: MessageEvent) {
      if (evt.origin !== expectedOrigin) return;
      if (!isConnectMessage(evt.data)) return;

      clearPopupState();
      setShowLightbox(false);
      router.refresh();
    }

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleConnect(platform: string) {
    if (!profileId) return;
    setError(null);
    setBusyPlatform(platform);
    setPopupBlockedUrl(null);

    const res = await fetch("/api/platform/social/connections/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company_id: companyId, profile_id: profileId, platform }),
    });
    const json = (await res.json()) as
      | { ok: true; data: { url: string } }
      | { ok: false; error: { message: string } };

    if (!res.ok || !json.ok) {
      setError(!json.ok ? json.error.message : "Failed to start connect.");
      setBusyPlatform(null);
      return;
    }

    openConnectPopup(json.data.url);
  }

  async function handleReconnect(rowId: string) {
    setBusyRow(rowId);
    setError(null);
    const res = await fetch("/api/platform/social/connections/reconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company_id: companyId, connection_id: rowId }),
    });
    const json = (await res.json()) as
      | { ok: true; data: { url: string } }
      | { ok: false; error: { message: string } };
    if (!res.ok || !json.ok) {
      setError(!json.ok ? json.error.message : "Failed to start reconnect.");
      setBusyRow(null);
      return;
    }
    openConnectPopup(json.data.url, rowId);
  }

  async function handleSync() {
    setBusySync(true);
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
        setError(!json.ok ? json.error.message : "Failed to sync.");
        return;
      }
      toastSuccess("Connections refreshed.");
      router.refresh();
    } finally {
      setBusySync(false);
    }
  }

  const connectBusy = busyPlatform !== null;

  return (
    <div data-testid="connections-list-wrapper">
      {canManage ? (
        <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={handleSync}
            disabled={busySync || connectBusy}
            data-testid="connections-sync-button"
          >
            {busySync ? "Refreshing…" : "Refresh"}
          </Button>
          <Button
            onClick={() => setShowLightbox((s) => !s)}
            disabled={connectBusy}
            data-testid="connections-connect-button"
          >
            {showLightbox ? "Cancel" : "Connect new account"}
          </Button>
        </div>
      ) : null}

      {showLightbox && profileId ? (
        <div
          className="mb-4 rounded-md border bg-card p-4"
          data-testid="connect-lightbox"
        >
          <h2 className="mb-2 text-base font-semibold">
            Connect a social account
          </h2>
          <p className="mb-3 text-sm text-muted-foreground">
            Pick a platform. A popup will open the OAuth flow — it closes
            itself when you finish (or cancel).
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {PLATFORMS.map((p) => (
              <Button
                key={p.value}
                variant="ghost"
                onClick={() => handleConnect(p.value)}
                disabled={connectBusy}
                data-testid={`connect-platform-${p.value}`}
              >
                {busyPlatform === p.value ? "Opening…" : p.label}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      {error ? (
        <Alert
          variant="destructive"
          className="mb-3"
          data-testid="connections-error"
          reportContext={{ message: error }}
        >
          {error}
        </Alert>
      ) : null}

      {popupBlockedUrl ? (
        <p
          className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
          role="alert"
          data-testid="connections-popup-blocked"
        >
          Your browser blocked the popup.{" "}
          <a
            href={popupBlockedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
            data-testid="connections-popup-fallback-link"
          >
            Open OAuth →
          </a>
        </p>
      ) : null}

      {connections.length === 0 ? (
        <div
          className="rounded-md border bg-card p-8 text-center text-sm text-muted-foreground"
          data-testid="connections-empty"
        >
          No social connections yet.{" "}
          {canManage
            ? "Click Connect new account to start the OAuth flow."
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
                    {(canManage || canReconnect) &&
                    (c.status === "auth_required" ||
                      c.status === "disconnected") ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleReconnect(c.id)}
                        disabled={busyRow === c.id || connectBusy || busySync}
                        data-testid={`connection-reconnect-${c.id}`}
                      >
                        {busyRow === c.id ? "Opening…" : "Reconnect"}
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
