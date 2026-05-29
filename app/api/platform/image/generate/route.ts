import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { dbUuid } from "@/lib/http";
import { logger } from "@/lib/logger";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { getActiveBrandProfile } from "@/lib/platform/brand";
import {
  generateWithFallback,
  getAllowedStyles,
  validateStyleForBrand,
} from "@/lib/image";
import { compositeImage, TEXT_ZONE_MAP } from "@/lib/image/compositing";
import type { CompositeInput } from "@/lib/image/compositing";
import { get_template } from "@/lib/image/templates";
import { getServiceRoleClient } from "@/lib/supabase";
import type { AspectRatio, CompositionType, StyleId } from "@/lib/image";

// ---------------------------------------------------------------------------
// POST /api/platform/image/generate — I4 mood board generation (A4)
//
// Generates 4–6 composited images for the customer to select from.
// Each image goes through:
//   1. generateWithFallback() → Ideogram background → Supabase Storage
//   2. compositeImage() → sharp renderer → overlay band + headline text
//      + brand logo (if available) → composite stored at /composite/ prefix
//
// Returns signed URLs for the composites (not raw backgrounds).
//
// Uses code templates from lib/image/compositing/templates-v1.ts (A-NEW-1).
// Will be migrated to database templates in A-NEW-4's follow-up.
//
// Auth: canDo("create_post") — editor+.
// Feature gate: IMAGE_FEATURE_MOOD_BOARD must be "true".
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120; // ~11s Ideogram + ~1s compositing per image; 6 parallel = ~15s total

const IMAGE_GEN_BUCKET =
  process.env.IMAGE_GENERATION_BUCKET ?? "generated-images";
const SIGNED_URL_TTL = 3600; // 1 hour — sufficient for a UI session

const GenerateSchema = z.object({
  company_id: dbUuid(),
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
  aspect_ratio: z.enum(["1x1", "4x5", "9x16", "16x9", "4x3"]),
  count: z.number().int().min(1).max(6).default(4),
  post_master_id: z.string().uuid().optional(),
  // A4 addition: user-supplied headline for the overlay text.
  // Default "Headline preview" is applied server-side when blank.
  headline: z.string().max(120).optional(),
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

  const { company_id: companyId, style_id, composition_type, aspect_ratio, count, post_master_id, headline } =
    parsed.data;

  const gateResult = await requireCanDoForApi(companyId, "create_post");
  if (gateResult.kind === "deny") {
    return gateResult.response;
  }

  const { userId } = gateResult;

  // Validate style against brand profile (safe_mode + approved_style_ids).
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

  const primaryColour = brand?.primary_colour ?? "#1A1A1A";
  const industry = brand?.industry ?? undefined;
  const headlineText = headline?.trim() || "Headline preview";

  // DB template for this aspect ratio (A-NEW-4). Falls back to TEXT_ZONE_MAP
  // if no template row exists (shouldn't happen after A-NEW-2 seed).
  const dbTemplate = await get_template(companyId, aspect_ratio as AspectRatio);
  const textZone = dbTemplate?.definition.customTextZone
    ?? TEXT_ZONE_MAP[(dbTemplate?.definition.compositionType ?? composition_type) as CompositionType];
  const maxHeadlineFontSize = dbTemplate?.definition.maxHeadlineFontSize ?? 56;
  const logoPosition = dbTemplate?.definition.logoPosition ?? "bottom-right";
  const logoSizePercent = dbTemplate?.definition.logoSizePercent ?? 18;
  const logoPadding = dbTemplate?.definition.logoPadding ?? 24;

  // Brand logo: prefer icon variant, fall back to primary.
  // Used directly as-is; compositor handles fetch failure gracefully.
  const logoUrl = brand?.logo_icon_url ?? brand?.logo_primary_url ?? null;

  // Generate all backgrounds in parallel.
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

  const generationResults = await Promise.all(generationTasks);
  const backgrounds = generationResults.filter((r): r is NonNullable<typeof r> => r !== null);

  if (backgrounds.length === 0) {
    return NextResponse.json(
      { ok: false, error: { code: "GENERATION_FAILED", message: "All image generation attempts failed." } },
      { status: 502 },
    );
  }

  // Composite each background with overlay + text + logo.
  const compositeResults = await Promise.all(
    backgrounds.map(async (bg) => {
      const compositeInput: CompositeInput = {
        backgroundStoragePath: bg.storagePath,
        textZones: [{
          ...textZone,
          text: headlineText,
          maxFontSize: maxHeadlineFontSize,
          colour: "white",
        }],
        logo: logoUrl
          ? {
              url: logoUrl,
              position: logoPosition,
              sizePercent: logoSizePercent,
              padding: logoPadding,
            }
          : null,
        outputFormat: bg.format === "png" ? "png" : "jpeg",
        outputWidth: bg.width,
        outputHeight: bg.height,
      };

      try {
        return await compositeImage(compositeInput);
      } catch (err) {
        logger.warn("mood-board.composite.partial-failure", {
          companyId,
          backgroundPath: bg.storagePath,
          error: String(err),
        });
        // Degrade: return the raw background path so the board doesn't lose a slot
        return {
          storagePath: bg.storagePath,
          provider: "fallback_raw",
          durationMs: 0,
        };
      }
    }),
  );

  // Sign URLs for display (composite paths).
  const supabase = getServiceRoleClient();
  const images = await Promise.all(
    compositeResults.map(async (comp, i) => {
      const bg = backgrounds[i]!;
      const { data } = await supabase.storage
        .from(IMAGE_GEN_BUCKET)
        .createSignedUrl(comp.storagePath, SIGNED_URL_TTL);
      return {
        storagePath: comp.storagePath,
        signedUrl: data?.signedUrl ?? null,
        width: bg.width,
        height: bg.height,
        format: bg.format,
        composited: comp.provider !== "fallback_raw",
      };
    }),
  );

  logger.info("mood-board.generate.complete", {
    companyId,
    requested: count,
    generated: images.length,
    composited: images.filter((i) => i.composited).length,
    userId,
  });

  return NextResponse.json({
    ok: true,
    data: { images },
    timestamp: new Date().toISOString(),
  });
}
