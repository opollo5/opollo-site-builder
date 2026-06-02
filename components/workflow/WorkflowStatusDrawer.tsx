"use client";

import { useEffect, useState } from "react";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { GateType, WorkflowGateWithApprovers } from "@/lib/platform/workflow/types";

// ---------------------------------------------------------------------------
// WorkflowStatusDrawer — vertical approval-workflow spine.
//
// Slides in from the right using the existing Sheet primitive.
// Fetches gate config from GET /api/platform/companies/[id]/workflow-gates
// on open; derives per-stage status from approvalStatus + workflowState.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkflowStatusDrawerProps {
  open: boolean;
  onClose: () => void;
  companyId: string;
  // Batch context (when opened from batch results):
  batchId?: string;
  approvalStatus?: string | null;
  reviewRound?: number | null;
  // Draft context (future use):
  draftId?: string;
  workflowState?: string | null;
}

type StageStatus = "done" | "active" | "waiting" | "rejected" | "escalated";

type VirtualGateType = GateType | "scheduled";

interface Stage {
  key: VirtualGateType;
  label: string;
  status: StageStatus;
  passRule?: string;
  reviewRound?: number | null;
  approvers: Array<{ id: string; platformUserId: string | null; externalEmail: string | null }>;
  autoSchedule?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STAGE_LABELS: Record<VirtualGateType, string> = {
  copy_review: "Copy review",
  image_review: "Image review",
  final_signoff: "Final sign-off",
  scheduled: "Scheduled",
};

const PASS_RULE_LABELS: Record<string, string> = {
  all_must: "All must approve",
  any_one: "Any one",
};

// ---------------------------------------------------------------------------
// Stage status derivation
// ---------------------------------------------------------------------------

function deriveStages(
  gates: WorkflowGateWithApprovers[],
  approvalStatus: string | null | undefined,
  reviewRound: number | null | undefined,
  workflowState: string | null | undefined,
): Stage[] {
  const enabledGates = gates.filter((g) => g.enabled);
  const stages: Stage[] = [];

  // Determine image_review status — the only Phase 1 wired gate.
  const imageGateDone =
    approvalStatus === "approved";
  const imageGateActive =
    approvalStatus === "pending_review";

  for (const gate of enabledGates) {
    let status: StageStatus = "waiting";

    if (gate.gateType === "image_review") {
      if (approvalStatus === "pending_review") status = "active";
      else if (approvalStatus === "approved") status = "done";
      else if (approvalStatus === "rejected") status = "rejected";
      else if (approvalStatus === "escalated_to_admin") status = "escalated";
      else status = "waiting";
    } else if (gate.gateType === "copy_review") {
      // Not wired in Phase 1 — always waiting.
      status = "waiting";
    } else if (gate.gateType === "final_signoff") {
      // Active only after image gate done (and image gate is not active/rejected).
      if (imageGateDone && !imageGateActive) status = "active";
      else status = "waiting";
    }

    stages.push({
      key: gate.gateType,
      label: STAGE_LABELS[gate.gateType],
      status,
      passRule: gate.passRule,
      reviewRound: gate.gateType === "image_review" ? (reviewRound ?? null) : null,
      approvers: gate.approvers,
      autoSchedule: gate.autoSchedule,
    });
  }

  // Always add Scheduled as the final stage.
  let scheduledStatus: StageStatus = "waiting";
  if (workflowState === "scheduled" || workflowState === "published") {
    scheduledStatus = "done";
  } else if (workflowState === "ready_to_schedule") {
    scheduledStatus = "active";
  }

  // Find if any enabled gate has autoSchedule — surface it on the Scheduled stage.
  const anyAutoSchedule = enabledGates.some((g) => g.autoSchedule);

  stages.push({
    key: "scheduled",
    label: STAGE_LABELS.scheduled,
    status: scheduledStatus,
    approvers: [],
    autoSchedule: anyAutoSchedule,
  });

  return stages;
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

interface StatusBadgeProps {
  status: StageStatus;
  label?: string;
}

function StatusBadge({ status, label }: StatusBadgeProps) {
  const display = label ?? status;
  const classes: Record<StageStatus, string> = {
    done: "bg-green-100 text-green-700",
    active: "bg-blue-100 text-blue-700",
    waiting: "bg-m2 text-tx-muted",
    rejected: "bg-red-100 text-red-700",
    escalated: "bg-amber-100 text-amber-700",
  };
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-medium capitalize",
        classes[status],
      )}
    >
      {display === "escalated_to_admin" ? "escalated" : display}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Stage circle icon
// ---------------------------------------------------------------------------

interface StageCircleProps {
  status: StageStatus;
}

function StageCircle({ status }: StageCircleProps) {
  // done: filled green + checkmark
  if (status === "done") {
    return (
      <div className="relative flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-green-500 text-white">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    );
  }
  // rejected: filled red + X
  if (status === "rejected") {
    return (
      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-red-500 text-white">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
    );
  }
  // escalated: orange warning
  if (status === "escalated") {
    return (
      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-amber-500 text-white">
        <svg width="10" height="12" viewBox="0 0 10 12" fill="none" aria-hidden="true">
          <path d="M5 2v5M5 9.5v.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
    );
  }
  // active: filled blue with pulsing ring
  if (status === "active") {
    return (
      <div className="relative flex h-7 w-7 flex-shrink-0 items-center justify-center">
        {/* Pulsing ring */}
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-50" />
        <div className="relative flex h-7 w-7 items-center justify-center rounded-full bg-blue-500" />
      </div>
    );
  }
  // waiting: grey outline circle
  return (
    <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border-2 border-b2 bg-bg-base" />
  );
}

// ---------------------------------------------------------------------------
// Approver pills
// ---------------------------------------------------------------------------

interface ApproverListProps {
  approvers: Stage["approvers"];
}

function ApproverList({ approvers }: ApproverListProps) {
  if (approvers.length === 0) return null;
  const visible = approvers.slice(0, 3);
  const overflow = approvers.length - visible.length;

  function initials(approver: Stage["approvers"][number]): string {
    if (approver.externalEmail) {
      return approver.externalEmail.slice(0, 2).toUpperCase();
    }
    // platformUserId has no display name here — show a person icon placeholder.
    return "P";
  }

  function displayLabel(approver: Stage["approvers"][number]): string {
    return approver.externalEmail ?? `User ${(approver.platformUserId ?? "").slice(0, 6)}`;
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      {visible.map((a) => (
        <span
          key={a.id}
          className="flex items-center gap-1 rounded-full border border-b1 bg-m1 px-2 py-0.5 text-xs text-tx-secondary"
          title={displayLabel(a)}
        >
          <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-m3 text-xs font-semibold text-tx-primary">
            {initials(a)}
          </span>
          <span className="max-w-[120px] truncate">{displayLabel(a)}</span>
        </span>
      ))}
      {overflow > 0 && (
        <span className="rounded-full border border-b1 bg-m1 px-2 py-0.5 text-xs text-tx-muted">
          +{overflow} more
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stage row
// ---------------------------------------------------------------------------

interface StageRowProps {
  stage: Stage;
  isLast: boolean;
}

function StageRow({ stage, isLast }: StageRowProps) {
  return (
    <div className="flex gap-3" data-testid={`stage-row-${stage.key}`}>
      {/* Left: circle + vertical connector */}
      <div className="flex flex-col items-center">
        <StageCircle status={stage.status} />
        {!isLast && (
          <div className="mt-1 flex-1 border-l-2 border-b1" style={{ minHeight: "2rem" }} />
        )}
      </div>

      {/* Right: content */}
      <div className={cn("pb-5 flex-1 min-w-0", isLast && "pb-0")}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-sm text-tx-primary">{stage.label}</span>
          <StatusBadge status={stage.status} />
        </div>

        {/* Pass rule + round info */}
        {stage.passRule && (
          <p className="text-xs text-tx-muted mt-0.5">
            {PASS_RULE_LABELS[stage.passRule] ?? stage.passRule}
            {stage.key === "image_review" &&
              stage.reviewRound !== null &&
              stage.reviewRound !== undefined &&
              (stage.status === "active" || stage.status === "rejected") && (
                <span className="ml-2">· Round {stage.reviewRound + 1} of 3</span>
              )}
          </p>
        )}

        {/* Auto-schedule note on the Scheduled stage */}
        {stage.key === "scheduled" && stage.autoSchedule && (
          <p className="text-xs text-tx-muted mt-0.5">Auto-schedule on</p>
        )}

        {/* Approvers */}
        <ApproverList approvers={stage.approvers} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WorkflowStatusDrawer
// ---------------------------------------------------------------------------

export function WorkflowStatusDrawer({
  open,
  onClose,
  companyId,
  approvalStatus,
  reviewRound,
  workflowState,
}: WorkflowStatusDrawerProps) {
  const [gates, setGates] = useState<WorkflowGateWithApprovers[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    fetch(`/api/platform/companies/${companyId}/workflow-gates`)
      .then((r) => r.json())
      .then((d: { ok: boolean; data?: { gates: WorkflowGateWithApprovers[] } }) => {
        if (d.ok && d.data) setGates(d.data.gates);
        else setError("Failed to load workflow config.");
      })
      .catch(() => setError("Network error."))
      .finally(() => setLoading(false));
  }, [open, companyId]);

  const stages =
    gates.length > 0 || !loading
      ? deriveStages(gates, approvalStatus, reviewRound, workflowState)
      : [];

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent data-testid="workflow-status-drawer">
        <SheetHeader>
          <SheetTitle>Approval workflow</SheetTitle>
        </SheetHeader>

        <div className="px-6 py-4">
          {loading ? (
            <div className="space-y-4" aria-label="Loading workflow stages">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex gap-3">
                  <div className="h-7 w-7 flex-shrink-0 animate-pulse rounded-full bg-m2" />
                  <div className="flex-1 space-y-2 pt-1">
                    <div className="h-3 w-32 animate-pulse rounded bg-m2" />
                    <div className="h-2 w-24 animate-pulse rounded bg-m2" />
                  </div>
                </div>
              ))}
            </div>
          ) : error ? (
            <p className="text-sm text-destructive" data-testid="workflow-error">{error}</p>
          ) : stages.length === 0 ? (
            <p className="text-sm text-tx-muted" data-testid="workflow-empty">
              No workflow stages configured.
            </p>
          ) : (
            <div data-testid="workflow-stage-list">
              {stages.map((stage, i) => (
                <StageRow
                  key={stage.key}
                  stage={stage}
                  isLast={i === stages.length - 1}
                />
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
