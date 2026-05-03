/**
 * lib/generator-payload.ts
 *
 * Assembles the LLM payload for page document generation (Pass 2).
 * Enforces hard caps on every collection passed to the model.
 * Strips objects to summary form — ids + labels only, never full objects.
 *
 * These caps exist because:
 * 1. Large payloads degrade Haiku JSON accuracy
 * 2. Large payloads increase cost silently
 * 3. "Keep small" as intention always drifts — these are code constraints
 */

import type { PageType, SharedContentType } from './types/page-document';

// ─── HARD CAPS ─────────────────────────────────────────────────────────────
// Change these only with a milestone. Never relax without a measured reason.

export const PAYLOAD_CAPS = {
  MAX_CTAS:              20,
  MAX_ROUTES:            20,
  MAX_SHARED_PER_TYPE:   20,
  MAX_IMAGES:            15,
  MAX_BRAND_VOICE_CHARS: 500,
  MAX_TOKEN_SUMMARY_CHARS: 200,
} as const;

// ─── SUMMARY TYPES (what the LLM actually sees) ───────────────────────────

export type CTASummary      = { id: string; label: string; variant: string };
export type RouteSummary    = { id: string; slug: string; label: string };
export type ContentSummary  = { id: string; label: string };
export type ImageSummary    = { id: string; label: string; tags: string[] };

export type ComponentManifestItem = {
  type:          string;
  variant:       string;
  description:   string;   // one sentence
  requiredProps: string[];
  optionalProps: string[];
  acceptsRefs:   string[];
};

export type PageSpec = {
  routeId:  string;
  slug:     string;
  pageType: PageType;
  label:    string;
  goal:     string;  // one sentence: what this page must achieve
};

export type SiteContext = {
  brandName:    string;
  brandVoice:   string;  // condensed to MAX_BRAND_VOICE_CHARS
  tokenSummary: string;  // condensed to MAX_TOKEN_SUMMARY_CHARS
};

export type AvailableRefs = {
  ctas:         CTASummary[];
  routes:       RouteSummary[];
  testimonials: ContentSummary[];
  services:     ContentSummary[];
  faqs:         ContentSummary[];
  images:       ImageSummary[];
};

export type GeneratorPayload = {
  pageSpec:           PageSpec;
  siteContext:        SiteContext;
  componentManifest:  ComponentManifestItem[];
  availableRefs:      AvailableRefs;
};

// ─── PAYLOAD BUILDER ───────────────────────────────────────────────────────

interface RawSharedContent {
  id: string;
  content_type: SharedContentType;
  label: string;
  content: Record<string, unknown>;
}

interface RawImage {
  id: string;
  alt_text: string;
  tags: string[];
  caption: string;
}

interface RawRoute {
  id: string;
  slug: string;
  label: string;
}

interface BuildPayloadOptions {
  pageSpec:          PageSpec;
  siteContext:       SiteContext;
  componentManifest: ComponentManifestItem[];
  sharedContent:     RawSharedContent[];
  routes:            RawRoute[];
  images:            RawImage[];
}

/**
 * Builds the LLM payload with hard caps enforced.
 * Logs a warning when truncation fires — never silently drops items.
 */
export function buildGeneratorPayload(opts: BuildPayloadOptions): GeneratorPayload {
  const {
    pageSpec, componentManifest, sharedContent, routes, images,
  } = opts;

  // Enforce brand voice char cap
  const siteContext: SiteContext = {
    ...opts.siteContext,
    brandVoice: truncateChars(
      opts.siteContext.brandVoice,
      PAYLOAD_CAPS.MAX_BRAND_VOICE_CHARS,
      'brandVoice',
    ),
    tokenSummary: truncateChars(
      opts.siteContext.tokenSummary,
      PAYLOAD_CAPS.MAX_TOKEN_SUMMARY_CHARS,
      'tokenSummary',
    ),
  };

  // CTAs — id + label + variant only
  const allCtas = sharedContent.filter(c => c.content_type === 'cta');
  const ctas = capArray(
    allCtas.map((c): CTASummary => ({
      id:      c.id,
      label:   c.label,
      variant: (c.content.variant as string) ?? 'primary',
    })),
    PAYLOAD_CAPS.MAX_CTAS,
    'ctas',
  );

  // Routes — id + slug + label only
  const cappedRoutes = capArray(
    routes.map((r): RouteSummary => ({ id: r.id, slug: r.slug, label: r.label })),
    PAYLOAD_CAPS.MAX_ROUTES,
    'routes',
  );

  // Testimonials
  const testimonials = capArray(
    sharedContent
      .filter(c => c.content_type === 'testimonial')
      .map((c): ContentSummary => ({ id: c.id, label: c.label })),
    PAYLOAD_CAPS.MAX_SHARED_PER_TYPE,
    'testimonials',
  );

  // Services
  const services = capArray(
    sharedContent
      .filter(c => c.content_type === 'service')
      .map((c): ContentSummary => ({ id: c.id, label: c.label })),
    PAYLOAD_CAPS.MAX_SHARED_PER_TYPE,
    'services',
  );

  // FAQs
  const faqs = capArray(
    sharedContent
      .filter(c => c.content_type === 'faq')
      .map((c): ContentSummary => ({ id: c.id, label: c.label })),
    PAYLOAD_CAPS.MAX_SHARED_PER_TYPE,
    'faqs',
  );

  // Images — id + alt_text truncated + first 3 tags
  const cappedImages = capArray(
    images.map((img): ImageSummary => ({
      id:    img.id,
      label: img.alt_text.slice(0, 80),
      tags:  img.tags.slice(0, 3),
    })),
    PAYLOAD_CAPS.MAX_IMAGES,
    'images',
  );

  return {
    pageSpec,
    siteContext,
    componentManifest,
    availableRefs: {
      ctas,
      routes:       cappedRoutes,
      testimonials,
      services,
      faqs,
      images:       cappedImages,
    },
  };
}

// ─── HELPERS ───────────────────────────────────────────────────────────────

function capArray<T>(arr: T[], max: number, name: string): T[] {
  if (arr.length <= max) return arr;
  console.warn(`[generator-payload] ${name} truncated from ${arr.length} to ${max}`);
  return arr.slice(0, max);
}

function truncateChars(str: string, max: number, name: string): string {
  if (str.length <= max) return str;
  console.warn(`[generator-payload] ${name} truncated from ${str.length} to ${max} chars`);
  return str.slice(0, max);
}
