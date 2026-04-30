// DESIGN-DISCOVERY — tone-of-voice multi-select → prose style guide.
//
// The Step-2 input surface offers two multi-selects: a "Personality"
// list (positive markers) and a "Never sound like" list (avoidance
// markers). The spec maps each option to a prose writing instruction;
// we expand the operator's selections into a single style_guide
// string before the Claude tone-extraction call so the model has the
// hard "do this, never that" rules in front of it.

export const PERSONALITY_OPTIONS = [
  "Professional",
  "Friendly",
  "Technical",
  "Straight-talking",
  "Premium",
  "Innovative",
] as const;
export type PersonalityOption = (typeof PERSONALITY_OPTIONS)[number];

export const AVOID_OPTIONS = [
  "Salesy",
  "Jargon-heavy",
  "Overly casual",
  "Corporate robot",
  "Overly technical",
] as const;
export type AvoidOption = (typeof AVOID_OPTIONS)[number];

const PERSONALITY_MAP: Record<PersonalityOption, string> = {
  Professional:
    "Write in second person. Complete sentences. Avoid contractions.",
  Friendly: "Conversational. Contractions fine. Warm but not casual.",
  Technical:
    "Use industry terminology. Assume reader understands IT concepts.",
  "Straight-talking":
    "Sentences under 20 words. No filler. Never write 'we are passionate about' or 'world-class solutions'.",
  Premium:
    "Elevated language. Avoid superlatives. Quality through specificity.",
  Innovative:
    "Forward-looking. Reference outcomes and transformation.",
};

const AVOID_MAP: Record<AvoidOption, string> = {
  Salesy: "No urgency tactics. No 'limited time'. No exclamation marks.",
  "Jargon-heavy":
    "Minimise acronyms. Define technical terms on first use.",
  "Overly casual": "No slang. No emoji. No sentence fragments for effect.",
  "Corporate robot":
    "No passive voice. No 'leverage', 'synergy', 'holistic'. Write like a human.",
  "Overly technical":
    "Lead with business outcomes, not technical specs.",
};

export function buildStyleGuide(
  personality: PersonalityOption[],
  avoid: AvoidOption[],
  target_audience: string | null,
  admired_brand: string | null,
): string {
  const lines: string[] = [];
  if (target_audience && target_audience.trim()) {
    lines.push(`Target audience: ${target_audience.trim()}.`);
  }
  if (personality.length > 0) {
    lines.push("Voice rules:");
    for (const p of personality) {
      lines.push(`- ${p}: ${PERSONALITY_MAP[p]}`);
    }
  }
  if (avoid.length > 0) {
    lines.push("Avoid:");
    for (const a of avoid) {
      lines.push(`- ${a}: ${AVOID_MAP[a]}`);
    }
  }
  if (admired_brand && admired_brand.trim()) {
    lines.push(
      `Reference style: emulate the communication style of ${admired_brand.trim()} where appropriate.`,
    );
  }
  return lines.join("\n");
}
