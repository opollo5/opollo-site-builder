import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { logger } from "@/lib/logger";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { getActiveBrandProfile } from "@/lib/platform/brand";
import {
  generateWithFallback,
  getAllowedStyles,
  validateStyleForBrand,
} from "@/lib/image";
import { getServiceRoleClient } from "@/lib/supabase";
import type { AspectRatio, CompositionType, StyleId } from "@/lib/image";

// ---------------------------------------------------------------------------
// POST /api/platform/image/generate — I4 mood board generation
//
// Generates 4–6 background images for the customer to select from.
// Each image goes through generateWithFallback() (Ideogram → quality
// check → stock fallback if needed) and is stored in Supabase Storage.
// Returns signed URLs for immediate display in the mood board UI.
//
// Auth: requires `create_post` permission (editor+ or Opollo staff).
// Feature gate: IMAGE_FEATURE_MOOD_BOARD must be "true".
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120; // Ideogram can take ~30s per image

const IMAGE_GEN_BUCKET =
  process.env.IMAGE_GENERATION_BUCKET ?? "generated-images";
const SIGNED_URL_TTL = 3600; // 1 hour — sufficient for a UI session

const GenerateSchema = z.object({
  company_id: z.string().uuid(),
  style_id: z.enum([
    "clean_corporate",
    "bold_promo",
    "minimal_modern",
    "editorial",
    "product_focus",
  ]),
  composition_type: z.enum([
    "split_layout",
    "gradient_fade",
    "full_background",
    "geometric",
    "texture",
  ]),
  aspect_ratio: z.enum([
    "ASPECT_1_1",
    "ASPECT_4_5",
    "ASPECT_16_9",
    "ASPECT_9_16",
  ]),
  count: z.number().int().min(1).max(6).default(4),
  post_master_id: z.string().uuid().optional(),
});

export async function POST(req: NextRequest) {
  if (process.env.IMAGE_FEATURE_MOOD_BOARD !== "true") {
    return NextResponse.json(
      { ok: false, error: { code: "FEATURE_DISABLED", message: "Mood board is not enabled." } },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "VALIDATION_FAILED", message: "Invalid JSON body." } },
      { status: 400 },
    );
  }

  const parsed = GenerateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: { code: "VALIDATION_FAILED", message: parsed.error.message } },
      { status: 400 },
    );
  }

  const { company_id: companyId, style_id, composition_type, aspect_ratio, count, post_master_id } =
    parsed.data;

  const gateResult = await requireCanDoForApi(companyId, "create_post");
  if (gateResult.kind === "deny") {
    return gateResult.response;
  }

  const { userId } = gateResult;

  // Validate style against brand profile (safe_mode + approved_style_ids)
  const brand = await getActiveBrandProfile(companyId);
  try {
    validateStyleForBrand(style_id as StyleId, brand);
  } catch {
    const allowed = getAllowedStyles(brand).join(", ");
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "STYLE_BLOCKED",
          message: `Style "${style_id}" is not available for this brand. Allowed: ${allowed}`,
        },
      },
      { status: 403 },
    );
  }

  logger.info("mood-board.generate.start", {
    companyId,
    styleId: style_id,
    compositionType: composition_type,
    aspectRatio: aspect_ratio,
    count,
    userId,
  });

  // Generate all images in parallel; use allSettled so partial failure
  // doesn't abort the whole board.
  const primaryColour = brand?.primary_colour ?? "#1A1A1A";
  const industry = brand?.industry ?? undefined;

  const generationTasks = Array.from({ length: count }, (_, i) =>
    generateWithFallback({
      styleId: style_id as StyleId,
      primaryColour,
      compositionType: composition_type as CompositionType,
      aspectRatio: aspect_ratio as AspectRatio,
      industry,
      count: 1,
      companyId,
      brandProfileId: brand?.id,
      brandProfileVersion: brand?.version,
      postMasterId: post_master_id,
      triggeredBy: userId,
    }).then((images) => images[0]).catch((err) => {
      logger.warn("mood-board.generate.partial-failure", {
        companyId,
        slot: i,
        error: String(err),
      });
      return null;
    }),
  );

  const results = await Promise.all(generationTasks);
  const successful = results.filter(
    (r): r is NonNullable<typeof r> => r !== null,
  );

  if (successful.length === 0) {
    return NextResponse.json(
      { ok: false, error: { code: "GENERATION_FAILED", message: "All image generation attempts failed." } },
      { status: 502 },
    );
  }

  // Get signed URLs for display
  const supabase = getServiceRoleClient();
  const images = await Promise.all(
    successful.map(async (img) => {
      const { data } = await supabase.storage
        .from(IMAGE_GEN_BUCKET)
        .createSignedUrl(img.storagePath, SIGNED_URL_TTL);
      return {
        storagePath: img.storagePath,
        signedUrl: data?.signedUrl ?? null,
        width: img.width,
        height: img.height,
        format: img.format,
      };
    }),
  );

  logger.info("mood-board.generate.complete", {
    companyId,
    requested: count,
    generated: images.length,
    userId,
  });

  return NextResponse.json({
    ok: true,
    data: { images },
    timestamp: new Date().toISOString(),
  });
}
