import { describe, expect, it } from "vitest";

import { resolveRefs } from "@/lib/ref-resolver";
import type { PageDocument } from "@/lib/types/page-document";
import type { SharedContentRow } from "@/lib/shared-content";
import type { RouteRegistryRow } from "@/lib/route-registry";

// ---------------------------------------------------------------------------
// M16-6 — unit tests for ref-resolver (pure function, no DB).
// ---------------------------------------------------------------------------

function makeDoc(refs: PageDocument["refs"]): PageDocument {
  return {
    schemaVersion: 1,
    pageId:   "page-1",
    routeId:  "route-1",
    pageType: "homepage",
    root:  { props: { title: "Home", description: "Test" } },
    content: [
      { type: "Hero",     props: { id: "sec-1", variant: "centered" } },
      { type: "CTABanner", props: { id: "sec-2", variant: "full-width", heading: "CTA" } },
    ],
    refs,
  };
}

const CTA_ROW: SharedContentRow = {
  id:           "cta-1",
  site_id:      "site-1",
  content_type: "cta",
  label:        "Book a Call",
  content:      { text: "Book a free call", variant: "primary", externalUrl: null },
  version_lock: 1,
  deleted_at:   null,
  deleted_by:   null,
  created_at:   "2025-01-01T00:00:00Z",
  updated_at:   "2025-01-01T00:00:00Z",
  created_by:   null,
  updated_by:   null,
};

const TESTIMONIAL_ROW: SharedContentRow = {
  id:           "test-1",
  site_id:      "site-1",
  content_type: "testimonial",
  label:        "Client A",
  content:      { quote: "Great service!", author: "Jane Doe", role: "CEO", company: "Acme" },
  version_lock: 1,
  deleted_at:   null,
  deleted_by:   null,
  created_at:   "2025-01-01T00:00:00Z",
  updated_at:   "2025-01-01T00:00:00Z",
  created_by:   null,
  updated_by:   null,
};

const SERVICE_ROW: SharedContentRow = {
  id:           "svc-1",
  site_id:      "site-1",
  content_type: "service",
  label:        "SEO",
  content:      { name: "SEO Services", tagline: "Rank higher", description: "We improve your rankings.", iconSlug: "search" },
  version_lock: 1,
  deleted_at:   null,
  deleted_by:   null,
  created_at:   "2025-01-01T00:00:00Z",
  updated_at:   "2025-01-01T00:00:00Z",
  created_by:   null,
  updated_by:   null,
};

const FAQ_ROW: SharedContentRow = {
  id:           "faq-1",
  site_id:      "site-1",
  content_type: "faq",
  label:        "What do you do?",
  content:      { question: "What do you do?", answer: "We help businesses grow." },
  version_lock: 1,
  deleted_at:   null,
  deleted_by:   null,
  created_at:   "2025-01-01T00:00:00Z",
  updated_at:   "2025-01-01T00:00:00Z",
  created_by:   null,
  updated_by:   null,
};

const ROUTE_ROW: Partial<RouteRegistryRow> & { id: string; slug: string; label: string } = {
  id:           "route-contact",
  site_id:      "site-1",
  slug:         "/contact",
  page_type:    "contact",
  label:        "Contact",
  status:       "planned",
  redirect_to:  null,
  wp_page_id:   null,
  wp_content_hash: null,
  version_lock: 1,
  created_at:   "2025-01-01T00:00:00Z",
  updated_at:   "2025-01-01T00:00:00Z",
};

// ─── TESTS ──────────────────────────────────────────────────────────────────

describe("resolveRefs — CTA", () => {
  it("resolves ctaRef to full CTA object", () => {
    const doc = makeDoc({ "sec-1": { ctaRef: "cta-1" } });
    const result = resolveRefs(doc, { sharedContent: [CTA_ROW], routes: [] });

    expect(result["sec-1"].cta).toBeDefined();
    expect(result["sec-1"].cta?.text).toBe("Book a free call");
    expect(result["sec-1"].cta?.variant).toBe("primary");
    expect(result["sec-1"].cta?.url).toBe("#");  // externalUrl is null, no routeRef
  });

  it("resolves ctaRef with routeRef inside content to route slug", () => {
    const ctaWithRoute: SharedContentRow = {
      ...CTA_ROW,
      content: { text: "Contact Us", variant: "primary", routeRef: "route-contact", externalUrl: null },
    };
    const doc = makeDoc({ "sec-1": { ctaRef: "cta-1" } });
    const result = resolveRefs(doc, { sharedContent: [ctaWithRoute], routes: [ROUTE_ROW as RouteRegistryRow] });

    expect(result["sec-1"].cta?.url).toBe("/contact");
  });

  it("omits cta when ctaRef not found", () => {
    const doc = makeDoc({ "sec-1": { ctaRef: "nonexistent" } });
    const result = resolveRefs(doc, { sharedContent: [], routes: [] });
    expect(result["sec-1"].cta).toBeUndefined();
  });

  it("omits cta when row is wrong content_type", () => {
    const doc = makeDoc({ "sec-1": { ctaRef: "test-1" } });
    const result = resolveRefs(doc, { sharedContent: [TESTIMONIAL_ROW], routes: [] });
    expect(result["sec-1"].cta).toBeUndefined();
  });
});

describe("resolveRefs — route", () => {
  it("resolves routeRef to route object", () => {
    const doc = makeDoc({ "sec-2": { routeRef: "route-contact" } });
    const result = resolveRefs(doc, { sharedContent: [], routes: [ROUTE_ROW as RouteRegistryRow] });

    expect(result["sec-2"].route?.slug).toBe("/contact");
    expect(result["sec-2"].route?.label).toBe("Contact");
  });

  it("omits route when routeRef not found", () => {
    const doc = makeDoc({ "sec-2": { routeRef: "nonexistent" } });
    const result = resolveRefs(doc, { sharedContent: [], routes: [] });
    expect(result["sec-2"].route).toBeUndefined();
  });
});

describe("resolveRefs — testimonial", () => {
  it("resolves testimonialRef to testimonial object", () => {
    const doc = makeDoc({ "sec-1": { testimonialRef: "test-1" } });
    const result = resolveRefs(doc, { sharedContent: [TESTIMONIAL_ROW], routes: [] });

    expect(result["sec-1"].testimonial?.quote).toBe("Great service!");
    expect(result["sec-1"].testimonial?.author).toBe("Jane Doe");
    expect(result["sec-1"].testimonial?.company).toBe("Acme");
  });
});

describe("resolveRefs — services", () => {
  it("resolves serviceRefs array to resolved services", () => {
    const doc = makeDoc({ "sec-1": { serviceRefs: ["svc-1"] } });
    const result = resolveRefs(doc, { sharedContent: [SERVICE_ROW], routes: [] });

    expect(result["sec-1"].services).toHaveLength(1);
    expect(result["sec-1"].services![0].name).toBe("SEO Services");
    expect(result["sec-1"].services![0].iconSlug).toBe("search");
  });

  it("skips missing service IDs", () => {
    const doc = makeDoc({ "sec-1": { serviceRefs: ["svc-1", "nonexistent"] } });
    const result = resolveRefs(doc, { sharedContent: [SERVICE_ROW], routes: [] });
    expect(result["sec-1"].services).toHaveLength(1);
  });
});

describe("resolveRefs — FAQs", () => {
  it("resolves faqRefs array to resolved FAQs", () => {
    const doc = makeDoc({ "sec-1": { faqRefs: ["faq-1"] } });
    const result = resolveRefs(doc, { sharedContent: [FAQ_ROW], routes: [] });

    expect(result["sec-1"].faqs).toHaveLength(1);
    expect(result["sec-1"].faqs![0].question).toBe("What do you do?");
    expect(result["sec-1"].faqs![0].answer).toBe("We help businesses grow.");
  });
});

describe("resolveRefs — tokens", () => {
  it("passes through cssTokens in the tokens key", () => {
    const doc = makeDoc({});
    const result = resolveRefs(doc, {
      sharedContent: [],
      routes:        [],
      cssTokens:     { "--opollo-color-primary": "#007bff" },
    });
    expect(result.tokens["--opollo-color-primary"]).toBe("#007bff");
  });
});

describe("resolveRefs — empty refs", () => {
  it("returns only tokens key when doc has no refs", () => {
    const doc = makeDoc({});
    const result = resolveRefs(doc, { sharedContent: [], routes: [] });
    const keys = Object.keys(result).filter(k => k !== "tokens");
    expect(keys).toHaveLength(0);
  });
});
