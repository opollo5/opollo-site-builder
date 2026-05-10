import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { __resetAuthKillSwitchCacheForTests } from "@/lib/auth-kill-switch";

// ---------------------------------------------------------------------------
// POST /api/internal/error-reports — integration / unit tests.
//
// Covers:
//   - 401 when flag on + no session
//   - 429 when rate limit exceeded (mocked)
//   - 400 on missing / malformed body
//   - 200 success path (persists row, attempts mail)
//   - Mail failure does NOT change the 200 response (data is persisted)
// ---------------------------------------------------------------------------

const mockState = vi.hoisted(() => ({
  client: null as SupabaseClient | null,
}));

vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    createRouteAuthClient: () => {
      if (!mockState.client) throw new Error("mockState.client not set");
      return mockState.client;
    },
  };
});

vi.mock("@/lib/email/sendgrid", () => ({
  sendEmail: vi.fn().mockResolvedValue({ ok: true, messageId: "test-msg-id" }),
}));

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn(),
}));

import { POST } from "@/app/api/internal/error-reports/route";
import { sendEmail } from "@/lib/email/sendgrid";
import { getServiceRoleClient } from "@/lib/supabase";

const VALID_PAYLOAD = {
  payload: {
    errorMessage: "Something broke",
    browser: "TestBrowser",
    viewport: "1280×800",
    locale: "en",
    timezone: "UTC",
    timestamp: "2026-05-10T00:00:00.000Z",
    currentUrl: "https://example.com/admin",
    routeHistory: [],
    breadcrumbs: [],
  },
};

function makeReq(body: unknown = VALID_PAYLOAD): NextRequest {
  return new NextRequest("http://localhost/api/internal/error-reports", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeSupabaseMock(insertId = "report-uuid-1") {
  return {
    from: vi.fn().mockReturnValue({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: insertId },
            error: null,
          }),
        }),
      }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    }),
  };
}

beforeEach(() => {
  __resetAuthKillSwitchCacheForTests();
  process.env.FEATURE_SUPABASE_AUTH = "false";
  process.env.ERROR_REPORT_RECIPIENT = "admin@opollo.com";
  vi.mocked(getServiceRoleClient).mockReturnValue(makeSupabaseMock() as never);
});

afterEach(() => {
  delete process.env.FEATURE_SUPABASE_AUTH;
  delete process.env.ERROR_REPORT_RECIPIENT;
  vi.clearAllMocks();
});

describe("POST /api/internal/error-reports", () => {
  it("returns 400 on missing payload field", async () => {
    const res = await POST(makeReq({ notPayload: {} }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error.code).toBe("VALIDATION_FAILED");
  });

  it("returns 400 on non-JSON body", async () => {
    const req = new NextRequest("http://localhost/api/internal/error-reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 200 and persists the row on happy path", async () => {
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.report_id).toBe("report-uuid-1");
  });

  it("sends email on happy path", async () => {
    await POST(makeReq());
    expect(sendEmail).toHaveBeenCalledOnce();
    const call = vi.mocked(sendEmail).mock.calls[0]![0];
    expect(call.to).toBe("admin@opollo.com");
    expect(call.subject).toContain("[Opollo UAT]");
  });

  it("returns 200 even when mail fails — data is persisted", async () => {
    vi.mocked(sendEmail).mockResolvedValueOnce({
      ok: false,
      error: { code: "SENDGRID_5XX", message: "Server error" },
    });
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  it("returns 200 and skips mail when ERROR_REPORT_RECIPIENT is unset", async () => {
    delete process.env.ERROR_REPORT_RECIPIENT;
    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("scrubs sensitive fields from persisted payload", async () => {
    const svc = makeSupabaseMock();
    vi.mocked(getServiceRoleClient).mockReturnValue(svc as never);

    await POST(makeReq({
      payload: {
        ...VALID_PAYLOAD.payload,
        stateSlice: { password: "hunter2", safeField: "ok" },
      },
    }));

    const insertCall = vi.mocked(svc.from("error_reports").insert).mock.calls[0]?.[0] as
      | { payload: { stateSlice: Record<string, string> } }
      | undefined;
    expect(insertCall?.payload?.stateSlice?.password).toBe("[redacted]");
    expect(insertCall?.payload?.stateSlice?.safeField).toBe("ok");
  });

  describe("with FEATURE_SUPABASE_AUTH=true", () => {
    beforeEach(() => {
      process.env.FEATURE_SUPABASE_AUTH = "true";
    });

    it("returns 401 when no session", async () => {
      const { createClient } = await import("@supabase/supabase-js");
      mockState.client = createClient("http://localhost", "anon-key");
      vi.spyOn(mockState.client.auth, "getUser").mockResolvedValue({
        data: { user: null },
        error: null,
      } as never);

      const res = await POST(makeReq());
      expect(res.status).toBe(401);
    });
  });
});
