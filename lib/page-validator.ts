/**
 * lib/page-validator.ts
 *
 * Validates a PageDocument against schema, component registry, and ref tables.
 * Zero LLM calls. Pure TypeScript. Fast. Free.
 *
 * Call this after every generation pass and before every approve/publish action.
 * Pages with errors are held in 'awaiting_review' and shown to the operator
 * with the relevant section highlighted in the prop editor.
 */

import type {
  PageDocument,
  ComponentRegistry,
  ValidationResult,
  ValidationError,
  ValidationWarning,
} from './types/page-document';

interface ValidatorDeps {
  /** All component types + variants in the registry */
  componentRegistry: ComponentRegistry;
  /** Current route_registry rows for this site */
  routes: { id: string; status: string }[];
  /** Current shared_content rows for this site */
  sharedContent: { id: string; content_type: string }[];
}

/**
 * Validates a PageDocument.
 * Returns ValidationResult with errors[] and warnings[].
 * passedAt is set only when errors is empty.
 */
export function validatePageDocument(
  doc: PageDocument,
  deps: ValidatorDeps,
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  const { componentRegistry, routes, sharedContent } = deps;

  // ── Build lookup sets ───────────────────────────────────────────────────

  const validComponentKeys = new Set<string>();
  for (const [type, variants] of Object.entries(componentRegistry)) {
    for (const variant of Object.keys(variants)) {
      validComponentKeys.add(`${type}:${variant}`);
    }
  }

  const routeIds = new Set(routes.map(r => r.id));
  const contentIds = new Set(sharedContent.map(c => c.id));
  const ctaIds = new Set(
    sharedContent.filter(c => c.content_type === 'cta').map(c => c.id),
  );
  const testimonialIds = new Set(
    sharedContent.filter(c => c.content_type === 'testimonial').map(c => c.id),
  );
  const serviceIds = new Set(
    sharedContent.filter(c => c.content_type === 'service').map(c => c.id),
  );
  const faqIds = new Set(
    sharedContent.filter(c => c.content_type === 'faq').map(c => c.id),
  );

  // ── SEO checks ─────────────────────────────────────────────────────────

  if (!doc.root.props.title?.trim()) {
    errors.push({ code: 'SEO_TITLE_MISSING', sectionId: null });
  } else if (doc.root.props.title.length > 70) {
    warnings.push({ code: 'SEO_TITLE_TOO_LONG', detail: `${doc.root.props.title.length} chars (max 70)` });
  }

  if (!doc.root.props.description?.trim()) {
    errors.push({ code: 'SEO_DESC_MISSING', sectionId: null });
  } else if (doc.root.props.description.length > 160) {
    warnings.push({ code: 'SEO_DESC_TOO_LONG', detail: `${doc.root.props.description.length} chars (max 160)` });
  }

  // ── Section structure ───────────────────────────────────────────────────

  if (doc.content.length === 0) {
    errors.push({ code: 'NO_SECTIONS', sectionId: null });
  }

  if (doc.content.length > 0 && doc.content[0].type !== 'Hero') {
    warnings.push({ code: 'FIRST_SECTION_NOT_HERO', detail: doc.content[0].type });
  }

  // ── Duplicate section IDs ───────────────────────────────────────────────

  const sectionIds = doc.content.map(s => s.props.id);
  const seen = new Set<string>();
  for (const id of sectionIds) {
    if (seen.has(id as string)) {
      errors.push({ code: 'DUPLICATE_SECTION_IDS', sectionId: id as string });
    }
    seen.add(id as string);
  }

  // ── Per-section validation ──────────────────────────────────────────────

  for (const section of doc.content) {
    const sectionId = section.props.id as string;

    // Component type + variant must exist in registry
    const key = `${section.type}:${section.props.variant}`;
    if (!validComponentKeys.has(key)) {
      errors.push({
        code: 'INVALID_COMPONENT_TYPE',
        sectionId,
        detail: `"${key}" is not in the component registry`,
      });
    }

    // Props must not contain hardcoded internal URL strings
    // This is the most important rule — internal links must be routeRefs
    for (const [propKey, propValue] of Object.entries(section.props)) {
      if (propKey === 'id') continue;
      if (typeof propValue === 'string') {
        if (propValue.startsWith('/') || propValue.match(/^https?:\/\//)) {
          errors.push({
            code: 'HARDCODED_URL_IN_PROPS',
            sectionId,
            detail: `props.${propKey} = "${propValue.slice(0, 60)}"`,
          });
        }
      }
      // Check nested objects and arrays for hardcoded URLs
      if (typeof propValue === 'object' && propValue !== null) {
        const nestedErrors = findHardcodedUrls(propValue, propKey);
        for (const detail of nestedErrors) {
          errors.push({ code: 'HARDCODED_URL_IN_PROPS', sectionId, detail });
        }
      }
    }

    // Ref validation
    const refs = doc.refs?.[sectionId];
    if (refs) {
      if (refs.routeRef && !routeIds.has(refs.routeRef)) {
        errors.push({
          code: 'BROKEN_ROUTE_REF',
          sectionId,
          detail: `route_registry.id "${refs.routeRef}" not found`,
        });
      }

      if (refs.ctaRef && !ctaIds.has(refs.ctaRef)) {
        errors.push({
          code: 'BROKEN_CTA_REF',
          sectionId,
          detail: `shared_content.id "${refs.ctaRef}" not found or wrong type`,
        });
      }

      if (refs.testimonialRef && !testimonialIds.has(refs.testimonialRef)) {
        errors.push({
          code: 'BROKEN_TESTIMONIAL_REF',
          sectionId,
          detail: `shared_content.id "${refs.testimonialRef}" not found`,
        });
      }

      if (refs.imageRef) {
        // image_library ref — warn only (images may not be transferred yet)
        warnings.push({
          code: 'IMAGE_REF_UNVERIFIED',
          detail: `imageRef "${refs.imageRef}" existence not verified at validation time`,
        });
      }

      if (refs.serviceRefs) {
        for (const sid of refs.serviceRefs) {
          if (!serviceIds.has(sid)) {
            errors.push({
              code: 'BROKEN_SERVICE_REF',
              sectionId,
              detail: `shared_content.id "${sid}" not found`,
            });
          }
        }
      }

      if (refs.faqRefs) {
        for (const fid of refs.faqRefs) {
          if (!faqIds.has(fid)) {
            errors.push({
              code: 'BROKEN_FAQ_REF',
              sectionId,
              detail: `shared_content.id "${fid}" not found`,
            });
          }
        }
      }
    }
  }

  // ── Schema version ──────────────────────────────────────────────────────

  if (doc.schemaVersion !== 1) {
    errors.push({
      code: 'UNSUPPORTED_SCHEMA_VERSION',
      sectionId: null,
      detail: `got ${doc.schemaVersion}, expected 1`,
    });
  }

  return {
    errors,
    warnings,
    passedAt: errors.length === 0 ? new Date() : null,
  };
}

/**
 * Recursively finds hardcoded URL strings inside nested objects/arrays.
 * Returns detail strings for each violation found.
 */
function findHardcodedUrls(
  value: unknown,
  path: string,
  found: string[] = [],
): string[] {
  if (typeof value === 'string') {
    if (value.startsWith('/') || value.match(/^https?:\/\//)) {
      found.push(`${path} = "${value.slice(0, 60)}"`);
    }
  } else if (Array.isArray(value)) {
    value.forEach((item, i) => findHardcodedUrls(item, `${path}[${i}]`, found));
  } else if (typeof value === 'object' && value !== null) {
    for (const [k, v] of Object.entries(value)) {
      findHardcodedUrls(v, `${path}.${k}`, found);
    }
  }
  return found;
}

// ─── ERROR CODE REFERENCE ─────────────────────────────────────────────────
// Keep this up to date. Operator-facing messages are derived from these.

export const VALIDATION_ERROR_MESSAGES: Record<string, string> = {
  SEO_TITLE_MISSING:         'Page is missing a title (required for SEO)',
  SEO_DESC_MISSING:          'Page is missing a meta description (required for SEO)',
  SEO_TITLE_TOO_LONG:        'Title exceeds 70 characters',
  SEO_DESC_TOO_LONG:         'Meta description exceeds 160 characters',
  NO_SECTIONS:               'Page has no sections',
  FIRST_SECTION_NOT_HERO:    'First section should be a Hero component',
  DUPLICATE_SECTION_IDS:     'Two sections share the same ID — regenerate this page',
  INVALID_COMPONENT_TYPE:    'Section uses a component type not in the registry',
  HARDCODED_URL_IN_PROPS:    'Section contains a hardcoded URL — use a route ref instead',
  BROKEN_ROUTE_REF:          'Section links to a route that does not exist',
  BROKEN_CTA_REF:            'Section references a CTA that does not exist',
  BROKEN_TESTIMONIAL_REF:    'Section references a testimonial that does not exist',
  BROKEN_SERVICE_REF:        'Section references a service that does not exist',
  BROKEN_FAQ_REF:            'Section references an FAQ that does not exist',
  UNSUPPORTED_SCHEMA_VERSION:'Page document version is not supported — regenerate',
};
