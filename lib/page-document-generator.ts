/**
 * lib/page-document-generator.ts
 *
 * M16-5 — Pass 2 page document generator. One Haiku call per page.
 *
 * Flow:
 *   1. Check idempotency — if pages.page_document is already set, return cached.
 *   2. Read blueprint, route, shared content.
 *   3. Build user message from site context + component manifest + available refs.
 *   4. Call Haiku (generation). JSON parse failure or schema validation failure
 *      → retry with the error appended (max 3 attempts total: 1 + 2 retries).
 *   5. Copy-quality critique pass (Haiku). If issues found → revise pass (Haiku).
 *      Revise failure is non-fatal — fall back to pre-revise draft.
 *   6. Store page_document to pages table, set html_is_stale = true.
 *
 * Idempotency keys (Anthropic 24h cache):
 *   m16-page-gen-{briefId}-{pageOrdinal}-gen-{attempt}    (1-indexed, 1..3)
 *   m16-page-gen-{briefId}-{pageOrdinal}-critique-1
 *   m16-page-gen-{briefId}-{pageOrdinal}-revise-1
 */

import type { AnthropicCallFn } from "@/lib/anthropic-call";
import { defaultAnthropicCall } from "@/lib/anthropic-call";
import { logger } from "@/lib/logger";
import { MODELS } from "@/lib/models";
import {
  PAGE_CRITIQUE_PROMPT,
  PAGE_GENERATOR_SYSTEM_PROMPT,
  PAGE_REVISE_PROMPT,
} from "@/lib/prompts";
import { COMPONENT_MANIFEST } from "@/lib/component-registry";
import { getSiteBlueprint, type SiteBlueprint } from "@/lib/site-blueprint";
import { getRouteById, listActiveRoutes, type RouteRegistryRow } from "@/lib/route-registry";
import { listSharedContent, type SharedContentRow } from "@/lib/shared-content";
import { getServiceRoleClient } from "@/lib/supabase";
import type { PageDocument, SectionData } from "@/lib/types/page-document";

// ─── TYPES ────────────────────────────────────────────────────────────────────

export type PageGeneratorInput = {
  siteId:      string;
  briefId:     string;
  pageId:      string;
  routeId:     string;
  pageOrdinal: number;
};

export type PageGeneratorResult =
  | {
      ok:       true;
      document: PageDocument;
      pageId:   string;
      cached:   boolean;
    }
  | {
      ok:    false;
      error: { code: string; message: string };
    };

// ─── MAIN ENTRY POINT ─────────────────────────────────────────────────────────

export async function runPageDocumentGenerator(
  input: PageGeneratorInput,
  callFn: AnthropicCallFn = defaultAnthropicCall,
): Promise<PageGeneratorResult> {
  const { siteId, briefId, pageId, routeId, pageOrdinal } = input;
  const svc = getServiceRoleClient();

  // 1. Read page — check idempotency
  const { data: page, error: pageErr } = await svc
    .from("pages")
    .select("id, site_id, slug, page_type, page_document")
    .eq("id", pageId)
    .eq("site_id", siteId)
    .maybeSingle();

  if (pageErr || !page) {
    return { ok: false, error: { code: "PAGE_NOT_FOUND", message: `Page ${pageId} not found.` } };
  }

  if (page.page_document !== null && page.page_document !== undefined) {
    logger.info("page-generator.cached", { siteId, briefId, pageId, pageOrdinal });
    return {
      ok:       true,
      cached:   true,
      pageId,
      document: page.page_document as PageDocument,
    };
  }

  // 2. Read blueprint
  const bpResult = await getSiteBlueprint(siteId);
  if (!bpResult.ok || !bpResult.data) {
    return { ok: false, error: { code: "BLUEPRINT_NOT_FOUND", message: `No blueprint for site ${siteId}.` } };
  }
  const blueprint = bpResult.data;

  // 3. Read route
  const routeResult = await getRouteById(routeId);
  if (!routeResult.ok || !routeResult.data) {
    return { ok: false, error: { code: "ROUTE_NOT_FOUND", message: `Route ${routeId} not found.` } };
  }
  const route = routeResult.data;

  // 4. Read shared content + all routes for available refs
  const [contentResult, routesResult] = await Promise.all([
    listSharedContent(siteId),
    listActiveRoutes(siteId),
  ]);
  const sharedContent = contentResult.ok ? contentResult.data : [];
  const allRoutes     = routesResult.ok  ? routesResult.data  : [];

  // 5. Build user message
  const userMessage = buildUserMessage({
    blueprint,
    route,
    pageId,
    routeId,
    allRoutes,
    sharedContent,
  });

  // 6. Generation loop (max 3 attempts)
  logger.info("page-generator.gen.start", { siteId, briefId, pageId, pageOrdinal, model: MODELS.PAGE_GENERATOR });

  let document: PageDocument | null = null;
  let lastError = "";

  for (let attempt = 1; attempt <= 3; attempt++) {
    const idempotencyKey = `m16-page-gen-${briefId}-${pageOrdinal}-gen-${attempt}`;
    const messages: Array<{ role: "user"; content: string }> = [
      { role: "user", content: attempt === 1 ? userMessage : `${userMessage}\n\nPREVIOUS ATTEMPT FAILED:\n${lastError}\n\nPlease fix the issue and try again.` },
    ];

    let rawText: string;
    try {
      const response = await callFn({
        model:           MODELS.PAGE_GENERATOR,
        max_tokens:      4096,
        system:          PAGE_GENERATOR_SYSTEM_PROMPT,
        messages,
        idempotency_key: idempotencyKey,
      });
      const block = response.content.find(b => b.type === "text");
      rawText = block?.text ?? "";
    } catch (err) {
      logger.error("page-generator.gen.call_error", { siteId, briefId, pageId, attempt, err });
      return {
        ok:    false,
        error: { code: "CLAUDE_ERROR", message: err instanceof Error ? err.message : String(err) },
      };
    }

    const parseResult = parsePageDocument(rawText, pageId, routeId, route.page_type);
    if (parseResult.ok) {
      document = parseResult.data;
      logger.info("page-generator.gen.ok", { siteId, briefId, pageId, attempt });
      break;
    }

    lastError = parseResult.error.message;
    logger.warn("page-generator.gen.attempt_failed", { siteId, briefId, pageId, attempt, error: lastError });

    if (attempt === 3) {
      logger.error("page-generator.gen.max_retries", { siteId, briefId, pageId });
      return { ok: false, error: parseResult.error };
    }
  }

  if (!document) {
    return { ok: false, error: { code: "PARSE_FAILED", message: "Generation did not produce a valid document." } };
  }

  // 7. Critique pass
  const critiqueKey = `m16-page-gen-${briefId}-${pageOrdinal}-critique-1`;
  let critiqueIssues: CritiqueIssue[] = [];

  try {
    const critiqueResponse = await callFn({
      model:           MODELS.PAGE_CRITIQUE,
      max_tokens:      1024,
      system:          PAGE_GENERATOR_SYSTEM_PROMPT,
      messages:        [
        { role: "user",      content: userMessage },
        { role: "assistant", content: JSON.stringify(document) },
        { role: "user",      content: PAGE_CRITIQUE_PROMPT },
      ],
      idempotency_key: critiqueKey,
    });
    const critiqueBlock = critiqueResponse.content.find(b => b.type === "text");
    const critiqueText  = critiqueBlock?.text?.trim() ?? "[]";
    critiqueIssues = parseCritique(critiqueText);
    logger.info("page-generator.critique.ok", { siteId, briefId, pageId, issues: critiqueIssues.length });
  } catch (err) {
    // Non-fatal: log and continue with un-revised document
    logger.warn("page-generator.critique.failed", { siteId, briefId, pageId, err });
  }

  // 8. Revise pass (only when critique found issues)
  if (critiqueIssues.length > 0) {
    const reviseKey = `m16-page-gen-${briefId}-${pageOrdinal}-revise-1`;
    try {
      const reviseResponse = await callFn({
        model:           MODELS.PAGE_REVISE,
        max_tokens:      4096,
        system:          PAGE_GENERATOR_SYSTEM_PROMPT,
        messages:        [
          { role: "user",      content: userMessage },
          { role: "assistant", content: JSON.stringify(document) },
          { role: "user",      content: PAGE_CRITIQUE_PROMPT },
          { role: "assistant", content: JSON.stringify(critiqueIssues) },
          { role: "user",      content: PAGE_REVISE_PROMPT },
        ],
        idempotency_key: reviseKey,
      });
      const reviseBlock = reviseResponse.content.find(b => b.type === "text");
      const reviseText  = reviseBlock?.text ?? "";
      const revised     = parsePageDocument(reviseText, pageId, routeId, route.page_type);
      if (revised.ok) {
        document = revised.data;
        logger.info("page-generator.revise.ok", { siteId, briefId, pageId });
      } else {
        logger.warn("page-generator.revise.parse_failed", { siteId, briefId, pageId, error: revised.error.message });
        // Fall back to pre-revise document — do not fail
      }
    } catch (err) {
      // Non-fatal: log and continue with pre-revise document
      logger.warn("page-generator.revise.failed", { siteId, briefId, pageId, err });
    }
  }

  // 9. Store to DB
  const { error: storeErr } = await svc
    .from("pages")
    .update({
      page_document:  document,
      html_is_stale:  true,
    })
    .eq("id", pageId);

  if (storeErr) {
    logger.error("page-generator.store.failed", { siteId, briefId, pageId, error: storeErr.message });
    return { ok: false, error: { code: "STORE_FAILED", message: "Failed to store page document." } };
  }

  logger.info("page-generator.done", { siteId, briefId, pageId, pageOrdinal });
  return { ok: true, cached: false, pageId, document };
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

type BuildMessageOpts = {
  blueprint:     SiteBlueprint;
  route:         RouteRegistryRow;
  pageId:        string;
  routeId:       string;
  allRoutes:     RouteRegistryRow[];
  sharedContent: SharedContentRow[];
};

function buildUserMessage(opts: BuildMessageOpts): string {
  const { blueprint, route, pageId, routeId, allRoutes, sharedContent } = opts;

  const seoDefaults = blueprint.seo_defaults as Record<string, string>;
  const parts: string[] = [];

  parts.push("SITE CONTEXT");
  parts.push(`Brand: ${blueprint.brand_name}`);
  if (seoDefaults.description) parts.push(`Description: ${seoDefaults.description}`);
  parts.push("");

  parts.push("PAGE SPECIFICATION");
  parts.push(`Page ID: ${pageId}`);
  parts.push(`Route ID: ${routeId}`);
  parts.push(`Slug: ${route.slug}`);
  parts.push(`Page type: ${route.page_type}`);
  parts.push(`Label: ${route.label}`);
  parts.push("");

  parts.push("COMPONENT MANIFEST");
  parts.push(JSON.stringify(COMPONENT_MANIFEST, null, 2));
  parts.push("");

  parts.push("AVAILABLE REFS");

  // CTAs from shared_content
  const ctas = sharedContent.filter(c => c.content_type === "cta");
  if (ctas.length > 0) {
    parts.push("CTAs (use ctaRef with these IDs):");
    for (const cta of ctas) {
      const content = cta.content as Record<string, string>;
      parts.push(`  - id: ${cta.id}, label: ${cta.label}, text: ${content.text ?? ""}`);
    }
  }

  // Routes
  if (allRoutes.length > 0) {
    parts.push("Routes (use routeRef with these IDs):");
    for (const r of allRoutes) {
      parts.push(`  - id: ${r.id}, slug: ${r.slug}, label: ${r.label}`);
    }
  }

  // Testimonials
  const testimonials = sharedContent.filter(c => c.content_type === "testimonial");
  if (testimonials.length > 0) {
    parts.push("Testimonials (use testimonialRef with these IDs):");
    for (const t of testimonials) {
      const content = t.content as Record<string, string>;
      parts.push(`  - id: ${t.id}, label: ${t.label}, author: ${content.author ?? ""}`);
    }
  }

  // Services
  const services = sharedContent.filter(c => c.content_type === "service");
  if (services.length > 0) {
    parts.push("Services (use serviceRefs array with these IDs):");
    for (const s of services) {
      parts.push(`  - id: ${s.id}, label: ${s.label}`);
    }
  }

  // FAQs
  const faqs = sharedContent.filter(c => c.content_type === "faq");
  if (faqs.length > 0) {
    parts.push("FAQs (use faqRefs array with these IDs):");
    for (const f of faqs) {
      const content = f.content as Record<string, string>;
      parts.push(`  - id: ${f.id}, label: ${f.label}, question: ${content.question ?? ""}`);
    }
  }

  parts.push("");
  parts.push("Generate a complete PageDocument JSON for this page.");

  return parts.join("\n");
}

// ─── VALIDATION ───────────────────────────────────────────────────────────────

const VALID_COMPONENT_TYPES = new Set(COMPONENT_MANIFEST.map(e => e.type));
const VALID_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parsePageDocument(
  raw:        string,
  pageId:     string,
  routeId:    string,
  pageType:   string,
): { ok: true; data: PageDocument } | { ok: false; error: { code: string; message: string } } {
  // Strip markdown fences
  let text = raw.trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      ok:    false,
      error: { code: "PARSE_FAILED", message: `Page generator response was not valid JSON. Got: ${text.slice(0, 200)}` },
    };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, error: { code: "PARSE_FAILED", message: "Page generator response was not a JSON object." } };
  }

  const obj = parsed as Record<string, unknown>;

  // schemaVersion
  if (obj.schemaVersion !== 1) {
    return { ok: false, error: { code: "VALIDATION_FAILED", message: "schemaVersion must be 1." } };
  }

  // pageId / routeId identity (allow mismatch warning but not error — LLM may hallucinate)
  // We overwrite them with the canonical values below, so this is just logging.

  // root
  const root = obj.root as Record<string, unknown> | undefined;
  if (typeof root !== "object" || root === null) {
    return { ok: false, error: { code: "VALIDATION_FAILED", message: "root must be an object." } };
  }
  const rootProps = root.props as Record<string, unknown> | undefined;
  if (typeof rootProps !== "object" || rootProps === null) {
    return { ok: false, error: { code: "VALIDATION_FAILED", message: "root.props must be an object." } };
  }
  if (typeof rootProps.title !== "string" || rootProps.title.trim() === "") {
    return { ok: false, error: { code: "VALIDATION_FAILED", message: "root.props.title must be a non-empty string." } };
  }
  if (typeof rootProps.description !== "string") {
    return { ok: false, error: { code: "VALIDATION_FAILED", message: "root.props.description must be a string." } };
  }

  // content
  if (!Array.isArray(obj.content) || obj.content.length === 0) {
    return { ok: false, error: { code: "VALIDATION_FAILED", message: "content must be a non-empty array." } };
  }

  // Validate each section
  for (let i = 0; i < obj.content.length; i++) {
    const section = obj.content[i] as Record<string, unknown>;
    if (typeof section.type !== "string" || !VALID_COMPONENT_TYPES.has(section.type)) {
      return { ok: false, error: { code: "VALIDATION_FAILED", message: `content[${i}].type "${String(section.type)}" is not a valid component type.` } };
    }
    const props = section.props as Record<string, unknown> | undefined;
    if (typeof props !== "object" || props === null) {
      return { ok: false, error: { code: "VALIDATION_FAILED", message: `content[${i}].props must be an object.` } };
    }
    if (typeof props.id !== "string" || !VALID_UUID_RE.test(props.id)) {
      return { ok: false, error: { code: "VALIDATION_FAILED", message: `content[${i}].props.id must be a valid UUID.` } };
    }
    if (typeof props.variant !== "string") {
      return { ok: false, error: { code: "VALIDATION_FAILED", message: `content[${i}].props.variant must be a string.` } };
    }
  }

  // First section must be Hero
  const firstSection = obj.content[0] as SectionData;
  if (firstSection.type !== "Hero") {
    return { ok: false, error: { code: "VALIDATION_FAILED", message: `First section must be type "Hero", got "${firstSection.type}".` } };
  }

  // refs must be an object
  if (typeof obj.refs !== "object" || obj.refs === null || Array.isArray(obj.refs)) {
    return { ok: false, error: { code: "VALIDATION_FAILED", message: "refs must be an object." } };
  }

  // Normalise: overwrite pageId, routeId, pageType with canonical values
  const document: PageDocument = {
    ...(obj as unknown as PageDocument),
    pageId,
    routeId,
    pageType: pageType as PageDocument["pageType"],
    schemaVersion: 1,
  };

  return { ok: true, data: document };
}

// ─── CRITIQUE ─────────────────────────────────────────────────────────────────

type CritiqueIssue = {
  sectionId: string;
  field:     string;
  issue:     string;
};

function parseCritique(raw: string): CritiqueIssue[] {
  let text = raw.trim();
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is CritiqueIssue =>
        typeof item === "object" &&
        item !== null &&
        typeof item.sectionId === "string" &&
        typeof item.field === "string" &&
        typeof item.issue === "string",
    );
  } catch {
    return [];
  }
}
