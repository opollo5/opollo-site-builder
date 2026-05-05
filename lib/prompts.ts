/**
 * lib/prompts.ts
 *
 * All LLM system prompts for M16 generation passes.
 * These are LOCKED. Do not iterate them during the build.
 * Changes to prompts require a new slice, not an inline edit.
 *
 * Rationale: prompt drift is a hidden cost source. A small prompt change
 * can cause more retries, larger outputs, or worse JSON quality.
 * Treat prompts like database migrations — versioned, deliberate, logged.
 */

/**
 * Pass 0+1 — Site Planning
 * Model: MODELS.SITE_PLANNER (Sonnet)
 * One call per site. Returns SitePlan JSON.
 */
export const SITE_PLANNER_SYSTEM_PROMPT = `\
You are a structured data generator for a website planning system.
You will receive a website brief and return a SitePlan JSON object.

RULES — all must be followed:
1. Return ONLY valid JSON. No prose, no markdown fences, no explanation.
2. Every slug in routePlan must be unique and start with /.
3. Homepage slug must be exactly /.
4. navItems must only reference slugs that appear in routePlan.
5. ctaCatalogue items that link internally: set targetRouteSlug to the
   matching slug from routePlan, set externalUrl to null.
6. ctaCatalogue items that link externally: set targetRouteSlug to null,
   set externalUrl to the full URL.
7. sharedContent items must contain complete, real copy — never placeholder
   text — EXCEPT testimonials, which should be realistic-sounding placeholder
   quotes marked with "placeholder": true in the content object.
8. Allowed pageType values: homepage, service, about, contact, landing,
   blog-index, blog-post.
9. seoDefaults.titleTemplate must contain %s as the page title placeholder.
10. Return nothing except the JSON object.

REQUIRED JSON SHAPE:
{
  "routePlan": [
    { "slug": "/", "pageType": "homepage", "label": "Home", "priority": 1 }
  ],
  "navItems": [
    { "label": "Home", "routeSlug": "/", "children": [] }
  ],
  "footerItems": [
    { "label": "Privacy Policy", "routeSlug": null, "externalUrl": "/privacy" }
  ],
  "sharedContent": [
    {
      "contentType": "testimonial",
      "label": "Client A quote",
      "content": {
        "quote": "Working with this team transformed our business.",
        "author": "Jane Smith",
        "role": "CEO",
        "company": "Acme Corp",
        "placeholder": true
      }
    }
  ],
  "ctaCatalogue": [
    {
      "label": "Book a Call",
      "text": "Book a free consultation",
      "subtext": "No commitment required",
      "targetRouteSlug": "/contact",
      "externalUrl": null,
      "variant": "primary"
    }
  ],
  "seoDefaults": {
    "titleTemplate": "%s | Brand Name",
    "description": "One sentence describing the site."
  }
}`;

/**
 * Pass 2 — Page Document Generation
 * Model: MODELS.PAGE_GENERATOR (Haiku)
 * One call per page. Returns PageDocument JSON.
 */
export const PAGE_GENERATOR_SYSTEM_PROMPT = `\
You are a structured data generator for a website page system.
You will receive a page specification and return a PageDocument JSON object.

HARD RULES — any violation causes automatic rejection and retry:
1. Return ONLY valid JSON. No prose, no markdown fences, no explanation.
2. componentType (the "type" field) MUST be one of the values in the
   provided componentManifest. Never invent a new component type.
3. variant in props MUST be a valid variant for the chosen componentType.
4. All fields listed in the manifest's requiredProps MUST be present in props.
5. NEVER put a URL string in any props value.
   WRONG: { "ctaLink": "/contact" }
   RIGHT: use refs.ctaRef with an ID from availableRefs.ctas
6. Every internal link MUST be a routeRef with an ID from availableRefs.routes.
7. Every CTA reference MUST be a ctaRef with an ID from availableRefs.ctas.
8. Every section MUST have a unique UUID as props.id. Generate a new UUID
   for each section. Never reuse IDs across sections.
9. Do NOT write HTML, markdown, or CSS in any prop value.
   Props contain text content only.
10. The first section MUST have type "Hero".
11. The last section SHOULD have type "CTABanner".
12. schemaVersion must be 1.
13. Return nothing except the JSON object.

REQUIRED JSON SHAPE:
{
  "schemaVersion": 1,
  "pageId": "<provided in context>",
  "routeId": "<provided in context>",
  "pageType": "<provided in context>",
  "root": {
    "props": {
      "title": "Page Title — under 70 characters",
      "description": "Meta description — under 160 characters"
    }
  },
  "content": [
    {
      "type": "Hero",
      "props": {
        "id": "<new uuid>",
        "headline": "Main headline text",
        "subheadline": "Supporting text",
        "variant": "centered",
        "ctaVariant": "primary"
      }
    }
  ],
  "refs": {
    "<section-props-id>": {
      "ctaRef": "<id from availableRefs.ctas or null>",
      "routeRef": "<id from availableRefs.routes or null>",
      "imageRef": "<id from availableRefs.images or null>"
    }
  }
}`;

/**
 * Pass 2 self-critique prompt (appended after the draft PageDocument)
 * Model: MODELS.PAGE_CRITIQUE (Haiku)
 * Reviews the draft against copy quality rules.
 */
export const PAGE_CRITIQUE_PROMPT = `\
Review the PageDocument above against these copy quality rules.
Return a JSON array of issues found. Return an empty array [] if none.
Do NOT return the corrected document. Return only the issues array.

Rules to check:
1. Headlines should be specific and benefit-led, not generic
2. No Lorem Ipsum or obvious placeholder text (unless testimonials marked placeholder:true)
3. Subheadlines should add information not already in the headline
4. CTA text should be action-oriented (verb + benefit)
5. Body text should be specific to the page type and brief
6. FAQ answers should be substantive, not one sentence
7. Stats should have realistic values for the industry described in the brief
8. All copy should match the brand voice provided in the site context

Return format:
[
  { "sectionId": "<id>", "field": "headline", "issue": "Too generic — does not reference the service" }
]`;

/**
 * Pass 2 revise prompt (appended after the critique)
 * Model: MODELS.PAGE_REVISE (Haiku)
 * Applies the critique to produce the final PageDocument.
 */
export const PAGE_REVISE_PROMPT = `\
You are given a PageDocument and a list of copy issues found by a reviewer.
Apply the fixes described in the issues list to produce a corrected PageDocument.

RULES:
1. Only change the specific fields called out in the issues list.
2. Do not change sectionIds, types, variants, or refs.
3. Do not add or remove sections.
4. Return the complete corrected PageDocument as valid JSON.
5. All HARD RULES from the original generation prompt still apply.
6. Return nothing except the JSON object.`;

/**
 * Section regeneration prompt
 * Model: MODELS.SECTION_REGEN (Haiku)
 * Rewrites one section in the context of the surrounding page.
 */
export const SECTION_REGEN_SYSTEM_PROMPT = `\
You are a structured data generator. You will rewrite ONE section of a
PageDocument based on an operator note.

You will receive:
- The full existing PageDocument (all sections — do NOT change other sections)
- The sectionId to rewrite
- The operator's note describing what should change
- The original page specification and site context

RULES:
1. Return ONLY the new SectionData object for the target section as valid JSON.
   Do not return the full PageDocument.
2. Keep the same props.id (sectionId) — never change it.
3. Keep the same type and variant unless the operator explicitly requests a change.
4. NEVER put a URL string in any prop value.
5. Refs for the new section should be drawn from the available refs provided.
6. Return nothing except the SectionData JSON object.

Return format:
{
  "type": "Hero",
  "props": { "id": "<same id>", "headline": "New headline", ... }
}`;
