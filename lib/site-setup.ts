import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// DESIGN-DISCOVERY — site setup wizard helpers.
//
// Backs the /admin/sites/[id]/setup wizard. The wizard captures a design
// direction (Step 1) and a tone of voice (Step 2); progress lives in
// sites.design_direction_status / sites.tone_of_voice_status (CHECK enum).
// This module is the read + status-write entry point for the wizard
// shell. Concept HTML / design tokens / tone JSON writes live with their
// own helpers (PR 7 + PR 8).
// ---------------------------------------------------------------------------

export type SetupStepStatus =
  | "pending"
  | "in_progress"
  | "approved"
  | "skipped";

export type SetupStep = 1 | 2 | 3;

export interface SetupStatus {
  design_direction_status: SetupStepStatus;
  tone_of_voice_status: SetupStepStatus;
  // Snapshot of the artefacts the Step 3 done screen renders. Loaded
  // here so the server page renders in one round trip.
  design_tokens: Record<string, unknown> | null;
  tone_of_voice: Record<string, unknown> | null;
}

export type GetSetupStatusResult =
  | { ok: true; data: SetupStatus }
  | { ok: false; error: { code: "NOT_FOUND" | "INTERNAL_ERROR"; message: string } };

export async function getSetupStatus(
  siteId: string,
): Promise<GetSetupStatusResult> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("sites")
    .select(
      "design_direction_status, tone_of_voice_status, design_tokens, tone_of_voice",
    )
    .eq("id", siteId)
    .neq("status", "removed")
    .maybeSingle();
  if (error) {
    return {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: error.message,
      },
    };
  }
  if (!data) {
    return {
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: `No active site found with id ${siteId}.`,
      },
    };
  }
  return {
    ok: true,
    data: {
      design_direction_status: data.design_direction_status as SetupStepStatus,
      tone_of_voice_status: data.tone_of_voice_status as SetupStepStatus,
      design_tokens: (data.design_tokens as Record<string, unknown> | null) ?? null,
      tone_of_voice: (data.tone_of_voice as Record<string, unknown> | null) ?? null,
    },
  };
}

// Resume logic. Step 3 == done. Step 1 first, then 2, then done.
// 'approved' and 'skipped' both count as "complete" for navigation.
export function computeResumeStep(s: {
  design_direction_status: SetupStepStatus;
  tone_of_voice_status: SetupStepStatus;
}): SetupStep {
  const designDone =
    s.design_direction_status === "approved" ||
    s.design_direction_status === "skipped";
  const toneDone =
    s.tone_of_voice_status === "approved" ||
    s.tone_of_voice_status === "skipped";
  if (designDone && toneDone) return 3;
  if (designDone) return 2;
  return 1;
}

export type StepUpdateResult =
  | { ok: true }
  | {
      ok: false;
      error: {
        code: "NOT_FOUND" | "INVALID_STEP" | "INTERNAL_ERROR";
        message: string;
      };
    };

export async function setStepStatus(
  siteId: string,
  step: 1 | 2,
  status: SetupStepStatus,
): Promise<StepUpdateResult> {
  const supabase = getServiceRoleClient();
  const column =
    step === 1 ? "design_direction_status" : "tone_of_voice_status";
  const { data, error } = await supabase
    .from("sites")
    .update({ [column]: status, updated_at: new Date().toISOString() })
    .eq("id", siteId)
    .neq("status", "removed")
    .select("id")
    .maybeSingle();
  if (error) {
    return {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: error.message,
      },
    };
  }
  if (!data) {
    return {
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: `No active site found with id ${siteId}.`,
      },
    };
  }
  return { ok: true };
}
