import { describe, expect, it } from "vitest";
import { isBlockingRole, BLOCKING_ROLES } from "@/lib/platform/workflow/steps";

// ---------------------------------------------------------------------------
// Unit tests for the B3 workflow engine.
// ---------------------------------------------------------------------------

describe("role blocking model", () => {
  it("reviewer is non-blocking", () => {
    expect(isBlockingRole("reviewer")).toBe(false);
  });

  it("mandatory_reviewer is blocking", () => {
    expect(isBlockingRole("mandatory_reviewer")).toBe(true);
  });

  it("gatekeeper is blocking", () => {
    expect(isBlockingRole("gatekeeper")).toBe(true);
  });

  it("approver is blocking", () => {
    expect(isBlockingRole("approver")).toBe(true);
  });

  it("BLOCKING_ROLES contains exactly the three blocking roles", () => {
    expect(BLOCKING_ROLES).toContain("mandatory_reviewer");
    expect(BLOCKING_ROLES).toContain("gatekeeper");
    expect(BLOCKING_ROLES).toContain("approver");
    expect(BLOCKING_ROLES).not.toContain("reviewer");
    expect(BLOCKING_ROLES).toHaveLength(3);
  });
});

// Simulate the step advancement logic
function determineAction(params: {
  currentStepOrder: number;
  totalSteps: number;
  hasNextStep: boolean;
}): "advance" | "schedule" {
  if (!params.hasNextStep || params.currentStepOrder >= params.totalSteps) {
    return "schedule";
  }
  return "advance";
}

describe("step advancement logic", () => {
  it("intermediate step: advance to next", () => {
    expect(
      determineAction({ currentStepOrder: 1, totalSteps: 3, hasNextStep: true }),
    ).toBe("advance");
  });

  it("final step (no next step): schedule", () => {
    expect(
      determineAction({ currentStepOrder: 3, totalSteps: 3, hasNextStep: false }),
    ).toBe("schedule");
  });

  it("single-step proof: schedule immediately", () => {
    expect(
      determineAction({ currentStepOrder: 1, totalSteps: 1, hasNextStep: false }),
    ).toBe("schedule");
  });
});

// Simulate version re-entry logic (B0 §4)
function determineReentryStep(
  steps: Array<{ step_order: number }>,
  changesRequestedStepOrder: number,
): number {
  // Re-enter at the step that requested changes
  const step = steps.find((s) => s.step_order === changesRequestedStepOrder);
  return step ? step.step_order : steps[0].step_order;
}

function getSkippedSteps(
  steps: Array<{ step_order: number }>,
  reentryStepOrder: number,
): Array<{ step_order: number }> {
  return steps.filter((s) => s.step_order < reentryStepOrder);
}

describe("version re-entry (B0 §4)", () => {
  const steps = [
    { step_order: 1 }, // Internal
    { step_order: 2 }, // Legal → requested changes
    { step_order: 3 }, // Client
  ];

  it("re-enters at the step that requested changes (step 2)", () => {
    expect(determineReentryStep(steps, 2)).toBe(2);
  });

  it("skips steps BEFORE the re-entry step (step 1 is skipped)", () => {
    const reentry = determineReentryStep(steps, 2);
    const skipped = getSkippedSteps(steps, reentry);
    expect(skipped.map((s) => s.step_order)).toEqual([1]);
  });

  it("re-entry at step 1 skips nothing", () => {
    const reentry = determineReentryStep(steps, 1);
    const skipped = getSkippedSteps(steps, reentry);
    expect(skipped).toHaveLength(0);
  });
});

// Simulate gatekeeper send-back constraints (B0 §5)
function canSendBack(params: {
  role: string;
  currentStepOrder: number;
}): { allowed: boolean; reason?: string } {
  if (params.role !== "gatekeeper") {
    return { allowed: false, reason: "Only gatekeepers can send back" };
  }
  if (params.currentStepOrder <= 1) {
    return { allowed: false, reason: "Cannot send back from step 1 (no prior step)" };
  }
  return { allowed: true };
}

describe("gatekeeper send-back constraints (B0 §5)", () => {
  it("gatekeeper at step 2 can send back to step 1", () => {
    expect(canSendBack({ role: "gatekeeper", currentStepOrder: 2 })).toMatchObject({
      allowed: true,
    });
  });

  it("gatekeeper at step 1 cannot send back (no prior step)", () => {
    expect(canSendBack({ role: "gatekeeper", currentStepOrder: 1 })).toMatchObject({
      allowed: false,
    });
  });

  it("approver cannot send back", () => {
    expect(canSendBack({ role: "approver", currentStepOrder: 2 })).toMatchObject({
      allowed: false,
    });
  });

  it("reviewer cannot send back", () => {
    expect(canSendBack({ role: "reviewer", currentStepOrder: 2 })).toMatchObject({
      allowed: false,
    });
  });
});
