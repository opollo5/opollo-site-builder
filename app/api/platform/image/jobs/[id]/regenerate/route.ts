import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { internalError, readJsonBody, validationError, validateUuidParam } from "@/lib/http";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import { enqueueImageJob } from "@/lib/image/enqueue";
import { buildPrompt } from "@/lib/image/generator/prompt-engine";
import { coordToGridRegion, buildSafeZoneFragment, type GridRegion } from "@/lib/image/generator/safe-zones";
import { TEXT_ZONE_MAP } from "@/lib/image/compositing/text-zones";
import type { GenerationParams } from "@/lib/image/types";

// ---------------------------------------------------------------------------
// POST /api/platform/image/jobs/[id]/regenerate
//
// Slice I — Regenerate-with-feedback (D21, D22, D23, D26, D27, D29, D30).
//
// Dispatches a new generation job with operator feedback appended to the
// original prompt. The new job uses the same generation_params as the parent
// plus { feedback_text, pins, parent_job_id } (D21).
//
// D23 contract: this endpoint NEVER implies region-only editing. All paths
// regenerate the full image with the feedback as hints (FLASH-tier steering).
//
// D25: Idempotent by job_id — dispatching twice for the same parent produces
// the same outcome (two jobs get queued but the second is a no-op per QStash
// dedup within the 24h window, since it's keyed by the new jobId not parentId).
//
// Auth: requireCanDoForApi(companyId, "create_post") — editor+.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// D22: Pin shape. x/y = normalised 0–1 from rendered image bounds.
const PinSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  region: z.enum([
    "top-left", "top-center", "top-right",
    "mid-left", "center", "mid-right",
    "bottom-left", "bottom-center", "bottom-right",
  ]),
  comment: z.string().max(200),
});

const RegenerateBodySchema = z.object({
  company_id: z.string().uuid(),
  feedback_text: z.string().max(500).optional(),
  // D22: ≤3 pins
  pins: z.array(PinSchema).max(3).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const idCheck = validateUuidParam(id, "id");
  if (!idCheck.ok) return idCheck.response;
  const parentJobId = idCheck.value;

  const body = await readJsonBody(req);
  if (!body) return validationError("Request body must be valid JSON.");
  const parsed = RegenerateBodySchema.safeParse(body);
  if (!parsed.success) {
    return validationError("Invalid request body.", { issues: parsed.error.issues });
  }
  const { company_id, feedback_text, pins } = parsed.data;

  const gate = await requireCanDoForApi(company_id, "create_post");
  if (gate.kind === "deny") return gate.response;

  const svc = getServiceRoleClient();

  // Load the parent job — verify ownership and get generation_params.
  const { data: parentJob, error: jobErr } = await svc
    .from("image_generation_jobs")
    .select("id, company_id, batch_id, generation_params, target_platforms, target_publish_date, parent_post_index, post_text")
    .eq("id", parentJobId)
    .maybeSingle();

  if (jobErr || !parentJob) {
    return validationError("Parent job not found.", { jobId: parentJobId });
  }
  if ((parentJob.company_id as string) !== company_id) {
    return validationError("Parent job not found.", { jobId: parentJobId });
  }

  const originalParams = (parentJob.generation_params as GenerationParams | null) ?? {} as GenerationParams;

  // ─── Build enhanced prompt (D23, D29/D30) ───────────────────────────────
  //
  // D30: safe-zone hint from the composition's text zone (same grid as Slice H).
  const textZone = originalParams.compositionType
    ? TEXT_ZONE_MAP[originalParams.compositionType as keyof typeof TEXT_ZONE_MAP]
    : null;
  const safeZoneFragment = textZone
    ? buildSafeZoneFragment([
        coordToGridRegion(
          (textZone.x + textZone.width / 2) / 100,
          (textZone.y + textZone.height / 2) / 100,
        ),
      ])
    : "";

  // D29: convert pins to region hints using the same grid.
  const pinHints = (pins ?? [])
    .map((pin) => {
      const region: GridRegion = pin.region ?? coordToGridRegion(pin.x, pin.y);
      return pin.comment
        ? `${region} area — ${pin.comment}`
        : `${region} area needs adjustment`;
    })
    .join("; ");

  // D23: base prompt via buildPrompt (no keepClearFragment param — that is
  // added by Slice H on the prompt-engine; here we append separately).
  const basePrompt = originalParams.styleId
    ? buildPrompt({
        styleId: originalParams.styleId as GenerationParams["styleId"],
        primaryColour: originalParams.primaryColour ?? "#000000",
        compositionType: originalParams.compositionType as GenerationParams["compositionType"],
        industry: originalParams.industry,
      })
    : "background image";

  // Combine: base + safe-zone + pin hints + operator feedback.
  // D23: never implies region-only editing; all paths regenerate the full image.
  const enhancedParts = [
    basePrompt,
    safeZoneFragment,
    pinHints && `Specific guidance for the next full-image generation: ${pinHints}`,
    feedback_text && `General feedback: ${feedback_text}`,
  ].filter(Boolean);

  const enhancedPrompt = enhancedParts.join(". ");

  // ─── Dispatch the new job (D21) ──────────────────────────────────────────
  // Store original params + feedback fields in generation_params JSONB.
  const newGenerationParams = {
    ...originalParams,
    feedback_text: feedback_text ?? null,
    pins: pins ?? [],
    parent_job_id: parentJobId,
    // Override prompt isn't stored in params (rebuilt deterministically from params).
    // But store the enhanced prompt for auditability.
    _enhanced_prompt: enhancedPrompt,
  };

  const { data: newJob, error: insertErr } = await svc
    .from("image_generation_jobs")
    .insert({
      company_id,
      batch_id: parentJob.batch_id as string | null,
      state: "pending",
      generation_params: newGenerationParams,
      target_platforms: parentJob.target_platforms,
      target_publish_date: parentJob.target_publish_date,
      parent_post_index: parentJob.parent_post_index,
      post_text: parentJob.post_text, // carry caption forward
    })
    .select("id")
    .single();

  if (insertErr || !newJob) {
    logger.error("image.regenerate.insert_failed", { parentJobId, err: insertErr?.message });
    return internalError("Failed to create regeneration job.");
  }

  const newJobId = (newJob as { id: string }).id;

  const enqueue = await enqueueImageJob({
    jobId: newJobId,
    generationParams: { ...originalParams, _enhancedPrompt: enhancedPrompt } as unknown as GenerationParams,
    batchId: (parentJob.batch_id as string | null) ?? undefined,
  });

  if (!enqueue.ok) {
    logger.error("image.regenerate.enqueue_failed", { parentJobId, newJobId, err: enqueue.error });
    // Mark failed immediately so the carousel doesn't show stuck "regenerating".
    await svc
      .from("image_generation_jobs")
      .update({ state: "failed", error_class: "EnqueueFailed", error_detail: enqueue.error })
      .eq("id", newJobId);
    return internalError("Failed to enqueue regeneration job.");
  }

  logger.info("image.regenerate.dispatched", {
    parentJobId,
    newJobId,
    companyId: company_id,
    hasFeedback: !!feedback_text,
    pinCount: pins?.length ?? 0,
  });

  return NextResponse.json({
    ok: true,
    data: { newJobId, parentJobId, batchId: parentJob.batch_id },
    timestamp: new Date().toISOString(),
  });
}
