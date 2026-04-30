import "server-only";

import { z } from "zod";

import { getServiceRoleClient } from "@/lib/supabase";

// DESIGN-DISCOVERY — design brief schema + persistence.
//
// design_brief is a JSONB column on sites; this module owns its v1
// shape and the read / write helpers used by the wizard.

export const DesignBriefSchema = z.object({
  industry: z.enum([
    "msp",
    "it_services",
    "cybersecurity",
    "general_b2b",
    "other",
  ]),
  reference_url: z.string().max(500).nullable(),
  existing_site_url: z.string().max(500).nullable(),
  description: z.string().max(4000).nullable(),
  // PR 4 ships without screenshot upload; the array is reserved.
  // PR 5 wires the Claude vision pass on uploaded screenshots.
  screenshots: z.array(z.string()).max(5).optional().default([]),
  // Operator-edited interpretation of what we extracted; overrides the
  // auto-extracted understanding when set. Free text.
  edited_understanding: z.string().max(2000).nullable().optional(),
  // Refinement notes accumulate across the iterate loop in PR 7.
  refinement_notes: z.array(z.string()).optional().default([]),
  // Cached extraction snapshot from the last URL fetch — drives the
  // mood board / understanding panel without re-fetching on every
  // render.
  extracted: z
    .object({
      swatches: z.array(z.string()).default([]),
      fonts: z.array(z.string()).default([]),
      layout_tags: z.array(z.string()).default([]),
      visual_tone_tags: z.array(z.string()).default([]),
      screenshot_url: z.string().nullable().default(null),
      source_url: z.string().nullable().default(null),
      fetched_at: z.string().nullable().default(null),
    })
    .nullable()
    .optional(),
});

export type DesignBrief = z.infer<typeof DesignBriefSchema>;

export type SaveDesignBriefResult =
  | { ok: true }
  | {
      ok: false;
      error: {
        code: "NOT_FOUND" | "VALIDATION_FAILED" | "INTERNAL_ERROR";
        message: string;
      };
    };

export async function saveDesignBrief(
  siteId: string,
  brief: DesignBrief,
  opts: { advanceStatus?: boolean } = {},
): Promise<SaveDesignBriefResult> {
  const parsed = DesignBriefSchema.safeParse(brief);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      },
    };
  }
  const supabase = getServiceRoleClient();
  const patch: Record<string, unknown> = {
    design_brief: parsed.data,
    updated_at: new Date().toISOString(),
  };
  if (opts.advanceStatus) {
    patch.design_direction_status = "in_progress";
  }
  const { data, error } = await supabase
    .from("sites")
    .update(patch)
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

export async function getDesignBrief(
  siteId: string,
): Promise<{ ok: true; data: DesignBrief | null } | { ok: false; error: { code: string; message: string } }> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("sites")
    .select("design_brief")
    .eq("id", siteId)
    .neq("status", "removed")
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
      error: { code: "NOT_FOUND", message: `Site ${siteId} not found.` },
    };
  }
  if (!data.design_brief) return { ok: true, data: null };
  const parsed = DesignBriefSchema.safeParse(data.design_brief);
  if (!parsed.success) {
    // Tolerate legacy / partial briefs by returning the raw shape;
    // call sites that need typed fields can fall back to defaults.
    return { ok: true, data: data.design_brief as unknown as DesignBrief };
  }
  return { ok: true, data: parsed.data };
}

// Confidence signal for the understanding panel. Green = multiple
// inputs with aligned signals; Amber = mixed signals or partial
// inputs; Grey = text description only.
export type Confidence = "high" | "medium" | "low";

export function computeConfidence(brief: DesignBrief): Confidence {
  const hasUrl = Boolean(
    brief.reference_url?.trim() || brief.existing_site_url?.trim(),
  );
  const hasScreens = (brief.screenshots ?? []).length > 0;
  const hasText = Boolean(brief.description?.trim());
  const score = (hasUrl ? 1 : 0) + (hasScreens ? 1 : 0) + (hasText ? 1 : 0);
  if (score >= 2) return "high";
  if (score === 1 && (hasUrl || hasScreens)) return "medium";
  return "low";
}
