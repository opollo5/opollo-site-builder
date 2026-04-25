"use client";

import type { AppearanceEventRow } from "@/lib/appearance-events";

// ---------------------------------------------------------------------------
// M13-5d — audit-event log section for the Appearance panel.
//
// Renders the most recent N events newest-first. Each row collapses
// into a one-liner; click to expand the raw details JSON for incident
// reconstruction.
// ---------------------------------------------------------------------------

const EVENT_PRESENTATION: Record<
  string,
  { label: string; cls: string; summary: (details: Record<string, unknown>) => string }
> = {
  preflight_run: {
    label: "Preflight",
    cls: "bg-muted text-muted-foreground",
    summary: (details) => {
      const outcome = (details.outcome as string | undefined) ?? "ran";
      if (outcome === "blocked") {
        const code = (details.blocker_code as string | undefined) ?? "unknown";
        return `Blocked: ${code}`;
      }
      if (outcome === "ready") {
        const stamped =
          (details.stamped_first_detection as boolean | undefined) ?? false;
        return stamped
          ? "Ready · first-detection stamped"
          : "Ready";
      }
      return outcome;
    },
  },
  globals_dry_run: {
    label: "Dry-run",
    cls: "bg-primary/10 text-primary",
    summary: (details) => {
      const note = details.note as string | undefined;
      if (note) return note;
      const anyChanges = (details.any_changes as boolean | undefined) ?? false;
      return anyChanges ? "Diff previewed" : "No changes pending";
    },
  },
  globals_confirmed: {
    label: "Sync intent",
    cls: "bg-primary/10 text-primary",
    summary: (details) => {
      const slots = (details.changed_slots as string[] | undefined) ?? [];
      return slots.length > 0
        ? `Operator confirmed ${slots.length} slot change${slots.length === 1 ? "" : "s"}`
        : "Operator confirmed sync";
    },
  },
  globals_completed: {
    label: "Synced",
    cls: "bg-emerald-500/10 text-emerald-700",
    summary: (details) => {
      const roundTrip = (details.round_trip_ok as boolean | undefined) ?? true;
      return roundTrip
        ? "Palette synced to WP"
        : "Palette synced (round-trip mismatch — see details)";
    },
  },
  globals_failed: {
    label: "Sync failed",
    cls: "bg-destructive/10 text-destructive",
    summary: (details) => {
      const stage = (details.stage as string | undefined) ?? "unknown";
      const wp = details.wp_code as string | undefined;
      return wp ? `Failed at ${stage} (${wp})` : `Failed at ${stage}`;
    },
  },
  rollback_requested: {
    label: "Rollback intent",
    cls: "bg-primary/10 text-primary",
    summary: (details) => {
      const outcome = (details.outcome as string | undefined) ?? "will_write";
      return outcome === "already_rolled_back"
        ? "No-op — palette already matched snapshot"
        : "Operator requested rollback";
    },
  },
  rollback_completed: {
    label: "Rolled back",
    cls: "bg-emerald-500/10 text-emerald-700",
    summary: () => "Palette restored to prior snapshot",
  },
  rollback_failed: {
    label: "Rollback failed",
    cls: "bg-destructive/10 text-destructive",
    summary: (details) => {
      const reason = (details.reason as string | undefined) ?? "unknown";
      return `Failed: ${reason}`;
    },
  },
  install_dry_run: { label: "Install dry-run", cls: "bg-muted text-muted-foreground", summary: () => "—" },
  install_confirmed: { label: "Install confirmed", cls: "bg-muted text-muted-foreground", summary: () => "—" },
  install_completed: { label: "Install completed", cls: "bg-muted text-muted-foreground", summary: () => "—" },
  install_failed: { label: "Install failed", cls: "bg-destructive/10 text-destructive", summary: () => "—" },
};

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

export function AppearanceEventLog({
  events,
}: {
  events: AppearanceEventRow[];
}) {
  if (events.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No appearance activity yet. Events appear here as you preflight,
        sync, or roll back.
      </p>
    );
  }

  return (
    <ol className="space-y-2">
      {events.map((event) => (
        <EventRow key={event.id} event={event} />
      ))}
    </ol>
  );
}

function EventRow({ event }: { event: AppearanceEventRow }) {
  const present = EVENT_PRESENTATION[event.event] ?? {
    label: event.event,
    cls: "bg-muted text-muted-foreground",
    summary: () => "(unknown event)",
  };
  const summary = present.summary(
    (event.details as Record<string, unknown>) ?? {},
  );
  return (
    <li className="rounded border p-3">
      <details className="group">
        <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
          <span
            className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${present.cls}`}
          >
            {present.label}
          </span>
          <span className="flex-1 text-foreground">{summary}</span>
          <time
            className="text-xs text-muted-foreground"
            dateTime={event.created_at}
          >
            {formatTimestamp(event.created_at)}
          </time>
        </summary>
        <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 text-[11px]">
          {JSON.stringify(event.details, null, 2)}
        </pre>
      </details>
    </li>
  );
}
