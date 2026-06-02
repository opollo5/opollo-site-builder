"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { GateType, PassRule, WorkflowGateWithApprovers } from "@/lib/platform/workflow/types";

// ---------------------------------------------------------------------------
// WorkflowGatesTab
//
// Admin UI for configuring the three workflow gates on a company.
// Fetches: GET /api/platform/companies/{id}/workflow-gates
// Saves:   PUT /api/platform/companies/{id}/workflow-gates  (all 3 together)
// ---------------------------------------------------------------------------

export interface WorkflowGatesMember {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface Props {
  companyId: string;
  members: WorkflowGatesMember[];
}

// ---------------------------------------------------------------------------
// Per-gate local state (before / after PUT)
// ---------------------------------------------------------------------------

interface ApproverDraft {
  /** Stable key for React list rendering. */
  key: string;
  platformUserId?: string;
  externalEmail?: string;
  /** Display label shown in the chip. */
  label: string;
}

interface GateDraft {
  gateType: GateType;
  enabled: boolean;
  passRule: PassRule;
  timeoutDays: number;
  autoSchedule: boolean;
  approvers: ApproverDraft[];
  /** True if the user has made changes since the last successful save. */
  dirty: boolean;
}

// Gate display metadata (deterministic order)
const GATE_META: { gateType: GateType; title: string; description: string }[] =
  [
    {
      gateType: "copy_review",
      title: "Copy review",
      description: "Content review before image generation",
    },
    {
      gateType: "image_review",
      title: "Image review",
      description: "Client reviews generated images",
    },
    {
      gateType: "final_signoff",
      title: "Final sign-off",
      description: "Final approval before scheduling",
    },
  ];

const PASS_RULE_OPTIONS: { value: PassRule; label: string }[] = [
  { value: "any_one", label: "Any one approver" },
  { value: "all_must", label: "All approvers must approve" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function gateFromApi(gate: WorkflowGateWithApprovers): GateDraft {
  return {
    gateType: gate.gateType,
    enabled: gate.enabled,
    passRule: gate.passRule,
    timeoutDays: gate.timeoutDays,
    autoSchedule: gate.autoSchedule,
    approvers: gate.approvers.map((a) => ({
      key: a.id,
      platformUserId: a.platformUserId ?? undefined,
      externalEmail: a.externalEmail ?? undefined,
      label: a.externalEmail ?? a.platformUserId ?? a.id,
    })),
    dirty: false,
  };
}

function defaultGate(gateType: GateType): GateDraft {
  return {
    gateType,
    enabled: false,
    passRule: "any_one",
    timeoutDays: 14,
    autoSchedule: false,
    approvers: [],
    dirty: false,
  };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function WorkflowGatesTab({ companyId, members }: Props) {
  const [gates, setGates] = useState<GateDraft[]>(() =>
    GATE_META.map((m) => defaultGate(m.gateType)),
  );
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Fetch on mount
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setFetchError(null);
      try {
        const res = await fetch(
          `/api/platform/companies/${companyId}/workflow-gates`,
        );
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json = (await res.json()) as {
          ok: boolean;
          data: { gates: WorkflowGateWithApprovers[] };
        };
        if (!cancelled) {
          // Merge API gates into our ordered list, keeping defaults for
          // any gate not yet persisted to the DB.
          const apiByType = Object.fromEntries(
            json.data.gates.map((g) => [g.gateType, g]),
          ) as Partial<Record<GateType, WorkflowGateWithApprovers>>;

          setGates(
            GATE_META.map((m) => {
              const apiGate = apiByType[m.gateType];
              return apiGate ? gateFromApi(apiGate) : defaultGate(m.gateType);
            }),
          );
        }
      } catch (err) {
        if (!cancelled) {
          setFetchError(
            err instanceof Error ? err.message : "Failed to load gates",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  // Update a single gate's draft, marking it dirty
  const updateGate = useCallback(
    (gateType: GateType, patch: Partial<Omit<GateDraft, "gateType">>) => {
      setGates((prev) =>
        prev.map((g) =>
          g.gateType === gateType ? { ...g, ...patch, dirty: true } : g,
        ),
      );
    },
    [],
  );

  // PUT all three gates; returns the saved gates from the API on success
  const saveGates = useCallback(
    async (gateType: GateType) => {
      const body = gates.map((g) => ({
        gateType: g.gateType,
        enabled: g.enabled,
        passRule: g.passRule,
        timeoutDays: g.timeoutDays,
        autoSchedule: g.autoSchedule,
        approvers: g.approvers.map((a) => ({
          ...(a.platformUserId ? { platformUserId: a.platformUserId } : {}),
          ...(a.externalEmail ? { externalEmail: a.externalEmail } : {}),
        })),
      }));

      const res = await fetch(
        `/api/platform/companies/${companyId}/workflow-gates`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Save failed (${res.status}): ${text}`);
      }
      const json = (await res.json()) as {
        ok: boolean;
        data: { gates: WorkflowGateWithApprovers[] };
      };
      // Refresh all gates from response
      const apiByType = Object.fromEntries(
        json.data.gates.map((g) => [g.gateType, g]),
      ) as Partial<Record<GateType, WorkflowGateWithApprovers>>;

      setGates((prev) =>
        prev.map((g) => {
          const saved = apiByType[g.gateType];
          return saved ? { ...gateFromApi(saved), dirty: false } : { ...g, dirty: false };
        }),
      );
      return gateType;
    },
    [companyId, gates],
  );

  if (loading) {
    return (
      <div
        className="flex items-center justify-center py-12 text-sm text-muted-foreground"
        data-testid="workflow-gates-loading"
      >
        Loading gate configuration…
      </div>
    );
  }

  if (fetchError) {
    return (
      <div
        className="rounded-xl border border-destructive/40 bg-destructive/5 p-5 text-sm text-destructive"
        data-testid="workflow-gates-error"
      >
        Failed to load workflow gates: {fetchError}
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="workflow-gates-tab">
      {GATE_META.map((meta, idx) => {
        const gate = gates[idx];
        if (!gate) return null;
        return (
          <GateConfigCard
            key={meta.gateType}
            meta={meta}
            gate={gate}
            allGates={gates}
            members={members}
            onUpdate={(patch) => updateGate(meta.gateType, patch)}
            onSave={() => saveGates(meta.gateType)}
          />
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// GateConfigCard
// ---------------------------------------------------------------------------

interface GateConfigCardProps {
  meta: (typeof GATE_META)[number];
  gate: GateDraft;
  allGates: GateDraft[];
  members: WorkflowGatesMember[];
  onUpdate: (patch: Partial<Omit<GateDraft, "gateType">>) => void;
  onSave: () => Promise<GateType>;
}

type SaveState = "idle" | "saving" | "saved" | "error";

function GateConfigCard({
  meta,
  gate,
  members,
  onUpdate,
  onSave,
}: GateConfigCardProps) {
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // External email add state
  const [externalEmailInput, setExternalEmailInput] = useState("");
  const [externalEmailError, setExternalEmailError] = useState<string | null>(
    null,
  );

  async function handleSave() {
    setSaveState("saving");
    setSaveError(null);
    try {
      await onSave();
      setSaveState("saved");
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setSaveState("idle"), 2500);
    } catch (err) {
      setSaveState("error");
      setSaveError(
        err instanceof Error ? err.message : "Unexpected error saving gates",
      );
    }
  }

  function addExternalApprover() {
    const email = externalEmailInput.trim();
    if (!isValidEmail(email)) {
      setExternalEmailError("Please enter a valid email address.");
      return;
    }
    // Prevent duplicates
    if (gate.approvers.some((a) => a.externalEmail === email)) {
      setExternalEmailError("This email is already an approver.");
      return;
    }
    onUpdate({
      approvers: [
        ...gate.approvers,
        {
          key: `ext-${email}-${Date.now()}`,
          externalEmail: email,
          label: email,
        },
      ],
    });
    setExternalEmailInput("");
    setExternalEmailError(null);
  }

  function removeApprover(key: string) {
    onUpdate({ approvers: gate.approvers.filter((a) => a.key !== key) });
  }

  // Members already added to this gate (by platformUserId)
  const addedMemberIds = new Set(
    gate.approvers
      .map((a) => a.platformUserId)
      .filter((id): id is string => id !== undefined),
  );

  // Internal members eligible to add: role approver or admin, not already added
  const eligibleMembers = members.filter(
    (m) =>
      (m.role === "approver" || m.role === "admin") &&
      !addedMemberIds.has(m.id),
  );

  const isDisabled = !gate.enabled;

  return (
    <article
      className={cn(
        "rounded-xl border border-border p-5 space-y-4 transition-colors",
        isDisabled ? "bg-muted/30" : "bg-card",
      )}
      data-testid={`gate-card-${gate.gateType}`}
    >
      {/* Header: title + enable toggle */}
      <header className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold leading-tight">{meta.title}</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {meta.description}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm text-muted-foreground">
            {gate.enabled ? "Enabled" : "Disabled"}
          </span>
          <Switch
            checked={gate.enabled}
            onCheckedChange={(checked) => onUpdate({ enabled: checked })}
            label={`${gate.enabled ? "Disable" : "Enable"} ${meta.title} gate`}
            data-testid={`gate-toggle-${gate.gateType}`}
          />
        </div>
      </header>

      {/* Body — only shown when enabled */}
      {gate.enabled && (
        <div className="space-y-5">
          {/* Pass rule + timeout */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label
                htmlFor={`pass-rule-${gate.gateType}`}
                className="text-sm font-medium"
              >
                Pass rule
              </label>
              <select
                id={`pass-rule-${gate.gateType}`}
                value={gate.passRule}
                onChange={(e) =>
                  onUpdate({ passRule: e.target.value as PassRule })
                }
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Pass rule"
                data-testid={`pass-rule-${gate.gateType}`}
              >
                {PASS_RULE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor={`timeout-${gate.gateType}`}
                className="text-sm font-medium"
              >
                Days until escalation
              </label>
              <Input
                id={`timeout-${gate.gateType}`}
                type="number"
                min={1}
                max={90}
                value={gate.timeoutDays}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!Number.isNaN(val)) {
                    onUpdate({ timeoutDays: Math.min(90, Math.max(1, val)) });
                  }
                }}
                data-testid={`timeout-${gate.gateType}`}
              />
            </div>
          </div>

          {/* Auto-schedule toggle — final_signoff only */}
          {gate.gateType === "final_signoff" && (
            <div className="flex items-center justify-between rounded-lg border border-border bg-background px-4 py-3">
              <div>
                <p className="text-sm font-medium">
                  Automatically schedule after approval
                </p>
                <p className="text-xs text-muted-foreground">
                  Posts are queued for their scheduled time as soon as this
                  gate passes.
                </p>
              </div>
              <Switch
                checked={gate.autoSchedule}
                onCheckedChange={(checked) =>
                  onUpdate({ autoSchedule: checked })
                }
                label="Toggle auto-schedule"
                data-testid="auto-schedule-toggle"
              />
            </div>
          )}

          {/* Approver list */}
          <div className="space-y-3">
            <p className="text-sm font-medium">Approvers</p>

            {gate.approvers.length > 0 ? (
              <ul
                className="flex flex-wrap gap-2"
                aria-label="Current approvers"
                data-testid={`approver-list-${gate.gateType}`}
              >
                {gate.approvers.map((a) => (
                  <li
                    key={a.key}
                    className="flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1 text-sm"
                    data-testid={`approver-chip-${a.key}`}
                  >
                    <span>{a.label}</span>
                    <button
                      type="button"
                      aria-label={`Remove approver ${a.label}`}
                      onClick={() => removeApprover(a.key)}
                      className="ml-0.5 rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      data-testid={`remove-approver-${a.key}`}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p
                className="text-sm text-muted-foreground"
                data-testid={`no-approvers-${gate.gateType}`}
              >
                No approvers added yet.
              </p>
            )}

            {/* Add internal approver */}
            {eligibleMembers.length > 0 && (
              <div className="space-y-1.5">
                <label
                  htmlFor={`internal-approver-${gate.gateType}`}
                  className="text-sm font-medium"
                >
                  Add internal approver
                </label>
                <select
                  id={`internal-approver-${gate.gateType}`}
                  defaultValue=""
                  onChange={(e) => {
                    const memberId = e.target.value;
                    if (!memberId) return;
                    const member = members.find((m) => m.id === memberId);
                    if (!member) return;
                    onUpdate({
                      approvers: [
                        ...gate.approvers,
                        {
                          key: `int-${memberId}`,
                          platformUserId: memberId,
                          label: member.name
                            ? `${member.name} (${member.email})`
                            : member.email,
                        },
                      ],
                    });
                    // Reset the select back to placeholder
                    e.target.value = "";
                  }}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Add internal approver"
                  data-testid={`internal-approver-select-${gate.gateType}`}
                >
                  <option value="" disabled>
                    Select a team member…
                  </option>
                  {eligibleMembers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name || m.email} — {m.role}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Add external approver */}
            <div className="space-y-1.5">
              <label
                htmlFor={`external-email-${gate.gateType}`}
                className="text-sm font-medium"
              >
                Add external approver
              </label>
              <div className="flex gap-2">
                <Input
                  id={`external-email-${gate.gateType}`}
                  type="email"
                  placeholder="client@example.com"
                  value={externalEmailInput}
                  onChange={(e) => {
                    setExternalEmailInput(e.target.value);
                    if (externalEmailError) setExternalEmailError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addExternalApprover();
                    }
                  }}
                  aria-describedby={
                    externalEmailError
                      ? `external-email-error-${gate.gateType}`
                      : undefined
                  }
                  data-testid={`external-email-input-${gate.gateType}`}
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={addExternalApprover}
                  data-testid={`add-external-${gate.gateType}`}
                >
                  Add
                </Button>
              </div>
              {externalEmailError && (
                <p
                  id={`external-email-error-${gate.gateType}`}
                  className="text-xs text-destructive"
                  role="alert"
                >
                  {externalEmailError}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Footer: unsaved indicator + save button */}
      <footer className="flex items-center justify-between gap-3 border-t border-border pt-4">
        <span
          className={cn(
            "text-xs transition-opacity",
            gate.dirty ? "text-amber-600" : "text-transparent select-none",
          )}
          aria-live="polite"
          data-testid={`unsaved-indicator-${gate.gateType}`}
        >
          Unsaved changes
        </span>
        <div className="flex items-center gap-3">
          {saveState === "error" && saveError && (
            <span
              className="text-xs text-destructive"
              role="alert"
              data-testid={`save-error-${gate.gateType}`}
            >
              {saveError}
            </span>
          )}
          {saveState === "saved" && (
            <span
              className="text-xs text-green-600"
              data-testid={`save-success-${gate.gateType}`}
            >
              Saved ✓
            </span>
          )}
          <Button
            type="button"
            onClick={handleSave}
            disabled={saveState === "saving"}
            data-testid={`save-gate-${gate.gateType}`}
          >
            {saveState === "saving" ? (
              <span className="flex items-center gap-2">
                <Spinner />
                Saving…
              </span>
            ) : (
              "Save changes"
            )}
          </Button>
        </div>
      </footer>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Tiny inline spinner (no external dep)
// ---------------------------------------------------------------------------

function Spinner() {
  return (
    <svg
      className="h-3.5 w-3.5 animate-spin text-current"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  );
}
