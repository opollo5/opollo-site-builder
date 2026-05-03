import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import {
  createMediaAsset,
  listMediaAssets,
} from "@/lib/platform/social/media";

// ---------------------------------------------------------------------------
// S1-23 — media library endpoints.
//
// GET  /api/platform/social/media?company_id=<uuid>
//      canDo("view_calendar") (viewer+).
//
// POST /api/platform/social/media
//      Body { company_id, source_url, mime_type?, bytes? }
//      canDo("edit_post") (editor+). Creates a social_media_assets
//      row pointing at a public URL. Future slice can add multipart
//      upload landing in Supabase Storage.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f-]{36}$/i;

const PostBodySchema = z.object({
  company_id: z.string().uuid(),
  source_url: z.string().url().startsWith("https://"),
  mime_type: z.string().optional(),
  bytes: z.number().int().positive().optional(),
});

function errorJson(
  code: string,
  message: string,
  status: number,
): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: { code, message, retryable: false },
      timestamp: new Date().toISOString(),
    },
    { status },
  );
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const companyId = url.searchParams.get("company_id");
  if (!companyId || !UUID_RE.test(companyId)) {
    return errorJson("VALIDATION_FAILED", "company_id required.", 400);
  }
  const gate = await requireCanDoForApi(companyId, "view_calendar");
  if (gate.kind === "deny") return gate.response;

  const result = await listMediaAssets({ companyId });
  if (!result.ok) {
    return errorJson(result.error.code, result.error.message, 500);
  }
  return NextResponse.json(
    {
      ok: true,
      data: result.data,
      timestamp: new Date().toISOString(),
    },
    { status: 200 },
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = PostBodySchema.safeParse(body);
  if (!parsed.success) {
    return errorJson(
      "VALIDATION_FAILED",
      "Body must be { company_id: uuid, source_url: https url, mime_type?, bytes? }.",
      400,
    );
  }

  const gate = await requireCanDoForApi(parsed.data.company_id, "edit_post");
  if (gate.kind === "deny") return gate.response;

  const result = await createMediaAsset({
    companyId: parsed.data.company_id,
    sourceUrl: parsed.data.source_url,
    mimeType: parsed.data.mime_type,
    bytes: parsed.data.bytes,
    uploadedBy: gate.userId,
  });
  if (!result.ok) {
    return errorJson(
      result.error.code,
      result.error.message,
      result.error.code === "VALIDATION_FAILED" ? 400 : 500,
    );
  }

  return NextResponse.json(
    {
      ok: true,
      data: { asset: result.data },
      timestamp: new Date().toISOString(),
    },
    { status: 201 },
  );
}
