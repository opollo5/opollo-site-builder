/**
 * lib/ref-resolver.ts
 *
 * M16-6 — resolves a PageDocument's refs (IDs → full objects) in one batch.
 *
 * Takes a PageDocument + the site's shared_content rows + route rows.
 * Returns ResolvedRefs: { [sectionId]: { cta?, route?, testimonial?, services?, faqs? } }
 *
 * This is pure data transformation — no DB calls, no LLM calls.
 * The caller (page-renderer.ts) pre-fetches all shared_content and routes
 * and passes them here so the resolver can run in a single synchronous pass.
 */

import type {
  PageDocument,
  PageRefs,
  ResolvedRefs,
  ResolvedCTA,
  ResolvedRoute,
  ResolvedImage,
  ResolvedTestimonial,
  ResolvedService,
  ResolvedFAQ,
} from "@/lib/types/page-document";
import type { SharedContentRow } from "@/lib/shared-content";
import type { RouteRegistryRow } from "@/lib/route-registry";

// ─── TYPES ────────────────────────────────────────────────────────────────────

export type ResolverDeps = {
  sharedContent: SharedContentRow[];
  routes:        RouteRegistryRow[];
  cssTokens?:    Record<string, string>;  // optional — CSS variable map for tokens key
};

// ─── MAIN ─────────────────────────────────────────────────────────────────────

/**
 * Resolves all refs in a PageDocument to their full objects.
 * Returns a ResolvedRefs map keyed by section ID.
 * Missing refs are silently omitted (they become validation errors, not resolver errors).
 */
export function resolveRefs(doc: PageDocument, deps: ResolverDeps): ResolvedRefs {
  const { sharedContent, routes, cssTokens = {} } = deps;

  // Build lookup maps for O(1) access
  const contentById = new Map<string, SharedContentRow>(sharedContent.map(c => [c.id, c]));
  const routeById   = new Map<string, RouteRegistryRow>(routes.map(r => [r.id, r]));

  const pageRefs: PageRefs = doc.refs ?? {};
  const resolved: ResolvedRefs = { tokens: cssTokens };

  for (const [sectionId, sectionRefs] of Object.entries(pageRefs)) {
    const result: ResolvedRefs[string] = {};

    // CTA
    if (sectionRefs.ctaRef) {
      const row = contentById.get(sectionRefs.ctaRef);
      if (row && row.content_type === "cta") {
        const c = row.content as Record<string, string | null | undefined>;
        const routeRow = c.routeRef ? routeById.get(c.routeRef as string) : null;
        result.cta = {
          id:      row.id,
          text:    String(c.text ?? ""),
          subtext: c.subtext ? String(c.subtext) : undefined,
          url:     routeRow ? routeRow.slug : (c.externalUrl ? String(c.externalUrl) : "#"),
          variant: String(c.variant ?? "primary"),
        } satisfies ResolvedCTA;
      }
    }

    // Route
    if (sectionRefs.routeRef) {
      const row = routeById.get(sectionRefs.routeRef);
      if (row) {
        result.route = {
          id:    row.id,
          slug:  row.slug,
          label: row.label,
        } satisfies ResolvedRoute;
      }
    }

    // Image (stored as-is; image_library fetch is out of scope for M16-6)
    if (sectionRefs.imageRef) {
      result.image = {
        id:  sectionRefs.imageRef,
        url: "",   // populated by a future image-library resolver
        alt: "",
      } satisfies ResolvedImage;
    }

    // Testimonial (single)
    if (sectionRefs.testimonialRef) {
      const row = contentById.get(sectionRefs.testimonialRef);
      if (row && row.content_type === "testimonial") {
        const c = row.content as Record<string, string | undefined>;
        result.testimonial = {
          id:       row.id,
          quote:    String(c.quote ?? ""),
          author:   String(c.author ?? ""),
          role:     c.role,
          company:  c.company,
          imageUrl: c.imageUrl,
        } satisfies ResolvedTestimonial;
      }
    }

    // Services (array)
    if (sectionRefs.serviceRefs && sectionRefs.serviceRefs.length > 0) {
      const services: ResolvedService[] = [];
      for (const sid of sectionRefs.serviceRefs) {
        const row = contentById.get(sid);
        if (row && row.content_type === "service") {
          const c = row.content as Record<string, string | undefined>;
          const routeRow = c.routeRef ? routeById.get(c.routeRef) : undefined;
          services.push({
            id:          row.id,
            name:        String(c.name ?? ""),
            tagline:     String(c.tagline ?? ""),
            description: String(c.description ?? ""),
            iconSlug:    c.iconSlug,
            url:         routeRow ? routeRow.slug : c.url,
          } satisfies ResolvedService);
        }
      }
      if (services.length > 0) result.services = services;
    }

    // FAQs (array)
    if (sectionRefs.faqRefs && sectionRefs.faqRefs.length > 0) {
      const faqs: ResolvedFAQ[] = [];
      for (const fid of sectionRefs.faqRefs) {
        const row = contentById.get(fid);
        if (row && row.content_type === "faq") {
          const c = row.content as Record<string, string>;
          faqs.push({
            id:       row.id,
            question: String(c.question ?? ""),
            answer:   String(c.answer ?? ""),
          } satisfies ResolvedFAQ);
        }
      }
      if (faqs.length > 0) result.faqs = faqs;
    }

    resolved[sectionId] = result;
  }

  return resolved;
}
