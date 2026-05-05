import type { BrandProfile } from "@/lib/platform/brand/types";
import type { SocialPlatform } from "@/lib/platform/social/variants/types";

// ---------------------------------------------------------------------------
// D1 — CAP prompt builder.
//
// Builds the system + user prompt pair for Claude from a brand profile +
// generation request. All constraints come from the brand profile or
// hard-coded platform rules — no free-form user input reaches Claude.
// ---------------------------------------------------------------------------

/** Character budgets per platform (conservative — leaves room for hashtags). */
export const PLATFORM_CHAR_LIMITS: Record<SocialPlatform, number> = {
  linkedin_company: 2800,
  linkedin_personal: 2800,
  facebook_page: 450,
  x: 270,
  gbp: 1400,
};

const PLATFORM_GUIDANCE: Record<SocialPlatform, string> = {
  linkedin_company:
    "Professional tone, thought-leadership framing. 1–3 paragraphs. Avoid casual slang.",
  linkedin_personal:
    "Conversational professional tone. First-person voice appropriate. 1–3 paragraphs.",
  facebook_page:
    "Warm and engaging. Shorter than LinkedIn. Encourage interaction. Emojis OK if brand allows.",
  x: "Punchy, direct. No thread — single tweet only. Fit in the character limit.",
  gbp:
    "Local-business-friendly. Highlight offers, events, or services. Clear call to action.",
};

function hashtagInstruction(
  strategy: BrandProfile["hashtag_strategy"],
): string {
  switch (strategy) {
    case "none":
      return "Include NO hashtags.";
    case "minimal":
      return "Include 1–2 relevant hashtags maximum.";
    case "standard":
      return "Include 3–5 relevant hashtags.";
    case "heavy":
      return "Include 5–10 relevant hashtags.";
    default:
      return "Include 2–3 relevant hashtags if appropriate for the platform.";
  }
}

function postLengthInstruction(
  length: BrandProfile["max_post_length"],
  platform: SocialPlatform,
): string {
  const limit = PLATFORM_CHAR_LIMITS[platform];
  switch (length) {
    case "short":
      return `Keep concise — aim for under ${Math.round(limit * 0.4)} characters.`;
    case "long":
      return `Use the full available space — aim for ${Math.round(limit * 0.8)}+ characters.`;
    default:
      return `Aim for ${Math.round(limit * 0.6)} characters.`;
  }
}

export function buildSystemPrompt(
  brand: BrandProfile | null,
  platforms: SocialPlatform[],
): string {
  const sections: string[] = [];

  sections.push(
    "You are a social media copywriter generating posts for a business. " +
      "You must return ONLY valid JSON matching the schema provided. No markdown fences, no explanations.",
  );

  if (brand) {
    const voice: string[] = [];
    if (brand.personality_traits.length > 0) {
      voice.push(`Personality: ${brand.personality_traits.join(", ")}.`);
    }
    if (brand.formality) {
      const formalityMap: Record<string, string> = {
        formal: "Use formal, professional language.",
        semi_formal: "Use a semi-formal tone — professional but approachable.",
        casual: "Use a casual, conversational tone.",
      };
      voice.push(formalityMap[brand.formality] ?? "");
    }
    if (brand.point_of_view) {
      voice.push(
        brand.point_of_view === "first_person"
          ? "Write in first person (we/our)."
          : "Write in third person.",
      );
    }
    if (brand.preferred_vocabulary.length > 0) {
      voice.push(
        `Preferred vocabulary: ${brand.preferred_vocabulary.join(", ")}.`,
      );
    }
    if (brand.avoided_terms.length > 0) {
      voice.push(
        `Never use these terms: ${brand.avoided_terms.join(", ")}.`,
      );
    }
    if (brand.voice_examples.length > 0) {
      const examples = brand.voice_examples.slice(0, 3);
      voice.push(
        `Voice examples (match this style):\n${examples.map((e) => `- "${e}"`).join("\n")}`,
      );
    }
    if (voice.length > 0) {
      sections.push("## Brand Voice\n" + voice.join("\n"));
    }

    if (brand.content_restrictions.length > 0) {
      sections.push(
        "## Hard Content Rules (never violate)\n" +
          brand.content_restrictions.map((r) => `- ${r}`).join("\n"),
      );
    }

    if (brand.avoided_topics.length > 0) {
      sections.push(
        "## Avoided Topics (never mention)\n" +
          brand.avoided_topics.map((t) => `- ${t}`).join("\n"),
      );
    }
  }

  const platformRules = platforms
    .map(
      (p) =>
        `**${p}** (max ${PLATFORM_CHAR_LIMITS[p]} chars): ${PLATFORM_GUIDANCE[p]}`,
    )
    .join("\n");
  sections.push("## Platform Rules\n" + platformRules);

  sections.push(
    '## Output Format\n' +
      'Return ONLY this JSON structure (no markdown, no wrapper text):\n' +
      '{\n' +
      '  "posts": [\n' +
      '    {\n' +
      '      "master_text": "<full LinkedIn-length text — the canonical version>",\n' +
      '      "variants": {\n' +
      platforms.map((p) => `        "${p}": "<platform-specific text>"`).join(",\n") +
      '\n      }\n' +
      '    }\n' +
      '  ]\n' +
      '}\n' +
      'The "variants" object must contain a key for EVERY platform listed above. ' +
      'master_text is the canonical full version (LinkedIn-length). ' +
      'Each variant is adapted for its platform character limit and style.',
  );

  return sections.join("\n\n");
}

export function buildUserPrompt(
  brand: BrandProfile | null,
  topics: string[],
  count: number,
): string {
  const topicList =
    topics.length > 0
      ? topics
      : brand?.focus_topics.length
        ? brand.focus_topics.slice(0, 5)
        : ["our products and services"];

  const industry = brand?.industry ?? "the industry";
  const hashtags = hashtagInstruction(brand?.hashtag_strategy ?? null);

  return (
    `Generate exactly ${count} social media post${count > 1 ? "s" : ""} about ${industry}.\n\n` +
    `Topic${topicList.length > 1 ? "s" : ""} to cover: ${topicList.join("; ")}\n\n` +
    `Hashtag rule: ${hashtags}\n\n` +
    `Each post must be unique — vary the angle, hook, and structure.\n` +
    `Return all ${count} post${count > 1 ? "s" : ""} in the JSON array.`
  );
}
