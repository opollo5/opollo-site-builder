"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { AppearanceEventLog } from "@/components/AppearanceEventLog";
import { ErrorFallback } from "@/components/ErrorFallback";
import { KadencePaletteDiffTable } from "@/components/KadencePaletteDiffTable";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CardSkeleton } from "@/components/ui/skeleton";
import { H1, Lead } from "@/components/ui/typography";
import type { AppearanceEventRow } from "@/lib/appearance-events";
import type {
  KadencePaletteProposal,
  PaletteDiff,
} from "@/lib/kadence-mapper";
import type {
  KadenceInstallState,
  KadencePalette,
} from "@/lib/kadence-rest";

// ---------------------------------------------------------------------------
// M13-5d — Appearance panel client.
//
// Owns the panel state machine. Calls into M13-5c's three routes:
//   POST /preflight        on mount + "Re-check" button
//   POST /sync-palette     dry_run + confirmed modes
//   POST /rollback-palette confirmed only (idempotent server-side)
//
// Phases:
//   loading            → just mounted, /preflight in flight
//   preflight_blocked  → 403 PREFLIGHT_BLOCKED, render translated blocker
//   kadence_inactive   → 409 KADENCE_NOT_ACTIVE, render install instructions
//   ready              → 200 success, render diff table + sync controls
//   error              → unrecoverable error, render retry
//
// Confirm modals (assistive-operator-flow contract):
//   - Sync: names the WP URL + lists the slots that will change with
//     before/after colors. Re-uses KadencePaletteDiffTable inline.
//   - Rollback: names the WP URL + the snapshot timestamp + the
//     prior-event id being undone. Marked destructive (red button).
//
// The "Re-sync" button shows when already_synced=true so an operator
// can force a fresh write + audit entry (e.g., to verify the operator
// path works on a known-good palette before a riskier operation).
// ---------------------------------------------------------------------------

type Phase = "loading" | "preflight_blocked" | "kadence_inactive" | "ready" | "error";

type PreflightContext = {
  install: KadenceInstallState;
  current_palette: KadencePalette;
  current_palette_sha: string;
  proposal: KadencePaletteProposal;
  diff: PaletteDiff;
  already_synced: boolean;
  site_version_lock: number;
};

type Blocker = {
  code: string;
  title: string;
  detail: string;
  nextAction: string;
};

type ConfirmKind = "sync" | "rollback" | null;
type ActionState = "idle" | "rechecking" | "syncing" | "rolling_back";

export function AppearancePanelClient({
  siteId,
  siteName,
  siteWpUrl,
  initialKadenceInstalledAt,
  initialKadenceGlobalsSyncedAt,
  initialSiteVersionLock,
  initialEvents,
}: {
  siteId: string;
  siteName: string;
  siteWpUrl: string;
  initialKadenceInstalledAt: string | null;
  initialKadenceGlobalsSyncedAt: string | null;
  initialSiteVersionLock: number;
  initialEvents: AppearanceEventRow[];
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("loading");
  const [actionState, setActionState] = useState<ActionState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [blocker, setBlocker] = useState<Blocker | null>(null);
  const [inactiveData, setInactiveData] = useState<{
    active_theme_slug: string | null;
    kadence_installed: boolean;
  } | null>(null);
  const [ctx, setCtx] = useState<PreflightContext | null>(null);
  const [siteVersionLock, setSiteVersionLock] = useState<number>(
    initialSiteVersionLock,
  );
  const [confirmOpen, setConfirmOpen] = useState<ConfirmKind>(null);
  const [events, setEvents] = useState<AppearanceEventRow[]>(initialEvents);
  const [kadenceGlobalsSyncedAt, setKadenceGlobalsSyncedAt] = useState<
    string | null
  >(initialKadenceGlobalsSyncedAt);

  // The most-recent globals_completed event id — drives whether
  // rollback is offered.
  const lastSyncEventId = useMemo(() => {
    return (
      events.find((e) => e.event === "globals_completed")?.id ?? null
    );
  }, [events]);

  // -------------------------------------------------------------------------
  // /preflight
  // -------------------------------------------------------------------------

  const runPreflight = useCallback(async () => {
    setActionState("rechecking");
    setErrorMessage(null);
    try {
      const res = await fetch(
        `/api/sites/${siteId}/appearance/preflight`,
        { method: "POST" },
      );
      const payload = (await res.json()) as
        | { ok: true; data: PreflightContext & { preflight: unknown } }
        | { ok: false; error: { code: string; message: string; details?: unknown } };
      if (res.ok && payload.ok) {
        setCtx({
          install: payload.data.install,
          current_palette: payload.data.current_palette,
          current_palette_sha: payload.data.current_palette_sha,
          proposal: payload.data.proposal,
          diff: payload.data.diff,
          already_synced: payload.data.already_synced,
          site_version_lock: payload.data.site_version_lock,
        });
        setSiteVersionLock(payload.data.site_version_lock);
        setBlocker(null);
        setInactiveData(null);
        setPhase("ready");
        return;
      }
      // Error paths.
      if (!payload.ok) {
        if (payload.error.code === "PREFLIGHT_BLOCKED") {
          const b = (payload.error.details as { blocker?: Blocker } | undefined)
            ?.blocker;
          if (b) {
            setBlocker(b);
            setPhase("preflight_blocked");
            return;
          }
        }
        if (payload.error.code === "KADENCE_NOT_ACTIVE") {
          const d = payload.error.details as
            | {
                active_theme_slug?: string | null;
                kadence_installed?: boolean;
              }
            | undefined;
          setInactiveData({
            active_theme_slug: d?.active_theme_slug ?? null,
            kadence_installed: d?.kadence_installed ?? false,
          });
          setPhase("kadence_inactive");
          return;
        }
        setErrorMessage(payload.error.message ?? "Preflight failed.");
        setPhase("error");
      }
    } catch (err) {
      setErrorMessage(
        `Network error: ${err instanceof Error ? err.message : String(err)}`,
      );
      setPhase("error");
    } finally {
      setActionState("idle");
    }
  }, [siteId]);

  // Run preflight on mount.
  useEffect(() => {
    void runPreflight();
  }, [runPreflight]);

  // -------------------------------------------------------------------------
  // Confirmed sync
  // -------------------------------------------------------------------------

  async function handleConfirmSync() {
    if (!ctx) return;
    setActionState("syncing");
    setErrorMessage(null);
    try {
      const res = await fetch(
        `/api/sites/${siteId}/appearance/sync-palette`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            mode: "confirmed",
            expected_site_version_lock: ctx.site_version_lock,
            expected_current_palette_sha: ctx.current_palette_sha,
          }),
        },
      );
      const payload = (await res.json()) as
        | {
            ok: true;
            data: {
              outcome: "SYNCED" | "ALREADY_SYNCED";
              synced_at: string;
              new_site_version_lock: number;
              round_trip_ok: boolean;
            };
          }
        | { ok: false; error: { code: string; message: string } };
      if (res.ok && payload.ok) {
        setKadenceGlobalsSyncedAt(payload.data.synced_at);
        setSiteVersionLock(payload.data.new_site_version_lock);
        setConfirmOpen(null);
        // Re-run preflight to refresh the diff (now should be empty).
        await runPreflight();
        // Refresh server props so the events list re-fetches.
        router.refresh();
        if (!payload.data.round_trip_ok) {
          setErrorMessage(
            "Palette synced, but WordPress's response didn't exactly match what we sent. Check the audit details for the round-trip mismatch.",
          );
        }
        return;
      }
      if (!payload.ok) {
        // Drift handling: re-run preflight so the operator sees the
        // fresh diff before retrying.
        if (payload.error.code === "WP_STATE_DRIFTED") {
          setConfirmOpen(null);
          await runPreflight();
          setErrorMessage(
            "WordPress changed between your preview and confirm. We've refreshed the diff — review again before syncing.",
          );
          return;
        }
        setErrorMessage(payload.error.message ?? "Sync failed.");
      }
    } catch (err) {
      setErrorMessage(
        `Network error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setActionState("idle");
    }
  }

  // -------------------------------------------------------------------------
  // Rollback
  // -------------------------------------------------------------------------

  async function handleConfirmRollback() {
    setActionState("rolling_back");
    setErrorMessage(null);
    try {
      const res = await fetch(
        `/api/sites/${siteId}/appearance/rollback-palette`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expected_site_version_lock: siteVersionLock,
          }),
        },
      );
      const payload = (await res.json()) as
        | {
            ok: true;
            data: {
              outcome: "ROLLED_BACK" | "ALREADY_ROLLED_BACK";
              rolled_back_at: string;
              new_site_version_lock: number;
            };
          }
        | { ok: false; error: { code: string; message: string } };
      if (res.ok && payload.ok) {
        setKadenceGlobalsSyncedAt(payload.data.rolled_back_at);
        setSiteVersionLock(payload.data.new_site_version_lock);
        setConfirmOpen(null);
        await runPreflight();
        router.refresh();
        return;
      }
      if (!payload.ok) {
        setErrorMessage(payload.error.message ?? "Rollback failed.");
      }
    } catch (err) {
      setErrorMessage(
        `Network error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setActionState("idle");
    }
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const wpDisplayUrl = siteWpUrl.replace(/\/+$/, "");

  return (
    <div className="mt-4 space-y-5">
      <div>
        <H1>Appearance</H1>
        <Lead className="mt-0.5">
          Sync this site&apos;s design-system palette to Kadence on{" "}
          <span className="font-medium text-foreground">{siteName}</span>{" "}
          ({wpDisplayUrl}).
        </Lead>
      </div>

      {/* Scope clarifier — what Opollo owns vs what the operator owns. */}
      <div
        role="note"
        className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground"
      >
        <p>
          <strong className="text-foreground">Opollo owns palette only.</strong>{" "}
          Typography + spacing globals stay in WP Admin → Customizer; you set
          them once and they persist across syncs. Kadence theme install +
          activate are also manual — install Kadence through WP Admin →
          Appearance → Themes if you haven&apos;t yet.
        </p>
      </div>

      {/* Top-level error banner — covers network errors + post-action errors. */}
      {errorMessage && <Alert variant="destructive">{errorMessage}</Alert>}

      {/* Status banner — varies by phase. */}
      {phase === "loading" && (
        <div className="space-y-3" aria-live="polite">
          <Alert
            variant="info"
            title="Checking Kadence on this site…"
          >
            Reading WordPress capabilities + theme state.
          </Alert>
          <CardSkeleton lines={3} />
          <CardSkeleton lines={2} />
        </div>
      )}

      {phase === "preflight_blocked" && blocker && (
        <PreflightBlockedBanner
          blocker={blocker}
          onRetry={runPreflight}
          retrying={actionState === "rechecking"}
        />
      )}

      {phase === "kadence_inactive" && (
        <KadenceInactiveBanner
          inactive={inactiveData}
          siteWpUrl={wpDisplayUrl}
          onRetry={runPreflight}
          retrying={actionState === "rechecking"}
        />
      )}

      {phase === "error" && (
        <ErrorFallback
          title="Couldn't load the appearance panel"
          description={
            <>
              <p>{errorMessage}</p>
              <p className="mt-1 text-xs">
                If this happens repeatedly, the WordPress site or Kadence
                plugin may be down. Re-checking sometimes helps after a
                brief pause.
              </p>
            </>
          }
          action={{
            label: actionState === "rechecking" ? "Re-checking…" : "Re-check",
            onClick: runPreflight,
          }}
        />
      )}

      {/* Ready state — full panel. */}
      {phase === "ready" && ctx && (
        <ReadyState
          ctx={ctx}
          kadenceInstalledAt={initialKadenceInstalledAt}
          kadenceGlobalsSyncedAt={kadenceGlobalsSyncedAt}
          actionState={actionState}
          lastSyncEventId={lastSyncEventId}
          onSyncClick={() => setConfirmOpen("sync")}
          onRollbackClick={() => setConfirmOpen("rollback")}
          onRecheck={runPreflight}
        />
      )}

      {/* Always-visible event log (initial server-side fetch + refreshes
          after mutations via router.refresh). */}
      <section aria-labelledby="event-log-heading">
        <h2
          id="event-log-heading"
          className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground"
        >
          Recent activity
        </h2>
        <AppearanceEventLog events={events} />
      </section>

      {/* Confirm modals. */}
      {confirmOpen === "sync" && ctx && (
        <SyncConfirmModal
          wpDisplayUrl={wpDisplayUrl}
          diff={ctx.diff}
          alreadySynced={ctx.already_synced}
          onCancel={() => setConfirmOpen(null)}
          onConfirm={handleConfirmSync}
          submitting={actionState === "syncing"}
        />
      )}

      {confirmOpen === "rollback" && (
        <RollbackConfirmModal
          wpDisplayUrl={wpDisplayUrl}
          lastSyncEvent={
            lastSyncEventId
              ? events.find((e) => e.id === lastSyncEventId) ?? null
              : null
          }
          onCancel={() => setConfirmOpen(null)}
          onConfirm={handleConfirmRollback}
          submitting={actionState === "rolling_back"}
        />
      )}

      {/* Effect: if events prop changes (router.refresh), update local state. */}
      <EventsSync initialEvents={initialEvents} setEvents={setEvents} />
    </div>
  );
}

// Wrapper effect to sync server-fetched events into client state on
// router.refresh() — `initialEvents` re-renders into a fresh array
// reference, so we copy it into local state for the audit log.
function EventsSync({
  initialEvents,
  setEvents,
}: {
  initialEvents: AppearanceEventRow[];
  setEvents: (events: AppearanceEventRow[]) => void;
}) {
  useEffect(() => {
    setEvents(initialEvents);
  }, [initialEvents, setEvents]);
  return null;
}

// ---------------------------------------------------------------------------
// Phase-specific sub-components
// ---------------------------------------------------------------------------

function PreflightBlockedBanner({
  blocker,
  onRetry,
  retrying,
}: {
  blocker: Blocker;
  onRetry: () => void;
  retrying: boolean;
}) {
  return (
    <div
      role="alert"
      className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-4 text-sm text-yellow-900 dark:text-yellow-200"
    >
      <p className="font-medium">{blocker.title}</p>
      <p className="mt-1">{blocker.detail}</p>
      <p className="mt-2 text-xs">
        <strong>What to do:</strong> {blocker.nextAction}
      </p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="mt-3"
        onClick={onRetry}
        disabled={retrying}
      >
        {retrying ? "Re-checking…" : "Re-check"}
      </Button>
    </div>
  );
}

function KadenceInactiveBanner({
  inactive,
  siteWpUrl,
  onRetry,
  retrying,
}: {
  inactive: { active_theme_slug: string | null; kadence_installed: boolean } | null;
  siteWpUrl: string;
  onRetry: () => void;
  retrying: boolean;
}) {
  const installed = inactive?.kadence_installed ?? false;
  const activeSlug = inactive?.active_theme_slug ?? "(unknown)";
  return (
    <div
      role="status"
      className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-4 text-sm text-yellow-900 dark:text-yellow-200"
    >
      <p className="font-medium">Kadence isn&apos;t the active theme.</p>
      <p className="mt-1">
        The currently-active theme on{" "}
        <span className="font-mono text-xs">{siteWpUrl}</span> is{" "}
        <span className="font-mono text-xs">{activeSlug}</span>.{" "}
        {installed
          ? "Kadence is installed but not active."
          : "Kadence isn't installed yet."}
      </p>
      <p className="mt-2 text-xs">
        <strong>What to do:</strong>{" "}
        {installed
          ? "In WP Admin → Appearance → Themes, hover over Kadence and click Activate."
          : "In WP Admin → Appearance → Themes → Add New, search 'kadence', click Install + Activate."}{" "}
        Then come back here and click Re-check.
      </p>
      <p className="mt-2 text-xs">
        <a
          href={`${siteWpUrl}/wp-admin/themes.php`}
          target="_blank"
          rel="noreferrer"
          className="underline hover:no-underline"
        >
          Open WP Admin → Themes →
        </a>
      </p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="mt-3"
        onClick={onRetry}
        disabled={retrying}
      >
        {retrying ? "Re-checking…" : "Re-check"}
      </Button>
    </div>
  );
}

function ReadyState({
  ctx,
  kadenceInstalledAt,
  kadenceGlobalsSyncedAt,
  actionState,
  lastSyncEventId,
  onSyncClick,
  onRollbackClick,
  onRecheck,
}: {
  ctx: PreflightContext;
  kadenceInstalledAt: string | null;
  kadenceGlobalsSyncedAt: string | null;
  actionState: ActionState;
  lastSyncEventId: string | null;
  onSyncClick: () => void;
  onRollbackClick: () => void;
  onRecheck: () => void;
}) {
  const insufficientProposal = ctx.proposal.source === "insufficient";
  const canSync =
    !insufficientProposal && (ctx.diff.any_changes || ctx.already_synced);
  const canRollback = lastSyncEventId !== null;

  return (
    <>
      <div className="rounded-lg border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm">
              <span className="inline-flex rounded bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700">
                Kadence active
              </span>
              {ctx.install.kadence_version && (
                <span className="ml-2 text-xs text-muted-foreground">
                  v{ctx.install.kadence_version}
                </span>
              )}
            </p>
            <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
              <div>
                <dt className="inline">Detected:</dt>{" "}
                <dd className="inline">
                  {kadenceInstalledAt
                    ? new Date(kadenceInstalledAt).toLocaleString()
                    : "(just now)"}
                </dd>
              </div>
              <div>
                <dt className="inline">Last synced:</dt>{" "}
                <dd className="inline">
                  {kadenceGlobalsSyncedAt
                    ? new Date(kadenceGlobalsSyncedAt).toLocaleString()
                    : "Never"}
                </dd>
              </div>
            </dl>
          </div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onRecheck}
            disabled={actionState !== "idle"}
          >
            {actionState === "rechecking" ? "Re-checking…" : "Re-check"}
          </Button>
        </div>
      </div>

      {insufficientProposal && (
        <div
          role="alert"
          className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-4 text-sm text-yellow-900 dark:text-yellow-200"
        >
          <p className="font-medium">
            Active design system doesn&apos;t have enough colors for a Kadence
            palette.
          </p>
          <p className="mt-1">
            Kadence wants 8 palette slots. The active DS exposes{" "}
            <span className="font-mono">
              {ctx.proposal.available_color_count}
            </span>{" "}
            color tokens. Add more colors to <code>tokens.css</code> or
            declare explicit <code>--&lt;prefix&gt;-palette-1</code> through{" "}
            <code>--&lt;prefix&gt;-palette-8</code> tokens to opt into a
            specific slot mapping.
          </p>
        </div>
      )}

      {!insufficientProposal && (
        <section aria-labelledby="diff-heading">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="diff-heading" className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
              Proposed palette
            </h2>
            {ctx.already_synced ? (
              <span className="inline-flex rounded bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700">
                Already synced
              </span>
            ) : (
              <span className="inline-flex rounded bg-yellow-500/10 px-2 py-0.5 text-xs font-medium text-yellow-900 dark:text-yellow-200">
                {ctx.diff.entries.filter((e) => e.changed).length} slot
                {ctx.diff.entries.filter((e) => e.changed).length === 1 ? "" : "s"} pending
              </span>
            )}
          </div>
          <KadencePaletteDiffTable diff={ctx.diff} />
          <p className="mt-2 text-xs text-muted-foreground">
            Source:{" "}
            <span className="font-mono">{ctx.proposal.source}</span>
            {ctx.proposal.source === "explicit" &&
              " — DS declared 8 explicit --<prefix>-palette-N slots"}
            {ctx.proposal.source === "ordered_hex" &&
              ` — first 8 of ${ctx.proposal.available_color_count} hex tokens in declaration order`}
          </p>
        </section>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {canRollback && (
          <Button
            type="button"
            variant="outline"
            onClick={onRollbackClick}
            disabled={actionState !== "idle"}
          >
            Rollback to last snapshot
          </Button>
        )}
        {canSync && (
          <Button
            type="button"
            onClick={onSyncClick}
            disabled={actionState !== "idle"}
          >
            {ctx.already_synced ? "Re-sync palette" : "Sync palette to WordPress"}
          </Button>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Confirm modals
// ---------------------------------------------------------------------------

function SyncConfirmModal({
  wpDisplayUrl,
  diff,
  alreadySynced,
  onCancel,
  onConfirm,
  submitting,
}: {
  wpDisplayUrl: string;
  diff: PaletteDiff;
  alreadySynced: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  submitting: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sync-confirm-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onCancel();
      }}
    >
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border bg-background p-6 shadow-lg">
        <h2 id="sync-confirm-title" className="text-lg font-semibold">
          Sync palette to WordPress?
        </h2>
        <div className="mt-3 space-y-3 text-sm text-muted-foreground">
          {alreadySynced ? (
            <p>
              The current Kadence palette already matches your DS. Re-syncing
              writes the same value to{" "}
              <span className="font-mono text-foreground">{wpDisplayUrl}</span>{" "}
              and records a fresh audit entry. Useful for verifying your write
              path before something riskier — otherwise no operator-visible
              change.
            </p>
          ) : (
            <p>
              This overwrites the Kadence color palette on{" "}
              <span className="font-mono text-foreground">{wpDisplayUrl}</span>{" "}
              with your active design system&apos;s palette. Any operator
              edits made through WP Admin → Customizer → Global Colors since
              the last sync will be lost.
            </p>
          )}
          <p>
            We snapshot the current palette before writing — you can roll
            back to it from this panel if needed.
          </p>
        </div>

        <div className="mt-5">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Slot-by-slot changes
          </h3>
          <KadencePaletteDiffTable diff={diff} />
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button type="button" onClick={onConfirm} disabled={submitting}>
            {submitting
              ? "Syncing…"
              : alreadySynced
                ? "Re-sync anyway"
                : "Sync palette"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function RollbackConfirmModal({
  wpDisplayUrl,
  lastSyncEvent,
  onCancel,
  onConfirm,
  submitting,
}: {
  wpDisplayUrl: string;
  lastSyncEvent: AppearanceEventRow | null;
  onCancel: () => void;
  onConfirm: () => void;
  submitting: boolean;
}) {
  const lastSyncDate = lastSyncEvent
    ? new Date(lastSyncEvent.created_at).toLocaleString()
    : null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rollback-confirm-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onCancel();
      }}
    >
      <div className="w-full max-w-lg rounded-lg border bg-background p-6 shadow-lg">
        <h2
          id="rollback-confirm-title"
          className="text-lg font-semibold text-destructive"
        >
          Rollback palette to last snapshot?
        </h2>
        <div className="mt-3 space-y-3 text-sm text-muted-foreground">
          <p>
            This restores the Kadence palette on{" "}
            <span className="font-mono text-foreground">{wpDisplayUrl}</span>{" "}
            to the snapshot taken before the last sync
            {lastSyncDate ? <> on {lastSyncDate}</> : ""}.
          </p>
          <p>
            Any palette changes made since the last sync (including the sync
            itself) are reverted. This is destructive — operator edits in
            WP Customizer made between syncs will also be reverted.
          </p>
          <p>
            If your current palette already matches the snapshot, the rollback
            is a no-op + records an audit entry only.
          </p>
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={submitting}
          >
            {submitting ? "Rolling back…" : "Rollback"}
          </Button>
        </div>
      </div>
    </div>
  );
}
