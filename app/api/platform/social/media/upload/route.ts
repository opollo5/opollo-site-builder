import { randomUUID } from "crypto";

import { NextResponse, type NextRequest } from "next/server";

import { internalError, validationError } from "@/lib/http";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { createMediaAsset } from "@/lib/platform/social/media";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Spec 22 PR 2 — direct file upload for the social composer image picker.
//
// POST /api/platform/social/media/upload
//   Content-Type: multipart/form-data
//   Fields: file (required, image/*), company_id (required, uuid)
//
// Flow:
//   1. Gate: canDo("edit_post").
//   2. Validate file type + size (10 MB cap, images only).
//   3. Upload to "social-media" Supabase Storage bucket.
//   4. Create a social_media_assets row via createMediaAsset.
//   5. Return asset.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
]);
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const SIGNED_URL_TTL = 365 * 24 * 3600; // 1 year

const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function POST(req: NextRequest): Promise<NextResponse> {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return validationError("Request must be multipart/form-data.");
  }

  const file = formData.get("file");
  const companyId = formData.get("company_id");

  if (typeof companyId !== "string" || !UUID_RE.test(companyId)) {
    return validationError("company_id (uuid) is required.");
  }
  if (!(file instanceof File)) {
    return validationError("file is required.");
  }

  const gate = await requireCanDoForApi(companyId, "edit_post");
  if (gate.kind === "deny") return gate.response;

  if (!ALLOWED_TYPES.has(file.type)) {
    return validationError("Only JPEG, PNG, GIF, and WebP images are supported.");
  }
  if (file.size > MAX_BYTES) {
    return validationError("File must be under 10 MB.");
  }

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
  const storagePath = `${companyId}/${randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const svc = getServiceRoleClient();
  const { error: uploadError } = await svc.storage
    .from("social-media")
    .upload(storagePath, buffer, { contentType: file.type, upsert: false });

  if (uploadError) {
    return internalError(`Storage upload failed: ${uploadError.message}`);
  }

  const { data: signed } = await svc.storage
    .from("social-media")
    .createSignedUrl(storagePath, SIGNED_URL_TTL);

  if (!signed?.signedUrl) {
    return internalError("Failed to generate signed URL after upload.");
  }

  const result = await createMediaAsset({
    companyId,
    sourceUrl: signed.signedUrl,
    mimeType: file.type,
    bytes: file.size,
    uploadedBy: gate.userId,
  });

  if (!result.ok) {
    return internalError(result.error.message);
  }

  return NextResponse.json(
    { ok: true, data: { asset: result.data }, timestamp: new Date().toISOString() },
    { status: 201 },
  );
}
