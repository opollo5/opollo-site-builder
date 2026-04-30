import { describe, expect, it } from "vitest";

import { getServiceRoleClient } from "@/lib/supabase";

import { seedSite } from "./_helpers";

// ---------------------------------------------------------------------------
// Migration 0060 — design discovery columns on sites.
//
// Pins the eight columns the DESIGN-DISCOVERY workstream relies on:
//   - design_brief (jsonb, nullable)
//   - homepage_concept_html (text, nullable)
//   - inner_page_concept_html (text, nullable)
//   - tone_applied_homepage_html (text, nullable)
//   - design_tokens (jsonb, nullable)
//   - design_direction_status (text NOT NULL DEFAULT 'pending', CHECK enum)
//   - tone_of_voice (jsonb, nullable)
//   - tone_of_voice_status (text NOT NULL DEFAULT 'pending', CHECK enum)
//
// _setup.ts truncates between tests so seedSite is fresh each time.
// ---------------------------------------------------------------------------

const VALID_STATUSES = ["pending", "in_progress", "approved", "skipped"];

describe("0060: fresh site defaults", () => {
  it("has 'pending' for both status columns and NULL for the rest", async () => {
    const site = await seedSite();
    const svc = getServiceRoleClient();
    const { data, error } = await svc
      .from("sites")
      .select(
        "design_brief, homepage_concept_html, inner_page_concept_html, tone_applied_homepage_html, design_tokens, design_direction_status, tone_of_voice, tone_of_voice_status",
      )
      .eq("id", site.id)
      .single();
    expect(error).toBeNull();
    expect(data?.design_brief).toBeNull();
    expect(data?.homepage_concept_html).toBeNull();
    expect(data?.inner_page_concept_html).toBeNull();
    expect(data?.tone_applied_homepage_html).toBeNull();
    expect(data?.design_tokens).toBeNull();
    expect(data?.tone_of_voice).toBeNull();
    expect(data?.design_direction_status).toBe("pending");
    expect(data?.tone_of_voice_status).toBe("pending");
  });
});

describe("0060: status CHECK constraints", () => {
  it.each(VALID_STATUSES)(
    "accepts design_direction_status='%s'",
    async (status) => {
      const site = await seedSite();
      const svc = getServiceRoleClient();
      const upd = await svc
        .from("sites")
        .update({ design_direction_status: status })
        .eq("id", site.id)
        .select("design_direction_status")
        .single();
      expect(upd.error).toBeNull();
      expect(upd.data?.design_direction_status).toBe(status);
    },
  );

  it.each(VALID_STATUSES)(
    "accepts tone_of_voice_status='%s'",
    async (status) => {
      const site = await seedSite();
      const svc = getServiceRoleClient();
      const upd = await svc
        .from("sites")
        .update({ tone_of_voice_status: status })
        .eq("id", site.id)
        .select("tone_of_voice_status")
        .single();
      expect(upd.error).toBeNull();
      expect(upd.data?.tone_of_voice_status).toBe(status);
    },
  );

  it("rejects unknown design_direction_status via CHECK (23514)", async () => {
    const site = await seedSite();
    const svc = getServiceRoleClient();
    const upd = await svc
      .from("sites")
      .update({ design_direction_status: "wat" })
      .eq("id", site.id);
    expect(upd.error).not.toBeNull();
    expect((upd.error as { code?: string }).code).toBe("23514");
  });

  it("rejects unknown tone_of_voice_status via CHECK (23514)", async () => {
    const site = await seedSite();
    const svc = getServiceRoleClient();
    const upd = await svc
      .from("sites")
      .update({ tone_of_voice_status: "wat" })
      .eq("id", site.id);
    expect(upd.error).not.toBeNull();
    expect((upd.error as { code?: string }).code).toBe("23514");
  });
});

describe("0060: jsonb columns round-trip", () => {
  it("design_brief stores arbitrary JSON", async () => {
    const site = await seedSite();
    const svc = getServiceRoleClient();
    const brief = {
      industry: "msp",
      reference_url: "https://example.com",
      description: "Premium technical, friendly tone",
      refinement_notes: ["lighten the hero", "increase white space"],
    };
    const upd = await svc
      .from("sites")
      .update({ design_brief: brief })
      .eq("id", site.id)
      .select("design_brief")
      .single();
    expect(upd.error).toBeNull();
    expect(upd.data?.design_brief).toEqual(brief);
  });

  it("design_tokens stores the token JSON shape", async () => {
    const site = await seedSite();
    const svc = getServiceRoleClient();
    const tokens = {
      primary: "#0F172A",
      secondary: "#475569",
      accent: "#3B82F6",
      background: "#FFFFFF",
      text: "#0F172A",
      font_heading: "Inter",
      font_body: "Inter",
      border_radius: "8px",
      spacing_unit: "8px",
    };
    const upd = await svc
      .from("sites")
      .update({ design_tokens: tokens })
      .eq("id", site.id)
      .select("design_tokens")
      .single();
    expect(upd.error).toBeNull();
    expect(upd.data?.design_tokens).toEqual(tokens);
  });

  it("tone_of_voice stores the tone JSON shape including arrays", async () => {
    const site = await seedSite();
    const svc = getServiceRoleClient();
    const tone = {
      formality_level: 3,
      sentence_length: "short",
      jargon_usage: "neutral",
      personality_markers: ["professional", "straight-talking"],
      avoid_markers: ["salesy", "jargon-heavy"],
      target_audience: "MSP business owners 25-200 staff",
      style_guide: "Sentences under 20 words. No filler.",
      approved_samples: [{ kind: "hero", text: "..." }],
    };
    const upd = await svc
      .from("sites")
      .update({ tone_of_voice: tone })
      .eq("id", site.id)
      .select("tone_of_voice")
      .single();
    expect(upd.error).toBeNull();
    expect(upd.data?.tone_of_voice).toEqual(tone);
  });
});

describe("0060: html columns round-trip", () => {
  it("homepage_concept_html / inner_page_concept_html / tone_applied_homepage_html accept long text", async () => {
    const site = await seedSite();
    const svc = getServiceRoleClient();
    const long = "<section>" + "a".repeat(50_000) + "</section>";
    const upd = await svc
      .from("sites")
      .update({
        homepage_concept_html: long,
        inner_page_concept_html: long,
        tone_applied_homepage_html: long,
      })
      .eq("id", site.id)
      .select(
        "homepage_concept_html, inner_page_concept_html, tone_applied_homepage_html",
      )
      .single();
    expect(upd.error).toBeNull();
    expect(upd.data?.homepage_concept_html).toBe(long);
    expect(upd.data?.inner_page_concept_html).toBe(long);
    expect(upd.data?.tone_applied_homepage_html).toBe(long);
  });
});
