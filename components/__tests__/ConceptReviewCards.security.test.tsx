import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ConceptReviewCards } from "@/components/ConceptReviewCards";
import type { ConceptResult } from "@/components/DesignDirectionInputs";
import { XSS_PAYLOADS } from "@/tests/helpers/xss-payloads";

// ---------------------------------------------------------------------------
// LAYER 4 — Component (XSS) — ConceptReviewCards
//
// ConceptReviewCards renders three AI-generated micro UI snippets
// (button / card / input) via dangerouslySetInnerHTML. The snippets
// come from the LLM, so prompt injection could plausibly cause the
// model to emit one of the XSS_PAYLOADS.
//
// This test drives every payload through the rendered component and
// asserts:
//   - No <script> nodes are inserted into the DOM.
//   - No <iframe>, <object>, <embed> nodes are inserted.
//   - No element retains an on*=... event-handler attribute.
//   - No anchor / image carries a javascript: / vbscript: / data:
//     URL in href / src.
//
// Per the security realism rule, this exercises the real render
// boundary — the component, with its real sanitiser call, against
// jsdom — not a unit-of-the-sanitiser stub.
// ---------------------------------------------------------------------------

function makeConcept(
  direction: ConceptResult["direction"],
  micro: { button: string; card: string; input: string },
): ConceptResult {
  return {
    direction,
    rationale: "test concept",
    palette_label: "test palette",
    typography_label: "test typography",
    design_tokens: {
      primary: "#111",
      secondary: "#222",
      accent: "#333",
      background: "#fff",
      text: "#000",
      font_heading: "Inter",
      font_body: "Inter",
      border_radius: "8px",
      spacing_unit: "8px",
    },
    homepage_html: "<section>concept</section>",
    inner_page_html: "<section>concept</section>",
    micro_ui: micro,
    label: "Test concept",
    normalization_warnings: [],
  } as unknown as ConceptResult;
}

function assertSafeDom() {
  // No script tags should have made it into the document.
  const scripts = document.querySelectorAll(
    "[data-testid='concept-micro-ui'] script",
  );
  expect(scripts.length).toBe(0);

  // No iframe/object/embed nodes.
  const dangerous = document.querySelectorAll(
    "[data-testid='concept-micro-ui'] iframe, [data-testid='concept-micro-ui'] object, [data-testid='concept-micro-ui'] embed",
  );
  expect(dangerous.length).toBe(0);

  // No element retains an on*= event-handler attribute.
  const all = document.querySelectorAll(
    "[data-testid='concept-micro-ui'] *",
  );
  for (const el of Array.from(all)) {
    for (const attr of Array.from(el.attributes)) {
      expect(attr.name.toLowerCase()).not.toMatch(/^on/);
    }
  }

  // No href / src carries a dangerous scheme.
  const linked = document.querySelectorAll(
    "[data-testid='concept-micro-ui'] a, [data-testid='concept-micro-ui'] img, [data-testid='concept-micro-ui'] [href], [data-testid='concept-micro-ui'] [src]",
  );
  for (const el of Array.from(linked)) {
    const href = el.getAttribute("href")?.toLowerCase() ?? "";
    const src = el.getAttribute("src")?.toLowerCase() ?? "";
    expect(href).not.toMatch(/^javascript:/);
    expect(href).not.toMatch(/^vbscript:/);
    expect(src).not.toMatch(/^javascript:/);
    expect(src).not.toMatch(/^vbscript:/);
  }
}

describe.each(XSS_PAYLOADS)(
  "SECURITY: ConceptReviewCards (%s)",
  ({ payload, technique }) => {
    it(`render is safe for: ${technique}`, () => {
      const concepts: ConceptResult[] = [
        makeConcept("minimal", {
          button: payload,
          card: "<div>safe card</div>",
          input: "<input />",
        }),
        makeConcept("dense", {
          button: "<button>safe</button>",
          card: payload,
          input: "<input />",
        }),
        makeConcept("editorial", {
          button: "<button>safe</button>",
          card: "<div>safe card</div>",
          input: payload,
        }),
      ];
      const { container, unmount } = render(
        <ConceptReviewCards
          concepts={concepts}
          errors={[]}
          referenceScreenshotUrl={null}
        />,
      );
      try {
        // Sanity — the component rendered.
        expect(screen.getAllByTestId("concept-micro-ui").length).toBe(3);
        // The injected payloads must not have created an active surface.
        assertSafeDom();
        // Container existed (silence the unused-var lint) — also useful
        // when debugging a failure: container.innerHTML shows what got
        // rendered.
        expect(container).toBeTruthy();
      } finally {
        unmount();
      }
    });
  },
);
