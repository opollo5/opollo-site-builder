import type { SocialPlatform } from "@/lib/platform/social/variants/types";

// ---------------------------------------------------------------------------
// D1 — CAP (Content Automation Platform) types.
//
// CAP generates social post copy from a company's brand profile via Claude.
// Generated posts land in social_post_master with source_type='cap' and
// flow through the normal draft → approval → schedule → publish pipeline.
// ---------------------------------------------------------------------------

export type CAPGenerateInput = {
  companyId: string;
  /** Optional topic hints (1–10). If omitted, brand focus_topics are used. */
  topics?: string[];
  /** Platforms to create variants for. Defaults to all supported. */
  platforms?: SocialPlatform[];
  /** Number of posts to generate (1–5). Defaults to 3. */
  count?: number;
  /** User who triggered generation. */
  triggeredBy: string | null;
};

export type CAPGeneratedPost = {
  postMasterId: string;
  masterText: string;
  /** Keys are SocialPlatform values; values are the generated variant text. */
  variants: Partial<Record<SocialPlatform, string>>;
};

export type CAPGenerateResult =
  | { ok: true; posts: CAPGeneratedPost[] }
  | { ok: false; error: { code: string; message: string } };

/** Shape Claude must return inside its JSON response. */
export type CAPClaudePost = {
  master_text: string;
  variants: Partial<Record<SocialPlatform, string>>;
};

export type CAPClaudeResponse = {
  posts: CAPClaudePost[];
};
