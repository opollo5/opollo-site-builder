"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { toastSuccess } from "@/lib/toast-success";

// BSP-6 — per-profile connections list with connect lightbox.
//
// Lightbox is a simple inline panel with platform buttons; clicking a
// platform opens a popup window pointing at the bundle.social OAuth URL
// returned by /api/admin/companies/[id]/social-profiles/[profileId]/connect.
//
// The popup completes against /api/platform/social/connections/callback
// which posts a `bundle-connect-complete` message back to this window.
// Same handshake as the existing SocialConnectionsList (reuse the
// origin-validated message listener pattern).

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

type Account = {
  id: string;
  type: string;
  username: string | null;
  displayName: string | null;
};

type Props = {
  companyId: string;
  profileId: string;
  profileName: string;
  initialAccounts: Account[];
  initialTeamReadError: string | null;
};

type ApiResponse<T> =
  | { ok: true; data: T; timestamp: string }
  | {
      ok: false;
      error: { code: string; message: string };
      timestamp: string;
    };

function isConnectMessage(v: unknown): boolean {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as Record<string, unknown>)["type"] === "bundle-connect-complete"
  );
}

export function AdminProfileConnectionsList({
  companyId,
  profileId,
  profileName,
  initialAccounts,
  initialTeamReadError,
}: Props) {
  const router = useRouter();
  const [showLightbox, setShowLightbox] = useState(false);
  const [busy, setBusy] = useState<string | null>(null); // platform value
  const [error, setError] = useState<string | null>(initialTeamReadError);
  const [popupBlockedUrl, setPopupBlockedUrl] = useState<string | null>(null);
  const popupRef = useRef<Window | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function clearPopupState() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    popupRef.current = null;
    setBusy(null);
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
    setError(null);
    setBusy(platform);
    setPopupBlockedUrl(null);

    const res = await fetch(
      `/api/admin/companies/${companyId}/social-profiles/${profileId}/connect`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform }),
      },
    );
    const json = (await res.json()) as ApiResponse<{
      url: string;
      team_id: string;
    }>;

    if (!res.ok || !json.ok) {
      setError(!json.ok ? json.error.message : "Failed to start connect.");
      setBusy(null);
      return;
    }

    if (popupRef.current && !popupRef.current.closed) {
      popupRef.current.focus();
      setBusy(null);
      return;
    }
    const popup = window.open(json.data.url, "bundle-connect", POPUP_FEATURES);
    if (!popup || popup.closed) {
      setPopupBlockedUrl(json.data.url);
      setBusy(null);
      return;
    }
    popupRef.current = popup;
    pollRef.current = setInterval(() => {
      if (popup.closed) {
        clearPopupState();
        setShowLightbox(false);
        router.refresh();
        toastSuccess(`${platform} connection flow closed.`);
      }
    }, 500);
  }

  return (
    <div data-testid="admin-profile-connections">
      <div className="mb-4 flex items-center justify-end gap-2">
        <Button
          onClick={() => setShowLightbox((s) => !s)}
          data-testid="connect-lightbox-toggle"
        >
          {showLightbox ? "Cancel" : "Connect new account"}
        </Button>
      </div>

      {showLightbox ? (
        <div
          className="mb-4 rounded-md border bg-card p-4"
          data-testid="connect-lightbox"
        >
          <h2 className="mb-2 text-base font-semibold">
            Connect a social account to {profileName}
          </h2>
          <p className="mb-3 text-sm text-muted-foreground">
            Pick a platform. A popup will open the OAuth flow for the
            chosen network. The popup closes itself when the user
            finishes (or when they cancel).
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {PLATFORMS.map((p) => (
              <Button
                key={p.value}
                variant="ghost"
                onClick={() => handleConnect(p.value)}
                disabled={busy !== null}
                data-testid={`connect-platform-${p.value}`}
              >
                {busy === p.value ? "Opening…" : p.label}
              </Button>
            ))}
          </div>
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
          >
            Open OAuth →
          </a>
        </p>
      ) : null}

      {initialAccounts.length === 0 ? (
        <div
          className="rounded-md border bg-card p-8 text-center text-sm text-muted-foreground"
          data-testid="connections-empty"
        >
          No accounts connected to this profile yet. Click{" "}
          <strong>Connect new account</strong> to start the OAuth flow.
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
                <th className="px-4 py-2 font-medium">bundle.social id</th>
              </tr>
            </thead>
            <tbody>
              {initialAccounts.map((a) => (
                <tr
                  key={a.id}
                  className="border-b last:border-b-0 hover:bg-muted/20"
                  data-testid={`account-row-${a.id}`}
                >
                  <td className="px-4 py-3 font-medium">{a.type}</td>
                  <td className="px-4 py-3">
                    {a.displayName ?? a.username ?? (
                      <span className="italic text-muted-foreground">
                        unnamed
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-sm text-muted-foreground">
                    {a.id}
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
