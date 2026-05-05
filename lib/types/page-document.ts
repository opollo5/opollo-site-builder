/**
 * lib/types/page-document.ts
 *
 * Canonical type definitions for the Opollo site graph.
 *
 * Core types (SectionData, PageRoot, Fields, Field subtypes) are copied
 * from puckeditor/puck packages/core/src/types/Data.ts and Config.ts.
 * Source: https://github.com/measuredco/puck (MIT license)
 * Renamed: Data → PageDocument, ComponentData → SectionData
 * Added: Opollo-specific fields marked // OPOLLO
 *
 * Do not redesign these types. They are the proven Puck data model.
 */

// ─── COPIED FROM puckeditor/puck ──────────────────────────────────────────

export type DefaultComponentProps = Record<string, unknown>;

/**
 * One section in a page. Equivalent to Puck's ComponentData.
 * type must match a key in componentRegistry.
 * props.id is a stable UUID that never changes across revisions.
 */
export type SectionData = {
  type: string;
  props: Record<string, unknown> & { id: string };
};

/**
 * Page-level metadata. Equivalent to Puck's RootData.
 */
export type PageRoot = {
  props: {
    title: string;
    description: string;
    ogImageId?: string;  // OPOLLO: image_library.id
    noIndex?: boolean;
  };
};

/**
 * The canonical storage format for one page.
 * Equivalent to Puck's Data type.
 * HTML is DERIVED from this. This is never derived from HTML.
 */
export type PageDocument = {
  root: PageRoot;
  content: SectionData[];
  // OPOLLO additions:
  schemaVersion: 1;
  pageId: string;    // pages.id
  routeId: string;   // route_registry.id
  pageType: PageType;
  refs: PageRefs;    // shared content references keyed by sectionId
};

// ─── COPIED FROM puckeditor/puck Config.ts ────────────────────────────────
// Fields type system. Used for design_components.puck_fields schema
// AND for the section prop editor UI (Puck AutoField components).

export type TextField     = { type: 'text';     label?: string };
export type TextareaField = { type: 'textarea'; label?: string };
export type NumberField   = { type: 'number';   label?: string; min?: number; max?: number };
export type SelectField   = { type: 'select';   label?: string; options: FieldOption[] };
export type RadioField    = { type: 'radio';    label?: string; options: FieldOption[] };
export type ArrayField    = { type: 'array';    label?: string; arrayFields: Fields };
export type ObjectField   = { type: 'object';   label?: string; objectFields: Fields };

export type FieldOption = { label: string; value: string };

export type Field =
  | TextField
  | TextareaField
  | NumberField
  | SelectField
  | RadioField
  | ArrayField
  | ObjectField;

export type Fields = Record<string, Field>;

/**
 * Definition for one component type + variant.
 * Equivalent to Puck's ComponentConfig.
 * render() is Opollo's addition — Puck uses React; Opollo uses HTML strings.
 */
export type ComponentDef = {
  fields: Fields;
  defaultProps: Record<string, unknown>;
  render: (props: Record<string, unknown>, target: RenderTarget) => string;
};

export type ComponentRegistry = Record<string, Record<string, ComponentDef>>;

// ─── END PUCK COPY ─────────────────────────────────────────────────────────

// ─── OPOLLO-ONLY TYPES ─────────────────────────────────────────────────────

export type PageType =
  | 'homepage'
  | 'service'
  | 'about'
  | 'contact'
  | 'landing'
  | 'blog-index'
  | 'blog-post';

export type RenderTarget = 'preview' | 'wordpress';

/**
 * Per-section shared content references.
 * Keyed by section props.id (stable UUID).
 * Never inline copies — always refs to shared_content or route_registry.
 */
export type PageRefs = {
  [sectionId: string]: SectionRefs;
};

export type SectionRefs = {
  ctaRef?:         string;    // shared_content.id, content_type='cta'
  routeRef?:       string;    // route_registry.id
  imageRef?:       string;    // image_library.id
  testimonialRef?: string;    // shared_content.id, content_type='testimonial'
  serviceRefs?:    string[];  // shared_content.id[], content_type='service'
  faqRefs?:        string[];  // shared_content.id[], content_type='faq'
};

// ─── VALIDATION ────────────────────────────────────────────────────────────

export type ValidationResult = {
  errors:   ValidationError[];
  warnings: ValidationWarning[];
  passedAt: Date | null;
};

export type ValidationError = {
  code:      string;
  sectionId: string | null;
  detail?:   string;
};

export type ValidationWarning = {
  code:    string;
  detail?: string;
};

// ─── SITE PLAN ─────────────────────────────────────────────────────────────

/**
 * Output of Pass 0+1 (site planner).
 * One call generates the full site plan before any pages are generated.
 * Stored to: site_blueprints, route_registry, shared_content.
 */
export type SitePlan = {
  routePlan: RoutePlanItem[];
  navItems:  NavItem[];
  footerItems: FooterItem[];
  sharedContent: SharedContentItem[];
  ctaCatalogue: CTACatalogueItem[];
  seoDefaults: {
    titleTemplate: string;  // e.g. "%s | Brand Name"
    description:   string;
  };
};

export type RoutePlanItem = {
  slug:      string;    // must start with /
  pageType:  PageType;
  label:     string;
  priority:  number;    // generation order
};

export type NavItem = {
  label:      string;
  routeSlug:  string;
  children?:  { label: string; routeSlug: string }[];
};

export type FooterItem = {
  label:       string;
  routeSlug:   string | null;
  externalUrl: string | null;
};

export type SharedContentItem = {
  contentType: SharedContentType;
  label:       string;
  content:     Record<string, unknown>;
};

export type CTACatalogueItem = {
  label:           string;
  text:            string;
  subtext?:        string;
  targetRouteSlug: string | null;
  externalUrl?:    string;
  variant:         'primary' | 'secondary' | 'ghost';
};

export type SharedContentType =
  | 'cta'
  | 'testimonial'
  | 'service'
  | 'faq'
  | 'stat'
  | 'offer';

// ─── RESOLVED REFS ─────────────────────────────────────────────────────────

/**
 * Output of lib/ref-resolver.ts.
 * All refs resolved to their full objects in one batch DB query.
 */
export type ResolvedSectionRefs = {
  cta?:         ResolvedCTA;
  route?:       ResolvedRoute;
  image?:       ResolvedImage;
  testimonial?: ResolvedTestimonial;
  services?:    ResolvedService[];
  faqs?:        ResolvedFAQ[];
};

export type ResolvedCTA = {
  id: string; text: string; subtext?: string;
  url: string; variant: string;
};

export type ResolvedRoute = {
  id: string; slug: string; label: string;
};

export type ResolvedImage = {
  id: string; url: string; alt: string;
};

export type ResolvedTestimonial = {
  id: string; quote: string; author: string;
  role?: string; company?: string; imageUrl?: string;
};

export type ResolvedService = {
  id: string; name: string; tagline: string;
  description: string; iconSlug?: string; url?: string;
};

export type ResolvedFAQ = {
  id: string; question: string; answer: string;
};

export type ResolvedRefs = {
  [sectionId: string]: ResolvedSectionRefs;
  tokens: Record<string, string>;  // CSS variable name → value
};
