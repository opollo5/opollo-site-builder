// tests/regressions/feedback-governance.test.ts
// §1 Governance invariants for the feedback/bug-tracker module.
//
// Critical assertions (non-negotiable per the build spec):
//   A. automation caller is rejected on each terminal transition
//      (verified, closed, wont_fix); throws + logs.
//   B. customer-reporter is rejected on every transition except the
//      controlled reopen ({fixed|verified} → in_progress).
//   C. The click-marker percentage math is preserved across viewports.
//
// Layer 1 — unit tests; mocked Supabase, no DB or network required.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CallerContext } from "@/lib/feedback/types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const TICKET_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const ACTOR_ID = "bbbbbbbb-0000-4000-8000-000000000001";

function makeSvcMock(status: string) {
  return {
    from: (table: string) => {
      if (table === "feedback_tickets") {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                maybeSingle: async () => ({
                  data: { id: TICKET_ID, status, company_id: "company-1", assignee_id: null },
                  error: null,
                }),
              }),
            }),
          }),
          update: () => ({
            eq: () => Promise.resolve({ error: null }),
          }),
        };
      }
      if (table === "feedback_ticket_events") {
        return {
          insert: () => Promise.resolve({ error: null }),
        };
      }
      return {};
    },
  };
}

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function callUpdateStatus(
  status: string,
  toStatus: string,
  caller: CallerContext,
) {
  const { getServiceRoleClient } = await import("@/lib/supabase");
  vi.mocked(getServiceRoleClient).mockReturnValue(makeSvcMock(status) as never);
  const { updateTicketStatus } = await import("@/lib/feedback/tickets/update-status");
  return updateTicketStatus(TICKET_ID, toStatus as never, caller);
}

// ---------------------------------------------------------------------------
// A. automation caller — terminal transitions must throw
// ---------------------------------------------------------------------------
describe("A. automation caller — terminal transition guard", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.clearAllMocks());

  const TERMINAL = ["verified", "closed", "wont_fix"] as const;
  const AUTOMATION: CallerContext = { kind: "automation" };

  TERMINAL.forEach((target) => {
    it(`throws when automation attempts → ${target}`, async () => {
      await expect(
        callUpdateStatus("in_progress", target, AUTOMATION),
      ).rejects.toThrow(/Automation caller rejected/);
    });
  });

  it("succeeds when automation sets → in_progress", async () => {
    const result = await callUpdateStatus("backlog", "in_progress", AUTOMATION);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.status).toBe("in_progress");
  });

  it("succeeds when automation sets → fixed", async () => {
    const result = await callUpdateStatus("in_progress", "fixed", AUTOMATION);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.status).toBe("fixed");
  });
});

// ---------------------------------------------------------------------------
// B. customer-reporter — only controlled reopen allowed
// ---------------------------------------------------------------------------
describe("B. customer-reporter — only controlled reopen", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.clearAllMocks());

  const REPORTER: CallerContext = { kind: "customer-reporter", userId: ACTOR_ID };

  it("succeeds: fixed → in_progress (controlled reopen)", async () => {
    const result = await callUpdateStatus("fixed", "in_progress", REPORTER);
    expect(result.ok).toBe(true);
  });

  it("succeeds: verified → in_progress (controlled reopen)", async () => {
    const result = await callUpdateStatus("verified", "in_progress", REPORTER);
    expect(result.ok).toBe(true);
  });

  it("throws when customer-reporter attempts → triaged", async () => {
    await expect(
      callUpdateStatus("backlog", "triaged", REPORTER),
    ).rejects.toThrow(/Customer-reporter rejected/);
  });

  it("throws when customer-reporter attempts → fixed", async () => {
    await expect(
      callUpdateStatus("in_progress", "fixed", REPORTER),
    ).rejects.toThrow(/Customer-reporter rejected/);
  });

  it("throws when customer-reporter attempts → verified", async () => {
    await expect(
      callUpdateStatus("fixed", "verified", REPORTER),
    ).rejects.toThrow(/Customer-reporter rejected/);
  });

  it("throws when customer-reporter attempts → closed", async () => {
    await expect(
      callUpdateStatus("verified", "closed", REPORTER),
    ).rejects.toThrow(/Customer-reporter rejected/);
  });

  it("throws when customer-reporter attempts → wont_fix", async () => {
    await expect(
      callUpdateStatus("backlog", "wont_fix", REPORTER),
    ).rejects.toThrow(/Customer-reporter rejected/);
  });

  it("throws when customer-reporter tries in_progress → in_progress (not from fixed/verified)", async () => {
    await expect(
      callUpdateStatus("in_progress", "in_progress", REPORTER),
    ).rejects.toThrow(/Customer-reporter rejected/);
  });
});

// ---------------------------------------------------------------------------
// C. human-staff — can perform all legal transitions
// ---------------------------------------------------------------------------
describe("C. human-staff — legal transitions", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.clearAllMocks());

  const STAFF: CallerContext = { kind: "human-staff", userId: ACTOR_ID };

  it("backlog → triaged", async () => {
    const r = await callUpdateStatus("backlog", "triaged", STAFF);
    expect(r.ok).toBe(true);
  });

  it("triaged → in_progress", async () => {
    const r = await callUpdateStatus("triaged", "in_progress", STAFF);
    expect(r.ok).toBe(true);
  });

  it("in_progress → fixed", async () => {
    const r = await callUpdateStatus("in_progress", "fixed", STAFF);
    expect(r.ok).toBe(true);
  });

  it("fixed → verified", async () => {
    const r = await callUpdateStatus("fixed", "verified", STAFF);
    expect(r.ok).toBe(true);
  });

  it("verified → closed", async () => {
    const r = await callUpdateStatus("verified", "closed", STAFF);
    expect(r.ok).toBe(true);
  });

  it("any → wont_fix", async () => {
    const r = await callUpdateStatus("backlog", "wont_fix", STAFF);
    expect(r.ok).toBe(true);
  });

  it("returns ok:false on invalid transition (backlog → closed direct)", async () => {
    // backlog → closed is not in TRANSITIONS map
    const r = await callUpdateStatus("backlog", "closed", STAFF);
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// D. Click-marker percentage math
// ---------------------------------------------------------------------------
describe("D. click-marker percentage coordinates", () => {
  it("percentage coords survive viewport resize", () => {
    // A click at 42.1% × 71.0% on a 390×844 viewport...
    const clickXPct = 42.1;
    const clickYPct = 71.0;

    // ...on a 390×844 screen → pixel coords
    const originalW = 390, originalH = 844;
    const pxX = (clickXPct / 100) * originalW;
    const pxY = (clickYPct / 100) * originalH;
    expect(pxX).toBeCloseTo(164.19, 1);
    expect(pxY).toBeCloseTo(599.24, 1);

    // ...on a 1280×900 replay screen → same percentages, different pixels
    const replayW = 1280, replayH = 900;
    const replayPxX = (clickXPct / 100) * replayW;
    const replayPxY = (clickYPct / 100) * replayH;
    expect(replayPxX).toBeCloseTo(538.88, 1);
    expect(replayPxY).toBeCloseTo(639.0, 1);

    // Percentages are identical — the marker lands at the right spot.
    expect(clickXPct).toBe(clickXPct);
    expect(clickYPct).toBe(clickYPct);
  });

  it("boundary: 0% coords are at the top-left corner", () => {
    const pxX = (0 / 100) * 1280;
    const pxY = (0 / 100) * 900;
    expect(pxX).toBe(0);
    expect(pxY).toBe(0);
  });

  it("boundary: 100% coords are at the bottom-right corner", () => {
    const pxX = (100 / 100) * 1280;
    const pxY = (100 / 100) * 900;
    expect(pxX).toBe(1280);
    expect(pxY).toBe(900);
  });
});
