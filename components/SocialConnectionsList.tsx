"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toastSuccess } from "@/lib/toast-success";

import { ChannelPickerModal } from "@/components/ChannelPickerModal";
import { Alert } from "@/components/ui/alert";
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
  instagram_business: { platform: "INSTAGRAM", label: "Instagram" },
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

function getPopupFeatures(): string {
  const w = 900;
  const h = 820;
  const left = Math.floor(window.screen.width / 2 - w / 2);
  const top = Math.floor(window.screen.height / 2 - h / 2);
  return `width=${w},height=${h},left=${left},top=${top},scrollbars=yes,resizable=yes`;
}

// 2026-05-13 platform trim: TikTok, Pinterest, Threads, and Reddit are
// removed from the UI surface. Backend Zod schemas still accept the
// full 14-platform enum, so any existing rows (or future re-enable)
// keep working — only the user-facing connect menu is filtered.
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

// URLs that surface the currently-signed-in account on each platform.
// Used by the identity-confirmation modal so users can verify they're
// authorising the correct account before the OAuth popup fires.
const PLATFORM_CHECK_URLS: Record<string, string> = {
  LINKEDIN:       "https://www.linkedin.com/in/me/",
  FACEBOOK:       "https://www.facebook.com/settings",
  INSTAGRAM:      "https://www.instagram.com/accounts/edit/",
  TWITTER:        "https://x.com/settings/account",
  GOOGLE_BUSINESS:"https://myaccount.google.com",
  TIKTOK:         "https://www.tiktok.com/setting",
  YOUTUBE:        "https://myaccount.google.com",
  PINTEREST:      "https://www.pinterest.com/settings/",
  THREADS:        "https://www.threads.net",
  REDDIT:         "https://www.reddit.com/settings/account",
};

type ConnectMessage = {
  type: "bundle-connect-complete";
  // 2026-05-13: needs_channel is no longer emitted to the parent — the
  // popup-mode picker page (/connect/pick-channel) handles channel
  // selection inside the popup and fires `success` instead. The kind
  // is kept in the union for backward compat with any in-flight popups
  // that load older callback HTML.
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
  // WS2 reconnect deep link: when set, scrolls to and highlights this
  // connection row so the user can immediately click Reconnect.
  reconnectConnectionId?: string | null;
};

export function SocialConnectionsList({
  companyId,
  profileId,
  connections,
  canManage,
  canReconnect,
  autoOpenPickerForConnectionId,
  noopdForPlatform,
  reconnectConnectionId,
}: Props) {
  const router = useRouter();
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [busySync, setBusySync] = useState(false);
  // Popover open state for the platform-picker dropdown (G1).
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busyPlatform, setBusyPlatform] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [popupBlockedUrl, setPopupBlockedUrl] = useState<string | null>(null);
  // Track per-row disconnect spinner state.
  const [disconnectBusy, setDisconnectBusy] = useState<string | null>(null);
  // Bug-fix 2026-05-12: "already connected" banner — set from prop (non-
  // popup redirect) or from the popup postMessage when noop+updated fires.
  // Lowercase bundle.social platform string, e.g. "linkedin".
  const [noopdPlatform, setNoopdPlatform] = useState<string | null>(
    noopdForPlatform ?? null,
  );

  // 2026-05-13 take 2: channel picker now auto-opens as a modal in
  // THIS parent window when the popup posts back connect=needs_channel
  // (or when the page is loaded with ?connect=needs_channel from the
  // non-popup callback redirect). Replaces the brief popup-in-popup
  // experiment whose opener relationship broke in some browsers.
  const [pickerForConnectionId, setPickerForConnectionId] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (!autoOpenPickerForConnectionId) return;
    // Only open for connections still pending channel selection. Once
    // set-channel succeeds the status flips to healthy; without this
    // guard router.refresh() would re-open the modal for the now-healthy row.
    if (
      !connections.some(
        (c) =>
          c.id === autoOpenPickerForConnectionId &&
          c.status === "pending_identity",
      )
    )
      return;
    pickerShownRef.current.add(autoOpenPickerForConnectionId);
    setPickerForConnectionId(autoOpenPickerForConnectionId);
  }, [autoOpenPickerForConnectionId, connections]);

  // WS2 reconnect deep link: scroll the highlighted row into view on mount.
  useEffect(() => {
    if (!reconnectConnectionId) return;
    const el = document.querySelector(
      `[data-testid="connection-row-${reconnectConnectionId}"]`,
    );
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [reconnectConnectionId]);

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

  // Identity confirmation modal — shown before every connect attempt so
  // the user can verify they're signed into the correct platform account.
  // Fires before preflight; dismissed by Cancel or by ticking the checkbox
  // and clicking Continue.
  const [identityConfirmModal, setIdentityConfirmModal] = useState<{
    platform: string;
    platformLabel: string;
  } | null>(null);
  const [identityConfirmChecked, setIdentityConfirmChecked] = useState(false);

  // Mirrors busyPlatform in a ref so the stale-closed handleMessage
  // effect can read the platform the user originally clicked (needed to
  // distinguish Instagram from Facebook — both land as facebook_page rows).
  const busyPlatformRef = useRef<string | null>(null);
  // Set to true when the user clicks "I manage both" in the preflight modal.
  // Passed to /connect (encodes into callback URL) and to syncOnPopupClose
  // (passed to /sync) so the cross-tenant block is bypassed for this flow.
  const forceCrossTenantRef = useRef<boolean>(false);
  // When needs_channel fires after an Instagram connect, override the
  // picker modal's platform so it shows Instagram-specific copy.
  const [pickerPlatformOverride, setPickerPlatformOverride] = useState<
    string | null
  >(null);

  const popupRef = useRef<Window | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Timestamp set when the popup opens so we can identify connections
  // created AFTER the popup (needed for auto-picker after sync).
  const popupOpenedAtRef = useRef<number | null>(null);
  // Shown-set for the auto-open effect. useRef resets on unmount (page
  // refresh) so a new mount always re-evaluates pending rows.
  const pickerShownRef = useRef<Set<string>>(new Set());
  // Set to Date.now() when a post-popup sync inserted > 0 rows.
  // Drives the auto-open picker effect below.
  const [postPopupSyncAt, setPostPopupSyncAt] = useState<number | null>(null);

  function clearPopupState(activeRowId?: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    popupRef.current = null;
    setBusyPlatform(null);
    forceCrossTenantRef.current = false;
    if (activeRowId) setBusyRow(null);
  }

  // When bundle.social redirects the popup to their own dashboard instead
  // of our /callback URL (the redirectUrl parameter is not honoured as a
  // browser redirect — confirmed 2026-05-13), the popup-close poll is the
  // only signal we get. Trigger an explicit sync so bundle.social-created
  // connections land in our DB even without a callback hit.
  async function syncOnPopupClose(rowId?: string) {
    const forceCrossTenant = forceCrossTenantRef.current;
    clearPopupState(rowId);
    let inserted = 0;
    try {
      const r = await fetch("/api/platform/social/connections/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // For fresh connects (no rowId), attribute new accounts so
        // platforms that don't redirect to our callback (e.g. X/Twitter
        // going to bundle.social's dashboard) still get a DB row created.
        body: JSON.stringify({
          company_id: companyId,
          ...(rowId ? {} : { attribute_new_to_company_id: companyId }),
          ...(forceCrossTenant && !rowId
            ? { force_cross_tenant_override: true }
            : {}),
        }),
      });
      if (r.ok) {
        const json = (await r.json()) as { data?: { inserted: number } };
        inserted = json?.data?.inserted ?? 0;
      }
    } catch {
      // Non-fatal — router.refresh() still picks up state via server fetch.
    }
    if (inserted > 0) setPostPopupSyncAt(Date.now());
    router.refresh();
    // X/Twitter (and any platform whose OAuth bundle.social processes
    // asynchronously): if the first sync fires before bundle.social has
    // finished creating the account, inserted=0. One retry after 3 s
    // catches the common case where the account appears a few seconds
    // after the popup closes.
    if (inserted === 0 && !rowId) {
      setTimeout(() => {
        void (async () => {
          try {
            const r2 = await fetch("/api/platform/social/connections/sync", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                company_id: companyId,
                attribute_new_to_company_id: companyId,
                ...(forceCrossTenant
                  ? { force_cross_tenant_override: true }
                  : {}),
              }),
            });
            if (r2.ok) {
              const json2 = (await r2.json()) as { data?: { inserted: number } };
              if ((json2?.data?.inserted ?? 0) > 0) setPostPopupSyncAt(Date.now());
            }
          } catch {
            // Non-fatal.
          }
          router.refresh();
        })();
      }, 3000);
    }
  }

  // preOpenedPopup: a Window already opened synchronously in the click
  // handler. When supplied we navigate it to url rather than calling
  // window.open again, preserving the user-gesture activation across the
  // async gap between click and OAuth-URL resolution.
  function openConnectPopup(
    url: string,
    rowId?: string,
    preOpenedPopup?: Window | null,
  ) {
    if (popupRef.current && !popupRef.current.closed) {
      popupRef.current.focus();
      return;
    }

    let popup: Window | null;
    if (preOpenedPopup && !preOpenedPopup.closed) {
      preOpenedPopup.location.href = url;
      popup = preOpenedPopup;
    } else {
      popup = window.open(url, "bundle-connect", getPopupFeatures());
    }

    if (!popup || popup.closed) {
      setPopupBlockedUrl(url);
      clearPopupState(rowId);
      return;
    }

    setPopupBlockedUrl(null);
    popupRef.current = popup;
    popupOpenedAtRef.current = Date.now();

    const p = popup;
    let closedHandled = false;
    pollRef.current = setInterval(() => {
      if (p.closed && !closedHandled) {
        closedHandled = true;
        void syncOnPopupClose(rowId);
      }
    }, 500);
  }

  // After a sync-on-popup-close finds inserted > 0, check whether a new
  // pending_identity connection appeared. If so, auto-open the picker.
  useEffect(() => {
    if (postPopupSyncAt === null) return;
    if (pickerForConnectionId) { setPostPopupSyncAt(null); return; }
    const since = (popupOpenedAtRef.current ?? 0) - 5_000;
    const newPending = connections.find(
      (c) =>
        c.status === "pending_identity" &&
        PLATFORM_TO_BUNDLE_LABEL[c.platform] !== null &&
        new Date(c.connected_at).getTime() >= since,
    );
    if (newPending) {
      setPickerForConnectionId(newPending.id);
      setPostPopupSyncAt(null);
      return;
    }
    // Give up after 10 s to avoid a stuck state (e.g. inserted but no
    // pending_identity — TWITTER goes straight to healthy).
    if (Date.now() - postPopupSyncAt > 10_000) setPostPopupSyncAt(null);
  }, [connections, pickerForConnectionId, postPopupSyncAt]);

  // Auto-open the channel picker for any pending_identity row that hasn't
  // been shown this component lifetime. Runs on mount and whenever the
  // connections array or open-picker state changes.
  useEffect(() => {
    if (pickerForConnectionId) return;
    const pending = connections.find(
      (c) =>
        c.status === "pending_identity" &&
        PLATFORM_TO_BUNDLE_LABEL[c.platform] !== null &&
        PLATFORM_TO_BUNDLE_LABEL[c.platform] !== undefined &&
        !pickerShownRef.current.has(c.id),
    );
    if (!pending) return;
    pickerShownRef.current.add(pending.id);
    setPickerForConnectionId(pending.id);
  }, [connections, pickerForConnectionId]);

  useEffect(() => {
    const expectedOrigin = window.location.origin;

    function handleMessage(evt: MessageEvent) {
      if (evt.origin !== expectedOrigin) return;
      if (!isConnectMessage(evt.data)) return;

      const clickedPlatform = busyPlatformRef.current;
      clearPopupState();
      setPickerOpen(false);
      // Auto-open the channel-picker modal in the parent window when
      // the callback signals needs_channel. The OAuth popup has just
      // closed itself; the modal slots in immediately.
      if (
        evt.data.connect === "needs_channel" &&
        typeof evt.data.connection_id === "string"
      ) {
        // Instagram Business creates a facebook_page DB row — preserve
        // the original click intent so the modal shows Instagram copy.
        if (clickedPlatform === "INSTAGRAM") {
          setPickerPlatformOverride("INSTAGRAM");
        }
        // Mark shown so the auto-open effect doesn't re-open the modal
        // while router.refresh() is in-flight with stale pending_identity data.
        pickerShownRef.current.add(evt.data.connection_id);
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
      // Cross-tenant block: the sync refused the account because the
      // platform identity is already owned by another company. Surface an
      // actionable error so the user knows they can click "I manage both"
      // on the next attempt to override the block.
      if (
        evt.data.connect === "error" &&
        evt.data.reason === "cross-tenant-blocked"
      ) {
        setError(
          "This account is already connected to another client. " +
            'To connect it here, click Connect and choose "I manage both" when prompted.',
        );
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

  async function handleConnect(
    platform: string,
    opts?: {
      skipPreflight?: boolean;
      forceCrossTenant?: boolean;
      skipIdentityConfirm?: boolean;
    },
  ) {
    if (!profileId) return;
    setError(null);

    // Identity confirmation gate — show the "verify your account" modal on
    // every fresh connect. skipIdentityConfirm is set by the modal's Continue
    // button and by the preflight "I manage both" path (user already confirmed).
    if (!opts?.skipIdentityConfirm) {
      const platformLabel =
        PLATFORMS.find((p) => p.value === platform)?.label ?? platform;
      setIdentityConfirmModal({ platform, platformLabel });
      return;
    }

    // Bug 1 fix: open a blank popup SYNCHRONOUSLY before the first await so
    // we remain inside the browser's user-gesture activation window. After the
    // async preflight + connect-API calls resolve we navigate the already-open
    // window to the OAuth URL via openConnectPopup(..., prePopup).
    const prePopup =
      typeof window !== "undefined"
        ? window.open("", "bundle-connect", getPopupFeatures())
        : null;

    // Layer 3 — pre-flight check before opening the popup.
    if (!opts?.skipPreflight) {
      const preflight = await runPreflight({ platform });
      if (preflight.warn) {
        prePopup?.close();
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

    // Record the cross-tenant override decision before the popup opens so
    // syncOnPopupClose can read it if the popup bypasses the callback URL.
    forceCrossTenantRef.current = opts?.forceCrossTenant === true;

    setBusyPlatform(platform);
    busyPlatformRef.current = platform;
    setPopupBlockedUrl(null);

    const res = await fetch("/api/platform/social/connections/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company_id: companyId,
        profile_id: profileId,
        platform,
        ...(opts?.forceCrossTenant ? { force_cross_tenant: true } : {}),
      }),
    });
    const json = (await res.json()) as
      | { ok: true; data: { url: string } }
      | { ok: false; error: { message: string } };

    if (!res.ok || !json.ok) {
      prePopup?.close();
      setError(!json.ok ? json.error.message : "Failed to start connect.");
      setBusyPlatform(null);
      return;
    }

    openConnectPopup(json.data.url, undefined, prePopup);
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

  async function handleReconnect(rowId: string, prePopup?: Window | null) {
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
      prePopup?.close();
      setError(!json.ok ? json.error.message : "Failed to start reconnect.");
      setBusyRow(null);
      return;
    }
    openConnectPopup(json.data.url, rowId, prePopup);
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

  // Resolve the picker target to its bundle.social platform shape so
  // the modal renders the right labels. null when the connection isn't
  // a channel-selection platform (modal stays closed).
  //
  // Three-tier resolution:
  //   1. pickerPlatformOverride (Instagram-via-Facebook click intent)
  //   2. DB row platform (connections prop, available after router.refresh)
  //   3. busyPlatformRef (clicked platform, available immediately on
  //      needs_channel — before the RSC re-render delivers the new row)
  //
  // Tier 3 fixes the race where handleMessage fires needs_channel with a
  // connection_id but connections still contains the pre-connect snapshot
  // and the row can't be found.
  const pickerTarget = (() => {
    if (!pickerForConnectionId) return null;

    if (pickerPlatformOverride === "INSTAGRAM") {
      return { platform: "INSTAGRAM" as const, label: "Instagram" };
    }

    const c = connections.find((x) => x.id === pickerForConnectionId);
    if (c) {
      const bundle = PLATFORM_TO_BUNDLE_LABEL[c.platform];
      if (!bundle) return null;
      return { platform: bundle.platform, label: bundle.label };
    }

    // Row not yet in prop (router.refresh() in flight). Derive platform
    // from the captured click intent so the modal opens immediately.
    const hint = busyPlatformRef.current;
    if (!hint) return null;
    const HINT_TO_PICKER: Record<
      string,
      { platform: "LINKEDIN" | "FACEBOOK" | "INSTAGRAM" | "GOOGLE_BUSINESS"; label: string } | undefined
    > = {
      LINKEDIN: { platform: "LINKEDIN", label: "LinkedIn" },
      FACEBOOK: { platform: "FACEBOOK", label: "Facebook" },
      INSTAGRAM: { platform: "INSTAGRAM", label: "Instagram" },
      GOOGLE_BUSINESS: { platform: "GOOGLE_BUSINESS", label: "Google Business" },
    };
    return HINT_TO_PICKER[hint] ?? null;
  })();

  return (
    <div data-testid="connections-list-wrapper">
      {pickerTarget ? (
        <ChannelPickerModal
          connectionId={pickerForConnectionId!}
          platform={pickerTarget.platform}
          platformLabel={pickerTarget.label}
          isOpen={true}
          onClose={() => {
            setPickerForConnectionId(null);
            setPickerPlatformOverride(null);
          }}
          onSelected={() => {
            setPickerForConnectionId(null);
            setPickerPlatformOverride(null);
            toastSuccess("Channel set — this connection is ready to publish.");
            router.refresh();
          }}
        />
      ) : null}

      {noopdConnection ? (
        <div
          className="mb-3 rounded-md border border-warning-border bg-warning-bg px-3 py-2 text-sm text-warning-fg"
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
          <p className="mt-1 text-warning-fg/80">
            Disconnect the existing connection below to connect a different
            account, or ask an admin to create a new profile.
          </p>
        </div>
      ) : null}

      {overdueConnections.length > 0 ? (
        <div
          className="mb-3 rounded-md border border-warning-border bg-warning-bg px-3 py-2 text-sm text-warning-fg"
          role="alert"
          data-testid="connections-overdue-banner"
        >
          <p className="font-medium">
            {overdueConnections.length}{" "}
            {overdueConnections.length === 1 ? "connection needs" : "connections need"}{" "}
            a channel.
          </p>
          <p className="mt-1 text-warning-fg/80">
            Pick a channel below to start publishing. Connections without a
            channel can&apos;t post.
          </p>
        </div>
      ) : null}

      {identityConfirmModal ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="identity-confirm-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          data-testid="identity-confirm-modal"
        >
          <div className="max-w-md rounded-lg bg-background p-5 shadow-xl">
            <h2
              id="identity-confirm-title"
              className="mb-2 text-base font-semibold"
            >
              Connecting {identityConfirmModal.platformLabel}
            </h2>
            <p className="mb-3 text-sm text-muted-foreground">
              You&apos;re about to authorise Opollo using the{" "}
              <strong>{identityConfirmModal.platformLabel}</strong> account
              currently signed into your browser. Make sure you&apos;re signed
              into the correct account before continuing.
            </p>
            {PLATFORM_CHECK_URLS[identityConfirmModal.platform] ? (
              <a
                href={PLATFORM_CHECK_URLS[identityConfirmModal.platform]}
                target="_blank"
                rel="noopener noreferrer"
                className="mb-4 inline-flex items-center gap-1 text-sm text-primary underline underline-offset-2"
                data-testid="identity-confirm-check-link"
              >
                Open {identityConfirmModal.platformLabel} to check which account
                ↗
              </a>
            ) : null}
            <label className="mb-4 flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 shrink-0 accent-primary"
                checked={identityConfirmChecked}
                onChange={(e) => setIdentityConfirmChecked(e.target.checked)}
                data-testid="identity-confirm-checkbox"
              />
              <span>
                I&apos;ve verified this is the correct account to authorise
              </span>
            </label>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setIdentityConfirmModal(null);
                  setIdentityConfirmChecked(false);
                }}
                data-testid="identity-confirm-cancel"
              >
                Cancel
              </Button>
              <Button
                disabled={!identityConfirmChecked}
                aria-disabled={!identityConfirmChecked}
                onClick={() => {
                  if (!identityConfirmChecked) return;
                  const { platform } = identityConfirmModal;
                  setIdentityConfirmModal(null);
                  setIdentityConfirmChecked(false);
                  void handleConnect(platform, { skipIdentityConfirm: true });
                }}
                data-testid="identity-confirm-continue"
              >
                Continue
              </Button>
            </div>
          </div>
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
                    skipIdentityConfirm: true,
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
          {profileId ? (
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  disabled={connectBusy}
                  data-testid="connections-connect-button"
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
                {/* `connect-lightbox` alias preserved for the e2e suite
                    (e2e/social.spec.ts asserts the picker is visible
                    via this testid). */}
                <div
                  role="menu"
                  className="flex flex-col"
                  data-testid="connect-lightbox"
                >
                  {PLATFORMS.map((p) => {
                    const isBusy = busyPlatform === p.value;
                    return (
                      <MenuItem
                        key={p.value}
                        onClick={() => {
                          setPickerOpen(false);
                          void handleConnect(p.value);
                        }}
                        disabled={connectBusy}
                        data-testid={`connect-platform-${p.value}`}
                        aria-label={`Connect ${p.label}`}
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
          ) : null}
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
          className="mb-3 rounded-md border border-warning-border bg-warning-bg px-3 py-2 text-sm text-warning-fg"
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
                    reconnectConnectionId === c.id
                      ? "bg-blue-50 ring-1 ring-inset ring-blue-200"
                      : noopdConnection?.id === c.id
                        ? "bg-amber-50"
                        : "hover:bg-muted/20"
                  }`}
                  data-testid={`connection-row-${c.id}`}
                >
                  <td className="px-4 py-3 font-medium">
                    {c.platform.startsWith("linkedin") && !c.is_personal_mode
                      ? "LinkedIn"
                      : (PLATFORM_LABEL[c.platform] ?? c.platform)}
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
                          onClick={() => {
                            const popup = window.open(
                              "",
                              "bundle-connect",
                              getPopupFeatures(),
                            );
                            void handleReconnect(c.id, popup);
                          }}
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
