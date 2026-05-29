import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { dbUuid, readJsonBody, validationError, internalError } from "@/lib/http";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { getServiceRoleClient } from "@/lib/supabase";
import { compositeImage, TEXT_ZONE_MAP } from "@/lib/image/compositing";
import type { CompositionType, AspectRatio } from "@/lib/image/types";
import type { TemplateDefinition } from "@/lib/image/templates";
import sharp from "sharp";

// ---------------------------------------------------------------------------
// POST /api/platform/image/templates/preview
//
// Renders a template definition against a background image using the sharp
// compositor. Used by the template editor "Test with real background" button.
// Returns a 1-hour signed URL for the composite.
//
// Auth: canDo("create_post") — editor+.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const BUCKET = process.env.IMAGE_GENERATION_BUCKET ?? "generated-images";
const SIGNED_URL_TTL = 3600;

const BodySchema = z.object({
  company_id: dbUuid(),
  background_storage_path: z.string().min(1),
  definition: z.object({
    compositionType: z.string(),
    customTextZone: z.object({
      x: z.number(), y: z.number(), width: z.number(), height: z.number(),
      alignment: z.enum(["left", "center", "right"]),
    }).optional(),
    overlayAlpha: z.number().min(0).max(1),
    logoPosition: z.enum(["top-right", "bottom-right", "bottom-left", "watermark-center"]),
    logoSizePercent: z.number().min(1).max(50),
    logoPadding: z.number().min(0).max(100),
    maxHeadlineFontSize: z.number().min(12).max(120),
    fontFamily: z.string().optional(),
  }),
  headline_text: z.string().max(200).optional(),
  logo_url: z.string().url().optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await readJsonBody(req);
  if (!body) return validationError("Request body must be valid JSON.");

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return validationError("Invalid preview request.", { issues: parsed.error.issues });

  const gate = await requireCanDoForApi(parsed.data.company_id, "create_post");
  if (gate.kind === "deny") return gate.response;

  const { background_storage_path, definition, headline_text, logo_url } = parsed.data;
  const def = definition as TemplateDefinition;

  const svc = getServiceRoleClient();

  // Get background dimensions.
  const { data: bgBlob } = await svc.storage.from(BUCKET).download(background_storage_path);
  if (!bgBlob) return internalError("Background image not found.");

  const bgBuf = Buffer.from(await bgBlob.arrayBuffer());
  const meta = await sharp(bgBuf).metadata();
  const width = meta.width ?? 1024;
  const height = meta.height ?? 1024;

  // Resolve text zone: custom override or TEXT_ZONE_MAP lookup.
  const textZone = def.customTextZone ?? TEXT_ZONE_MAP[def.compositionType as CompositionType];

  let result;
  try {
    result = await compositeImage({
      backgroundStoragePath: background_storage_path,
      textZones: [{
        ...textZone,
        text: headline_text ?? "Headline preview",
        maxFontSize: def.maxHeadlineFontSize,
        colour: "white",
      }],
      logo: logo_url ? {
        url: logo_url,
        position: def.logoPosition,
        sizePercent: def.logoSizePercent,
        padding: def.logoPadding,
      } : null,
      outputFormat: "jpeg",
      outputWidth: width,
      outputHeight: height,
    });
  } catch (err) {
    return internalError(err instanceof Error ? err.message : "Compositing failed.");
  }

  const { data: signed } = await svc.storage
    .from(BUCKET)
    .createSignedUrl(result.storagePath, SIGNED_URL_TTL);

  return NextResponse.json({
    ok: true,
    data: { signedUrl: signed?.signedUrl ?? null, storagePath: result.storagePath },
    timestamp: new Date().toISOString(),
  });
}
