import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { dbUuid, internalError, readJsonBody, validationError } from "@/lib/http";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { getActiveBrandProfile } from "@/lib/platform/brand";
import { createMediaAsset } from "@/lib/platform/social/media";
import { generateWithFallback, getAllowedStyles } from "@/lib/image";
import type { AspectRatio, StyleId } from "@/lib/image/types";
import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// POST /api/platform/social/cap/generate-image
//   Body: { company_id, aspect_ratio?: "1x1"|"4x5"|"16x9" }
//
// Generates a brand-derived background image for the composer image picker.
// Routes through the canonical generateWithFallback() pipeline (v3 FLASH,
// quality check, retry, image_generation_log). Stores in the generated-images
// bucket and creates a social_media_assets row for the composer to attach.
//
// Replaces the legacy inline Ideogram fetch (A3). Free-form user prompts
// are not accepted — the canonical image pipeline uses parameterised inputs
// only (image-generation skill rule #2).
//
// Degraded path: IDEOGRAM_API_KEY unset → 503 NOT_CONFIGURED.
// Gate: canDo("create_post") — editor+.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMAGE_GEN_BUCKET = process.env.IMAGE_GENERATION_BUCKET ?? "generated-images";
const SIGNED_URL_TTL = 365 * 24 * 3600; // 1 year — stored as source_url in media assets

const DEFAULT_STYLE: StyleId = "clean_corporate";
const DEFAULT_COLOUR = "#1a56db";

const BodySchema = z.object({
  company_id: dbUuid(),
  aspect_ratio: z.enum(["1x1", "4x5", "16x9"]).optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body must be valid JSON.");
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return validationError(
      "Body must be { company_id: uuid, aspect_ratio?: '1x1'|'4x5'|'16x9' }.",
      { issues: parsed.error.issues },
    );
  }

  const gate = await requireCanDoForApi(parsed.data.company_id, "create_post");
  if (gate.kind === "deny") return gate.response;

  if (!process.env.IDEOGRAM_API_KEY) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "NOT_CONFIGURED",
          message: "AI image generation is not configured on this environment.",
          retryable: false,
          suggested_action: "Set IDEOGRAM_API_KEY to enable AI image generation.",
        },
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }

  const { company_id, aspect_ratio } = parsed.data;

  // Read brand profile — degrade gracefully if missing.
  const brand = await getActiveBrandProfile(company_id);
  const allowedStyles = getAllowedStyles(brand);

  let images;
  try {
    images = await generateWithFallback({
      styleId: allowedStyles[0] ?? DEFAULT_STYLE,
      primaryColour: brand?.primary_colour ?? DEFAULT_COLOUR,
      compositionType: "split_layout",
      aspectRatio: (aspect_ratio ?? "1x1") as AspectRatio,
      count: 1,
      industry: brand?.industry ?? undefined,
      companyId: company_id,
      brandProfileId: brand?.id,
      brandProfileVersion: brand?.version,
    });
  } catch (err) {
    logger.error("cap.generate-image.generation_failed", {
      companyId: company_id,
      err: err instanceof Error ? err.message : String(err),
    });
    return internalError("Image generation failed.");
  }

  const image = images[0];
  if (!image) return internalError("Image generation returned no result.");

  // Sign the storage path for the media-asset source_url (1-year TTL).
  const svc = getServiceRoleClient();
  const { data: signed, error: signErr } = await svc.storage
    .from(IMAGE_GEN_BUCKET)
    .createSignedUrl(image.storagePath, SIGNED_URL_TTL);

  if (signErr || !signed?.signedUrl) {
    return internalError("Failed to generate signed URL for generated image.");
  }

  const mimeType = image.format === "png" ? "image/png" : "image/jpeg";
  const result = await createMediaAsset({
    companyId: company_id,
    sourceUrl: signed.signedUrl,
    mimeType,
    uploadedBy: gate.userId,
  });

  if (!result.ok) return internalError(result.error.message);

  return NextResponse.json(
    {
      ok: true,
      data: { asset: { ...result.data, width: image.width, height: image.height } },
      timestamp: new Date().toISOString(),
    },
    { status: 201 },
  );
}
