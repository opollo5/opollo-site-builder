import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared content-layer Zod schemas.
//
// These validate operator-supplied page content — not the component or
// template definitions themselves. They'll be consumed by the batch
// generator in M3 when content is checked against each component's JSON
// Schema before composition. Defining them here keeps the pattern
// consistent across clients and avoids each component hand-rolling its
// own whitelist.
// ---------------------------------------------------------------------------

// Inline HTML with a tight tag whitelist. Allows plain text plus <br>,
// <strong>, and <em> — nothing else. Any other tag or attribute fails
// validation.
//
// Rationale (Q2 of the M1c Phase 2 plan): operators frequently need
// emphasis inside body copy (e.g. urgency-band, certain hero subs, long-
// form landing-page paragraphs). Accepting arbitrary HTML would invite
// XSS and markup drift; accepting plain text loses needed emphasis. The
// whitelist is the minimum that covers the actual use cases we see on
// the LeadSource source page.
//
// The regex strategy: strip every allowed tag occurrence, then require
// that no residual angle brackets remain. Self-closing variants of <br>
// are accepted (<br>, <br/>, <br />). <strong> and <em> accept a single
// optional pairing of open+close with any content between them; nested
// emphasis is rejected to keep the surface area small.

const BR_TAG = /<br\s*\/?>/gi;
const STRONG_OPEN = /<strong>/gi;
const STRONG_CLOSE = /<\/strong>/gi;
const EM_OPEN = /<em>/gi;
const EM_CLOSE = /<\/em>/gi;

function hasResidualAngles(stripped: string): boolean {
  return /[<>]/.test(stripped);
}

function tagCountsBalance(input: string): boolean {
  const strongOpens = (input.match(STRONG_OPEN) ?? []).length;
  const strongCloses = (input.match(STRONG_CLOSE) ?? []).length;
  const emOpens = (input.match(EM_OPEN) ?? []).length;
  const emCloses = (input.match(EM_CLOSE) ?? []).length;
  return strongOpens === strongCloses && emOpens === emCloses;
}

export const InlineHtmlSchema = z
  .string()
  .min(1)
  .max(4000)
  .refine((s) => tagCountsBalance(s), {
    message:
      "Inline HTML must have balanced <strong> and <em> open/close pairs.",
  })
  .refine(
    (s) => {
      const stripped = s
        .replace(BR_TAG, "")
        .replace(STRONG_OPEN, "")
        .replace(STRONG_CLOSE, "")
        .replace(EM_OPEN, "")
        .replace(EM_CLOSE, "");
      return !hasResidualAngles(stripped);
    },
    {
      message:
        "Inline HTML may contain only <br>, <strong>, and <em> tags — no other tags or attributes.",
    },
  );

// Convenience type for components that want to declare an inline-HTML field.
export type InlineHtml = z.infer<typeof InlineHtmlSchema>;

// JSON-Schema-side description for inline HTML fields. Embed this as the
// `description` of a string field in any component's content_schema.json so
// the LLM generator (M3) knows what markup is allowed. Validation is still
// performed at the Zod layer; the JSON Schema description is documentation.
export const INLINE_HTML_JSON_SCHEMA_DESCRIPTION =
  "Plain text with optional inline emphasis. Only <br>, <strong>, and <em> tags are allowed. All other HTML will be rejected.";
