import { randomUUID } from "crypto";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { internalError, readJsonBody, validationError } from "@/lib/http";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { createMediaAsset } from "@/lib/platform/social/media";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Spec 22 PR 2 — AI image generation for the composer image picker.
//
// POST /api/platform/social/cap/generate-image
//   Body: { company_id, prompt, aspect_ratio?: "1:1"|"4:5"|"16:9" }
//
// Calls the Ideogram API with the user's free-form prompt (no structured
// style params). Downloads the generated image, stores it in the existing
// "generated-images" Supabase Storage bucket, creates a social_media_assets
// row, and returns the signed source_url + asset id.
//
// Degraded path: when IDEOGRAM_API_KEY is unset (local / test), returns
// a 503 NOT_CONFIGURED response so the UI can show a helpful message
// rather than an opaque error.
//
// Gate: canDo("create_post") — editor+.
// Rate limit: deferred to PR 4 (AI Assistant slice); this endpoint shares
// the CAP 10/company/24h budget once wired.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMAGE_GEN_BUCKET = process.env.IMAGE_GENERATION_BUCKET ?? "generated-images";
const IDEOGRAM_API = "https://api.ideogram.ai/generate";
const SIGNED_URL_TTL = 365 * 24 * 3600;
const TIMEOUT_MS = parseInt(process.env.IMAGE_GENERATION_TIMEOUT_MS ?? "30000");

const BodySchema = z.object({
  company_id: z.string().uuid(),
  prompt: z.string().min(3).max(500),
  aspect_ratio: z.enum(["ASPECT_1_1", "ASPECT_4_5", "ASPECT_16_9"]).optional(),
});

interface IdeogramImage {
  url: string;
  width: number;
  height: number;
}

interface IdeogramResponse {
  data: IdeogramImage[];
}

const NEGATIVE_PROMPT =
  "text, words, letters, typography, watermark, logo, blurry, distorted, low quality";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body must be valid JSON.");
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return validationError(
      "Body must be { company_id: uuid, prompt: string(3-500), aspect_ratio?: 'ASPECT_1_1'|'ASPECT_4_5'|'ASPECT_16_9' }.",
      { issues: parsed.error.issues },
    );
  }

  const gate = await requireCanDoForApi(parsed.data.company_id, "create_post");
  if (gate.kind === "deny") return gate.response;

  const apiKey = process.env.IDEOGRAM_API_KEY;
  if (!apiKey) {
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

  const model = process.env.IDEOGRAM_STANDARD_MODEL ?? "ideogram-ai/ideogram-v3-flash";

  let ideogramData: IdeogramResponse;
  try {
    const resp = await fetch(IDEOGRAM_API, {
      method: "POST",
      headers: { "Api-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        image_request: {
          prompt: parsed.data.prompt,
          model,
          aspect_ratio: parsed.data.aspect_ratio ?? "ASPECT_1_1",
          num_images: 1,
          style_type: "REALISTIC",
          negative_prompt: NEGATIVE_PROMPT,
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!resp.ok) {
      const text = await resp.text();
      return internalError(`Ideogram API error ${resp.status}: ${text.slice(0, 200)}`);
    }

    ideogramData = (await resp.json()) as IdeogramResponse;
  } catch (err) {
    return internalError(err instanceof Error ? err.message : "Image generation request failed.");
  }

  const image = ideogramData.data[0];
  if (!image?.url) {
    return internalError("Ideogram returned no image.");
  }

  // Download the ephemeral Ideogram URL immediately.
  let imageBuffer: Buffer;
  let mimeType = "image/jpeg";
  try {
    const imgResp = await fetch(image.url, { signal: AbortSignal.timeout(30_000) });
    if (!imgResp.ok) return internalError("Failed to download generated image.");
    const ct = imgResp.headers.get("content-type");
    if (ct) mimeType = ct.split(";")[0]!.trim();
    imageBuffer = Buffer.from(await imgResp.arrayBuffer());
  } catch (err) {
    return internalError(err instanceof Error ? err.message : "Image download failed.");
  }

  const ext = mimeType.includes("png") ? "png" : "jpg";
  const storagePath = `${parsed.data.company_id}/${randomUUID()}.${ext}`;

  const svc = getServiceRoleClient();
  const { error: uploadError } = await svc.storage
    .from(IMAGE_GEN_BUCKET)
    .upload(storagePath, imageBuffer, { contentType: mimeType, upsert: false });

  if (uploadError) {
    return internalError(`Storage upload failed: ${uploadError.message}`);
  }

  const { data: signed } = await svc.storage
    .from(IMAGE_GEN_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL);

  if (!signed?.signedUrl) {
    return internalError("Failed to generate signed URL for generated image.");
  }

  const result = await createMediaAsset({
    companyId: parsed.data.company_id,
    sourceUrl: signed.signedUrl,
    mimeType,
    bytes: imageBuffer.length,
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
