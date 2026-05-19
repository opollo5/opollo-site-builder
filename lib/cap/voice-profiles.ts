import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import type { VoiceTone } from "@/lib/cap/voice-tone-labels";

export type { VoiceTone };
export { VOICE_TONE_LABELS } from "@/lib/cap/voice-tone-labels";

export interface CapVoiceProfile {
  id: string;
  cap_subscription_id: string;
  name: string;
  tone: VoiceTone;
  language_patterns: Record<string, unknown>;
  banned_words: string[];
  on_brand_phrases: string[];
  industry: string;
  target_audience: string;
  reference_posts: string[];
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export async function listVoiceProfiles(
  subscriptionId: string,
): Promise<CapVoiceProfile[]> {
  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("cap_voice_profiles")
    .select("*")
    .eq("cap_subscription_id", subscriptionId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) {
    logger.warn("cap.voice-profiles.list_failed", { subscriptionId, error: error.message });
    return [];
  }
  return (data ?? []) as CapVoiceProfile[];
}

export async function getVoiceProfile(profileId: string): Promise<CapVoiceProfile | null> {
  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("cap_voice_profiles")
    .select("*")
    .eq("id", profileId)
    .maybeSingle();

  if (error) {
    logger.warn("cap.voice-profiles.get_failed", { profileId, error: error.message });
    return null;
  }
  return data as CapVoiceProfile | null;
}

export interface CreateVoiceProfileInput {
  subscriptionId: string;
  name: string;
  tone: VoiceTone;
  industry: string;
  targetAudience: string;
  bannedWords?: string[];
  onBrandPhrases?: string[];
  languagePatterns?: Record<string, unknown>;
  referencePosts?: string[];
  isDefault?: boolean;
}

export async function createVoiceProfile(
  input: CreateVoiceProfileInput,
): Promise<CapVoiceProfile> {
  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("cap_voice_profiles")
    .insert({
      cap_subscription_id: input.subscriptionId,
      name: input.name,
      tone: input.tone,
      industry: input.industry,
      target_audience: input.targetAudience,
      banned_words: input.bannedWords ?? [],
      on_brand_phrases: input.onBrandPhrases ?? [],
      language_patterns: input.languagePatterns ?? {},
      reference_posts: input.referencePosts ?? [],
      is_default: input.isDefault ?? false,
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create voice profile: ${error.message}`);
  }
  return data as CapVoiceProfile;
}

export type UpdateVoiceProfileInput = Partial<Omit<CreateVoiceProfileInput, "subscriptionId">>;

export async function updateVoiceProfile(
  profileId: string,
  input: UpdateVoiceProfileInput,
): Promise<void> {
  const svc = getServiceRoleClient();
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.tone !== undefined) patch.tone = input.tone;
  if (input.industry !== undefined) patch.industry = input.industry;
  if (input.targetAudience !== undefined) patch.target_audience = input.targetAudience;
  if (input.bannedWords !== undefined) patch.banned_words = input.bannedWords;
  if (input.onBrandPhrases !== undefined) patch.on_brand_phrases = input.onBrandPhrases;
  if (input.languagePatterns !== undefined) patch.language_patterns = input.languagePatterns;
  if (input.referencePosts !== undefined) patch.reference_posts = input.referencePosts;
  if (input.isDefault !== undefined) patch.is_default = input.isDefault;

  const { error } = await svc
    .from("cap_voice_profiles")
    .update(patch)
    .eq("id", profileId);

  if (error) {
    throw new Error(`Failed to update voice profile: ${error.message}`);
  }
}

export async function deleteVoiceProfile(profileId: string): Promise<void> {
  const svc = getServiceRoleClient();
  const { error } = await svc
    .from("cap_voice_profiles")
    .delete()
    .eq("id", profileId);

  if (error) {
    throw new Error(`Failed to delete voice profile: ${error.message}`);
  }
}
