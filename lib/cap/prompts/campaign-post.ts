import "server-only";

export const PROMPT_VERSION = 1;

const ARC_PHASE_GUIDANCE: Record<string, string> = {
  awareness:
    "WEEK 1 — AWARENESS: Open with a striking statistic, question, or observation about a problem your audience faces. " +
    "Do NOT pitch products or services. Goal: make the reader feel seen and curious. End with a thought-provoking question or statement.",
  education:
    "WEEK 2 — EDUCATION: Share practical insight, a framework, or tips that help the reader understand the solution space. " +
    "Position the author as a knowledgeable guide. No hard sell — the value is in the learning. End with a key takeaway.",
  offer:
    "WEEK 3 — OFFER: Build the case for why action is timely. Reference the problem (week 1) and the solution direction (week 2). " +
    "Include a soft, natural CTA toward the company's services — never pushy. The reader should feel invited, not sold to.",
  proof:
    "WEEK 4 — PROOF: Anchor the campaign with social proof — a result, a transformation, or a generalised case example. " +
    "Reinforce trust and close with a clear, confident CTA.",
};

export function buildCampaignPostSystemMessage(
  performancePriorsBlock?: string,
): string {
  const base =
    "You are a LinkedIn content strategist for Managed Service Provider (MSP) companies. " +
    "You write high-performing, authentic LinkedIn posts that sound human, on-brand, and strategically timed " +
    "within a 4-week campaign arc. Your posts avoid generic platitudes and corporate jargon. " +
    "You always respond with ONLY a JSON object in the exact format requested — no markdown fences, no extra commentary.";

  if (!performancePriorsBlock) return base;
  return base + "\n\n" + performancePriorsBlock;
}

interface BuildCampaignPostUserMessageInput {
  weekNumber: 1 | 2 | 3 | 4;
  arcPhase: "awareness" | "education" | "offer" | "proof";
  monthlyObjective: string;
  month: string;
  tone: string;
  industry: string;
  targetAudience: string;
  bannedWords: string[];
  onBrandPhrases: string[];
  languagePatterns: Record<string, unknown>;
  referencePosts: string[];
}

export function buildCampaignPostUserMessage(
  input: BuildCampaignPostUserMessageInput,
): string {
  const {
    weekNumber,
    arcPhase,
    monthlyObjective,
    month,
    tone,
    industry,
    targetAudience,
    bannedWords,
    onBrandPhrases,
    languagePatterns,
    referencePosts,
  } = input;

  const monthLabel = new Date(month).toLocaleString("en-AU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  const refSection =
    referencePosts.length > 0
      ? `\nEXAMPLE POSTS FROM THIS BRAND (match the voice, not the content):\n${referencePosts
          .slice(0, 3)
          .map((p, i) => `[${i + 1}] ${p}`)
          .join("\n")}`
      : "";

  const patternsSection =
    Object.keys(languagePatterns).length > 0
      ? `\nLANGUAGE PATTERNS: ${JSON.stringify(languagePatterns)}`
      : "";

  return `Write a LinkedIn post for week ${weekNumber} of the ${monthLabel} campaign.

CAMPAIGN OBJECTIVE: ${monthlyObjective}
INDUSTRY: ${industry}
TARGET AUDIENCE: ${targetAudience}
BRAND TONE: ${tone}
ARC PHASE GUIDANCE:
${ARC_PHASE_GUIDANCE[arcPhase]}
${onBrandPhrases.length > 0 ? `\nON-BRAND PHRASES TO WEAVE IN (use naturally, not forcefully):\n${onBrandPhrases.join(", ")}` : ""}
${bannedWords.length > 0 ? `\nBANNED WORDS (never use): ${bannedWords.join(", ")}` : ""}
${patternsSection}
${refSection}

REQUIREMENTS:
- 150–280 words
- No hashtags in the post body
- Conversational yet professional
- No generic openers like "In today's world" or "As we all know"
- No em-dashes
- Blank line between paragraphs

Respond with exactly this JSON (no markdown, no extra keys):
{
  "content": "<the full post text>",
  "hashtags": ["<tag1>", "<tag2>", "<tag3>", "<tag4>", "<tag5>"]
}`;
}
