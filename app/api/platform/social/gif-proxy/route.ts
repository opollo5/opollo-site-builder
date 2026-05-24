import { randomUUID } from "crypto";

import { NextResponse, type NextRequest } from "next/server";

import { internalError, validationError } from "@/lib/http";
import { requireCanDoForApi } from "@/lib/platform/auth/api-gate";
import { createMediaAsset } from "@/lib/platform/social/media";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// POST /api/platform/social/gif-proxy
// Body: { company_id: string, giphy_url: string }
//
// Downloads a GIF from a Giphy CDN URL, stores it in Supabase Storage
// (so we own the asset — Giphy CDN URLs can expire), creates a
// social_media_assets row, and returns the storage URL.
//
// This is necessary because Giphy's URLs are signed with expiry and
// can't be saved as-is in posts that may be scheduled weeks out.
// ---------------------------------------------------------------------------

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_GIF_BYTES = 8 * 1024 * 1024; // 8 MB
const SIGNED_URL_TTL = 365 * 24 * 3600; // 1 year
const UUID_RE = /^[0-9a-f-]{36}$/i;

// Allowed Giphy CDN hostnames: media.giphy.com, media0.giphy.com, media1.giphy.com, …
const GIPHY_HOST_RE = /^media\d*\.giphy\.com$/;

/**
 * Validates that a URL is a safe Giphy CDN URL and returns a reconstructed
 * URL object (breaking the taint chain from user input to fetch).
 * Returns null if the URL is not acceptable.
 */
function parseSafeGiphyUrl(raw: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (!GIPHY_HOST_RE.test(parsed.hostname)) return null;
  // Reconstruct from parsed parts — hostname is now from a trusted URL object,
  // not directly from the user-supplied string.
  return new URL(`https://${parsed.hostname}${parsed.pathname}${parsed.search}`);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return validationError("Request body must be JSON.");
  }

  const { company_id, giphy_url } = body as { company_id?: string; giphy_url?: string };

  if (typeof company_id !== "string" || !UUID_RE.test(company_id)) {
    return validationError("company_id (uuid) is required.");
  }

  const safeGiphyUrl = typeof giphy_url === "string" ? parseSafeGiphyUrl(giphy_url) : null;
  if (!safeGiphyUrl) {
    return validationError("giphy_url must be an https://media*.giphy.com URL.");
  }

  const gate = await requireCanDoForApi(company_id, "edit_post");
  if (gate.kind === "deny") return gate.response;

  // Fetch the GIF from the validated Giphy URL (safeGiphyUrl is a URL object, not raw user input)
  let gifRes: Response;
  try {
    gifRes = await fetch(safeGiphyUrl.href);
  } catch {
    return internalError("Failed to fetch GIF from Giphy.");
  }
  if (!gifRes.ok) {
    return internalError(`Giphy returned ${gifRes.status} for the GIF URL.`);
  }

  const contentType = gifRes.headers.get("content-type") ?? "image/gif";
  if (!contentType.startsWith("image/")) {
    return validationError("Giphy URL did not return an image.");
  }

  const arrayBuffer = await gifRes.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_GIF_BYTES) {
    return validationError("GIF exceeds the 8 MB size limit.");
  }

  const buffer = Buffer.from(arrayBuffer);
  const storagePath = `${company_id}/${randomUUID()}.gif`;

  const svc = getServiceRoleClient();
  const { error: uploadError } = await svc.storage
    .from("social-media")
    .upload(storagePath, buffer, { contentType: "image/gif", upsert: false });

  if (uploadError) {
    return internalError(`Storage upload failed: ${uploadError.message}`);
  }

  const { data: signed } = await svc.storage
    .from("social-media")
    .createSignedUrl(storagePath, SIGNED_URL_TTL);

  if (!signed?.signedUrl) {
    return internalError("Failed to generate signed URL after GIF upload.");
  }

  const result = await createMediaAsset({
    companyId: company_id,
    sourceUrl: signed.signedUrl,
    mimeType: "image/gif",
    bytes: buffer.byteLength,
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
