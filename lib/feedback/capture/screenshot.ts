import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

const BUCKET = "feedback-screenshots";
const SIGNED_URL_TTL_SECONDS = 3600; // 1 hour

type MintUploadUrlResult =
  | { ok: true; uploadUrl: string; objectPath: string }
  | { ok: false; error: string };

// Generate a short-lived signed upload URL for a screenshot. The client
// uploads directly to storage; the object path is then stored on the ticket.
export async function mintUploadUrl(
  contentType: string,
): Promise<MintUploadUrlResult> {
  const svc = getServiceRoleClient();
  const objectPath = `screenshots/${Date.now()}-${Math.random().toString(36).slice(2)}.png`;

  const { data, error } = await svc.storage
    .from(BUCKET)
    .createSignedUploadUrl(objectPath);

  if (error) {
    logger.error("feedback.screenshot.mint_upload_url_failed", { err: error.message });
    return { ok: false, error: error.message };
  }

  return { ok: true, uploadUrl: data.signedUrl, objectPath };
}

// Resolve a stored object path to a short-lived signed download URL.
// Never persist signed URLs — call this at render time.
export async function resolveSignedUrl(objectPath: string): Promise<string | null> {
  const svc = getServiceRoleClient();
  const { data, error } = await svc.storage
    .from(BUCKET)
    .createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS);

  if (error) {
    logger.error("feedback.screenshot.resolve_signed_url_failed", {
      path: objectPath,
      err: error.message,
    });
    return null;
  }

  return data.signedUrl;
}
