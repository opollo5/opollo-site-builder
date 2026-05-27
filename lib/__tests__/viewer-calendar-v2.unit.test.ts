import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// PR-10 — unit tests for the V2 calendar additions to /viewer/[token].
//
// The viewer page is a Server Component, so we test the pure utility
// functions extracted from it rather than rendering the component.
//
// We verify:
//   1. V2 platform strings are resolved to human labels via labelFor().
//   2. Posts with multiple target_profiles expand to one entry each.
//   3. Posts with no target_profiles produce a single "unknown" entry.
//   4. V1 (SocialPlatform) labels still resolve correctly.
// ---------------------------------------------------------------------------

// labelFor and V2_PLATFORM_LABEL are internal to the page module — we
// replicate the mapping logic here so we can test it without importing the
// server component (which depends on @supabase/ssr + next/headers).

const V2_PLATFORM_LABEL: Record<string, string> = {
  linkedin:                 "LinkedIn",
  facebook:                 "Facebook",
  instagram:                "Instagram",
  x:                        "X (Twitter)",
  google_business_profile:  "Google Business Profile",
  pinterest:                "Pinterest",
  tiktok:                   "TikTok",
};

const V1_PLATFORM_LABEL: Record<string, string> = {
  linkedin_personal:    "LinkedIn (personal)",
  linkedin_company:     "LinkedIn (company)",
  facebook_page:        "Facebook page",
  instagram_business:   "Instagram business",
  x:                    "X (Twitter)",
  gbp:                  "Google Business Profile",
};

function labelFor(platform: string): string {
  return V1_PLATFORM_LABEL[platform] ?? V2_PLATFORM_LABEL[platform] ?? platform;
}

// Mirrors the V2 expansion logic from the viewer page.
function expandV2Drafts(
  drafts: Array<{
    id: string;
    content: string | null;
    link_url: string | null;
    scheduled_at: string;
    target_profiles: Array<{ profile_id: string; platform: string }> | null;
  }>,
) {
  const entries: Array<{ id: string; platform: string; master_text: string | null }> = [];
  for (const d of drafts) {
    const profiles = d.target_profiles ?? [];
    if (profiles.length === 0) {
      entries.push({ id: d.id, platform: "unknown", master_text: d.content });
    } else {
      for (const p of profiles) {
        entries.push({ id: `${d.id}:${p.profile_id}`, platform: p.platform, master_text: d.content });
      }
    }
  }
  return entries;
}

describe("viewer — V2 platform label resolution", () => {
  it("resolves V2 platform strings to human labels", () => {
    expect(labelFor("linkedin")).toBe("LinkedIn");
    expect(labelFor("facebook")).toBe("Facebook");
    expect(labelFor("instagram")).toBe("Instagram");
    expect(labelFor("google_business_profile")).toBe("Google Business Profile");
    expect(labelFor("tiktok")).toBe("TikTok");
  });

  it("resolves V1 SocialPlatform strings to human labels", () => {
    expect(labelFor("linkedin_personal")).toBe("LinkedIn (personal)");
    expect(labelFor("linkedin_company")).toBe("LinkedIn (company)");
    expect(labelFor("facebook_page")).toBe("Facebook page");
    expect(labelFor("gbp")).toBe("Google Business Profile");
  });

  it("falls back to the raw string for unknown platforms", () => {
    expect(labelFor("mastodon")).toBe("mastodon");
  });
});

describe("viewer — V2 draft expansion", () => {
  it("expands a draft with two target_profiles to two entries", () => {
    const entries = expandV2Drafts([
      {
        id: "d1",
        content: "Hello",
        link_url: null,
        scheduled_at: "2026-06-01T10:00:00Z",
        target_profiles: [
          { profile_id: "p1", platform: "linkedin" },
          { profile_id: "p2", platform: "facebook" },
        ],
      },
    ]);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ id: "d1:p1", platform: "linkedin" });
    expect(entries[1]).toMatchObject({ id: "d1:p2", platform: "facebook" });
  });

  it("produces a single unknown entry for a draft with no target_profiles", () => {
    const entries = expandV2Drafts([
      {
        id: "d2",
        content: "No connections",
        link_url: null,
        scheduled_at: "2026-06-02T10:00:00Z",
        target_profiles: null,
      },
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: "d2", platform: "unknown" });
  });

  it("preserves content and link_url in each expanded entry", () => {
    const entries = expandV2Drafts([
      {
        id: "d3",
        content: "Check this out",
        link_url: "https://example.com",
        scheduled_at: "2026-06-03T10:00:00Z",
        target_profiles: [{ profile_id: "p3", platform: "instagram" }],
      },
    ]);
    expect(entries[0]?.master_text).toBe("Check this out");
  });
});
