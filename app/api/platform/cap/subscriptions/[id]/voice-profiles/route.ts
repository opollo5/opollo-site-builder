import { NextResponse, type NextRequest } from "next/server";

import { validationError, internalError } from "@/lib/http";
import { requireCapOperatorForApi } from "@/lib/cap/api-gate";
import {
  listVoiceProfiles,
  createVoiceProfile,
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

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!UUID_RE.test(id)) return validationError("id must be a UUID.");

  const gate = await requireCapOperatorForApi();
  if (gate.kind === "deny") return gate.response;

  const profiles = await listVoiceProfiles(id);
  return NextResponse.json({ ok: true, data: profiles }, { status: 200 });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!UUID_RE.test(id)) return validationError("id must be a UUID.");

  const gate = await requireCapOperatorForApi();
  if (gate.kind === "deny") return gate.response;

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return validationError("Request body must be JSON.");
  }

  const { name, tone, industry, target_audience, banned_words, on_brand_phrases, reference_posts, is_default } = body;

  if (typeof name !== "string" || name.trim().length === 0) {
    return validationError("name is required.");
  }
  if (typeof tone !== "string" || !VALID_TONES.has(tone as VoiceTone)) {
    return validationError("tone must be one of: professional-friendly, authoritative, conversational, technical, irreverent.");
  }
  if (typeof industry !== "string" || industry.trim().length === 0) {
    return validationError("industry is required.");
  }
  if (typeof target_audience !== "string" || target_audience.trim().length === 0) {
    return validationError("target_audience is required.");
  }

  try {
    const profile = await createVoiceProfile({
      subscriptionId: id,
      name: name.trim(),
      tone: tone as VoiceTone,
      industry: industry.trim(),
      targetAudience: target_audience.trim(),
      bannedWords: Array.isArray(banned_words) ? (banned_words as string[]).filter((w): w is string => typeof w === "string") : [],
      onBrandPhrases: Array.isArray(on_brand_phrases) ? (on_brand_phrases as string[]).filter((p): p is string => typeof p === "string") : [],
      referencePosts: Array.isArray(reference_posts) ? (reference_posts as string[]).filter((p): p is string => typeof p === "string") : [],
      isDefault: is_default === true,
    });
    return NextResponse.json({ ok: true, data: profile }, { status: 201 });
  } catch (err) {
    return internalError(err instanceof Error ? err.message : "Failed to create voice profile");
  }
}
