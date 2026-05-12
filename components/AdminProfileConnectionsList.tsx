"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  SocialPlatformIcon,
  type SocialPlatformIconKey,
} from "@/components/ui/SocialPlatformIcon";
import { toastSuccess } from "@/lib/toast-success";

// BSP-6 — per-profile connections list with connect dropdown.
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

const PLATFORMS: Array<{
  value: SocialPlatformIconKey;
  label: string;
}> = [
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

// Disconnect-busy state is keyed by `${account.id}` so we can spin only
// the affected row.

type ApiResponse<T> =
  | { ok: true; data: T; timestamp: string }
  | {
      ok: false;
      error: { code: string; message: string };
      timestamp: string;
    };

type ConnectMessage = {
  type: "bundle-connect-complete";
  connect?: string;
  connection_id?: string;
};

function isConnectMessage(v: unknown): v is ConnectMessage {
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
  const [accounts, setAccounts] = useState<Account[]>(initialAccounts);
  // Popover open state for the platform-picker dropdown (G1).
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null); // platform value
  const [disconnectBusy, setDisconnectBusy] = useState<string | null>(null); // account id
  const [error, setError] = useState<string | null>(initialTeamReadError);
  const [popupBlockedUrl, setPopupBlockedUrl] = useState<string | null>(null);
  // Cross-tenant identity-leak defence (Layer 3): pre-flight modal state.
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
      // 2026-05-13: needs_channel is no longer routed through the
      // parent — the popup-mode picker page handles it inline and
      // posts back `success`. Any inbound message just clears the
      // popup state and refreshes the list.
      clearPopupState();
      setPickerOpen(false);
      router.refresh();
    }
    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleDisconnect(account: Account) {
    if (
      !window.confirm(
        `Disconnect ${account.type} (${account.displayName ?? account.username ?? account.id}) from ${profileName}? Re-connecting requires the OAuth flow.`,
      )
    ) {
      return;
    }
    setError(null);
    setDisconnectBusy(account.id);
    const res = await fetch(
      `/api/admin/companies/${companyId}/social-profiles/${profileId}/disconnect`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: account.type }),
      },
    );
    const json = (await res.json()) as ApiResponse<{
      team_id: string;
      platform: string;
    }>;
    setDisconnectBusy(null);
    if (!res.ok || !json.ok) {
      setError(!json.ok ? json.error.message : "Failed to disconnect.");
      return;
    }
    toastSuccess(`Disconnected ${account.type} from ${profileName}.`);
    // Optimistic — drop the row locally; router.refresh re-syncs from
    // bundle.social.
    setAccounts((prev) => prev.filter((a) => a.id !== account.id));
    router.refresh();
  }

  async function runPreflight(platform: string): Promise<{
    warn: boolean;
    others: Array<{ company_name: string; connected_at: string }>;
  }> {
    try {
      const params = new URLSearchParams({
        platform,
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
      return { warn: false, others: [] };
    }
  }

  async function handleConnect(platform: string, opts?: { skipPreflight?: boolean }) {
    setError(null);

    if (!opts?.skipPreflight) {
      const preflight = await runPreflight(platform);
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
        setPickerOpen(false);
        router.refresh();
        toastSuccess(`${platform} connection flow closed.`);
      }
    }, 500);
  }

  return (
    <div data-testid="admin-profile-connections">
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
              {preflightModal.platformLabel} was recently connected for:
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
              <strong>{preflightModal.platformLabel}</strong> account, it
              will be <strong>rejected</strong> to prevent cross-tenant
              publishing. To connect a different {preflightModal.platformLabel}{" "}
              account, log out of {preflightModal.platformLabel} in another
              browser tab first.
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

      <div className="mb-4 flex items-center justify-end gap-2">
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button
              disabled={busy !== null}
              data-testid="connect-lightbox-toggle"
              aria-haspopup="menu"
              aria-expanded={pickerOpen}
            >
              Connect new account
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-[280px] p-1"
            data-testid="connect-platform-menu"
          >
            {/* `connect-lightbox` alias preserved for e2e backward compat. */}
            <div
              role="menu"
              className="flex flex-col"
              data-testid="connect-lightbox"
            >
              {PLATFORMS.map((p) => {
                const isBusy = busy === p.value;
                return (
                  <button
                    key={p.value}
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      setPickerOpen(false);
                      void handleConnect(p.value);
                    }}
                    disabled={busy !== null}
                    className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition hover:bg-muted/60 focus:bg-muted/60 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                    data-testid={`connect-platform-${p.value}`}
                    aria-label={`Connect ${p.label} to ${profileName}`}
                  >
                    <SocialPlatformIcon
                      platform={p.value}
                      size={16}
                      className="flex-shrink-0 text-foreground"
                    />
                    <span className="flex-1 font-medium">{p.label}</span>
                    {isBusy ? (
                      <span className="text-xs text-muted-foreground">
                        Opening…
                      </span>
                    ) : (
                      <span
                        aria-hidden="true"
                        className="text-muted-foreground"
                      >
                        ›
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      </div>

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

      {accounts.length === 0 ? (
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
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
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
                  <td className="px-4 py-3 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDisconnect(a)}
                      disabled={disconnectBusy !== null}
                      data-testid={`account-disconnect-${a.id}`}
                    >
                      {disconnectBusy === a.id ? "Disconnecting…" : "Disconnect"}
                    </Button>
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
