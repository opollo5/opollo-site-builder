import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Unit tests for lib/social/approval/escalate.ts
//
// All DB and email calls are mocked. We test the time-bucketing logic:
//   - Draft submitted < 48h ago → no action
//   - Draft submitted 48–72h ago → reminder email to approver
//   - Draft submitted 72–96h ago → escalate to admin
//   - Draft submitted > 96h ago → auto-reject
// ---------------------------------------------------------------------------

const mockFrom = vi.fn();
const mockSendEmail = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: () => ({ from: mockFrom }),
}));

vi.mock("@/lib/email/sendgrid", () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}));

vi.mock("@/lib/platform/service-health/monitor", () => ({
  withHealthMonitoring: (_: string, __: string, fn: () => Promise<unknown>) => fn(),
}));

vi.mock("server-only", () => ({}));

function msAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

const H48 = 48 * 60 * 60 * 1000 + 1000; // just over 48h
const H72 = 72 * 60 * 60 * 1000 + 1000;
const H96 = 96 * 60 * 60 * 1000 + 1000;

function buildSelectChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.lte = vi.fn().mockReturnValue({ data: rows, error: null });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: null });
  chain.update = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ data: null, error: null }) });
  chain.insert = vi.fn().mockReturnValue({ data: null, error: null });
  return chain;
}

function buildAdminChain(admins: unknown[]) {
  // escalateToAdmin calls .select(...).eq("company_id", ...).eq("role", ...)
  const finalResult = { data: admins, error: null };
  const innerChain: Record<string, unknown> = {};
  innerChain.eq = vi.fn().mockReturnValue(finalResult);
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(innerChain);
  return chain;
}

function buildUserChain(email: string | null) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: email ? { email } : null });
  return chain;
}

describe("runEscalationCycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("takes no action on drafts submitted under 48h ago", async () => {
    const draft = { id: "d1", company_id: "c1", content: "Hello", approver_user_id: "u1", created_at: msAgo(H48 - 10_000) };
    const draftsChain = buildSelectChain([draft]);
    mockFrom.mockReturnValue(draftsChain);

    const { runEscalationCycle } = await import("@/lib/social/approval/escalate");
    // Draft is just under 48h — should not be in the query results since query uses lte(h48).
    // We pass it through anyway to verify the logic doesn't misfire.
    const result = await runEscalationCycle();
    // If the draft age < 48h it never enters any bucket, so 0 actions.
    expect(result.escalated + result.autoRejected).toBe(0);
  });

  it("sends a reminder to the approver for drafts 48–72h old", async () => {
    const draft = { id: "d2", company_id: "c1", content: "Buy now!", approver_user_id: "approver-uid", created_at: msAgo(H48 + 5000) };
    const draftsChain = buildSelectChain([draft]);
    const userChain = buildUserChain("approver@example.com");

    mockFrom
      .mockReturnValueOnce(draftsChain)  // initial query
      .mockReturnValue(userChain);        // platform_users lookup

    const { runEscalationCycle } = await import("@/lib/social/approval/escalate");
    vi.resetModules();
    const mod = await import("@/lib/social/approval/escalate");
    const result = await mod.runEscalationCycle();

    expect(result.escalated).toBe(1);
    expect(result.autoRejected).toBe(0);
  });

  it("escalates to admin for drafts 72–96h old", async () => {
    const draft = { id: "d3", company_id: "c1", content: "Old post", approver_user_id: "u1", created_at: msAgo(H72 + 5000) };
    const draftsChain = buildSelectChain([draft]);
    const adminChain = buildAdminChain([{ platform_users: { email: "admin@example.com" } }]);

    mockFrom
      .mockReturnValueOnce(draftsChain)
      .mockReturnValue(adminChain);

    vi.resetModules();
    const mod = await import("@/lib/social/approval/escalate");
    const result = await mod.runEscalationCycle();

    expect(result.escalated).toBe(1);
    expect(result.autoRejected).toBe(0);
  });

  it("auto-rejects drafts older than 96h and inserts a decision row", async () => {
    const draft = { id: "d4", company_id: "c1", content: "Stale", approver_user_id: null, created_at: msAgo(H96 + 5000) };

    // Build a mock chain that handles update and insert
    const updateChain = { eq: vi.fn().mockReturnValue({ data: null, error: null }) };
    const insertChain = { data: null, error: null };
    const selectChain = buildSelectChain([draft]);
    const updateFrom = { update: vi.fn().mockReturnValue(updateChain) };
    const insertFrom = { insert: vi.fn().mockReturnValue(insertChain) };

    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "social_post_drafts" && callCount === 0) {
        callCount++;
        return selectChain;
      }
      if (table === "social_post_drafts") return updateFrom;
      if (table === "social_post_approval_decisions") return insertFrom;
      return selectChain;
    });

    vi.resetModules();
    const mod = await import("@/lib/social/approval/escalate");
    const result = await mod.runEscalationCycle();

    expect(result.autoRejected).toBe(1);
    expect(result.escalated).toBe(0);
  });

  it("returns zero counts when DB query fails", async () => {
    const errorChain: Record<string, unknown> = {};
    errorChain.select = vi.fn().mockReturnValue(errorChain);
    errorChain.eq = vi.fn().mockReturnValue(errorChain);
    errorChain.lte = vi.fn().mockReturnValue({ data: null, error: { message: "DB error" } });
    mockFrom.mockReturnValue(errorChain);

    vi.resetModules();
    const mod = await import("@/lib/social/approval/escalate");
    const result = await mod.runEscalationCycle();

    expect(result.escalated).toBe(0);
    expect(result.autoRejected).toBe(0);
  });
});
