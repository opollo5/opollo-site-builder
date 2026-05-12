"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// ChannelPickerModal — channel-selection flow (incident 2026-05-12).
//
// Used after a customer connects a channel-selection platform
// (LinkedIn / FB / IG / YT / GBP) and bundle.social returns the
// account in pending_identity. The modal:
//   1. Fetches the channel list from
//      GET /api/platform/social/connections/[id]/channels.
//   2. Renders rows with platform-specific subtext.
//   3. On select → POST .../set-channel → onSelected().
//   4. LinkedIn empty-channels branch → "Connect as personal profile"
//      → POST .../connect-as-personal → onSelected().
//
// Platform-agnostic by design: the API normalises every channel into
// the `Channel` shape exposed by lib/platform/social/connections/
// channels.ts, so this component does no per-platform branching aside
// from the LinkedIn personal-mode affordance.
// ---------------------------------------------------------------------------

type Channel = {
  id: string;
  name: string;
  subtext: string | null;
  avatarUrl: string | null;
  kind:
    | "LINKEDIN_ORG"
    | "FACEBOOK_PAGE"
    | "INSTAGRAM_ACCOUNT"
    | "YOUTUBE_CHANNEL"
    | "GBP_LOCATION"
    | "OTHER";
};

type Props = {
  connectionId: string;
  platform: "LINKEDIN" | "FACEBOOK" | "INSTAGRAM" | "YOUTUBE" | "GOOGLE_BUSINESS";
  platformLabel: string;
  isOpen: boolean;
  onClose: () => void;
  onSelected: () => void;
};

type FetchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; channels: Channel[] }
  | { kind: "error"; message: string };

export function ChannelPickerModal({
  connectionId,
  platform,
  platformLabel,
  isOpen,
  onClose,
  onSelected,
}: Props) {
  const [state, setState] = useState<FetchState>({ kind: "idle" });
  const [busyChannelId, setBusyChannelId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyPersonal, setBusyPersonal] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setState({ kind: "loading" });
    setActionError(null);
    (async () => {
      try {
        const res = await fetch(
          `/api/platform/social/connections/${connectionId}/channels`,
          { method: "GET" },
        );
        const json = (await res.json()) as
          | { ok: true; data: { channels: Channel[] } }
          | { ok: false; error: { message: string } };
        if (cancelled) return;
        if (!res.ok || !json.ok) {
          setState({
            kind: "error",
            message: !json.ok ? json.error.message : "Failed to load channels.",
          });
          return;
        }
        setState({ kind: "loaded", channels: json.data.channels });
      } catch (err) {
        if (cancelled) return;
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, connectionId]);

  async function handleSelect(channel: Channel) {
    setBusyChannelId(channel.id);
    setActionError(null);
    const res = await fetch(
      `/api/platform/social/connections/${connectionId}/set-channel`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel_id: channel.id }),
      },
    );
    const json = (await res.json()) as
      | { ok: true }
      | { ok: false; error: { message: string } };
    setBusyChannelId(null);
    if (!res.ok || !json.ok) {
      setActionError(!json.ok ? json.error.message : "Failed to set channel.");
      return;
    }
    onSelected();
  }

  async function handlePersonalMode() {
    setBusyPersonal(true);
    setActionError(null);
    const res = await fetch(
      `/api/platform/social/connections/${connectionId}/connect-as-personal`,
      { method: "POST" },
    );
    const json = (await res.json()) as
      | { ok: true }
      | { ok: false; error: { message: string } };
    setBusyPersonal(false);
    if (!res.ok || !json.ok) {
      setActionError(
        !json.ok ? json.error.message : "Failed to enable personal-mode.",
      );
      return;
    }
    onSelected();
  }

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="channel-picker-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      data-testid="channel-picker-modal"
    >
      <div className="max-h-[80vh] w-full max-w-md overflow-hidden rounded-lg bg-background shadow-xl">
        <header className="border-b p-4">
          <h2
            id="channel-picker-title"
            className="text-base font-semibold"
            data-testid="channel-picker-title"
          >
            Pick a {platformLabel} channel
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Posts to this connection will be published to the channel you
            pick. You can change it later.
          </p>
        </header>

        <div
          className="max-h-[55vh] overflow-y-auto p-4"
          data-testid="channel-picker-body"
        >
          {state.kind === "loading" || state.kind === "idle" ? (
            <p
              className="text-sm text-muted-foreground"
              data-testid="channel-picker-loading"
            >
              Loading channels…
            </p>
          ) : state.kind === "error" ? (
            <p
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              role="alert"
              data-testid="channel-picker-fetch-error"
            >
              {state.message}
            </p>
          ) : state.channels.length === 0 ? (
            <div data-testid="channel-picker-empty">
              <p className="mb-3 text-sm text-muted-foreground">
                You don&apos;t admin any {platformLabel} channels.
              </p>
              {platform === "LINKEDIN" ? (
                <>
                  <p className="mb-3 text-sm text-muted-foreground">
                    Connect as your personal LinkedIn profile instead?
                    Posts will be published under your own name.
                  </p>
                  <Button
                    onClick={handlePersonalMode}
                    disabled={busyPersonal}
                    data-testid="channel-picker-personal-mode"
                  >
                    {busyPersonal ? "Connecting…" : "Connect as personal profile"}
                  </Button>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Disconnect this account and try again with one that
                  admins at least one {platformLabel} resource.
                </p>
              )}
            </div>
          ) : (
            <ul className="space-y-2" data-testid="channel-picker-list">
              {state.channels.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => handleSelect(c)}
                    disabled={busyChannelId !== null}
                    className="flex w-full items-center gap-3 rounded-md border bg-card p-3 text-left hover:bg-muted/30 disabled:opacity-50"
                    data-testid={`channel-picker-row-${c.id}`}
                  >
                    {c.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={c.avatarUrl}
                        alt=""
                        className="h-10 w-10 flex-shrink-0 rounded-full bg-muted"
                      />
                    ) : (
                      <div className="h-10 w-10 flex-shrink-0 rounded-full bg-muted" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {c.name}
                      </div>
                      {c.subtext ? (
                        <div className="truncate text-sm text-muted-foreground">
                          {c.subtext}
                        </div>
                      ) : null}
                    </div>
                    {busyChannelId === c.id ? (
                      <span className="text-sm text-muted-foreground">
                        Selecting…
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {actionError ? (
            <p
              className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              role="alert"
              data-testid="channel-picker-action-error"
            >
              {actionError}
            </p>
          ) : null}
        </div>

        <footer className="flex justify-end gap-2 border-t p-4">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={busyChannelId !== null || busyPersonal}
            data-testid="channel-picker-close"
          >
            Close
          </Button>
        </footer>
      </div>
    </div>
  );
}
