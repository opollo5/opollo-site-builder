// ---------------------------------------------------------------------------
// REGRESSION — set-channel cross-tenant conflict surfaces structured 409
// and the force override path emits audit event.
//
// Bug reported 2026-05-14: set-channel returns 409 on cross-tenant conflict
// (from PR #868 identity layer) but the modal showed no UI — the error body
// was a plain INVALID_STATE message not surfaced as actionable conflict UI.
//
// Fixes:
//   A. Return CROSS_TENANT_CONFLICT 409 with conflicting_company /
//      conflicting_channel_name / override_allowed in error.details.
//   B. Accept force:true; when override_allowed=true proceed and emit
//      cross_tenant_override audit event.
//   C. ChannelPickerBody guards duplicate clicks and renders conflict UI.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setChannel: vi.fn(),
  resolveIdentityFingerprint: vi.fn(),
  checkCrossTenantConflict: vi.fn(),
  computeIdentityHash: vi.fn(),
  emitCrossTenantBlocked: vi.fn(),
  emitCrossTenantOverride: vi.fn(),
  update: vi.fn(),
  platformEventInsert: vi.fn(),
  platformCompaniesSelect: vi.fn(),
}));

vi.mock("@/lib/platform/social/connections/channels", () => ({
  setChannel: mocks.setChannel,
}));

vi.mock("@/lib/platform/social/connections/identity", () => ({
  resolveIdentityFingerprint: mocks.resolveIdentityFingerprint,
  checkCrossTenantConflict: mocks.checkCrossTenantConflict,
  computeIdentityHash: mocks.computeIdentityHash,
  emitCrossTenantBlocked: mocks.emitCrossTenantBlocked,
  emitCrossTenantOverride: mocks.emitCrossTenantOverride,
}));

vi.mock("@/lib/bundlesocial", () => ({}));

vi.mock("@/lib/platform/auth/api-gate", () => ({
  requireCanDoForApi: async () => ({
    kind: "allow" as const,
    userId: "user-test",
    supabase: {} as never,
  }),
}));

const CONN_ID = "cd339e96-8388-469f-9ef7-d035d9306353";
const COMPANY_ID = "11111111-1111-1111-1111-111111111111";
const PROFILE_ID = "22222222-2222-2222-2222-222222222222";
const OTHER_COMPANY_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const connRow = {
  id: CONN_ID,
  company_id: COMPANY_ID,
  profile_id: PROFILE_ID,
  platform: "linkedin_personal",
  bundle_social_account_id: "bs-acct-1",
  status: "pending_identity",
  is_personal_mode: false,
  display_name: "Opollo LinkedIn",
  external_account_id: null,
};

const conflictingRow = {
  id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  company_id: OTHER_COMPANY_ID,
  profile_id: null,
  platform: "linkedin_personal",
  display_name: "Acme LinkedIn Page",
  external_account_id: "urn:li:organization:12345",
  external_user_id: "urn:li:person:Steve",
  external_identity_hash: "hash-conflict",
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
      if (table === "platform_companies") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => mocks.platformCompaniesSelect(),
            }),
          }),
        };
      }
      if (table === "platform_events") {
        return {
          insert: (payload: unknown) => mocks.platformEventInsert(payload),
        };
      }
      throw new Error(`Unexpected table in mock: ${table}`);
    },
  }),
}));

import { POST } from "@/app/api/platform/social/connections/[id]/set-channel/route";

const BASE_FINGERPRINT = {
  external_account_id: "urn:li:organization:12345",
  external_user_id: "urn:li:person:Steve",
  external_identity_hash: "hash-conflict",
  displayName: "Steve",
  channels: [
    {
      id: "urn:li:organization:12345",
      name: "Acme LinkedIn Page",
      username: "acme",
      address: null,
      avatarUrl: null,
    },
  ],
  raw: {},
};

function makeReq(channelId: string, extra?: Record<string, unknown>): Request {
  return new Request(
    `http://localhost/api/platform/social/connections/${CONN_ID}/set-channel`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channel_id: channelId, ...extra }),
    },
  );
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();

  mocks.setChannel.mockResolvedValue({
    ok: true,
    data: { externalId: "urn:li:organization:12345", userId: "urn:li:person:Steve" },
  });
  mocks.resolveIdentityFingerprint.mockResolvedValue(BASE_FINGERPRINT);
  mocks.computeIdentityHash.mockReturnValue("hash-conflict");
  mocks.update.mockResolvedValue({ error: null });
  mocks.platformEventInsert.mockResolvedValue({ error: null });
  mocks.platformCompaniesSelect.mockResolvedValue({
    data: { name: "Acme Corp" },
    error: null,
  });
  mocks.emitCrossTenantBlocked.mockResolvedValue(undefined);
  mocks.emitCrossTenantOverride.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("R-CHANNEL-409: conflict without force → structured 409 CROSS_TENANT_CONFLICT", () => {
  beforeEach(() => {
    mocks.checkCrossTenantConflict.mockResolvedValue({
      ok: false,
      code: "CROSS_TENANT",
      override_allowed: true,
      conflicting_rows: [conflictingRow],
    });
  });

  it("returns 409", async () => {
    const res = await POST(makeReq("urn:li:organization:12345") as never, {
      params: { id: CONN_ID },
    });
    expect(res.status).toBe(409);
  });

  it("body.error.code is CROSS_TENANT_CONFLICT", async () => {
    const res = await POST(makeReq("urn:li:organization:12345") as never, {
      params: { id: CONN_ID },
    });
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CROSS_TENANT_CONFLICT");
  });

  it("body.error.details.conflicting_company is the looked-up company name", async () => {
    const res = await POST(makeReq("urn:li:organization:12345") as never, {
      params: { id: CONN_ID },
    });
    const body = (await res.json()) as {
      error: { details: { conflicting_company: string } };
    };
    expect(body.error.details.conflicting_company).toBe("Acme Corp");
  });

  it("body.error.details.conflicting_channel_name is the row display_name", async () => {
    const res = await POST(makeReq("urn:li:organization:12345") as never, {
      params: { id: CONN_ID },
    });
    const body = (await res.json()) as {
      error: { details: { conflicting_channel_name: string } };
    };
    expect(body.error.details.conflicting_channel_name).toBe("Acme LinkedIn Page");
  });

  it("body.error.details.override_allowed reflects the conflict result", async () => {
    const res = await POST(makeReq("urn:li:organization:12345") as never, {
      params: { id: CONN_ID },
    });
    const body = (await res.json()) as {
      error: { details: { override_allowed: boolean } };
    };
    expect(body.error.details.override_allowed).toBe(true);
  });

  it("emits cross_tenant_blocked audit event", async () => {
    await POST(makeReq("urn:li:organization:12345") as never, {
      params: { id: CONN_ID },
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.emitCrossTenantBlocked).toHaveBeenCalledTimes(1);
    expect(mocks.emitCrossTenantOverride).not.toHaveBeenCalled();
  });

  it("does NOT write a DB row on conflict", async () => {
    await POST(makeReq("urn:li:organization:12345") as never, {
      params: { id: CONN_ID },
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });
});

describe("R-CHANNEL-409: conflict without force, override_allowed=false → 409 no override button", () => {
  it("override_allowed:false reflected in response details", async () => {
    mocks.checkCrossTenantConflict.mockResolvedValue({
      ok: false,
      code: "CROSS_TENANT",
      override_allowed: false,
      conflicting_rows: [conflictingRow],
    });
    const res = await POST(makeReq("urn:li:organization:12345") as never, {
      params: { id: CONN_ID },
    });
    const body = (await res.json()) as {
      error: { details: { override_allowed: boolean } };
    };
    expect(body.error.details.override_allowed).toBe(false);
  });
});

describe("R-CHANNEL-409: force=true + override_allowed=true → 200 + override audit", () => {
  beforeEach(() => {
    mocks.checkCrossTenantConflict.mockResolvedValue({
      ok: false,
      code: "CROSS_TENANT",
      override_allowed: true,
      conflicting_rows: [conflictingRow],
    });
  });

  it("returns 200 when force=true and override_allowed=true", async () => {
    const res = await POST(
      makeReq("urn:li:organization:12345", { force: true }) as never,
      { params: { id: CONN_ID } },
    );
    expect(res.status).toBe(200);
  });

  it("emits cross_tenant_override audit event (not blocked)", async () => {
    await POST(
      makeReq("urn:li:organization:12345", { force: true }) as never,
      { params: { id: CONN_ID } },
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.emitCrossTenantOverride).toHaveBeenCalledTimes(1);
    expect(mocks.emitCrossTenantBlocked).not.toHaveBeenCalled();
  });

  it("writes status=healthy to DB on successful override", async () => {
    await POST(
      makeReq("urn:li:organization:12345", { force: true }) as never,
      { params: { id: CONN_ID } },
    );
    expect(mocks.update).toHaveBeenCalledTimes(1);
    const written = mocks.update.mock.calls[0]![0] as { status: string };
    expect(written.status).toBe("healthy");
  });
});

describe("R-CHANNEL-409: force=true but override_allowed=false → still 409 (cannot override)", () => {
  it("returns 409 even with force=true when override_allowed=false", async () => {
    mocks.checkCrossTenantConflict.mockResolvedValue({
      ok: false,
      code: "CROSS_TENANT",
      override_allowed: false,
      conflicting_rows: [conflictingRow],
    });
    const res = await POST(
      makeReq("urn:li:organization:12345", { force: true }) as never,
      { params: { id: CONN_ID } },
    );
    expect(res.status).toBe(409);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
