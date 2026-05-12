"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toastSuccess } from "@/lib/toast-success";

import { ChannelPickerModal } from "@/components/ChannelPickerModal";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  PLATFORM_LABEL,
  STATUS_LABEL,
  STATUS_PILL,
  type SocialConnection,
} from "@/lib/platform/social/connections/types";

// Map our DB SocialPlatform enum to the bundle.social platform type
// the picker modal expects. Identical mapping to
// lib/platform/social/connections/route-helpers.ts's PLATFORM_TO_BUNDLE.
const PLATFORM_TO_BUNDLE_LABEL: Record<
  string,
  {
    platform: "LINKEDIN" | "FACEBOOK" | "INSTAGRAM" | "YOUTUBE" | "GOOGLE_BUSINESS";
    label: string;
  } | null
> = {
  linkedin_personal: { platform: "LINKEDIN", label: "LinkedIn" },
  linkedin_company: { platform: "LINKEDIN", label: "LinkedIn" },
  facebook_page: { platform: "FACEBOOK", label: "Facebook" },
  gbp: { platform: "GOOGLE_BUSINESS", label: "Google Business" },
  // Twitter / X is NOT a channel-selection platform; render undefined
  // so the banner / modal don't try to pick a channel for it.
  x: null,
};

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
  connect: "success" | "noop" | "error" | "sync-failed" | "needs_channel";
  reason?: string;
  connection_id?: string;
  // Bug-fix 2026-05-12: set on noop when the user re-connected a platform
  // they already have (sync updated=1, inserted=0). Drives the actionable
  // "already connected" banner and row highlight.
  attempted_platform?: string;
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
  // Channel-selection flow (incident 2026-05-12): when the callback
  // route redirects with ?connect=needs_channel&connection_id=<id>,
  // the page passes the id here so we auto-open the picker against
  // that row on first render.
  autoOpenPickerForConnectionId?: string | null;
  // Bug-fix 2026-05-12: when the callback route signals noop+updated,
  // the page passes the attempted platform (lowercase, e.g. "linkedin")
  // so we show an actionable banner and highlight the blocking row.
  noopdForPlatform?: string | null;
};

export function SocialConnectionsList({
  companyId,
  profileId,
  connections,
  canManage,
  canReconnect,
  autoOpenPickerForConnectionId,
  noopdForPlatform,
}: Props) {
  const router = useRouter();
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [busySync, setBusySync] = useState(false);
  const [showLightbox, setShowLightbox] = useState(false);
  const [busyPlatform, setBusyPlatform] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [popupBlockedUrl, setPopupBlockedUrl] = useState<string | null>(null);
  // Channel-selection flow (incident 2026-05-12): which connection
  // (if any) should the picker modal be open against?
  const [pickerForConnectionId, setPickerForConnectionId] = useState<
    string | null
  >(null);
  // Track per-row disconnect spinner state.
  const [disconnectBusy, setDisconnectBusy] = useState<string | null>(null);
  // Bug-fix 2026-05-12: "already connected" banner — set from prop (non-
  // popup redirect) or from the popup postMessage when noop+updated fires.
  // Lowercase bundle.social platform string, e.g. "linkedin".
  const [noopdPlatform, setNoopdPlatform] = useState<string | null>(
    noopdForPlatform ?? null,
  );

  // Auto-open the picker when the page hands us a connection_id (after
  // a fresh OAuth that needs channel selection). The effect only fires
  // when the prop is non-null and the connection is actually in this
  // list's bucket — guards against the parent passing us another
  // profile's connection.
  useEffect(() => {
    if (!autoOpenPickerForConnectionId) return;
    if (!connections.some((c) => c.id === autoOpenPickerForConnectionId))
      return;
    setPickerForConnectionId(autoOpenPickerForConnectionId);
  }, [autoOpenPickerForConnectionId, connections]);
  // Cross-tenant identity-leak defence (Layer 3): pre-flight warning
  // modal state. When the user clicks Connect, we first call
  // /identity-preflight; if it returns warn=true, we render a
  // confirmation modal and only proceed to the popup if the user
  // confirms.
  const [preflightModal, setPreflightModal] = useState<
    | {
        platform: string;
        platformLabel: string;
        others: Array<{ company_name: string; connected_at: string }>;
      }
    | null
  >(null);

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
      // Channel-selection flow: if the callback signalled needs_channel,
      // open the picker directly without waiting for a router.refresh
      // round-trip. router.refresh still fires so the row appears in
      // the list (status='pending_identity') in the same tick.
      if (
        evt.data.connect === "needs_channel" &&
        typeof evt.data.connection_id === "string"
      ) {
        setPickerForConnectionId(evt.data.connection_id);
      }
      // Bug-fix 2026-05-12: if the callback signalled noop with an
      // attempted_platform, show the actionable "already connected" banner.
      if (
        evt.data.connect === "noop" &&
        typeof evt.data.attempted_platform === "string"
      ) {
        setNoopdPlatform(evt.data.attempted_platform);
      }
      router.refresh();
    }

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleConnect(platform: string, opts?: { skipPreflight?: boolean }) {
    if (!profileId) return;
    setError(null);

    // Layer 3 — pre-flight check before opening the popup.
    if (!opts?.skipPreflight) {
      const preflight = await runPreflight({ platform });
      if (preflight.warn) {
        const platformLabel =
          PLATFORMS.find((p) => p.value === platform)?.label ?? platform;
        setPreflightModal({
          platform,
          platformLabel,
          others: preflight.others,
        });
        return;
      }
    }

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

  async function runPreflight(args: { platform: string }): Promise<{
    warn: boolean;
    others: Array<{ company_name: string; connected_at: string }>;
  }> {
    if (!profileId) return { warn: false, others: [] };
    try {
      const params = new URLSearchParams({
        platform: args.platform,
        target_company_id: companyId,
        target_profile_id: profileId,
      });
      const res = await fetch(
        `/api/platform/social/connections/identity-preflight?${params.toString()}`,
      );
      if (!res.ok) return { warn: false, others: [] };
      const json = (await res.json()) as {
        ok: boolean;
        data?: {
          warn: boolean;
          others: Array<{ company_name: string; connected_at: string }>;
        };
      };
      return json.ok && json.data ? json.data : { warn: false, others: [] };
    } catch {
      // Pre-flight is advisory only — silent fallback to no-warn means
      // the popup opens immediately and Layer 2's hard block still
      // catches actual cross-tenant attachments.
      return { warn: false, others: [] };
    }
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

  async function handleDisconnect(connectionId: string) {
    if (
      !window.confirm(
        "Disconnect this account? Drafts that reference it will be released back to drafts.",
      )
    ) {
      return;
    }
    setDisconnectBusy(connectionId);
    setError(null);
    const res = await fetch(
      `/api/platform/social/connections/${connectionId}/disconnect`,
      { method: "POST" },
    );
    const json = (await res.json()) as
      | { ok: true }
      | { ok: false; error: { message: string } };
    setDisconnectBusy(null);
    if (!res.ok || !json.ok) {
      setError(!json.ok ? json.error.message : "Failed to disconnect.");
      return;
    }
    toastSuccess("Connection disconnected.");
    router.refresh();
  }

  // Connections that have been sitting in pending_identity for >24h.
  // The server emits the connection_channel_overdue audit on first
  // render via emitOverdueEventsIfNeeded; the client renders the banner
  // here.
  const OVERDUE_THRESHOLD_MS = 24 * 60 * 60 * 1000;
  const overdueConnections = connections.filter((c) => {
    if (c.status !== "pending_identity") return false;
    const age = Date.now() - new Date(c.connected_at).getTime();
    return age > OVERDUE_THRESHOLD_MS;
  });

  // Resolve the currently-targeted picker connection to its platform
  // shape so the modal renders the right labels. Returns null when
  // the connection is missing or the platform isn't a channel-selection
  // platform.
  const pickerTarget = pickerForConnectionId
    ? (() => {
        const c = connections.find((x) => x.id === pickerForConnectionId);
        if (!c) return null;
        const bundle = PLATFORM_TO_BUNDLE_LABEL[c.platform];
        if (!bundle) return null;
        return { conn: c, ...bundle };
      })()
    : null;

  // Bug-fix 2026-05-12: the "already connected" blocking row — find the
  // first healthy (or pending_identity) connection whose bundle.social
  // platform matches the attempted_platform signal. Used for the
  // actionable banner and yellow row highlight.
  const noopdConnection = noopdPlatform
    ? connections.find(
        (c) =>
          (PLATFORM_TO_BUNDLE_LABEL[c.platform]?.platform ?? "").toLowerCase() ===
            noopdPlatform.toLowerCase() &&
          (c.status === "healthy" || c.status === "pending_identity"),
      ) ?? null
    : null;

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
      {pickerTarget ? (
        <ChannelPickerModal
          connectionId={pickerTarget.conn.id}
          platform={pickerTarget.platform}
          platformLabel={pickerTarget.label}
          isOpen={true}
          onClose={() => setPickerForConnectionId(null)}
          onSelected={() => {
            setPickerForConnectionId(null);
            toastSuccess("Channel set — this connection is ready to publish.");
            router.refresh();
          }}
        />
      ) : null}

      {noopdConnection ? (
        <div
          className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
          role="alert"
          data-testid="connections-already-connected-banner"
        >
          <p className="font-medium">
            This profile already has a{" "}
            {PLATFORM_LABEL[noopdConnection.platform] ?? noopdConnection.platform}{" "}
            connection
            {noopdConnection.display_name ? ` (${noopdConnection.display_name})` : ""},
            connected{" "}
            {new Date(noopdConnection.connected_at).toLocaleDateString("en-AU", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}.
          </p>
          <p className="mt-1 text-amber-900/80">
            Disconnect the existing connection below to connect a different
            account, or ask an admin to create a new profile.
          </p>
        </div>
      ) : null}

      {overdueConnections.length > 0 ? (
        <div
          className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
          role="alert"
          data-testid="connections-overdue-banner"
        >
          <p className="font-medium">
            {overdueConnections.length}{" "}
            {overdueConnections.length === 1 ? "connection needs" : "connections need"}{" "}
            a channel.
          </p>
          <p className="mt-1 text-amber-900/80">
            Pick a channel below to start publishing. Connections without a
            channel can&apos;t post.
          </p>
        </div>
      ) : null}

      {preflightModal ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="preflight-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          data-testid="preflight-modal"
        >
          <div className="max-w-md rounded-lg bg-background p-5 shadow-xl">
            <h2
              id="preflight-modal-title"
              className="mb-2 text-base font-semibold"
            >
              Heads up — {preflightModal.platformLabel} is already connected
              elsewhere
            </h2>
            <p className="mb-3 text-sm text-muted-foreground">
              You (or another admin) previously connected{" "}
              <strong>{preflightModal.platformLabel}</strong> for:
            </p>
            <ul className="mb-3 list-disc pl-5 text-sm">
              {preflightModal.others.map((o) => (
                <li key={o.company_name}>
                  {o.company_name}{" "}
                  <span className="text-muted-foreground">
                    (connected {new Date(o.connected_at).toLocaleDateString()})
                  </span>
                </li>
              ))}
            </ul>
            <p className="mb-3 text-sm text-muted-foreground">
              If the OAuth flow auto-approves with the same{" "}
              <strong>{preflightModal.platformLabel}</strong> account, it will
              be <strong>rejected</strong> to prevent cross-tenant publishing.
              You&apos;ll see an error after the popup closes. To connect a
              different {preflightModal.platformLabel} account, log out of{" "}
              {preflightModal.platformLabel} in another browser tab first.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setPreflightModal(null)}
                data-testid="preflight-modal-cancel"
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  const platform = preflightModal.platform;
                  setPreflightModal(null);
                  void handleConnect(platform, { skipPreflight: true });
                }}
                data-testid="preflight-modal-continue"
              >
                Continue
              </Button>
            </div>
          </div>
        </div>
      ) : null}

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
                  className={`border-b last:border-b-0 ${
                    noopdConnection?.id === c.id
                      ? "bg-amber-50"
                      : "hover:bg-muted/20"
                  }`}
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
                    {c.status === "healthy" && c.is_personal_mode ? (
                      <div
                        className="mt-0.5 text-xs italic text-muted-foreground"
                        data-testid={`connection-personal-mode-${c.id}`}
                      >
                        Personal profile
                      </div>
                    ) : null}
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
                    <div className="flex justify-end gap-1">
                      {canManage &&
                      c.status === "pending_identity" &&
                      PLATFORM_TO_BUNDLE_LABEL[c.platform] !== null ? (
                        <Button
                          size="sm"
                          onClick={() => setPickerForConnectionId(c.id)}
                          disabled={
                            busyRow === c.id ||
                            connectBusy ||
                            busySync ||
                            disconnectBusy !== null
                          }
                          data-testid={`connection-select-channel-${c.id}`}
                        >
                          Select channel
                        </Button>
                      ) : null}
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
                      {canManage ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDisconnect(c.id)}
                          disabled={
                            disconnectBusy === c.id ||
                            busySync ||
                            connectBusy ||
                            busyRow !== null
                          }
                          data-testid={`connection-disconnect-${c.id}`}
                        >
                          {disconnectBusy === c.id
                            ? "Disconnecting…"
                            : "Disconnect"}
                        </Button>
                      ) : null}
                    </div>
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
