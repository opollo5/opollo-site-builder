import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";

import type { DesignBrief } from "@/lib/design-discovery/design-brief";

// ---------------------------------------------------------------------------
// DESIGN-DISCOVERY — design-direction approval persistence (PR 7).
//
// One write per approval: design_brief + design_tokens +
// homepage_concept_html + inner_page_concept_html +
// design_direction_status='approved'. Caller is admin-gated.
// ---------------------------------------------------------------------------

export interface ApprovedConceptInput {
  homepage_html: string;
  inner_page_html: string;
  design_tokens: Record<string, unknown>;
  rationale: string;
  direction: string;
}

export type ApproveDesignDirectionResult =
  | { ok: true }
  | {
      ok: false;
      error: { code: "NOT_FOUND" | "INTERNAL_ERROR"; message: string };
    };

export async function approveDesignDirection(
  siteId: string,
  brief: DesignBrief,
  concept: ApprovedConceptInput,
): Promise<ApproveDesignDirectionResult> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("sites")
    .update({
      design_brief: brief,
      design_tokens: concept.design_tokens,
      homepage_concept_html: concept.homepage_html,
      inner_page_concept_html: concept.inner_page_html,
      design_direction_status: "approved",
      updated_at: new Date().toISOString(),
    })
    .eq("id", siteId)
    .neq("status", "removed")
    .select("id")
    .maybeSingle();
  if (error) {
    return {
      ok: false,
      error: { code: "INTERNAL_ERROR", message: error.message },
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

export type ResetDesignDirectionResult = ApproveDesignDirectionResult;

// "Reset and start over" — clears the approved concept and flips
// status back to 'in_progress'. Used by PR 7's CTA when an operator
// wants to redo the design after approving it.
export async function resetDesignDirection(
  siteId: string,
): Promise<ResetDesignDirectionResult> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("sites")
    .update({
      design_tokens: null,
      homepage_concept_html: null,
      inner_page_concept_html: null,
      tone_applied_homepage_html: null,
      design_direction_status: "in_progress",
      updated_at: new Date().toISOString(),
    })
    .eq("id", siteId)
    .neq("status", "removed")
    .select("id")
    .maybeSingle();
  if (error) {
    return {
      ok: false,
      error: { code: "INTERNAL_ERROR", message: error.message },
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
