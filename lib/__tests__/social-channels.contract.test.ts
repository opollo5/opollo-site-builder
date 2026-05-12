import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// LAYER 2 — Contract. Channel-selection SDK shape.
//
// Pins the exact request body the channels.ts wrappers send to
// bundle.social's socialAccountRefreshChannels / socialAccountSetChannel
// / socialAccountUnsetChannel endpoints, per platform. Snapshot drift
// gets reviewed as a Zod-schema diff at the boundary.
//
// Coverage: 5 channel-selection platforms × 3 ops = 15 snapshots.
// refreshChannels additionally supports DISCORD/SLACK/REDDIT/PINTEREST,
// but those aren't channel-selection-required so only one extra-platform
// smoke is included (DISCORD).
// ---------------------------------------------------------------------------

const setChannelMock = vi.fn();
const unsetChannelMock = vi.fn();
const refreshChannelsMock = vi.fn();
const getByTypeMock = vi.fn();

vi.mock("@/lib/bundlesocial", () => ({
  getBundlesocialClient: () => ({
    socialAccount: {
      socialAccountSetChannel: setChannelMock,
      socialAccountUnsetChannel: unsetChannelMock,
      socialAccountRefreshChannels: refreshChannelsMock,
      socialAccountGetByType: getByTypeMock,
    },
  }),
  getBundlesocialTeamId: () => "ignored-in-this-test",
}));

import {
  getChannels,
  normalizeChannel,
  refreshChannels,
  setChannel,
  unsetChannel,
} from "@/lib/platform/social/connections/channels";

const TEAM_ID = "team-channels-contract";

const CHANNEL_PLATFORMS = [
  "LINKEDIN",
  "FACEBOOK",
  "INSTAGRAM",
  "YOUTUBE",
  "GOOGLE_BUSINESS",
] as const;

beforeEach(() => {
  setChannelMock.mockReset();
  unsetChannelMock.mockReset();
  refreshChannelsMock.mockReset();
  getByTypeMock.mockReset();
  refreshChannelsMock.mockResolvedValue({ channels: [] });
  setChannelMock.mockResolvedValue({ externalId: "urn:x", userId: "urn:u" });
  unsetChannelMock.mockResolvedValue({});
  getByTypeMock.mockResolvedValue({ channels: [] });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("CONTRACT: socialAccountRefreshChannels — per platform", () => {
  for (const platform of CHANNEL_PLATFORMS) {
    it(`[snapshot] ${platform} — request body`, async () => {
      await refreshChannels({ teamId: TEAM_ID, platform });
      const arg = refreshChannelsMock.mock.calls[0]?.[0];
      expect(arg).toMatchSnapshot();
    });
  }

  // Extra-platform smoke: refreshChannels supports DISCORD/SLACK/REDDIT/
  // PINTEREST in addition to the channel-selection set. setChannel /
  // unsetChannel do NOT — covered by the supported-platform error tests
  // below.
  it("[snapshot] DISCORD — request body (refresh-only platform)", async () => {
    await refreshChannels({ teamId: TEAM_ID, platform: "DISCORD" });
    const arg = refreshChannelsMock.mock.calls[0]?.[0];
    expect(arg).toMatchSnapshot();
  });
});

describe("CONTRACT: socialAccountSetChannel — per platform", () => {
  for (const platform of CHANNEL_PLATFORMS) {
    it(`[snapshot] ${platform} — request body`, async () => {
      await setChannel({
        teamId: TEAM_ID,
        platform,
        channelId: "channel-fixture-1",
      });
      const arg = setChannelMock.mock.calls[0]?.[0];
      expect(arg).toMatchSnapshot();
    });
  }
});

describe("CONTRACT: socialAccountUnsetChannel — per platform", () => {
  for (const platform of CHANNEL_PLATFORMS) {
    it(`[snapshot] ${platform} — request body`, async () => {
      await unsetChannel({ teamId: TEAM_ID, platform });
      const arg = unsetChannelMock.mock.calls[0]?.[0];
      expect(arg).toMatchSnapshot();
    });
  }
});

describe("setChannel / unsetChannel — platform support", () => {
  it("setChannel refuses TWITTER (not a channel-selection platform)", async () => {
    const r = await setChannel({
      teamId: TEAM_ID,
      // @ts-expect-error — intentionally widening to test the runtime guard
      platform: "TWITTER",
      channelId: "x",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("PLATFORM_NOT_SUPPORTED");
    expect(setChannelMock).not.toHaveBeenCalled();
  });

  it("unsetChannel refuses DISCORD (not a channel-selection platform)", async () => {
    const r = await unsetChannel({
      teamId: TEAM_ID,
      // @ts-expect-error — intentionally widening to test the runtime guard
      platform: "DISCORD",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("PLATFORM_NOT_SUPPORTED");
    expect(unsetChannelMock).not.toHaveBeenCalled();
  });
});

describe("normalizeChannel — per-platform subtext", () => {
  it("LINKEDIN — uses username for the subtext", () => {
    const c = normalizeChannel("LINKEDIN", {
      id: "urn:li:organization:42",
      name: "ACME Co",
      username: "acme-co",
      avatarUrl: "https://cdn/acme.png",
    });
    expect(c.kind).toBe("LINKEDIN_ORG");
    expect(c.name).toBe("ACME Co");
    expect(c.subtext).toBe("acme-co");
    expect(c.avatarUrl).toBe("https://cdn/acme.png");
  });

  it("FACEBOOK_PAGE — uses username for the subtext", () => {
    const c = normalizeChannel("FACEBOOK", {
      id: "fb-page-42",
      name: "Pizza Inc",
      username: "pizza.inc",
    });
    expect(c.kind).toBe("FACEBOOK_PAGE");
    expect(c.subtext).toBe("pizza.inc");
  });

  it("INSTAGRAM — prefixes the username with @", () => {
    const c = normalizeChannel("INSTAGRAM", {
      id: "ig-acc-42",
      name: "Pizza Inc",
      username: "pizza_inc",
    });
    expect(c.subtext).toBe("@pizza_inc");
  });

  it("INSTAGRAM — does NOT double-prefix when username already starts with @", () => {
    const c = normalizeChannel("INSTAGRAM", {
      id: "ig-acc-42",
      name: "Pizza Inc",
      username: "@pizza_inc",
    });
    expect(c.subtext).toBe("@pizza_inc");
  });

  it("YOUTUBE — uses username for the subtext", () => {
    const c = normalizeChannel("YOUTUBE", {
      id: "yt-ch-42",
      name: "Pizza Tube",
      username: "pizzatube",
    });
    expect(c.kind).toBe("YOUTUBE_CHANNEL");
    expect(c.subtext).toBe("pizzatube");
  });

  it("GOOGLE_BUSINESS — uses address for the subtext", () => {
    const c = normalizeChannel("GOOGLE_BUSINESS", {
      id: "gbp-loc-42",
      name: "Pizza Inc — Surry Hills",
      address: "12 Crown St, Surry Hills NSW 2010",
    });
    expect(c.kind).toBe("GBP_LOCATION");
    expect(c.subtext).toBe("12 Crown St, Surry Hills NSW 2010");
  });

  it("falls back to username, then id, when name is missing", () => {
    expect(
      normalizeChannel("LINKEDIN", { id: "urn:li:42", username: "fallback" }).name,
    ).toBe("fallback");
    expect(normalizeChannel("FACEBOOK", { id: "id-only" }).name).toBe(
      "id-only",
    );
  });
});

describe("refreshChannels / getChannels — response shaping", () => {
  it("returns the normalised Channel[] from the SDK response", async () => {
    refreshChannelsMock.mockResolvedValueOnce({
      channels: [
        { id: "urn:1", name: "Org One", username: "one" },
        { id: "urn:2", name: "Org Two", username: "two" },
      ],
    });
    const r = await refreshChannels({ teamId: TEAM_ID, platform: "LINKEDIN" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.channels).toHaveLength(2);
      expect(r.data.channels[0]).toMatchObject({
        id: "urn:1",
        name: "Org One",
        subtext: "one",
        kind: "LINKEDIN_ORG",
      });
    }
  });

  it("returns [] when the SDK returns null channels", async () => {
    refreshChannelsMock.mockResolvedValueOnce({ channels: null });
    const r = await refreshChannels({ teamId: TEAM_ID, platform: "LINKEDIN" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.channels).toEqual([]);
  });

  it("getChannels uses socialAccountGetByType (cached read, no refresh)", async () => {
    getByTypeMock.mockResolvedValueOnce({
      channels: [{ id: "urn:cached", name: "Cached" }],
    });
    const r = await getChannels({ teamId: TEAM_ID, platform: "FACEBOOK" });
    expect(getByTypeMock).toHaveBeenCalledWith({
      teamId: TEAM_ID,
      type: "FACEBOOK",
    });
    expect(refreshChannelsMock).not.toHaveBeenCalled();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.channels[0]?.id).toBe("urn:cached");
  });
});

describe("SDK error mapping — UPSTREAM_REJECTED for 4xx", () => {
  it("setChannel surfaces UPSTREAM_REJECTED on 400", async () => {
    setChannelMock.mockRejectedValueOnce({
      name: "ApiError",
      status: 400,
      body: { message: "channel not found" },
    });
    const r = await setChannel({
      teamId: TEAM_ID,
      platform: "LINKEDIN",
      channelId: "missing",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("UPSTREAM_REJECTED");
      expect(r.error.message).toBe("channel not found");
    }
  });

  it("setChannel surfaces INTERNAL_ERROR on 500", async () => {
    setChannelMock.mockRejectedValueOnce({
      name: "ApiError",
      status: 503,
      body: { message: "downstream out" },
    });
    const r = await setChannel({
      teamId: TEAM_ID,
      platform: "LINKEDIN",
      channelId: "ok",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("INTERNAL_ERROR");
  });
});
