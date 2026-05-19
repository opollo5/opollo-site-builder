import "server-only";

export const IMAGE_PROMPT_VERSION = 1;

const ARC_PHASE_VISUAL_TONE: Record<string, string> = {
  awareness: "thought-provoking, slightly dramatic, evoking a challenge or tension",
  education: "clear, informative, professional whitespace, diagrams or people collaborating",
  offer: "optimistic, action-oriented, warm light, forward momentum",
  proof: "confident, celebratory, trustworthy, evidence of success",
};

interface BuildImagePromptInput {
  arcPhase: "awareness" | "education" | "offer" | "proof";
  industry: string;
  postContentSummary: string;
}

export function buildImagePrompt(input: BuildImagePromptInput): string {
  const { arcPhase, industry, postContentSummary } = input;
  const visualTone = ARC_PHASE_VISUAL_TONE[arcPhase];

  return (
    `Professional LinkedIn post image for a ${industry} company. ` +
    `Visual tone: ${visualTone}. ` +
    `The post is about: ${postContentSummary.slice(0, 120)}. ` +
    `Style: clean corporate photography or flat illustration, no text overlays, ` +
    `16:9 aspect ratio, high resolution, suitable for professional social media.`
  );
}
