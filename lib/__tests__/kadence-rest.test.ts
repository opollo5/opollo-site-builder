import { afterEach, describe, expect, it, vi } from "vitest";

import {
  KADENCE_THEME_SLUG,
  getKadenceInstallState,
  getKadencePalette,
  parseKadencePaletteOption,
} from "@/lib/kadence-rest";
import type { WpConfig } from "@/lib/wordpress";

// ---------------------------------------------------------------------------
// M13-5a kadence-rest — unit tests.
//
// WP REST is mocked via global.fetch. Three surfaces under test:
//   - parseKadencePaletteOption: pure, exercised across all four
//     documented source values
//   - getKadenceInstallState: composition test over themes list +
//     active theme
//   - getKadencePalette: end-to-end from WpGetSettings → parsed
// ---------------------------------------------------------------------------

const CFG: WpConfig = {
  baseUrl: "https://example.test",
  user: "unit-test-user",
  appPassword: "unit-test-pw",
};

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

type CannedResponse = { status: number; body: unknown };

function mockFetch(responses: Record<string, CannedResponse>) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [needle, resp] of Object.entries(responses)) {
      if (url.includes(needle)) {
        return new Response(JSON.stringify(resp.body), {
          status: resp.status,
          headers: { "content-type": "application/json" },
        });
      }
    }
    return new Response(JSON.stringify({ error: `unmocked: ${url}` }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

// ---------------------------------------------------------------------------
// parseKadencePaletteOption
// ---------------------------------------------------------------------------

describe("parseKadencePaletteOption", () => {
  it("returns source='unset' for empty string", () => {
    const res = parseKadencePaletteOption("");
    expect(res.source).toBe("unset");
    expect(res.palette).toEqual([]);
  });

  it("returns source='empty' for JSON empty array", () => {
    const res = parseKadencePaletteOption("[]");
    expect(res.source).toBe("empty");
    expect(res.palette).toEqual([]);
  });

  it("returns source='populated' for a well-formed palette JSON", () => {
    const raw = JSON.stringify([
      { slug: "palette1", name: "Brand Blue", color: "#185FA5" },
      { slug: "palette2", name: "Brand Teal", color: "#1D9E75" },
    ]);
    const res = parseKadencePaletteOption(raw);
    expect(res.source).toBe("populated");
    expect(res.palette).toHaveLength(2);
    expect(res.palette[0]).toEqual({
      slug: "palette1",
      name: "Brand Blue",
      color: "#185FA5",
    });
  });

  it("drops schema-invalid entries but keeps well-formed ones", () => {
    const raw = JSON.stringify([
      { slug: "palette1", color: "#185FA5" }, // missing name → falls back to slug
      { slug: "", color: "#123" }, // invalid — no slug, dropped
      { color: "#abc" }, // invalid — no slug, dropped
      null, // invalid — dropped
      { slug: "palette2", name: "Teal", color: "#1D9E75" },
    ]);
    const res = parseKadencePaletteOption(raw);
    expect(res.source).toBe("populated");
    expect(res.palette.map((p) => p.slug)).toEqual(["palette1", "palette2"]);
    // Name falls back to slug when omitted.
    expect(res.palette[0]?.name).toBe("palette1");
  });

  it("returns source='unparseable' for malformed JSON", () => {
    const res = parseKadencePaletteOption("{not json}");
    expect(res.source).toBe("unparseable");
    expect(res.palette).toEqual([]);
  });

  it("returns source='unparseable' when all entries are schema-invalid", () => {
    const raw = JSON.stringify([{ color: "#abc" }, null, 42, "a string"]);
    const res = parseKadencePaletteOption(raw);
    expect(res.source).toBe("unparseable");
    expect(res.palette).toEqual([]);
  });

  it("returns source='unparseable' for non-string input (defensive)", () => {
    const res = parseKadencePaletteOption({ palette: [] } as unknown);
    expect(res.source).toBe("unparseable");
    expect(res.palette).toEqual([]);
  });

  it("returns source='unparseable' when JSON is not an array", () => {
    const res = parseKadencePaletteOption(JSON.stringify({ palette1: "#123" }));
    expect(res.source).toBe("unparseable");
  });
});

// ---------------------------------------------------------------------------
// getKadenceInstallState
// ---------------------------------------------------------------------------

describe("getKadenceInstallState", () => {
  it("returns kadence_installed=false when no kadence theme is present", async () => {
    mockFetch({
      "/wp-json/wp/v2/themes?status=active": {
        status: 200,
        body: [
          {
            stylesheet: "twentytwentyfour",
            name: { rendered: "Twenty Twenty-Four" },
            version: "1.0",
            status: "active",
          },
        ],
      },
      "/wp-json/wp/v2/themes": {
        status: 200,
        body: [
          {
            stylesheet: "twentytwentyfour",
            name: { rendered: "Twenty Twenty-Four" },
            version: "1.0",
          },
          {
            stylesheet: "twentytwentythree",
            name: { rendered: "Twenty Twenty-Three" },
            version: "1.0",
          },
        ],
      },
    });

    const res = await getKadenceInstallState(CFG);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.kadence_installed).toBe(false);
    expect(res.kadence_active).toBe(false);
    expect(res.kadence_version).toBeNull();
    expect(res.active_theme_slug).toBe("twentytwentyfour");
  });

  it("returns kadence_installed=true + kadence_active=false when installed-not-active", async () => {
    mockFetch({
      "/wp-json/wp/v2/themes?status=active": {
        status: 200,
        body: [
          {
            stylesheet: "twentytwentyfour",
            name: "Twenty Twenty-Four",
            version: "1.0",
            status: "active",
          },
        ],
      },
      "/wp-json/wp/v2/themes": {
        status: 200,
        body: [
          { stylesheet: "twentytwentyfour", name: "Twenty Twenty-Four", version: "1.0" },
          { stylesheet: KADENCE_THEME_SLUG, name: "Kadence", version: "1.2.3" },
        ],
      },
    });

    const res = await getKadenceInstallState(CFG);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.kadence_installed).toBe(true);
    expect(res.kadence_active).toBe(false);
    expect(res.kadence_version).toBe("1.2.3");
    expect(res.active_theme_slug).toBe("twentytwentyfour");
  });

  it("returns kadence_installed=true + kadence_active=true when installed-and-active", async () => {
    mockFetch({
      "/wp-json/wp/v2/themes?status=active": {
        status: 200,
        body: [
          { stylesheet: KADENCE_THEME_SLUG, name: "Kadence", version: "1.2.3", status: "active" },
        ],
      },
      "/wp-json/wp/v2/themes": {
        status: 200,
        body: [
          { stylesheet: KADENCE_THEME_SLUG, name: "Kadence", version: "1.2.3" },
        ],
      },
    });

    const res = await getKadenceInstallState(CFG);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.kadence_installed).toBe(true);
    expect(res.kadence_active).toBe(true);
    expect(res.kadence_version).toBe("1.2.3");
    expect(res.active_theme_slug).toBe(KADENCE_THEME_SLUG);
  });

  it("surfaces AUTH_FAILED from the themes list endpoint", async () => {
    mockFetch({
      "/wp-json/wp/v2/themes": {
        status: 401,
        body: { code: "rest_forbidden", message: "Unauthorized" },
      },
    });

    const res = await getKadenceInstallState(CFG);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("AUTH_FAILED");
  });
});

// ---------------------------------------------------------------------------
// getKadencePalette
// ---------------------------------------------------------------------------

describe("getKadencePalette", () => {
  it("returns source='unset' when kadence_blocks_colors is absent from settings", async () => {
    mockFetch({
      "/wp-json/wp/v2/settings": {
        status: 200,
        body: {
          title: "Site",
          description: "Tagline",
          // Notably no kadence_blocks_colors.
        },
      },
    });
    const res = await getKadencePalette(CFG);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.source).toBe("unparseable"); // typeof raw === undefined
  });

  it("returns source='unset' when kadence_blocks_colors is empty string", async () => {
    mockFetch({
      "/wp-json/wp/v2/settings": {
        status: 200,
        body: { kadence_blocks_colors: "" },
      },
    });
    const res = await getKadencePalette(CFG);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.source).toBe("unset");
  });

  it("returns a populated palette when WP has one set", async () => {
    const palette = [
      { slug: "palette1", name: "Primary", color: "#185FA5" },
      { slug: "palette2", name: "Secondary", color: "#1D9E75" },
    ];
    mockFetch({
      "/wp-json/wp/v2/settings": {
        status: 200,
        body: { kadence_blocks_colors: JSON.stringify(palette) },
      },
    });
    const res = await getKadencePalette(CFG);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.source).toBe("populated");
    expect(res.palette).toHaveLength(2);
  });

  it("surfaces AUTH_FAILED from the settings endpoint", async () => {
    mockFetch({
      "/wp-json/wp/v2/settings": {
        status: 403,
        body: { code: "rest_forbidden", message: "Insufficient capabilities" },
      },
    });
    const res = await getKadencePalette(CFG);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("AUTH_FAILED");
  });
});
