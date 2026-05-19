export type VoiceTone =
  | "professional-friendly"
  | "authoritative"
  | "conversational"
  | "technical"
  | "irreverent";

export const VOICE_TONE_LABELS: Record<VoiceTone, string> = {
  "professional-friendly": "Professional & Friendly",
  authoritative: "Authoritative",
  conversational: "Conversational",
  technical: "Technical",
  irreverent: "Irreverent",
};
