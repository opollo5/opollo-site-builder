import { describe, expect, it } from "vitest";

import {
  ANCHOR_EXTRA_CYCLES,
  SiteConventionsSchema,
  freezeSiteConventions,
  getSiteConventions,
} from "@/lib/site-conventions";
import { getServiceRoleClient } from "@/lib/supabase";

import { seedSite } from "./_helpers";

// ---------------------------------------------------------------------------
// M12-2 — lib/site-conventions.ts tests.
//
// Split into four concern groups:
//
//   1. ANCHOR_EXTRA_CYCLES constant exported — M12-3 will read it.
//   2. SiteConventionsSchema — zod validation of the payload shape.
//   3. freezeSiteConventions — idempotency + NOT_FOUND + read-after-write.
//   4. getSiteConventions — read-path sanity.
//
// _setup.ts TRUNCATEs every table in beforeEach, so every test that needs a
// brief creates its own site + brief fresh inside the test body. Do NOT
// hoist to beforeAll — the truncate will wipe the row before the test runs.
// ---------------------------------------------------------------------------

async function seedBrief(siteId: string, suffix: string): Promise<string> {
  const svc = getServiceRoleClient();
  const unique = `${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { data, error } = await svc
    .from("briefs")
    .insert({
      site_id: siteId,
      title: `site-conventions test ${unique}`,
      status: "parsed",
      source_storage_path: `site-conventions-test/${unique}.md`,
      source_mime_type: "text/markdown",
      source_size_bytes: 128,
      source_sha256: "0".repeat(64),
      upload_idempotency_key: `site-conv-${unique}`,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`seedBrief: ${error?.message ?? "no data"}`);
  }
  return data.id as string;
}

describe("ANCHOR_EXTRA_CYCLES", () => {
  it("exports a positive integer", () => {
    expect(Number.isInteger(ANCHOR_EXTRA_CYCLES)).toBe(true);
    expect(ANCHOR_EXTRA_CYCLES).toBeGreaterThan(0);
  });
});

describe("SiteConventionsSchema", () => {
  it("accepts an empty object (all fields optional)", () => {
    const res = SiteConventionsSchema.safeParse({});
    expect(res.success).toBe(true);
  });

  it("accepts a full object with every known field", () => {
    const res = SiteConventionsSchema.safeParse({
      typographic_scale: "1.25 modular",
      section_rhythm: "alternating dense/airy",
      hero_pattern: "full-width with photo background",
      cta_phrasing: { primary: "Get started", secondary: "Learn more" },
      color_role_map: { primary: "--ls-blue", accent: "--ls-yellow" },
      tone_register: "warm, confident",
      additional: { vertical_rhythm_baseline_px: 8 },
    });
    expect(res.success).toBe(true);
  });

  it("defaults `additional` to an empty object when omitted", () => {
    const res = SiteConventionsSchema.parse({ tone_register: "formal" });
    expect(res.additional).toEqual({});
  });

  it("accepts null for structured fields (explicit no-constraint)", () => {
    const res = SiteConventionsSchema.safeParse({
      cta_phrasing: null,
      color_role_map: null,
      typographic_scale: null,
    });
    expect(res.success).toBe(true);
  });

  it("rejects a numeric value in a string field", () => {
    const res = SiteConventionsSchema.safeParse({
      typographic_scale: 1.25,
    });
    expect(res.success).toBe(false);
  });

  it("rejects an array for cta_phrasing (expects a record)", () => {
    const res = SiteConventionsSchema.safeParse({
      cta_phrasing: ["Get started", "Learn more"],
    });
    expect(res.success).toBe(false);
  });
});

describe("freezeSiteConventions", () => {
  it("returns NOT_FOUND when the brief doesn't exist", async () => {
    // No site/brief seeded — the UUID is a pure ghost.
    const res = await freezeSiteConventions({
      briefId: "00000000-0000-0000-0000-000000000000",
      conventions: { tone_register: "neutral" },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("NOT_FOUND");
  });

  it("returns VALIDATION_FAILED on invalid payload", async () => {
    const site = await seedSite();
    const briefId = await seedBrief(site.id, "validation");
    const res = await freezeSiteConventions({
      briefId,
      conventions: { typographic_scale: 1.25 },
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("VALIDATION_FAILED");
  });

  it("first call inserts the row with frozen_at set, wasAlreadyFrozen=false", async () => {
    const site = await seedSite();
    const briefId = await seedBrief(site.id, "first");
    const conventions = {
      tone_register: "neutral",
      typographic_scale: "1.25",
      cta_phrasing: { primary: "Start" },
    };
    const res = await freezeSiteConventions({ briefId, conventions });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.wasAlreadyFrozen).toBe(false);
    expect(res.row.brief_id).toBe(briefId);
    expect(res.row.tone_register).toBe("neutral");
    expect(res.row.typographic_scale).toBe("1.25");
    expect(res.row.cta_phrasing).toEqual({ primary: "Start" });
    expect(res.row.frozen_at).not.toBeNull();
  });

  it("second call on same brief returns wasAlreadyFrozen=true without mutating", async () => {
    const site = await seedSite();
    const briefId = await seedBrief(site.id, "second");
    const firstConventions = { tone_register: "neutral" };
    const first = await freezeSiteConventions({
      briefId,
      conventions: firstConventions,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const originalFrozenAt = first.row.frozen_at;
    const originalId = first.row.id;

    // Call again with DIFFERENT conventions. The existing row must win;
    // the new payload is ignored.
    const second = await freezeSiteConventions({
      briefId,
      conventions: { tone_register: "playful", typographic_scale: "1.5" },
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.wasAlreadyFrozen).toBe(true);
    expect(second.row.id).toBe(originalId);
    expect(second.row.frozen_at).toBe(originalFrozenAt);
    // Original conventions preserved — the second call did NOT overwrite.
    expect(second.row.tone_register).toBe("neutral");
    expect(second.row.typographic_scale).toBeNull();
  });

  it("concurrent calls resolve to the same frozen row", async () => {
    const site = await seedSite();
    const briefId = await seedBrief(site.id, "concurrent");
    const conventions = { tone_register: "urgent" };
    // Fire both promises in the same tick. Whichever INSERT wins, the
    // other must resolve via the post-conflict read path.
    const [a, b] = await Promise.all([
      freezeSiteConventions({ briefId, conventions }),
      freezeSiteConventions({ briefId, conventions }),
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    // Both resolve to the same row.
    expect(a.row.id).toBe(b.row.id);
    expect(a.row.brief_id).toBe(briefId);
    expect(b.row.brief_id).toBe(briefId);
    // Exactly one call saw wasAlreadyFrozen=false (the INSERT winner).
    const firstFrozenCount =
      (a.wasAlreadyFrozen ? 0 : 1) + (b.wasAlreadyFrozen ? 0 : 1);
    expect(firstFrozenCount).toBe(1);
  });
});

describe("getSiteConventions", () => {
  it("returns null when no conventions row exists for a brief", async () => {
    const site = await seedSite();
    const briefId = await seedBrief(site.id, "get-null");
    const res = await getSiteConventions(briefId);
    expect(res).toBeNull();
  });

  it("returns the row after freezeSiteConventions has run", async () => {
    const site = await seedSite();
    const briefId = await seedBrief(site.id, "get-row");
    await freezeSiteConventions({
      briefId,
      conventions: { tone_register: "playful" },
    });
    const res = await getSiteConventions(briefId);
    expect(res).not.toBeNull();
    expect(res?.brief_id).toBe(briefId);
    expect(res?.tone_register).toBe("playful");
    expect(res?.frozen_at).not.toBeNull();
  });
});
