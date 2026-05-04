import { describe, expect, it } from "vitest";

import { componentRegistry, COMPONENT_MANIFEST } from "@/lib/component-registry";

// ---------------------------------------------------------------------------
// M16-3 — unit tests for the component registry.
//
// All 20 variants are exercised against their render functions.
// Tests are pure TypeScript — no DB, no LLM, no filesystem.
// ---------------------------------------------------------------------------

const SECTION_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function props(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: SECTION_ID, ...overrides };
}

// ─── MANIFEST ────────────────────────────────────────────────────────────────

describe("COMPONENT_MANIFEST", () => {
  it("has exactly 20 entries", () => {
    expect(COMPONENT_MANIFEST).toHaveLength(20);
  });

  it("every entry has type, variant, description, requiredProps, acceptsRefs", () => {
    for (const entry of COMPONENT_MANIFEST) {
      expect(entry.type).toBeTruthy();
      expect(entry.variant).toBeTruthy();
      expect(entry.description).toBeTruthy();
      expect(Array.isArray(entry.requiredProps)).toBe(true);
      expect(Array.isArray(entry.acceptsRefs)).toBe(true);
    }
  });

  it("every manifest entry has a matching registry entry", () => {
    for (const { type, variant } of COMPONENT_MANIFEST) {
      expect(componentRegistry[type]?.[variant]).toBeDefined();
    }
  });
});

// ─── REGISTRY SHAPE ──────────────────────────────────────────────────────────

describe("componentRegistry shape", () => {
  it("has 8 component types", () => {
    expect(Object.keys(componentRegistry)).toHaveLength(8);
  });

  it("Hero has 3 variants", () => {
    expect(Object.keys(componentRegistry.Hero)).toHaveLength(3);
  });

  it("Features has 3 variants", () => {
    expect(Object.keys(componentRegistry.Features)).toHaveLength(3);
  });

  it("CTABanner has 3 variants", () => {
    expect(Object.keys(componentRegistry.CTABanner)).toHaveLength(3);
  });

  it("Content has 3 variants", () => {
    expect(Object.keys(componentRegistry.Content)).toHaveLength(3);
  });

  it("Testimonial has 2 variants", () => {
    expect(Object.keys(componentRegistry.Testimonial)).toHaveLength(2);
  });

  it("FAQ has 2 variants", () => {
    expect(Object.keys(componentRegistry.FAQ)).toHaveLength(2);
  });

  it("Stats has 2 variants", () => {
    expect(Object.keys(componentRegistry.Stats)).toHaveLength(2);
  });

  it("Contact has 2 variants", () => {
    expect(Object.keys(componentRegistry.Contact)).toHaveLength(2);
  });

  it("every entry has fields, defaultProps, and render", () => {
    for (const [type, variants] of Object.entries(componentRegistry)) {
      for (const [variant, def] of Object.entries(variants)) {
        expect(def.fields, `${type}:${variant} missing fields`).toBeDefined();
        expect(def.defaultProps, `${type}:${variant} missing defaultProps`).toBeDefined();
        expect(typeof def.render, `${type}:${variant} render not a function`).toBe("function");
      }
    }
  });
});

// ─── HERO ────────────────────────────────────────────────────────────────────

describe("Hero:centered", () => {
  const render = componentRegistry.Hero.centered.render;

  it("returns an HTML string", () => {
    const html = render(props({ headline: "We build things" }), "preview");
    expect(typeof html).toBe("string");
  });

  it("wraps with data-opollo-id", () => {
    const html = render(props({ headline: "Test" }), "preview");
    expect(html).toContain(`data-opollo-id="${SECTION_ID}"`);
  });

  it("renders headline in h1", () => {
    const html = render(props({ headline: "Hello World" }), "preview");
    expect(html).toContain("<h1");
    expect(html).toContain("Hello World");
  });

  it("renders subheadline when provided", () => {
    const html = render(props({ headline: "H", subheadline: "Sub text" }), "preview");
    expect(html).toContain("Sub text");
  });

  it("renders CTA button when cta prop provided", () => {
    const html = render(props({ headline: "H", cta: { text: "Get started", url: "/start" } }), "preview");
    expect(html).toContain("Get started");
    expect(html).toContain("/start");
    expect(html).toContain("opollo-btn");
  });

  it("escapes XSS in headline", () => {
    const html = render(props({ headline: '<script>alert("xss")</script>' }), "preview");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("has opollo-Hero--centered class", () => {
    const html = render(props({ headline: "H" }), "preview");
    expect(html).toContain("opollo-Hero--centered");
  });
});

describe("Hero:split-right", () => {
  const render = componentRegistry.Hero["split-right"].render;

  it("renders headline and has split class", () => {
    const html = render(props({ headline: "Split hero" }), "preview");
    expect(html).toContain("Split hero");
    expect(html).toContain("opollo-Hero--split-right");
  });

  it("renders image when provided", () => {
    const html = render(props({ headline: "H", image: { url: "https://example.com/img.jpg", alt: "Photo" } }), "preview");
    expect(html).toContain("https://example.com/img.jpg");
    expect(html).toContain('alt="Photo"');
  });

  it("renders placeholder when no image", () => {
    const html = render(props({ headline: "H" }), "preview");
    expect(html).toContain("opollo-img-placeholder");
  });
});

describe("Hero:split-left", () => {
  const render = componentRegistry.Hero["split-left"].render;

  it("has split-left class and renders headline", () => {
    const html = render(props({ headline: "Left split" }), "preview");
    expect(html).toContain("opollo-Hero--split-left");
    expect(html).toContain("Left split");
  });
});

// ─── FEATURES ────────────────────────────────────────────────────────────────

describe("Features:grid-3", () => {
  const render = componentRegistry.Features["grid-3"].render;

  it("renders section heading", () => {
    const html = render(props({ heading: "Why us", features: [] }), "preview");
    expect(html).toContain("Why us");
    expect(html).toContain("opollo-h2");
  });

  it("renders feature items", () => {
    const html = render(props({
      heading: "Features",
      features: [
        { title: "Fast", description: "Really fast", iconSlug: "zap" },
        { title: "Reliable", description: "99.9% uptime", iconSlug: "shield" },
      ],
    }), "preview");
    expect(html).toContain("Fast");
    expect(html).toContain("Really fast");
    expect(html).toContain("Reliable");
  });

  it("has grid-3 class", () => {
    const html = render(props({ heading: "F", features: [] }), "preview");
    expect(html).toContain("opollo-Features--grid-3");
  });

  it("handles empty features array", () => {
    expect(() => render(props({ heading: "F", features: [] }), "preview")).not.toThrow();
  });

  it("escapes XSS in feature title", () => {
    const html = render(props({ heading: "H", features: [{ title: "<b>bold</b>", description: "" }] }), "preview");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;b&gt;");
  });
});

describe("Features:grid-2", () => {
  const render = componentRegistry.Features["grid-2"].render;

  it("has grid-2 class", () => {
    const html = render(props({ heading: "F", features: [] }), "preview");
    expect(html).toContain("opollo-Features--grid-2");
  });
});

describe("Features:list", () => {
  const render = componentRegistry.Features.list.render;

  it("has list class", () => {
    const html = render(props({ heading: "F", features: [] }), "preview");
    expect(html).toContain("opollo-Features--list");
  });
});

// ─── CTA BANNER ──────────────────────────────────────────────────────────────

describe("CTABanner:full-width", () => {
  const render = componentRegistry.CTABanner["full-width"].render;

  it("renders heading with full-width class", () => {
    const html = render(props({ heading: "Book a call" }), "preview");
    expect(html).toContain("Book a call");
    expect(html).toContain("opollo-CTABanner--full-width");
  });

  it("renders CTA button", () => {
    const html = render(props({ heading: "H", cta: { text: "Book now", url: "/book" } }), "preview");
    expect(html).toContain("Book now");
  });
});

describe("CTABanner:card", () => {
  const render = componentRegistry.CTABanner.card.render;

  it("renders with card class", () => {
    const html = render(props({ heading: "Let's talk" }), "preview");
    expect(html).toContain("opollo-CTABanner--card");
    expect(html).toContain("Let&#x27;s talk");
  });
});

describe("CTABanner:inline", () => {
  const render = componentRegistry.CTABanner.inline.render;

  it("renders with inline class", () => {
    const html = render(props({ heading: "Inline CTA" }), "preview");
    expect(html).toContain("opollo-CTABanner--inline");
    expect(html).toContain("Inline CTA");
  });
});

// ─── CONTENT ─────────────────────────────────────────────────────────────────

describe("Content:prose", () => {
  const render = componentRegistry.Content.prose.render;

  it("renders heading and body", () => {
    const html = render(props({ heading: "Our story", body: "We started in 2020." }), "preview");
    expect(html).toContain("Our story");
    expect(html).toContain("We started in 2020.");
    expect(html).toContain("opollo-Content--prose");
  });
});

describe("Content:two-column", () => {
  const render = componentRegistry.Content["two-column"].render;

  it("renders both columns", () => {
    const html = render(props({ heading: "H", body: "Left text", bodyRight: "Right text" }), "preview");
    expect(html).toContain("Left text");
    expect(html).toContain("Right text");
    expect(html).toContain("opollo-Content--two-column");
  });
});

describe("Content:with-image", () => {
  const render = componentRegistry.Content["with-image"].render;

  it("renders image and text", () => {
    const html = render(props({
      heading: "About us",
      body: "Some text",
      image: { url: "https://example.com/team.jpg", alt: "Team" },
    }), "preview");
    expect(html).toContain("About us");
    expect(html).toContain("https://example.com/team.jpg");
    expect(html).toContain("opollo-Content--with-image");
  });
});

// ─── TESTIMONIAL ─────────────────────────────────────────────────────────────

describe("Testimonial:single", () => {
  const render = componentRegistry.Testimonial.single.render;

  it("renders blockquote with quote text and author", () => {
    const html = render(props({
      heading: "What clients say",
      testimonials: [{ quote: "Great service!", author: "Jane Doe", role: "CEO", company: "Acme" }],
    }), "preview");
    expect(html).toContain("Great service!");
    expect(html).toContain("Jane Doe");
    expect(html).toContain("opollo-Testimonial--single");
    expect(html).toContain("<blockquote");
  });

  it("uses resolved testimonial prop as fallback", () => {
    const html = render(props({
      heading: "H",
      testimonial: { quote: "Resolved quote", author: "John" },
    }), "preview");
    expect(html).toContain("Resolved quote");
    expect(html).toContain("John");
  });
});

describe("Testimonial:grid", () => {
  const render = componentRegistry.Testimonial.grid.render;

  it("renders multiple testimonials", () => {
    const html = render(props({
      heading: "Reviews",
      testimonials: [
        { quote: "Quote A", author: "Author A" },
        { quote: "Quote B", author: "Author B" },
        { quote: "Quote C", author: "Author C" },
      ],
    }), "preview");
    expect(html).toContain("Quote A");
    expect(html).toContain("Quote B");
    expect(html).toContain("Quote C");
    expect(html).toContain("opollo-Testimonial--grid");
  });
});

// ─── FAQ ─────────────────────────────────────────────────────────────────────

describe("FAQ:accordion", () => {
  const render = componentRegistry.FAQ.accordion.render;

  it("renders details/summary accordion with question and answer", () => {
    const html = render(props({
      heading: "FAQ",
      faqs: [
        { question: "How does it work?", answer: "It works great." },
        { question: "What is the price?", answer: "Contact us." },
      ],
    }), "preview");
    expect(html).toContain("<details");
    expect(html).toContain("<summary");
    expect(html).toContain("How does it work?");
    expect(html).toContain("It works great.");
    expect(html).toContain("opollo-FAQ--accordion");
  });

  it("renders empty list without throwing", () => {
    expect(() => render(props({ heading: "FAQ", faqs: [] }), "preview")).not.toThrow();
  });
});

describe("FAQ:list", () => {
  const render = componentRegistry.FAQ.list.render;

  it("renders dt/dd pairs", () => {
    const html = render(props({
      heading: "FAQ",
      faqs: [{ question: "Q1", answer: "A1" }],
    }), "preview");
    expect(html).toContain("<dt");
    expect(html).toContain("<dd");
    expect(html).toContain("Q1");
    expect(html).toContain("A1");
    expect(html).toContain("opollo-FAQ--list");
  });
});

// ─── STATS ───────────────────────────────────────────────────────────────────

describe("Stats:horizontal", () => {
  const render = componentRegistry.Stats.horizontal.render;

  it("renders stat values and labels", () => {
    const html = render(props({
      heading: "Numbers",
      stats: [
        { value: "98%", label: "Satisfaction" },
        { value: "500+", label: "Clients" },
      ],
    }), "preview");
    expect(html).toContain("98%");
    expect(html).toContain("Satisfaction");
    expect(html).toContain("opollo-Stats--horizontal");
  });
});

describe("Stats:grid", () => {
  const render = componentRegistry.Stats.grid.render;

  it("renders with grid class", () => {
    const html = render(props({ heading: "H", stats: [{ value: "10k", label: "Users" }] }), "preview");
    expect(html).toContain("opollo-Stats--grid");
    expect(html).toContain("10k");
  });
});

// ─── CONTACT ─────────────────────────────────────────────────────────────────

describe("Contact:form", () => {
  const render = componentRegistry.Contact.form.render;

  it("renders a form with name/email/message fields", () => {
    const html = render(props({ heading: "Get in touch", email: "hello@example.com" }), "preview");
    expect(html).toContain("<form");
    expect(html).toContain('type="email"');
    expect(html).toContain("opollo-Contact--form");
    expect(html).toContain("hello@example.com");
  });

  it("form field ids use section id for unique labels", () => {
    const html = render(props({ heading: "H" }), "preview");
    expect(html).toContain(`id="name-${SECTION_ID}"`);
    expect(html).toContain(`for="name-${SECTION_ID}"`);
  });

  it("renders phone and address when provided", () => {
    const html = render(props({ heading: "H", phone: "+44 20 1234 5678", address: "123 Main St" }), "preview");
    expect(html).toContain("+44 20 1234 5678");
    expect(html).toContain("123 Main St");
  });
});

describe("Contact:details", () => {
  const render = componentRegistry.Contact.details.render;

  it("renders contact details without a form", () => {
    const html = render(props({ heading: "Find us", email: "info@co.com", phone: "0800 123" }), "preview");
    expect(html).not.toContain("<form");
    expect(html).toContain("info@co.com");
    expect(html).toContain("0800 123");
    expect(html).toContain("opollo-Contact--details");
  });
});

// ─── ALL VARIANTS — XSS SAFETY ───────────────────────────────────────────────

describe("all render functions — XSS safety", () => {
  const xssPayload = '<img src=x onerror=alert(1)>';

  it.each(
    Object.entries(componentRegistry).flatMap(([type, variants]) =>
      Object.entries(variants).map(([variant, def]) => [type, variant, def] as const),
    ),
  )("%s:%s does not render raw XSS payload", (_type, _variant, def) => {
    const p = { ...def.defaultProps, id: SECTION_ID, heading: xssPayload, headline: xssPayload };
    const html = def.render(p, "preview");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toMatch(/<[^>]*onerror=/);
    expect(html).toContain("&lt;img");
  });
});

// ─── ALL VARIANTS — data-opollo-id ───────────────────────────────────────────

describe("all render functions — section id", () => {
  it.each(
    Object.entries(componentRegistry).flatMap(([type, variants]) =>
      Object.entries(variants).map(([variant, def]) => [type, variant, def] as const),
    ),
  )("%s:%s includes data-opollo-id", (_type, _variant, def) => {
    const p = { ...def.defaultProps, id: SECTION_ID };
    const html = def.render(p, "preview");
    expect(html).toContain(`data-opollo-id="${SECTION_ID}"`);
  });
});
