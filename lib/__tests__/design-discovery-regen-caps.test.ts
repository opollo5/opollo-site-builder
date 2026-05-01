import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  getRegenCounts,
  incrementRegenCount,
  REGEN_CAP,
  resetRegenCount,
} from "@/lib/design-discovery/regen-caps";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// DESIGN-DISCOVERY-FOLLOWUP PR 3 — server-side cap state machine.
// Runs against a live local Supabase (vitest globalSetup TRUNCATEs
// between tests). No mocks.
// ---------------------------------------------------------------------------

const TEST_SITE_NAME = "regen-caps-test-site";
const TEST_SITE_PREFIX = "regen-caps-test";

let TEST_SITE_ID: string;

async function createSite(): Promise<string> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("sites")
    .insert({
      name: TEST_SITE_NAME,
      wp_url: "https://regen-caps.test",
      prefix: TEST_SITE_PREFIX,
      status: "active",
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`createSite failed: ${error?.message ?? "no data"}`);
  }
  return data.id;
}

beforeEach(async () => {
  TEST_SITE_ID = await createSite();
});

afterAll(async () => {
  // _setup.ts truncates between tests; nothing to do here.
});

describe("incrementRegenCount", () => {
  it("starts at 0 and increments to 1 on first call", async () => {
    const result = await incrementRegenCount(
      TEST_SITE_ID,
      "concept_refinements",
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.current).toBe(1);
  });

  it("increments independently across the two buckets", async () => {
    await incrementRegenCount(TEST_SITE_ID, "concept_refinements");
    await incrementRegenCount(TEST_SITE_ID, "concept_refinements");
    await incrementRegenCount(TEST_SITE_ID, "tone_samples");

    const counts = await getRegenCounts(TEST_SITE_ID);
    expect(counts.ok).toBe(true);
    if (counts.ok) {
      expect(counts.counts.concept_refinements).toBe(2);
      expect(counts.counts.tone_samples).toBe(1);
    }
  });

  it("returns LIMIT_REACHED at the cap", async () => {
    for (let i = 0; i < REGEN_CAP; i++) {
      const r = await incrementRegenCount(TEST_SITE_ID, "concept_refinements");
      expect(r.ok).toBe(true);
    }
    const beyond = await incrementRegenCount(
      TEST_SITE_ID,
      "concept_refinements",
    );
    expect(beyond.ok).toBe(false);
    if (!beyond.ok) {
      expect(beyond.error.code).toBe("LIMIT_REACHED");
      expect(beyond.error.message).toMatch(/Refinement limit reached/);
      expect(beyond.error.message).toMatch(/10\/10/);
    }
  });

  it("does NOT increment when the cap is hit", async () => {
    for (let i = 0; i < REGEN_CAP; i++) {
      await incrementRegenCount(TEST_SITE_ID, "tone_samples");
    }
    await incrementRegenCount(TEST_SITE_ID, "tone_samples");
    await incrementRegenCount(TEST_SITE_ID, "tone_samples");
    const counts = await getRegenCounts(TEST_SITE_ID);
    expect(counts.ok).toBe(true);
    if (counts.ok) expect(counts.counts.tone_samples).toBe(REGEN_CAP);
  });

  it("returns NOT_FOUND for an unknown site", async () => {
    const r = await incrementRegenCount(
      "00000000-0000-0000-0000-000000000000",
      "concept_refinements",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("NOT_FOUND");
  });
});

describe("resetRegenCount", () => {
  it("zeros the targeted bucket without touching the other", async () => {
    await incrementRegenCount(TEST_SITE_ID, "concept_refinements");
    await incrementRegenCount(TEST_SITE_ID, "concept_refinements");
    await incrementRegenCount(TEST_SITE_ID, "tone_samples");
    await resetRegenCount(TEST_SITE_ID, "concept_refinements");
    const counts = await getRegenCounts(TEST_SITE_ID);
    expect(counts.ok).toBe(true);
    if (counts.ok) {
      expect(counts.counts.concept_refinements).toBe(0);
      expect(counts.counts.tone_samples).toBe(1);
    }
  });

  it("re-enables increments after a reset", async () => {
    for (let i = 0; i < REGEN_CAP; i++) {
      await incrementRegenCount(TEST_SITE_ID, "concept_refinements");
    }
    const overCap = await incrementRegenCount(
      TEST_SITE_ID,
      "concept_refinements",
    );
    expect(overCap.ok).toBe(false);

    await resetRegenCount(TEST_SITE_ID, "concept_refinements");
    const afterReset = await incrementRegenCount(
      TEST_SITE_ID,
      "concept_refinements",
    );
    expect(afterReset.ok).toBe(true);
    if (afterReset.ok) expect(afterReset.current).toBe(1);
  });
});

describe("getRegenCounts", () => {
  it("returns the default row for a freshly-created site", async () => {
    const counts = await getRegenCounts(TEST_SITE_ID);
    expect(counts.ok).toBe(true);
    if (counts.ok) {
      expect(counts.counts.concept_refinements).toBe(0);
      expect(counts.counts.tone_samples).toBe(0);
    }
  });
});
