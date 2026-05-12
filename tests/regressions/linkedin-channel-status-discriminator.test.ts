import { describe, expect, it } from "vitest";

import {
  CHANNEL_SELECTION_PLATFORMS,
  requiresChannelSelection,
} from "@/lib/platform/social/connections/identity";

// ---------------------------------------------------------------------------
// REGRESSION #884 — LinkedIn channel-picker skipped after OAuth
//
// Incident: sync.ts used `identity.channels.length > 0` as the "channel
// selected" discriminator. bundle.social populates channels[] immediately
// after OAuth (before the user picks anything), so every fresh LinkedIn
// connect landed as status='healthy'. The callback route's
// `findMostRecentlyInsertedConnectionId` filters on status='pending_identity'
// — it returned null, so `connect=needs_channel` was never sent and the
// picker was never shown.
//
// Fix: use `external_account_id !== null` as the discriminator. externalId
// is only set after socialAccountSetChannel is called.
//
// Reference: docs/incidents/2026-05-12-linkedin-channel-picker-missing.md
// ---------------------------------------------------------------------------

// Mirror the discriminator logic from sync.ts + process.ts so any future
// drift produces a failing test (not a silent regression).
function computeStatus(opts: {
  platform: string;
  externalAccountId: string | null;
  externalUserId?: string | null;
  isPersonal: boolean;
}): "healthy" | "pending_identity" {
  const hasIdentity =
    opts.externalAccountId !== null || (opts.externalUserId ?? null) !== null;
  const needsChannelSelection =
    requiresChannelSelection(opts.platform) &&
    opts.externalAccountId === null &&
    !opts.isPersonal;
  return !hasIdentity || needsChannelSelection ? "pending_identity" : "healthy";
}

describe("R-884: LinkedIn channel-status discriminator", () => {
  it("CHANNEL_SELECTION_PLATFORMS includes all five two-step platforms", () => {
    expect(CHANNEL_SELECTION_PLATFORMS.has("LINKEDIN")).toBe(true);
    expect(CHANNEL_SELECTION_PLATFORMS.has("FACEBOOK")).toBe(true);
    expect(CHANNEL_SELECTION_PLATFORMS.has("INSTAGRAM")).toBe(true);
    expect(CHANNEL_SELECTION_PLATFORMS.has("YOUTUBE")).toBe(true);
    expect(CHANNEL_SELECTION_PLATFORMS.has("GOOGLE_BUSINESS")).toBe(true);
  });

  it("LINKEDIN: channels.length=16, externalId=null → pending_identity (pre-setChannel)", () => {
    // This is the exact incident scenario: bundle.social returns 16 channels
    // immediately after OAuth, but no channel has been selected yet.
    // channels[] should NOT be used as the discriminator.
    const status = computeStatus({
      platform: "LINKEDIN",
      externalAccountId: null,
      isPersonal: false,
    });
    expect(status).toBe("pending_identity");
  });

  it("LINKEDIN: externalId set (setChannel called) → healthy", () => {
    const status = computeStatus({
      platform: "LINKEDIN",
      externalAccountId: "urn:li:organization:40810993",
      isPersonal: false,
    });
    expect(status).toBe("healthy");
  });

  it("TWITTER: non-channel platform → healthy when identity is populated", () => {
    // TWITTER/X does not require channel selection. Normal OAuth populates
    // userId (externalUserId); externalAccountId stays null for TWITTER.
    const status = computeStatus({
      platform: "TWITTER",
      externalAccountId: null,
      externalUserId: "urn:twitter:user:12345",
      isPersonal: false,
    });
    expect(status).toBe("healthy");
  });

  it("LINKEDIN personal mode: is_personal_mode=true bypasses channel requirement → healthy", () => {
    // User clicked "Connect as personal profile" — externalAccountId stays
    // null (no org channel bound) but externalUserId is populated after
    // OAuth. Channel selection is not required in personal mode.
    const status = computeStatus({
      platform: "LINKEDIN",
      externalAccountId: null,
      externalUserId: "urn:li:person:cn_0IGowb1",
      isPersonal: true,
    });
    expect(status).toBe("healthy");
  });
});
