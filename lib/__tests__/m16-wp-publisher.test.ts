import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  compileThemeJsonPatch,
  type OpolloDesignTokens,
} from "@/lib/wp-global-styles";
import {
  wrapInGutenbergBlock,
  isGutenbergCandidate,
  computeContentHash,
  sharedContentToBlock,
} from "@/lib/gutenberg-format";
import { sharedContentSlug } from "@/lib/wp-site-publish";
import { seedSite } from "./_helpers";
import { createSiteBlueprint } from "@/lib/site-blueprint";
import { upsertRoutesFromPlan, listActiveRoutes } from "@/lib/route-registry";

// ---------------------------------------------------------------------------
// M16-8 — WordPress publisher tests.
//
// Pure-function tests (no DB):
//   - compileThemeJsonPatch → only Opollo color keys
//   - wrapInGutenbergBlock → correct wp:html format
//   - isGutenbergCandidate → detects M16 vs legacy HTML
//   - computeContentHash → returns deterministic SHA-256 hex
//   - sharedContentToBlock → embeds content type and JSON
//   - sharedContentSlug → deterministic slug generation
//
// DB integration tests:
//   - publishSlot M16 extension: wp_status set to 'published'
//   - publishSlot M16 extension: wp_content_hash stored in route_registry
// ---------------------------------------------------------------------------

// ─── compileThemeJsonPatch ────────────────────────────────────────────────────

describe("compileThemeJsonPatch", () => {
  it("returns only Opollo-managed color keys (Risk 9)", () => {
    const tokens: OpolloDesignTokens = {
      primary:    "#1E40AF",
      secondary:  "#10B981",
      accent:     "#F59E0B",
      background: "#FFFFFF",
      text:       "#111827",
    };
    const patch = compileThemeJsonPatch(tokens);

    // Must only contain the expected keys in settings
    const settingsKeys = Object.keys(patch.settings);
    expect(settingsKeys).toContain("color");
    expect(settingsKeys).not.toContain("layout");
    expect(settingsKeys).not.toContain("border");
    expect(settingsKeys).not.toContain("shadow");

    // Palette has exactly 5 Opollo entries
    const palette = patch.settings.color.palette.theme;
    expect(palette).toHaveLength(5);
    expect(palette.map(e => e.slug)).toEqual([
      "opollo-primary",
      "opollo-secondary",
      "opollo-accent",
      "opollo-background",
      "opollo-text",
    ]);
    expect(palette[0]!.color).toBe("#1E40AF");
  });

  it("omits color entries for missing tokens", () => {
    const tokens: OpolloDesignTokens = { primary: "#1E40AF" };
    const patch = compileThemeJsonPatch(tokens);
    const palette = patch.settings.color.palette.theme;
    expect(palette).toHaveLength(1);
    expect(palette[0]!.slug).toBe("opollo-primary");
  });

  it("ignores tokens with non-hex color values", () => {
    const tokens: OpolloDesignTokens = {
      primary: "blue",    // not a hex string
      secondary: "#10B981",
    };
    const patch = compileThemeJsonPatch(tokens);
    const palette = patch.settings.color.palette.theme;
    expect(palette.map(e => e.slug)).not.toContain("opollo-primary");
    expect(palette.map(e => e.slug)).toContain("opollo-secondary");
  });

  it("adds typography fontSizes when font tokens are present", () => {
    const tokens: OpolloDesignTokens = {
      font_heading: "Playfair Display",
      font_body:    "Inter",
    };
    const patch = compileThemeJsonPatch(tokens);
    expect(patch.settings.typography?.fontSizes?.theme).toHaveLength(2);
  });

  it("adds spacing when spacing_unit is present", () => {
    const tokens: OpolloDesignTokens = { spacing_unit: "1rem" };
    const patch = compileThemeJsonPatch(tokens);
    expect(patch.settings.spacing?.spacingScale?.unit).toBe("1rem");
  });

  it("returns empty palette for empty tokens", () => {
    const patch = compileThemeJsonPatch({});
    expect(patch.settings.color.palette.theme).toHaveLength(0);
  });
});

// ─── wrapInGutenbergBlock ─────────────────────────────────────────────────────

describe("wrapInGutenbergBlock", () => {
  it("wraps HTML in wp:html block comment markers", () => {
    const html = '<div class="opollo-Hero" data-opollo-id="abc">Hello</div>';
    const wrapped = wrapInGutenbergBlock(html, "page-123");
    expect(wrapped).toContain("<!-- wp:html -->");
    expect(wrapped).toContain("<!-- /wp:html -->");
    expect(wrapped).toContain("data-opollo-page-id=\"page-123\"");
    expect(wrapped).toContain('data-opollo-id="abc"');
    expect(wrapped).toContain("Hello");
  });

  it("sanitises pageId to strip non-safe characters", () => {
    const wrapped = wrapInGutenbergBlock("x", '<script>alert(1)</script>');
    expect(wrapped).not.toContain("<script>");
    expect(wrapped).toContain('data-opollo-page-id="scriptalert1script"');
  });
});

// ─── isGutenbergCandidate ─────────────────────────────────────────────────────

describe("isGutenbergCandidate", () => {
  it("returns true for M16-rendered HTML (has data-opollo-id)", () => {
    const html = '<div class="opollo-Hero" data-opollo-id="uuid-1">…</div>';
    expect(isGutenbergCandidate(html)).toBe(true);
  });

  it("returns false for legacy HTML without data-opollo-id", () => {
    const html = '<section class="hero-section"><h1>Hello</h1></section>';
    expect(isGutenbergCandidate(html)).toBe(false);
  });
});

// ─── computeContentHash ───────────────────────────────────────────────────────

describe("computeContentHash", () => {
  it("returns a 64-character hex string (SHA-256)", async () => {
    const hash = await computeContentHash("Hello World");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it("returns the same hash for the same input", async () => {
    const a = await computeContentHash("deterministic");
    const b = await computeContentHash("deterministic");
    expect(a).toBe(b);
  });

  it("returns different hashes for different inputs", async () => {
    const a = await computeContentHash("foo");
    const b = await computeContentHash("bar");
    expect(a).not.toBe(b);
  });
});

// ─── sharedContentToBlock ────────────────────────────────────────────────────

describe("sharedContentToBlock", () => {
  it("includes the content_type and label in the block output", () => {
    const block = sharedContentToBlock("Main CTA", "cta", { text: "Get started" });
    expect(block).toContain("<!-- wp:html -->");
    expect(block).toContain("<!-- /wp:html -->");
    expect(block).toContain("opollo-content-type: cta");
    expect(block).toContain("opollo-label: Main CTA");
    expect(block).toContain('"text":"Get started"');
  });

  it("strips HTML from the label to prevent injection", () => {
    const block = sharedContentToBlock('<script>alert(1)</script>', "cta", {});
    expect(block).not.toContain("<script>");
  });
});

// ─── sharedContentSlug ───────────────────────────────────────────────────────

describe("sharedContentSlug", () => {
  it("produces a valid WP slug (lowercase alphanumeric + hyphens)", () => {
    const slug = sharedContentSlug("cta", "Main Call to Action");
    expect(slug).toMatch(/^opollo-cta-[a-z0-9-]+$/);
  });

  it("produces the same slug for the same inputs (deterministic)", () => {
    const a = sharedContentSlug("testimonial", "Client Review");
    const b = sharedContentSlug("testimonial", "Client Review");
    expect(a).toBe(b);
  });

  it("produces different slugs for different labels", () => {
    const a = sharedContentSlug("cta", "Get Started");
    const b = sharedContentSlug("cta", "Contact Us");
    expect(a).not.toBe(b);
  });
});

// ─── publishSlot M16 extensions (DB integration) ─────────────────────────────
//
// For M16, the slot is pre-linked to the M16 pages row via
// generation_job_pages.pages_id.  publishSlot adopts it (skips INSERT),
// then updates wp_status + stores wp_content_hash.

async function seedM16SlotAndPages(prefix: string) {
  const { getServiceRoleClient } = await import("@/lib/supabase");
  const svc = getServiceRoleClient();
  const site = await seedSite({ prefix });

  // Route (needed for wp_content_hash storage)
  const { data: routeRow, error: rErr } = await svc
    .from("route_registry")
    .insert({ site_id: site.id, slug: `/${prefix}-home`, page_type: "service", label: "Home", status: "planned" })
    .select("id")
    .single();
  if (rErr || !routeRow) throw new Error(`route insert: ${rErr?.message ?? "no row"}`);

  // M16 pages row (created by the page document generator, pre-exists)
  const { data: pageRow, error: pErr } = await svc
    .from("pages")
    .insert({
      site_id:               site.id,
      slug:                  `/${prefix}-home`,
      title:                 "Home",
      page_type:             "homepage",
      design_system_version: 1,
      status:                "draft",
      wp_status:             "not_uploaded",
    })
    .select("id")
    .single();
  if (pErr || !pageRow) throw new Error(`page insert: ${pErr?.message ?? "no row"}`);

  // Batch job
  const { data: job, error: jErr } = await svc
    .from("generation_jobs")
    .insert({ site_id: site.id, status: "running", requested_count: 1, succeeded_count: 0, failed_count: 0 })
    .select("id")
    .single();
  if (jErr || !job) throw new Error(`job insert: ${jErr?.message ?? "no row"}`);

  // Slot pre-linked to the M16 pages row (this is the M16 flow difference)
  const { data: slot, error: sErr } = await svc
    .from("generation_job_pages")
    .insert({
      job_id:    job.id,
      site_id:   site.id,
      page_type: "homepage",
      slug:      `/${prefix}-home`,
      title:     "Home",
      design_system_version: 1,
      state:     "validating",
      worker_id: `worker-${prefix}`,
      lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
      pages_id:  pageRow.id,  // pre-link so publishSlot adopts the M16 row
    })
    .select("id")
    .single();
  if (sErr || !slot) throw new Error(`slot insert: ${sErr?.message ?? "no row"}`);

  return { svc, site, pageRow, routeRow, job, slot };
}

describe("publishSlot — M16 wp_status extension", () => {
  it("sets pages.wp_status=published and stores wp_content_hash after a successful publish", async () => {
    const { publishSlot } = await import("@/lib/batch-publisher");
    const { svc, site, pageRow, routeRow, job, slot } = await seedM16SlotAndPages("wpp01");

    const html = '<div class="opollo-Hero" data-opollo-id="sec-1">Hello</div>';
    const wp = {
      getBySlug: async () => ({ ok: true as const, found: null }),
      create: async () => ({ ok: true as const, wp_page_id: 42, slug: `/${site.id}-home` }),
      update: async () => ({ ok: true as const, wp_page_id: 42 }),
    };

    const result = await publishSlot(
      slot.id,
      `worker-wpp01`,
      {
        job_id:                job.id,
        site_id:               site.id,
        slug:                  "/wpp01-home",
        title:                 "Home",
        generated_html:        html,
        design_system_version: "1",
        m16_route_id:          routeRow.id,
      },
      wp,
    );
    expect(result.ok).toBe(true);

    // wp_status should be 'published'
    const { data: updatedPage } = await svc
      .from("pages")
      .select("wp_status")
      .eq("id", pageRow.id)
      .single();
    expect(updatedPage?.wp_status).toBe("published");

    // wp_content_hash should be 64-char hex
    const { data: updatedRoute } = await svc
      .from("route_registry")
      .select("wp_content_hash")
      .eq("id", routeRow.id)
      .single();
    expect(updatedRoute?.wp_content_hash).not.toBeNull();
    expect(typeof updatedRoute?.wp_content_hash).toBe("string");
    expect((updatedRoute?.wp_content_hash as string).length).toBe(64);
  });

  it("wraps M16 HTML in Gutenberg block before sending to WP", async () => {
    const { publishSlot } = await import("@/lib/batch-publisher");
    const { site, job, slot } = await seedM16SlotAndPages("wpp02");

    const m16Html = '<div class="opollo-Hero" data-opollo-id="sec-uuid">Content</div>';
    let capturedContent = "";

    const wp = {
      getBySlug: async () => ({ ok: true as const, found: null }),
      create: async (input: { slug: string; title: string; content: string }) => {
        capturedContent = input.content;
        return { ok: true as const, wp_page_id: 99, slug: "/wpp02-home" };
      },
      update: async () => ({ ok: true as const, wp_page_id: 99 }),
    };

    await publishSlot(
      slot.id,
      `worker-wpp02`,
      {
        job_id:                job.id,
        site_id:               site.id,
        slug:                  "/wpp02-home",
        title:                 "Home",
        generated_html:        m16Html,
        design_system_version: "1",
        m16_route_id:          "some-route-id",
      },
      wp,
    );

    expect(capturedContent).toContain("<!-- wp:html -->");
    expect(capturedContent).toContain("<!-- /wp:html -->");
    expect(capturedContent).toContain("data-opollo-id=\"sec-uuid\"");
  });
});
