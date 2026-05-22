"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { ChannelPickerModal } from "@/components/ChannelPickerModal";
import { Button } from "@/components/ui/button";
import { MenuItem } from "@/components/ui/menu-item";
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

function getPopupFeatures(): string {
  const w = 900;
  const h = 820;
  const left = Math.floor(window.screen.width / 2 - w / 2);
  const top = Math.floor(window.screen.height / 2 - h / 2);
  return `width=${w},height=${h},left=${left},top=${top},scrollbars=yes,resizable=yes`;
}

// Bundle.social platform enum → ChannelPickerModal props. null entries
// indicate platforms that don't go through channel selection (they
// won't trigger the modal).
const PLATFORM_TO_BUNDLE_LABEL: Record<
  string,
  {
    platform: "LINKEDIN" | "FACEBOOK" | "INSTAGRAM" | "YOUTUBE" | "GOOGLE_BUSINESS";
    label: string;
  } | null
> = {
  LINKEDIN: { platform: "LINKEDIN", label: "LinkedIn" },
  FACEBOOK: { platform: "FACEBOOK", label: "Facebook" },
  INSTAGRAM: { platform: "INSTAGRAM", label: "Instagram" },
  YOUTUBE: { platform: "YOUTUBE", label: "YouTube" },
  GOOGLE_BUSINESS: { platform: "GOOGLE_BUSINESS", label: "Google Business" },
};

// DB social_platform enum → ChannelPickerModal props. Used when auto-opening
// the picker after a sync-on-popup-close picks up a pending_identity row.
const DB_PLATFORM_TO_PICKER: Record<
  string,
  {
    platform: "LINKEDIN" | "FACEBOOK" | "INSTAGRAM" | "YOUTUBE" | "GOOGLE_BUSINESS";
    label: string;
  } | null
> = {
  linkedin_personal: { platform: "LINKEDIN", label: "LinkedIn" },
  linkedin_company: { platform: "LINKEDIN", label: "LinkedIn" },
  facebook_page: { platform: "FACEBOOK", label: "Facebook" },
  instagram_business: { platform: "INSTAGRAM", label: "Instagram" },
  gbp: { platform: "GOOGLE_BUSINESS", label: "Google Business" },
  x: null,
};


// 2026-05-13 platform trim: TikTok, Pinterest, Threads, and Reddit are
// removed from the UI surface. Backend Zod enums still accept the full
// set so any existing rows continue working.
const PLATFORMS: Array<{
  value: SocialPlatformIconKey;
  label: string;
}> = [
  { value: "LINKEDIN", label: "LinkedIn" },
  { value: "FACEBOOK", label: "Facebook" },
  { value: "INSTAGRAM", label: "Instagram" },
  { value: "TWITTER", label: "X (Twitter)" },
  { value: "GOOGLE_BUSINESS", label: "Google Business" },
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
  reason?: string;
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
  // 2026-05-13 take 2: channel picker opens as a modal in this parent
  // window. Tracks the connection_id currently targeted.
  const [pickerTarget, setPickerTarget] = useState<{
    connectionId: string;
    platform: "LINKEDIN" | "FACEBOOK" | "INSTAGRAM" | "YOUTUBE" | "GOOGLE_BUSINESS";
    label: string;
  } | null>(null);
  const popupRef = useRef<Window | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const popupOpenedAtRef = useRef<number | null>(null);
  // Shown-set for the auto-open effect. useRef resets on unmount (page
  // refresh) so a new mount always re-evaluates pending rows.
  const pickerShownRef = useRef<Set<string>>(new Set());
  const forceCrossTenantRef = useRef<boolean>(false);
  // Mirrors busyPlatform in a ref so the stale-closed handleMessage effect
  // can read the platform the user originally clicked regardless of whether
  // syncOnPopupClose already cleared the busy state (500ms poll race).
  const busyPlatformRef = useRef<string | null>(null);
  // Set to Date.now() when any popup message arrives. Added to the auto-open
  // effect's deps so it re-fires and checks for new pending_identity rows even
  // when connect:"success" is sent without a connection_id.
  const [lastPopupAt, setLastPopupAt] = useState<number | null>(null);

  function clearPopupState() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    popupRef.current = null;
    setBusy(null);
    forceCrossTenantRef.current = false;
  }

  // Sync-on-popup-close (same reasoning as SocialConnectionsList):
  // bundle.social redirects the popup to their dashboard instead of our
  // callback URL, so we sync explicitly when the popup closes. If a
  // pending_identity connection appears, auto-open the channel picker.
  async function syncOnPopupClose() {
    const forceCrossTenant = forceCrossTenantRef.current;
    clearPopupState();
    setPickerOpen(false);
    let inserted = 0;
    try {
      const r = await fetch("/api/platform/social/connections/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_id: companyId,
          attribute_new_to_company_id: companyId,
          ...(forceCrossTenant ? { force_cross_tenant_override: true } : {}),
        }),
      });
      if (r.ok) {
        const json = (await r.json()) as { data?: { inserted: number } };
        inserted = json?.data?.inserted ?? 0;
      }
    } catch {}
    if (inserted > 0) {
      try {
        const connRes = await fetch(
          `/api/platform/social/connections?company_id=${encodeURIComponent(companyId)}`,
        );
        if (connRes.ok) {
          const data = (await connRes.json()) as {
            data?: {
              connections: Array<{
                id: string;
                platform: string;
                status: string;
                connected_at: string;
              }>;
            };
          };
          const since = (popupOpenedAtRef.current ?? 0) - 5_000;
          const newPending = (data?.data?.connections ?? []).find(
            (c) =>
              c.status === "pending_identity" &&
              DB_PLATFORM_TO_PICKER[c.platform] !== null &&
              DB_PLATFORM_TO_PICKER[c.platform] !== undefined &&
              new Date(c.connected_at).getTime() >= since,
          );
          if (newPending) {
            const picker = DB_PLATFORM_TO_PICKER[newPending.platform]!;
            setPickerTarget({
              connectionId: newPending.id,
              platform: picker.platform,
              label: picker.label,
            });
          }
        }
      } catch {}
    }
    setLastPopupAt(Date.now());
    router.refresh();
    toastSuccess("Connection flow completed.");
  }

  useEffect(() => {
    const expectedOrigin = window.location.origin;
    function handleMessage(evt: MessageEvent) {
      if (evt.origin !== expectedOrigin) return;
      if (!isConnectMessage(evt.data)) return;
      // Read from ref — not from the busy state closure. The 500ms
      // popup-close poll can call clearPopupState() (and setBusy(null))
      // before the postMessage event is processed; reading busy from a
      // stale closure would produce null and silently drop the picker open.
      const platformValue = busyPlatformRef.current;
      clearPopupState();
      setPickerOpen(false);
      if (
        evt.data.connect === "needs_channel" &&
        typeof evt.data.connection_id === "string"
      ) {
        const mapped = platformValue
          ? PLATFORM_TO_BUNDLE_LABEL[platformValue]
          : null;
        if (mapped) {
          setPickerTarget({
            connectionId: evt.data.connection_id,
            platform: mapped.platform,
            label: mapped.label,
          });
        }
      }
      if (
        evt.data.connect === "error" &&
        evt.data.reason === "cross-tenant-blocked"
      ) {
        setError(
          "This account is already connected to another client. " +
            'To connect it here, click Connect and choose "I manage both" when prompted.',
        );
      }
      // Signal the auto-open effect to re-check DB connections. Handles the
      // connect:"success" case where the callback didn't send a connection_id
      // (findMostRecentlyInsertedConnectionId returned null) — the effect will
      // do a fresh fetch and pick up any new pending_identity row.
      setLastPopupAt(Date.now());
      router.refresh();
    }
    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On mount and after any accounts change, fetch DB connections and
  // auto-open the picker for any pending_identity row not shown yet
  // this component lifetime.
  useEffect(() => {
    if (pickerTarget) return;
    void (async () => {
      try {
        const res = await fetch(
          `/api/platform/social/connections?company_id=${encodeURIComponent(companyId)}`,
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          data?: {
            connections: Array<{
              id: string;
              platform: string;
              status: string;
              connected_at: string;
            }>;
          };
        };
        const pending = (data?.data?.connections ?? []).find(
          (c) =>
            c.status === "pending_identity" &&
            DB_PLATFORM_TO_PICKER[c.platform] !== null &&
            DB_PLATFORM_TO_PICKER[c.platform] !== undefined &&
            !pickerShownRef.current.has(c.id),
        );
        if (!pending) return;
        const picker = DB_PLATFORM_TO_PICKER[pending.platform]!;
        pickerShownRef.current.add(pending.id);
        setPickerTarget({
          connectionId: pending.id,
          platform: picker.platform,
          label: picker.label,
        });
      } catch {}
    })();
  }, [accounts, pickerTarget, companyId, lastPopupAt]);

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

  async function handleConnect(
    platform: string,
    opts?: { skipPreflight?: boolean; forceCrossTenant?: boolean },
  ) {
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

    forceCrossTenantRef.current = opts?.forceCrossTenant === true;
    setBusy(platform);
    busyPlatformRef.current = platform;
    setPopupBlockedUrl(null);

    const res = await fetch(
      `/api/admin/companies/${companyId}/social-profiles/${profileId}/connect`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform,
          ...(opts?.forceCrossTenant ? { force_cross_tenant: true } : {}),
        }),
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
    const popup = window.open(json.data.url, "bundle-connect", getPopupFeatures());
    if (!popup || popup.closed) {
      setPopupBlockedUrl(json.data.url);
      setBusy(null);
      return;
    }
    popupRef.current = popup;
    popupOpenedAtRef.current = Date.now();
    let closedHandled = false;
    pollRef.current = setInterval(() => {
      if (popup.closed && !closedHandled) {
        closedHandled = true;
        void syncOnPopupClose();
      }
    }, 500);
  }

  return (
    <div data-testid="admin-profile-connections">
      {pickerTarget ? (
        <ChannelPickerModal
          connectionId={pickerTarget.connectionId}
          platform={pickerTarget.platform}
          platformLabel={pickerTarget.label}
          isOpen={true}
          onClose={() => setPickerTarget(null)}
          onSelected={() => {
            setPickerTarget(null);
            toastSuccess(
              `${pickerTarget.label} channel set — ready to publish.`,
            );
            router.refresh();
          }}
        />
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
              If you personally manage{" "}
              <strong>{preflightModal.platformLabel}</strong> for multiple
              clients, click &ldquo;I manage both&rdquo; to proceed. The
              connection will be audited. To connect a different account,
              log out of {preflightModal.platformLabel} in another tab first.
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
                  void handleConnect(platform, {
                    skipPreflight: true,
                    forceCrossTenant: true,
                  });
                }}
                data-testid="preflight-modal-continue"
              >
                I manage both
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
                  <MenuItem
                    key={p.value}
                    onClick={() => {
                      setPickerOpen(false);
                      void handleConnect(p.value);
                    }}
                    disabled={busy !== null}
                    data-testid={`connect-platform-${p.value}`}
                    aria-label={`Connect ${p.label} to ${profileName}`}
                    icon={<SocialPlatformIcon platform={p.value} size={16} />}
                    trailing={
                      isBusy
                        ? <span className="text-xs">Opening…</span>
                        : <span aria-hidden="true">›</span>
                    }
                  >
                    {p.label}
                  </MenuItem>
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
