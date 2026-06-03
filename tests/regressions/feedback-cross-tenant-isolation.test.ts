// tests/regressions/feedback-cross-tenant-isolation.test.ts
//
// Cross-company isolation regression for the feedback API (#1287).
//
// Multi-tenant safety: a member of Company A MUST NOT:
//   - Read a ticket owned by Company B (GET /api/feedback/tickets/[id])
//   - Reopen a ticket owned by Company B (POST /api/feedback/tickets/[id]/reopen)
//   - Receive Company B tickets from the list endpoint (GET /api/feedback/tickets)
//
// The tests are structured for the red-green cycle:
//   RED:   run with the membership check removed from the GET route handler
//          → expects 404, gets 200 → FAIL (proves the test catches the gap)
//   GREEN: run with the correct handler (membership check present)
//          → all three assertions pass
//
// Layer 1 — unit tests; all I/O is mocked. No DB or network required.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const COMPANY_A = "aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa";
const COMPANY_B = "bbbbbbbb-0000-0000-0000-bbbbbbbbbbbb";
const USER_A    = "00000000-user-0000-0000-aaaaaaaaaaaa";
const TICKET_B  = "ffffffff-tick-0000-0000-bbbbbbbbbbbb";

// A Company B ticket — the resource Company A member must not access.
const TICKET_COMPANY_B = {
  id: TICKET_B,
  company_id: COMPANY_B,
  title: "Company B private bug",
  description: "Should not be visible to Company A.",
  severity: "normal",
  priority: "medium",
  status: "fixed",       // eligible for "still broken" reopen
  assignee_id: null,
  triaged_by: null,
  triaged_at: null,
  verified_by: null,
  verified_at: null,
  tags: [],
  page_url: "https://companyb.example.com",
  route_pattern: null,
  css_selector: "body",
  element_label: null,
  click_x_pct: 50,
  click_y_pct: 50,
  viewport_w: 1280,
  viewport_h: 900,
  device_pixel_ratio: 1,
  user_agent: null,
  console_errors: null,
  screenshot_path: null,
  annotation: null,
  repo_ref: null,
  linked_pr_url: null,
  created_by: "company-b-user",
  updated_by: null,
  created_at: "2026-06-03T00:00:00Z",
  updated_at: "2026-06-03T00:00:00Z",
  deleted_at: null,
};

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// supabase service-role client — used by getTicket() internally.
vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn(),
}));

// lib/platform/auth module — handles isOpolloStaff + isCompanyMember
// for routes that call them through the TypeScript helpers.
vi.mock("@/lib/platform/auth", () => ({
  isOpolloStaff:    vi.fn(async () => false),
  isCompanyMember:  vi.fn(async (companyId: string) => companyId === COMPANY_A),
  getCurrentPlatformSession: vi.fn(async () => null),
  canDo: vi.fn(async () => false),
}));

// Query helpers — getTicket returns the Company B ticket; list returns empty.
vi.mock("@/lib/feedback/tickets/queries", () => ({
  getTicket:    vi.fn(async () => TICKET_COMPANY_B),
  listTickets:  vi.fn(async () => []),
  listComments: vi.fn(async () => []),
  listEvents:   vi.fn(async () => []),
}));

// Mute notification side-effects.
vi.mock("@/lib/feedback/tickets/notify", () => ({
  notifyReopenedByCustomer: vi.fn(async () => {}),
  notifyTicketCreated:      vi.fn(async () => {}),
  notifyCommentAdded:       vi.fn(async () => {}),
  notifyStatusChanged:      vi.fn(async () => {}),
}));

// update-status and addComment — not reached when membership blocks.
vi.mock("@/lib/feedback/tickets/update-status", () => ({
  updateTicketStatus: vi.fn(async () => ({ ok: true, status: "in_progress" })),
}));
vi.mock("@/lib/feedback/tickets/comments", () => ({
  addComment: vi.fn(async () => ({ ok: true, comment: {} })),
}));

// ---------------------------------------------------------------------------
// auth client factory — User A is authenticated but only in Company A.
//
// The raw supabase.rpc("is_company_member") call is used directly in the
// GET and reopen route handlers (they bypass the lib/platform/auth helper).
// The mock correctly returns false when the company is COMPANY_B.
// ---------------------------------------------------------------------------
function makeUserAClient() {
  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: USER_A, email: "user-a@company-a.test" } },
        error: null,
      })),
    },
    // Direct rpc calls made by the route handlers.
    rpc: vi.fn(async (fnName: string, args?: Record<string, unknown>) => {
      if (fnName === "is_opollo_staff")   return { data: false, error: null };
      if (fnName === "is_company_member") {
        // User A is a member of COMPANY_A only.
        return { data: args?.company === COMPANY_A, error: null };
      }
      return { data: null, error: null };
    }),
  };
}

// ---------------------------------------------------------------------------
// createRouteAuthClient is called inside each route handler. We mock it to
// return our controlled User A client every time.
// ---------------------------------------------------------------------------
vi.mock("@/lib/auth", () => ({
  createRouteAuthClient: vi.fn(),
}));

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
function makeGetRequest(url = `http://localhost/api/feedback/tickets/${TICKET_B}`) {
  return new Request(url, { method: "GET" });
}
function makePostRequest(url: string, body: object = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("cross-company isolation — GET /api/feedback/tickets/[id]", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { createRouteAuthClient } = await import("@/lib/auth");
    vi.mocked(createRouteAuthClient).mockReturnValue(makeUserAClient() as never);
  });
  afterEach(() => vi.clearAllMocks());

  it("returns 404 when a Company A member requests a Company B ticket", async () => {
    const { GET } = await import(
      "@/app/api/feedback/tickets/[id]/route"
    );
    const req = makeGetRequest() as never;
    const res = await GET(req, {
      params: Promise.resolve({ id: TICKET_B }) as never,
    });

    // The membership check in the route must fire and produce 404.
    // If the check is absent (broken policy), this will get 200 → test FAILS (red).
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it("does NOT expose the ticket body to a cross-company caller", async () => {
    const { GET } = await import(
      "@/app/api/feedback/tickets/[id]/route"
    );
    const req = makeGetRequest() as never;
    const res = await GET(req, {
      params: Promise.resolve({ id: TICKET_B }) as never,
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    // The ticket data must not appear in the response.
    expect(body.data).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(COMPANY_B);
    expect(JSON.stringify(body)).not.toContain("Company B private bug");
  });
});

describe("cross-company isolation — POST /api/feedback/tickets/[id]/reopen", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { createRouteAuthClient } = await import("@/lib/auth");
    vi.mocked(createRouteAuthClient).mockReturnValue(makeUserAClient() as never);
  });
  afterEach(() => vi.clearAllMocks());

  it("returns 404 when a Company A member tries to reopen a Company B ticket", async () => {
    const { POST } = await import(
      "@/app/api/feedback/tickets/[id]/reopen/route"
    );
    const req = makePostRequest(
      `http://localhost/api/feedback/tickets/${TICKET_B}/reopen`,
      { comment: "Still broken" },
    ) as never;
    const res = await POST(req, {
      params: Promise.resolve({ id: TICKET_B }) as never,
    });

    // Must return 404, not 403 (403 would reveal the ticket exists).
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it("does NOT change the ticket's status on a cross-company reopen attempt", async () => {
    const { updateTicketStatus } = await import(
      "@/lib/feedback/tickets/update-status"
    );
    const { POST } = await import(
      "@/app/api/feedback/tickets/[id]/reopen/route"
    );
    const req = makePostRequest(
      `http://localhost/api/feedback/tickets/${TICKET_B}/reopen`,
    ) as never;
    await POST(req, {
      params: Promise.resolve({ id: TICKET_B }) as never,
    });

    // The state machine must never be reached for cross-company callers.
    expect(vi.mocked(updateTicketStatus)).not.toHaveBeenCalled();
  });
});

describe("cross-company isolation — GET /api/feedback/tickets (list)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { createRouteAuthClient } = await import("@/lib/auth");
    vi.mocked(createRouteAuthClient).mockReturnValue(makeUserAClient() as never);
  });
  afterEach(() => vi.clearAllMocks());

  it("returns 403 when a Company A member requests Company B tickets", async () => {
    const { GET } = await import(
      "@/app/api/feedback/tickets/route"
    );
    const req = makeGetRequest(
      `http://localhost/api/feedback/tickets?companyId=${COMPANY_B}`,
    ) as never;
    const res = await GET(req);

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it("does NOT call listTickets when company membership check fails", async () => {
    const { listTickets } = await import(
      "@/lib/feedback/tickets/queries"
    );
    const { GET } = await import(
      "@/app/api/feedback/tickets/route"
    );
    const req = makeGetRequest(
      `http://localhost/api/feedback/tickets?companyId=${COMPANY_B}`,
    ) as never;
    await GET(req);

    // listTickets must never be reached — the gate must fire first.
    expect(vi.mocked(listTickets)).not.toHaveBeenCalled();
  });

  it("does return Company A tickets when the companyId matches", async () => {
    // Reconfigure listTickets to return a Company A ticket for this test.
    const { listTickets } = await import(
      "@/lib/feedback/tickets/queries"
    );
    const TICKET_A = { ...TICKET_COMPANY_B, id: "ticket-a", company_id: COMPANY_A, title: "Company A bug" };
    vi.mocked(listTickets).mockResolvedValueOnce([TICKET_A] as never);

    const { GET } = await import(
      "@/app/api/feedback/tickets/route"
    );
    const req = makeGetRequest(
      `http://localhost/api/feedback/tickets?companyId=${COMPANY_A}`,
    ) as never;
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    // All returned tickets must belong to Company A — never Company B.
    const tickets = body.data.tickets as Array<{ company_id: string }>;
    expect(tickets.every((t) => t.company_id === COMPANY_A)).toBe(true);
    expect(tickets.some((t) => t.company_id === COMPANY_B)).toBe(false);
  });
});
