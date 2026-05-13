// ---------------------------------------------------------------------------
// REGRESSION — set-channel must write display_name from the selected
// channel's name (not the personal OAuth displayName). And must emit
// a connection_channel_selected platform_event on success.
//
// Incident: 2026-05-13
// After picking an org page the UI showed "Steven Morey" (OAuth personal
// name) instead of the org page name because set-channel never updated
// display_name. Fixed: find channel in fingerprint.channels and write name.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock factories are hoisted above variable declarations, so all mock
// fn handles must be created via vi.hoisted() to be in scope.
const mocks = vi.hoisted(() => ({
  setChannel: vi.fn(),
  resolveIdentityFingerprint: vi.fn(),
  checkCrossTenantConflict: vi.fn(),
  computeIdentityHash: vi.fn(),
  emitCrossTenantBlocked: vi.fn(),
  update: vi.fn(),
  platformEventInsert: vi.fn(),
}));

vi.mock("@/lib/platform/social/connections/channels", () => ({
  setChannel: mocks.setChannel,
}));

vi.mock("@/lib/platform/social/connections/identity", () => ({
  resolveIdentityFingerprint: mocks.resolveIdentityFingerprint,
  checkCrossTenantConflict: mocks.checkCrossTenantConflict,
  computeIdentityHash: mocks.computeIdentityHash,
  emitCrossTenantBlocked: mocks.emitCrossTenantBlocked,
}));

vi.mock("@/lib/bundlesocial", () => ({}));

vi.mock("@/lib/platform/auth/api-gate", () => ({
  requireCanDoForApi: async () => ({
    kind: "allow" as const,
    userId: "user-test",
    supabase: {} as never,
  }),
}));

const connRow = {
  id: "cd339e96-8388-469f-9ef7-d035d9306353",
  company_id: "11111111-1111-1111-1111-111111111111",
  profile_id: "22222222-2222-2222-2222-222222222222",
  platform: "linkedin_personal",
  bundle_social_account_id: "bs-acct-1",
  status: "pending_identity",
  is_personal_mode: false,
  display_name: "Steven Morey",
  external_account_id: null,
};

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: () => ({
    from: (table: string) => {
      if (table === "social_connections") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: connRow, error: null }),
            }),
          }),
          update: (vals: unknown) => ({
            eq: (_col: string, _val: string) => mocks.update(vals),
          }),
        };
      }
      if (table === "platform_social_profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { bundle_social_team_id: "team-fixture" },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "platform_events") {
        return {
          insert: (payload: unknown) => mocks.platformEventInsert(payload),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  }),
}));

import { POST } from "@/app/api/platform/social/connections/[id]/set-channel/route";

const ORG_URN = "urn:li:organization:105341307";
const ORG_NAME = "Opollo MSP Marketing";
const PERSON_URN = "urn:li:person:AbC123";
const PERSON_NAME = "Steven Morey";

function makeReq(channelId: string): Request {
  return new Request(
    `http://localhost/api/platform/social/connections/${connRow.id}/set-channel`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channel_id: channelId }),
    },
  );
}

const BASE_FINGERPRINT = {
  external_account_id: ORG_URN,
  external_user_id: PERSON_URN,
  external_identity_hash: "hash-abc",
  displayName: PERSON_NAME,
  channels: [
    {
      id: ORG_URN,
      name: ORG_NAME,
      username: "opollo-msp",
      address: null,
      avatarUrl: null,
    },
    {
      id: "urn:li:organization:999",
      name: "Some Other Page",
      username: "other",
      address: null,
      avatarUrl: null,
    },
  ],
  raw: {},
};

beforeEach(() => {
  mocks.setChannel.mockReset();
  mocks.resolveIdentityFingerprint.mockReset();
  mocks.checkCrossTenantConflict.mockReset();
  mocks.computeIdentityHash.mockReset();
  mocks.emitCrossTenantBlocked.mockReset();
  mocks.update.mockReset();
  mocks.platformEventInsert.mockReset();

  mocks.setChannel.mockResolvedValue({
    ok: true,
    data: { externalId: ORG_URN, userId: PERSON_URN },
  });
  mocks.resolveIdentityFingerprint.mockResolvedValue(BASE_FINGERPRINT);
  mocks.computeIdentityHash.mockReturnValue("hash-abc");
  mocks.checkCrossTenantConflict.mockResolvedValue({
    ok: true,
    override_allowed: true,
    conflicting_rows: [],
  });
  mocks.update.mockResolvedValue({ error: null });
  mocks.platformEventInsert.mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("R-SET-CHANNEL-DISPLAY-NAME: set-channel writes channel name, not personal name", () => {
  it("200 on success", async () => {
    const res = await POST(makeReq(ORG_URN) as never, {
      params: { id: connRow.id },
    });
    expect(res.status).toBe(200);
  });

  it("writes display_name from the selected channel's name (not OAuth personal name)", async () => {
    await POST(makeReq(ORG_URN) as never, { params: { id: connRow.id } });

    expect(mocks.update).toHaveBeenCalledTimes(1);
    const written = mocks.update.mock.calls[0]![0] as Record<string, unknown>;
    expect(written.display_name).toBe(ORG_NAME);
  });

  it("does NOT write the personal OAuth displayName as display_name", async () => {
    await POST(makeReq(ORG_URN) as never, { params: { id: connRow.id } });

    const written = mocks.update.mock.calls[0]![0] as Record<string, unknown>;
    expect(written.display_name).not.toBe(PERSON_NAME);
  });

  it("sets is_personal_mode=false and status=healthy on the update", async () => {
    await POST(makeReq(ORG_URN) as never, { params: { id: connRow.id } });

    const written = mocks.update.mock.calls[0]![0] as Record<string, unknown>;
    expect(written.status).toBe("healthy");
    expect(written.is_personal_mode).toBe(false);
  });

  it("emits a connection_channel_selected platform_event", async () => {
    await POST(makeReq(ORG_URN) as never, { params: { id: connRow.id } });

    // platform_events insert fires async (void); flush microtasks.
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.platformEventInsert).toHaveBeenCalledTimes(1);
    const payload = mocks.platformEventInsert.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(payload.event_type).toBe("connection_channel_selected");
    expect(payload.entity_id).toBe(connRow.id);
    const inner = payload.payload as Record<string, unknown>;
    expect(inner.channel_id).toBe(ORG_URN);
    expect(inner.channel_name).toBe(ORG_NAME);
  });

  it("records previous display_name in the event payload for audit trail", async () => {
    await POST(makeReq(ORG_URN) as never, { params: { id: connRow.id } });

    await new Promise((r) => setTimeout(r, 0));
    const payload = mocks.platformEventInsert.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    const inner = payload.payload as Record<string, unknown>;
    expect(inner.previous_display_name).toBe(PERSON_NAME);
  });

  it("display_name is null when channel_id is not found in channels list (graceful fallback)", async () => {
    const unknownId = "urn:li:organization:999999";
    // channels list does not contain unknownId — find returns undefined.
    mocks.resolveIdentityFingerprint.mockResolvedValueOnce({
      ...BASE_FINGERPRINT,
      external_account_id: unknownId,
      channels: [
        {
          id: ORG_URN,
          name: ORG_NAME,
          username: "opollo-msp",
          address: null,
          avatarUrl: null,
        },
      ],
    });

    const res = await POST(makeReq(unknownId) as never, {
      params: { id: connRow.id },
    });
    expect(res.status).toBe(200);

    const written = mocks.update.mock.calls[0]![0] as Record<string, unknown>;
    expect(written.display_name).toBeNull();
  });
});
