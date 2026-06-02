"use client";

import { useState } from "react";
import type { WorkflowStep, UpsertStepInput } from "@/lib/platform/workflow/steps";

// ---------------------------------------------------------------------------
// WorkflowStepsTab — step builder for the B3 workflow engine.
//
// Shown on the company workflow-config page alongside the existing
// WorkflowGatesTab (which configures the image_batch gate path).
// This tab configures workflow_steps for the content proof path.
// ---------------------------------------------------------------------------

type StepRole = "reviewer" | "mandatory_reviewer" | "gatekeeper" | "approver";

const ROLE_LABELS: Record<StepRole, string> = {
  reviewer:           "Reviewer (non-blocking)",
  mandatory_reviewer: "Required reviewer",
  gatekeeper:         "Gatekeeper (can send back 1 step)",
  approver:           "Approver",
};

interface Props {
  companyId: string;
  initialSteps: WorkflowStep[];
}

type DraftParticipant = {
  platform_user_id: string | null;
  external_email: string | null;
  role: StepRole;
  displayName: string;
};

type DraftStep = {
  step_order: number;
  name: string;
  pass_rule: "any_one" | "all_must";
  timeout_days: number;
  participants: DraftParticipant[];
};

function stepToUpsert(s: DraftStep): UpsertStepInput {
  return {
    step_order: s.step_order,
    name: s.name,
    pass_rule: s.pass_rule,
    timeout_days: s.timeout_days,
    participants: s.participants.map((p) => ({
      platform_user_id: p.platform_user_id,
      external_email: p.external_email,
      role: p.role,
    })),
  };
}

export function WorkflowStepsTab({ companyId, initialSteps }: Props) {
  const [steps, setSteps] = useState<DraftStep[]>(
    initialSteps.map((s) => ({
      step_order: s.step_order,
      name: s.name,
      pass_rule: s.pass_rule as "any_one" | "all_must",
      timeout_days: s.timeout_days,
      participants: s.participants.map((p) => ({
        platform_user_id: p.platform_user_id,
        external_email: p.external_email,
        role: p.role as StepRole,
        displayName: p.email ?? p.external_email ?? "",
      })),
    })),
  );
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState<Record<number, string>>({});
  const [newRole, setNewRole] = useState<Record<number, StepRole>>({});

  function addStep() {
    const maxOrder = steps.reduce((m, s) => Math.max(m, s.step_order), 0);
    setSteps((prev) => [
      ...prev,
      {
        step_order: maxOrder + 1,
        name: `Step ${maxOrder + 1}`,
        pass_rule: "any_one",
        timeout_days: 14,
        participants: [],
      },
    ]);
  }

  function removeStep(order: number) {
    setSteps((prev) =>
      prev
        .filter((s) => s.step_order !== order)
        .map((s, i) => ({ ...s, step_order: i + 1 })),
    );
  }

  function updateStep(order: number, update: Partial<DraftStep>) {
    setSteps((prev) =>
      prev.map((s) => (s.step_order === order ? { ...s, ...update } : s)),
    );
  }

  function addParticipant(stepOrder: number) {
    const email = newEmail[stepOrder]?.trim();
    const role = newRole[stepOrder] ?? "approver";
    if (!email || !email.includes("@")) return;

    setSteps((prev) =>
      prev.map((s) =>
        s.step_order === stepOrder
          ? {
              ...s,
              participants: [
                ...s.participants,
                { platform_user_id: null, external_email: email, role, displayName: email },
              ],
            }
          : s,
      ),
    );
    setNewEmail((prev) => ({ ...prev, [stepOrder]: "" }));
  }

  function removeParticipant(stepOrder: number, email: string | null) {
    setSteps((prev) =>
      prev.map((s) =>
        s.step_order === stepOrder
          ? {
              ...s,
              participants: s.participants.filter(
                (p) => p.external_email !== email && p.platform_user_id !== email,
              ),
            }
          : s,
      ),
    );
  }

  async function save() {
    setStatus("saving");
    setErrorMsg(null);
    try {
      const res = await fetch(
        `/api/platform/companies/${companyId}/workflow-steps`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ steps: steps.map(stepToUpsert) }),
        },
      );
      const json = await res.json();
      if (!json.ok) {
        setErrorMsg(json.error?.message ?? "Failed to save.");
        setStatus("error");
        return;
      }
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);
    } catch {
      setStatus("error");
      setErrorMsg("Network error. Please try again.");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Workflow steps
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure the review steps for content proofs. Steps run in order; each step must pass before the next opens.
          </p>
        </div>
        <button
          onClick={save}
          disabled={status === "saving"}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {status === "saving" ? "Saving…" : status === "saved" ? "Saved ✓" : "Save"}
        </button>
      </div>

      {errorMsg ? (
        <p className="text-sm text-destructive">{errorMsg}</p>
      ) : null}

      {steps.length === 0 && (
        <div className="rounded-lg border border-dashed bg-muted/30 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            No steps configured. Add a step to enable multi-step proof workflows.
          </p>
        </div>
      )}

      <ul className="space-y-3">
        {steps.map((step) => (
          <li key={step.step_order} className="rounded-lg border bg-card p-4">
            <div className="flex items-start gap-3">
              {/* Step order badge */}
              <span className="mt-0.5 flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">
                {step.step_order}
              </span>

              <div className="flex-1 space-y-3">
                {/* Name + remove */}
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={step.name}
                    onChange={(e) => updateStep(step.step_order, { name: e.target.value })}
                    className="flex-1 rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="Step name"
                  />
                  <button
                    onClick={() => removeStep(step.step_order)}
                    className="text-muted-foreground hover:text-destructive text-xs"
                  >
                    Remove
                  </button>
                </div>

                {/* Pass rule + timeout */}
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span>Pass rule:</span>
                    <select
                      value={step.pass_rule}
                      onChange={(e) =>
                        updateStep(step.step_order, {
                          pass_rule: e.target.value as "any_one" | "all_must",
                        })
                      }
                      className="rounded border bg-background px-1.5 py-0.5 text-xs focus:outline-none"
                    >
                      <option value="any_one">Any one approves</option>
                      <option value="all_must">All must approve</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span>Timeout (days):</span>
                    <input
                      type="number"
                      min={1}
                      max={90}
                      value={step.timeout_days}
                      onChange={(e) =>
                        updateStep(step.step_order, {
                          timeout_days: parseInt(e.target.value, 10) || 14,
                        })
                      }
                      className="w-14 rounded border bg-background px-1.5 py-0.5 text-xs focus:outline-none"
                    />
                  </label>
                </div>

                {/* Participants */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    Participants
                  </p>
                  {step.participants.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No participants yet.</p>
                  ) : (
                    <ul className="space-y-1">
                      {step.participants.map((p) => (
                        <li
                          key={p.external_email ?? p.platform_user_id}
                          className="flex items-center justify-between text-xs rounded bg-muted/40 px-2 py-1"
                        >
                          <span className="font-medium">{p.displayName}</span>
                          <span className="text-muted-foreground ml-2">{ROLE_LABELS[p.role]}</span>
                          <button
                            onClick={() => removeParticipant(step.step_order, p.external_email ?? p.platform_user_id)}
                            className="ml-2 text-muted-foreground hover:text-destructive"
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* Add participant */}
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="email"
                      placeholder="reviewer@email.com"
                      value={newEmail[step.step_order] ?? ""}
                      onChange={(e) =>
                        setNewEmail((prev) => ({ ...prev, [step.step_order]: e.target.value }))
                      }
                      className="flex-1 rounded border bg-background px-2 py-1 text-xs focus:outline-none"
                    />
                    <select
                      value={newRole[step.step_order] ?? "approver"}
                      onChange={(e) =>
                        setNewRole((prev) => ({
                          ...prev,
                          [step.step_order]: e.target.value as StepRole,
                        }))
                      }
                      className="rounded border bg-background px-1.5 py-1 text-xs focus:outline-none"
                    >
                      {Object.entries(ROLE_LABELS).map(([val, label]) => (
                        <option key={val} value={val}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => addParticipant(step.step_order)}
                      className="rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <button
        onClick={addStep}
        className="w-full rounded-lg border border-dashed py-2 text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors"
      >
        + Add step
      </button>
    </div>
  );
}
