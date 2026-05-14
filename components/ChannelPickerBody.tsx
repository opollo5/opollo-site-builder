"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// ChannelPickerBody — the channel-list + Personal-mode body, extracted
// from ChannelPickerModal so it can render either inside the modal (when
// invoked from the "Switch channel" admin action on a healthy connection)
// or fullscreen inside the OAuth popup (when invoked from the post-OAuth
// callback redirect to /connect/pick-channel).
//
// Layout: no modal chrome. The wrapping component handles the dialog
// container or the popup viewport.
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

export type ChannelPickerBodyProps = {
  connectionId: string;
  platform: "LINKEDIN" | "FACEBOOK" | "INSTAGRAM" | "YOUTUBE" | "GOOGLE_BUSINESS";
  platformLabel: string;
  // Called after the user picks a channel (set-channel returns ok) OR
  // taps the LinkedIn-empty-channels "Personal profile" branch.
  onSelected: () => void;
  // Optional auto-fetch toggle. Defaults to true. The modal sets this
  // false until isOpen=true; the popup-mode page always wants true.
  autoFetch?: boolean;
};

type FetchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; channels: Channel[] }
  | { kind: "error"; message: string };

type ConflictState = {
  channelId: string;
  conflictingCompany: string | null;
  conflictingChannelName: string | null;
  overrideAllowed: boolean;
};

export function ChannelPickerBody({
  connectionId,
  platform,
  platformLabel,
  onSelected,
  autoFetch = true,
}: ChannelPickerBodyProps) {
  const [state, setState] = useState<FetchState>({ kind: "idle" });
  const [busyChannelId, setBusyChannelId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [conflictError, setConflictError] = useState<ConflictState | null>(null);
  const [busyPersonal, setBusyPersonal] = useState(false);

  useEffect(() => {
    if (!autoFetch) return;
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
  }, [autoFetch, connectionId]);

  async function handleSelect(channel: Channel, opts?: { force?: boolean }) {
    // Fix C: explicit guard prevents duplicate POSTs if React batches or
    // the user clicks before the disabled attr takes effect.
    if (busyChannelId !== null) return;
    setBusyChannelId(channel.id);
    setActionError(null);
    setConflictError(null);
    const res = await fetch(
      `/api/platform/social/connections/${connectionId}/set-channel`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel_id: channel.id,
          ...(opts?.force ? { force: true } : {}),
        }),
      },
    );
    type ErrorBody = {
      ok: false;
      error: {
        code: string;
        message: string;
        details?: {
          conflicting_company?: string | null;
          conflicting_channel_name?: string | null;
          override_allowed?: boolean;
        };
      };
    };
    // Clear spinner before JSON parse so a parse failure doesn't leave the
    // channel row stuck in "Selecting…" forever.
    setBusyChannelId(null);
    let json: { ok: true } | ErrorBody;
    try {
      json = (await res.json()) as { ok: true } | ErrorBody;
    } catch {
      setActionError("Failed to set channel.");
      return;
    }
    if (!res.ok || !json.ok) {
      const err = (json as ErrorBody).error;
      if (res.status === 409 && err.code === "CROSS_TENANT_CONFLICT") {
        console.error("channel-picker: cross-tenant conflict", {
          code: err.code,
          details: err.details,
        });
        setConflictError({
          channelId: channel.id,
          conflictingCompany: err.details?.conflicting_company ?? null,
          conflictingChannelName: err.details?.conflicting_channel_name ?? null,
          overrideAllowed: err.details?.override_allowed === true,
        });
        return;
      }
      setActionError(err?.message ?? "Failed to set channel.");
      return;
    }
    onSelected();
  }

  async function retryWithOverride(channel: Channel) {
    await handleSelect(channel, { force: true });
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

  return (
    <div data-testid="channel-picker-body">
      {conflictError ? (
        // Conflict replaces the channel list entirely so the user can't
        // click another channel while the override prompt is visible.
        <div
          className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
          role="alert"
          data-testid="channel-picker-conflict-error"
        >
          <p className="mb-1 font-medium">
            This {platformLabel} channel is already connected to another
            company
            {conflictError.conflictingCompany
              ? ` (${conflictError.conflictingCompany})`
              : ""}.
          </p>
          {conflictError.conflictingChannelName ? (
            <p className="mb-2 text-amber-800">
              Channel: {conflictError.conflictingChannelName}
            </p>
          ) : null}
          {conflictError.overrideAllowed ? (
            <>
              <p className="mb-2">
                If you manage social media for both companies, you can connect
                it to this one too.
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    const ch = (
                      state.kind === "loaded" ? state.channels : []
                    ).find((c) => c.id === conflictError.channelId);
                    if (ch) void retryWithOverride(ch);
                  }}
                  disabled={busyChannelId !== null}
                  data-testid="channel-picker-connect-both"
                >
                  {busyChannelId !== null ? "Connecting…" : "Connect to both companies"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConflictError(null)}
                  data-testid="channel-picker-conflict-cancel"
                >
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <p className="text-amber-800">
              Contact support to set up multi-company sharing, or disconnect
              the channel from the other company first.
            </p>
          )}
        </div>
      ) : state.kind === "loading" || state.kind === "idle" ? (
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
                Connect as your personal LinkedIn profile instead? Posts will
                be published under your own name.
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
              Disconnect this account and try again with one that admins at
              least one {platformLabel} resource.
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
                  <div className="truncate text-sm font-medium">{c.name}</div>
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
  );
}
