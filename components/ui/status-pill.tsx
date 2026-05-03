import * as React from "react";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// A-4 — StatusPill primitive.
//
// Wraps Badge with semantic per-domain mapping. Consumers pass a
// status string from one of the seven domain taxonomies below and the
// pill resolves to the canonical (label, tone, animation) tuple.
// Replaces 31+ hand-rolled `bg-emerald-500/10 text-emerald-700`
// instances across the codebase.
//
// Adding a new domain status:
//   1. Add the string to the kind union below.
//   2. Add a mapping row in STATUS_MAP.
//   3. Verify the Badge tone exists in components/ui/badge.tsx.
// ---------------------------------------------------------------------------

export type StatusKind =
  // Brief lifecycle (briefs.status)
  | "brief_parsing"
  | "brief_parsed"
  | "brief_committed"
  | "brief_failed_parse"
  // Brief run (brief_runs.status)
  | "run_queued"
  | "run_running"
  | "run_paused"
  | "run_succeeded"
  | "run_failed"
  | "run_cancelled"
  // Brief page (brief_pages.page_status)
  | "page_pending"
  | "page_generating"
  | "page_awaiting_review"
  | "page_approved"
  | "page_failed"
  | "page_skipped"
  // Site lifecycle (sites.status)
  | "site_active"
  | "site_pending_pairing"
  | "site_paused"
  | "site_removed"
  // Generation job (generation_jobs.status)
  | "job_queued"
  | "job_running"
  | "job_partial"
  | "job_succeeded"
  | "job_failed"
  | "job_cancelled"
  // Post lifecycle (posts.status)
  | "post_draft"
  | "post_published"
  | "post_scheduled"
  // Image source (image_library.source)
  | "image_istock"
  | "image_upload"
  | "image_generated"
  // Slot state (generation_jobs.slots[].state)
  | "slot_pending"
  | "slot_leased"
  | "slot_generating"
  | "slot_validating"
  | "slot_publishing"
  | "slot_succeeded"
  | "slot_failed"
  | "slot_skipped"
  // Appearance event (appearance_events.event)
  | "appearance_install_started"
  | "appearance_install_completed"
  | "appearance_install_failed"
  | "appearance_globals_started"
  | "appearance_globals_completed"
  | "appearance_globals_failed"
  | "appearance_palette_started"
  | "appearance_palette_completed"
  | "appearance_palette_failed"
  // Design system (design_systems.status)
  | "ds_draft"
  | "ds_active"
  | "ds_archived"
  // Quality flag (brief_pages.quality_flag)
  | "quality_cost_ceiling"
  | "quality_capped_with_issues";

interface StatusEntry {
  label: string;
  tone: NonNullable<BadgeProps["tone"]>;
  /** When true, the pill applies .animate-pulse for in-progress states. */
  pulse?: boolean;
}

const STATUS_MAP: Record<StatusKind, StatusEntry> = {
  // Brief
  brief_parsing: { label: "Parsing", tone: "neutral", pulse: true },
  brief_parsed: { label: "Parsed", tone: "info" },
  brief_committed: { label: "Committed", tone: "success" },
  brief_failed_parse: { label: "Parse failed", tone: "error" },

  // Run
  run_queued: { label: "Queued — waiting for runner", tone: "primary", pulse: true },
  run_running: { label: "Running", tone: "primary", pulse: true },
  run_paused: { label: "Awaiting your review", tone: "warning" },
  run_succeeded: { label: "Complete", tone: "success" },
  run_failed: { label: "Failed", tone: "error" },
  run_cancelled: { label: "Cancelled", tone: "neutral" },

  // Page
  page_pending: { label: "Pending", tone: "neutral" },
  page_generating: { label: "Generating", tone: "primary", pulse: true },
  page_awaiting_review: { label: "Awaiting review", tone: "warning" },
  page_approved: { label: "Approved", tone: "success" },
  page_failed: { label: "Failed", tone: "error" },
  page_skipped: { label: "Skipped", tone: "neutral" },

  // Site
  site_active: { label: "Connected", tone: "success" },
  // UAT (2026-05-03) — "pending pairing" is internal jargon. Operators
  // see this on every freshly-added site that hasn't yet had its WP
  // credentials saved + verified, so rename to "Setup incomplete".
  // Tone left neutral because it isn't a problem — it's a "next action
  // lives here" state.
  site_pending_pairing: { label: "Setup incomplete", tone: "neutral" },
  site_paused: { label: "Paused", tone: "warning" },
  site_removed: { label: "Removed", tone: "error" },

  // Job
  job_queued: { label: "queued", tone: "neutral" },
  job_running: { label: "running", tone: "primary", pulse: true },
  job_partial: { label: "partial", tone: "warning" },
  job_succeeded: { label: "succeeded", tone: "success" },
  job_failed: { label: "failed", tone: "error" },
  job_cancelled: { label: "cancelled", tone: "neutral" },

  // Post
  post_draft: { label: "draft", tone: "neutral" },
  post_published: { label: "published", tone: "success" },
  post_scheduled: { label: "scheduled", tone: "info" },

  // Image
  image_istock: { label: "iStock", tone: "info" },
  image_upload: { label: "Upload", tone: "warning" },
  image_generated: { label: "Generated", tone: "primary" },

  // Slot
  slot_pending: { label: "pending", tone: "neutral" },
  slot_leased: { label: "leased", tone: "primary", pulse: true },
  slot_generating: { label: "generating", tone: "primary", pulse: true },
  slot_validating: { label: "validating", tone: "primary", pulse: true },
  slot_publishing: { label: "publishing", tone: "primary", pulse: true },
  slot_succeeded: { label: "succeeded", tone: "success" },
  slot_failed: { label: "failed", tone: "error" },
  slot_skipped: { label: "skipped", tone: "neutral" },

  // Appearance
  appearance_install_started: { label: "Install started", tone: "primary", pulse: true },
  appearance_install_completed: { label: "Install completed", tone: "success" },
  appearance_install_failed: { label: "Install failed", tone: "error" },
  appearance_globals_started: { label: "Globals started", tone: "primary", pulse: true },
  appearance_globals_completed: { label: "Globals completed", tone: "success" },
  appearance_globals_failed: { label: "Globals failed", tone: "error" },
  appearance_palette_started: { label: "Palette started", tone: "primary", pulse: true },
  appearance_palette_completed: { label: "Palette completed", tone: "success" },
  appearance_palette_failed: { label: "Palette failed", tone: "error" },

  // Design system
  ds_draft: { label: "draft", tone: "neutral" },
  ds_active: { label: "active", tone: "success" },
  ds_archived: { label: "archived", tone: "neutral" },

  // Quality flag
  quality_cost_ceiling: { label: "Cost ceiling hit", tone: "warning" },
  quality_capped_with_issues: { label: "Capped with issues", tone: "warning" },
};

export interface StatusPillProps
  extends Omit<BadgeProps, "tone" | "children"> {
  kind: StatusKind;
  /** Override the default label (rare — mostly when you want to add ordinal info, e.g. "Page 3 awaiting review"). */
  label?: React.ReactNode;
}

export const StatusPill = React.forwardRef<HTMLSpanElement, StatusPillProps>(
  function StatusPill({ kind, label, className, ...props }, ref) {
    const entry = STATUS_MAP[kind];
    return (
      <Badge
        ref={ref}
        tone={entry.tone}
        className={cn(entry.pulse && "animate-pulse", className)}
        {...props}
      >
        {label ?? entry.label}
      </Badge>
    );
  },
);

// ---------------------------------------------------------------------------
// Domain → kind mappers. Consumers can either pass `kind="run_paused"`
// directly or use the mapper that matches their domain shape.
// ---------------------------------------------------------------------------

export function briefStatusKind(
  status: "parsing" | "parsed" | "committed" | "failed_parse",
): StatusKind {
  return `brief_${status}` as StatusKind;
}

export function runStatusKind(
  status:
    | "queued"
    | "running"
    | "paused"
    | "succeeded"
    | "failed"
    | "cancelled",
): StatusKind {
  return `run_${status}` as StatusKind;
}

export function pageStatusKind(
  status:
    | "pending"
    | "generating"
    | "awaiting_review"
    | "approved"
    | "failed"
    | "skipped",
): StatusKind {
  return `page_${status}` as StatusKind;
}

export function siteStatusKind(
  status: "active" | "pending_pairing" | "paused" | "removed",
): StatusKind {
  return `site_${status}` as StatusKind;
}

export function jobStatusKind(
  status:
    | "queued"
    | "running"
    | "partial"
    | "succeeded"
    | "failed"
    | "cancelled",
): StatusKind {
  return `job_${status}` as StatusKind;
}

export function postStatusKind(
  status: "draft" | "published" | "scheduled",
): StatusKind {
  return `post_${status}` as StatusKind;
}

export function imageSourceKind(
  source: "istock" | "upload" | "generated",
): StatusKind {
  return `image_${source}` as StatusKind;
}

export function slotStateKind(
  state:
    | "pending"
    | "leased"
    | "generating"
    | "validating"
    | "publishing"
    | "succeeded"
    | "failed"
    | "skipped",
): StatusKind {
  return `slot_${state}` as StatusKind;
}

export function dsStatusKind(
  status: "draft" | "active" | "archived",
): StatusKind {
  return `ds_${status}` as StatusKind;
}
