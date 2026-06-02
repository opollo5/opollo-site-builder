import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Unit tests for lib/platform/workflow/approval-callbacks.ts
//
// DB calls, QStash, email are all mocked. Tests cover:
//   - enqueueApprovalCallbacks: publishes 4 QStash messages (3 reminders + 1 escalation)
//   - handleReminderCallback no-ops when request is approved
//   - handleReminderCallback atomic claim prevents double-send
//   - handleEscalateCallback fires admin alert and sets admin_alerted_at
// ---------------------------------------------------------------------------

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ─── QStash ───────────────────────────────────────────────────────────────
const { mockPublishJSON } = vi.hoisted(() => ({
  mockPublishJSON: vi.fn().mockResolvedValue({ messageId: "msg-123" }),
}));

vi.mock("@/lib/qstash", () => ({
  getQstashClient: vi.fn(() => ({ publishJSON: mockPublishJSON })),
  verifyQstashSignature: vi.fn().mockResolvedValue({ ok: true }),
}));

// ─── Supabase ─────────────────────────────────────────────────────────────
const { mockFrom } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn(() => ({ from: mockFrom })),
}));

// ─── Email ────────────────────────────────────────────────────────────────
const { mockSendEmail } = vi.hoisted(() => ({
  mockSendEmail: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("@/lib/email/sendgrid", () => ({
  sendEmail: (...args: unknown[]) => mockSendEmail(...args),
}));

vi.mock("@/lib/email/templates/social-approval-reminder", () => ({
  renderSocialApprovalReminderEmail: vi.fn().mockReturnValue({
    subject: "Reminder",
    html: "<p>reminder</p>",
    text: "reminder",
  }),
}));

// ─────────────────────────────────────────────────────────────────────────────
// RFC 4122 v4 UUIDs
// ─────────────────────────────────────────────────────────────────────────────
const APPROVAL_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMPANY_UUID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeOpenRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: APPROVAL_UUID,
    company_id: COMPANY_UUID,
    revoked_at: null,
    final_approved_at: null,
    final_rejected_at: null,
    reminder_day0_sent_at: null,
    reminder_day3_sent_at: null,
    reminder_day7_sent_at: null,
    reminder_day14_sent_at: null,
    admin_alerted_at: null,
    expires_at: new Date(Date.now() + 14 * 86_400_000).toISOString(),
    ...overrides,
  };
}

/**
 * Build a chainable Supabase mock for a single-row SELECT then UPDATE flow.
 * - selectResult: { data, error } returned from .maybeSingle() on the SELECT
 * - claimResult:  { data, error } returned from .maybeSingle() on the claim UPDATE
 */
function buildSelectThenClaimChain(opts: {
  selectResult: { data: unknown; error: null | { message: string } };
  claimResult?: { data: unknown; error: null | { message: string } };
  recipientsResult?: { data: unknown; error: null | { message: string } };
  companyResult?: { data: unknown; error: null | { message: string } };
}) {
  let callIndex = 0;

  return (table: string) => {
    callIndex++;

    // First call: the main approval_request lookup
    if (callIndex === 1) {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue(opts.selectResult),
      };
    }

    // Second call: the atomic claim UPDATE
    if (callIndex === 2) {
      const claimRes = opts.claimResult ?? { data: { id: APPROVAL_UUID }, error: null };
      return {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue(claimRes),
      };
    }

    // Third call: recipients lookup (reminder only)
    if (callIndex === 3 && table === "social_approval_recipients") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn(),
        then: vi.fn(),
        // PostgREST returns array result without .maybeSingle()
        // mock as awaitable
        ...buildArrayResult(opts.recipientsResult ?? { data: [], error: null }),
      };
    }

    // Fourth call: company lookup
    if (callIndex === 4 || table === "platform_companies") {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue(
          opts.companyResult ?? {
            data: { id: COMPANY_UUID, name: "ACME Corp", timezone: "Australia/Melbourne" },
            error: null,
          },
        ),
      };
    }

    // Fallback
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
  };
}

/** For queries that return arrays (not maybeSingle). */
function buildArrayResult(result: { data: unknown; error: null | { message: string } }) {
  // The Supabase client returns { data, error } when the chain resolves.
  // We use a custom thenable mock.
  const chain: Record<string, unknown> = {};
  const thenableResult = {
    then: (resolve: (v: { data: unknown; error: unknown }) => unknown) =>
      Promise.resolve(result).then(resolve),
    catch: (fn: (e: unknown) => unknown) => Promise.resolve(result).catch(fn),
    finally: (fn: () => unknown) => Promise.resolve(result).finally(fn),
  };
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.not = vi.fn().mockReturnValue(thenableResult);
  return chain;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("enqueueApprovalCallbacks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("publishes 4 QStash messages: 3 reminders + 1 escalation", async () => {
    const { enqueueApprovalCallbacks } = await import(
      "@/lib/platform/workflow/approval-callbacks"
    );

    await enqueueApprovalCallbacks({
      approvalRequestId: APPROVAL_UUID,
      timeoutDays: 14,
      origin: "https://example.com",
    });

    expect(mockPublishJSON).toHaveBeenCalledTimes(4);

    // Verify the 3 reminder calls
    const reminderCalls = mockPublishJSON.mock.calls.filter(
      (c) => (c[0] as { url: string }).url.includes("/reminder"),
    );
    expect(reminderCalls).toHaveLength(3);

    const days = reminderCalls
      .map((c) => ((c[0] as { body: { day: number } }).body as { day: number }).day)
      .sort((a, b) => a - b);
    expect(days).toEqual([3, 7, 14]);

    // Verify the escalation call
    const escalateCalls = mockPublishJSON.mock.calls.filter(
      (c) => (c[0] as { url: string }).url.includes("/escalate"),
    );
    expect(escalateCalls).toHaveLength(1);
  });

  it("logs and does not throw when QStash client is null", async () => {
    const { getQstashClient } = await import("@/lib/qstash");
    vi.mocked(getQstashClient).mockReturnValueOnce(null);

    vi.resetModules();
    const { enqueueApprovalCallbacks } = await import(
      "@/lib/platform/workflow/approval-callbacks"
    );

    await expect(
      enqueueApprovalCallbacks({
        approvalRequestId: APPROVAL_UUID,
        timeoutDays: 14,
        origin: "https://example.com",
      }),
    ).resolves.toBeUndefined();
  });

  it("uses deduplication IDs scoped to approvalRequestId", async () => {
    vi.resetModules();
    const { enqueueApprovalCallbacks } = await import(
      "@/lib/platform/workflow/approval-callbacks"
    );

    await enqueueApprovalCallbacks({
      approvalRequestId: APPROVAL_UUID,
      timeoutDays: 14,
      origin: "https://example.com",
    });

    const deduplicationIds = mockPublishJSON.mock.calls.map(
      (c) => (c[0] as { deduplicationId: string }).deduplicationId,
    );

    expect(deduplicationIds).toContain(`approval-reminder-day3-${APPROVAL_UUID}`);
    expect(deduplicationIds).toContain(`approval-reminder-day7-${APPROVAL_UUID}`);
    expect(deduplicationIds).toContain(`approval-reminder-day14-${APPROVAL_UUID}`);
    expect(deduplicationIds).toContain(`approval-escalate-${APPROVAL_UUID}`);
  });
});

describe("handleReminderCallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns noop_not_open when request is approved", async () => {
    mockFrom.mockImplementation(
      buildSelectThenClaimChain({
        selectResult: {
          data: makeOpenRequest({ final_approved_at: new Date().toISOString() }),
          error: null,
        },
      }),
    );

    vi.resetModules();
    const { handleReminderCallback } = await import(
      "@/lib/platform/workflow/approval-callbacks"
    );

    const result = await handleReminderCallback({
      approvalRequestId: APPROVAL_UUID,
      day: 3,
    });

    expect(result.outcome).toBe("noop_not_open");
    // No claim UPDATE should be attempted
    expect(mockPublishJSON).not.toHaveBeenCalled();
  });

  it("returns noop_not_open when request is rejected", async () => {
    mockFrom.mockImplementation(
      buildSelectThenClaimChain({
        selectResult: {
          data: makeOpenRequest({ final_rejected_at: new Date().toISOString() }),
          error: null,
        },
      }),
    );

    vi.resetModules();
    const { handleReminderCallback } = await import(
      "@/lib/platform/workflow/approval-callbacks"
    );

    const result = await handleReminderCallback({
      approvalRequestId: APPROVAL_UUID,
      day: 7,
    });

    expect(result.outcome).toBe("noop_not_open");
  });

  it("returns noop_already_handled when reminder_day3_sent_at is already set", async () => {
    mockFrom.mockImplementation(
      buildSelectThenClaimChain({
        selectResult: {
          data: makeOpenRequest({ reminder_day3_sent_at: new Date().toISOString() }),
          error: null,
        },
      }),
    );

    vi.resetModules();
    const { handleReminderCallback } = await import(
      "@/lib/platform/workflow/approval-callbacks"
    );

    const result = await handleReminderCallback({
      approvalRequestId: APPROVAL_UUID,
      day: 3,
    });

    expect(result.outcome).toBe("noop_already_handled");
  });

  it("returns noop_already_handled when atomic claim wins nothing (concurrent fire)", async () => {
    // SELECT returns open request, but UPDATE returns no row (another process claimed it)
    let callIndex = 0;
    mockFrom.mockImplementation(() => {
      callIndex++;
      if (callIndex === 1) {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: makeOpenRequest(),
            error: null,
          }),
        };
      }
      // The claim UPDATE returns no row
      return {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
    });

    vi.resetModules();
    const { handleReminderCallback } = await import(
      "@/lib/platform/workflow/approval-callbacks"
    );

    const result = await handleReminderCallback({
      approvalRequestId: APPROVAL_UUID,
      day: 7,
    });

    expect(result.outcome).toBe("noop_already_handled");
    // Email should NOT have been sent
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("returns dispatched and sends email when internal recipient exists", async () => {
    let callIndex = 0;
    mockFrom.mockImplementation((table: string) => {
      callIndex++;

      if (callIndex === 1) {
        // Approval request lookup
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: makeOpenRequest(),
            error: null,
          }),
        };
      }

      if (callIndex === 2) {
        // Atomic claim — succeeds
        return {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: APPROVAL_UUID }, error: null }),
        };
      }

      if (table === "social_approval_recipients") {
        // Returns one internal recipient
        const recipientChain: Record<string, unknown> = {};
        const awaitableResult = Promise.resolve({
          data: [
            {
              id: "rrrrrrrr-rrrr-4rrr-8rrr-rrrrrrrrrrrr",
              approval_request_id: APPROVAL_UUID,
              email: "approver@example.com",
              platform_user_id: "uuuuuuuu-uuuu-4uuu-8uuu-uuuuuuuuuuuu",
              revoked_at: null,
            },
          ],
          error: null,
        });
        recipientChain.select = vi.fn().mockReturnValue(recipientChain);
        recipientChain.eq = vi.fn().mockReturnValue(recipientChain);
        recipientChain.is = vi.fn().mockReturnValue(recipientChain);
        recipientChain.not = vi.fn().mockReturnValue(awaitableResult);
        return recipientChain;
      }

      if (table === "platform_companies") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: COMPANY_UUID, name: "ACME Corp", timezone: "Australia/Melbourne" },
            error: null,
          }),
        };
      }

      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
    });

    vi.resetModules();
    const { handleReminderCallback } = await import(
      "@/lib/platform/workflow/approval-callbacks"
    );

    const result = await handleReminderCallback({
      approvalRequestId: APPROVAL_UUID,
      day: 14,
    });

    expect(result.outcome).toBe("dispatched");
    expect(mockSendEmail).toHaveBeenCalledOnce();
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "approver@example.com" }),
    );
  });

  it("returns noop_not_found when approval request does not exist", async () => {
    mockFrom.mockImplementation(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }));

    vi.resetModules();
    const { handleReminderCallback } = await import(
      "@/lib/platform/workflow/approval-callbacks"
    );

    const result = await handleReminderCallback({
      approvalRequestId: APPROVAL_UUID,
      day: 3,
    });

    expect(result.outcome).toBe("noop_not_found");
  });

  it("returns internal_error when DB lookup fails", async () => {
    mockFrom.mockImplementation(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: "DB error" } }),
    }));

    vi.resetModules();
    const { handleReminderCallback } = await import(
      "@/lib/platform/workflow/approval-callbacks"
    );

    const result = await handleReminderCallback({
      approvalRequestId: APPROVAL_UUID,
      day: 7,
    });

    expect(result.outcome).toBe("internal_error");
  });
});

describe("handleEscalateCallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns noop_not_open when request is already approved", async () => {
    mockFrom.mockImplementation(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: makeOpenRequest({ final_approved_at: new Date().toISOString() }),
        error: null,
      }),
    }));

    vi.resetModules();
    const { handleEscalateCallback } = await import(
      "@/lib/platform/workflow/approval-callbacks"
    );

    const result = await handleEscalateCallback({ approvalRequestId: APPROVAL_UUID });

    expect(result.outcome).toBe("noop_not_open");
  });

  it("returns noop_already_handled when admin_alerted_at is set", async () => {
    mockFrom.mockImplementation(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: makeOpenRequest({ admin_alerted_at: new Date().toISOString() }),
        error: null,
      }),
    }));

    vi.resetModules();
    const { handleEscalateCallback } = await import(
      "@/lib/platform/workflow/approval-callbacks"
    );

    const result = await handleEscalateCallback({ approvalRequestId: APPROVAL_UUID });

    expect(result.outcome).toBe("noop_already_handled");
  });

  it("sets admin_alerted_at atomically and returns dispatched", async () => {
    let callIndex = 0;
    mockFrom.mockImplementation(() => {
      callIndex++;
      if (callIndex === 1) {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: makeOpenRequest(),
            error: null,
          }),
        };
      }
      // The atomic claim UPDATE
      return {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: APPROVAL_UUID }, error: null }),
      };
    });

    vi.resetModules();
    const { handleEscalateCallback } = await import(
      "@/lib/platform/workflow/approval-callbacks"
    );

    const result = await handleEscalateCallback({ approvalRequestId: APPROVAL_UUID });

    expect(result.outcome).toBe("dispatched");
    // The update mock was called (second mockFrom call)
    expect(callIndex).toBe(2);
  });

  it("returns noop_already_handled when concurrent escalation wins the claim", async () => {
    let callIndex = 0;
    mockFrom.mockImplementation(() => {
      callIndex++;
      if (callIndex === 1) {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: makeOpenRequest(),
            error: null,
          }),
        };
      }
      // Claim returns no row — another fire won
      return {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
    });

    vi.resetModules();
    const { handleEscalateCallback } = await import(
      "@/lib/platform/workflow/approval-callbacks"
    );

    const result = await handleEscalateCallback({ approvalRequestId: APPROVAL_UUID });

    expect(result.outcome).toBe("noop_already_handled");
  });

  it("returns noop_not_found when request does not exist", async () => {
    mockFrom.mockImplementation(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }));

    vi.resetModules();
    const { handleEscalateCallback } = await import(
      "@/lib/platform/workflow/approval-callbacks"
    );

    const result = await handleEscalateCallback({ approvalRequestId: APPROVAL_UUID });

    expect(result.outcome).toBe("noop_not_found");
  });
});
