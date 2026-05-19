import { NextResponse, type NextRequest } from "next/server";

import { validationError, internalError } from "@/lib/http";
import { requireCapOperatorForApi } from "@/lib/cap/api-gate";
import {
  updateVoiceProfile,
  deleteVoiceProfile,
  type VoiceTone,
} from "@/lib/cap/voice-profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-fA-F-]{36}$/;
const VALID_TONES = new Set<VoiceTone>([
  "professional-friendly",
  "authoritative",
  "conversational",
  "technical",
  "irreverent",
]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; profileId: string }> },
): Promise<NextResponse> {
  const { id, profileId } = await params;
  if (!UUID_RE.test(id) || !UUID_RE.test(profileId)) {
    return validationError("id and profileId must be UUIDs.");
  }

  const gate = await requireCapOperatorForApi();
  if (gate.kind === "deny") return gate.response;

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return validationError("Request body must be JSON.");
  }

  const patch: Record<string, unknown> = {};

  if (body.name !== undefined) {
    if (typeof body.name !== "string" || body.name.trim().length === 0) {
      return validationError("name must be a non-empty string.");
    }
    patch.name = body.name.trim();
  }
  if (body.tone !== undefined) {
    if (typeof body.tone !== "string" || !VALID_TONES.has(body.tone as VoiceTone)) {
      return validationError("tone is invalid.");
    }
    patch.tone = body.tone as VoiceTone;
  }
  if (body.industry !== undefined) patch.industry = String(body.industry).trim();
  if (body.target_audience !== undefined) patch.targetAudience = String(body.target_audience).trim();
  if (body.banned_words !== undefined && Array.isArray(body.banned_words)) {
    patch.bannedWords = (body.banned_words as unknown[]).filter((w): w is string => typeof w === "string");
  }
  if (body.on_brand_phrases !== undefined && Array.isArray(body.on_brand_phrases)) {
    patch.onBrandPhrases = (body.on_brand_phrases as unknown[]).filter((p): p is string => typeof p === "string");
  }
  if (body.reference_posts !== undefined && Array.isArray(body.reference_posts)) {
    patch.referencePosts = (body.reference_posts as unknown[]).filter((p): p is string => typeof p === "string");
  }
  if (body.is_default !== undefined) patch.isDefault = body.is_default === true;

  try {
    await updateVoiceProfile(profileId, patch);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    return internalError(err instanceof Error ? err.message : "Failed to update voice profile");
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; profileId: string }> },
): Promise<NextResponse> {
  const { id, profileId } = await params;
  if (!UUID_RE.test(id) || !UUID_RE.test(profileId)) {
    return validationError("id and profileId must be UUIDs.");
  }

  const gate = await requireCapOperatorForApi();
  if (gate.kind === "deny") return gate.response;

  try {
    await deleteVoiceProfile(profileId);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    return internalError(err instanceof Error ? err.message : "Failed to delete voice profile");
  }
}
