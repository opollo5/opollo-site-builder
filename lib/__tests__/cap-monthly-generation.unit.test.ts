import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Supabase service-role mock
// ─────────────────────────────────────────────────────────────────────────────
const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn(() => ({ from: mockFrom })),
}));

// ─────────────────────────────────────────────────────────────────────────────
// recordHealthEvent mock
// ─────────────────────────────────────────────────────────────────────────────
const { mockRecordHealthEvent } = vi.hoisted(() => ({ mockRecordHealthEvent: vi.fn() }));
vi.mock("@/lib/platform/service-health/record", () => ({
  recordHealthEvent: mockRecordHealthEvent,
}));

// ─────────────────────────────────────────────────────────────────────────────
// runCampaign mock
// ─────────────────────────────────────────────────────────────────────────────
const { mockRunCampaign } = vi.hoisted(() => ({ mockRunCampaign: vi.fn() }));
vi.mock("@/lib/cap/generation/campaign-runner", () => ({
  runCampaign: mockRunCampaign,
}));

import { runMonthlyCapGeneration } from "@/lib/cap/monthly-generation";

const SUB_WITH_TEMPLATE = {
  id: "sub-1",
  company_id: "company-1",
  monthly_objective_template: "Drive LinkedIn engagement for our MSP team.",
  cap_voice_profiles: [{ id: "vp-1", is_default: true }],
};

const SUB_WITHOUT_TEMPLATE = {
  id: "sub-2",
  company_id: "company-2",
  monthly_objective_template: null,
  cap_voice_profiles: [{ id: "vp-2", is_default: true }],
};

const SUB_NO_PROFILES = {
  id: "sub-3",
  company_id: "company-3",
  monthly_objective_template: "Some objective",
  cap_voice_profiles: [],
};

function buildSubscriptionQuery(subscriptions: unknown[]) {
  return {
    select: vi.fn().mockReturnValue({
      in: vi.fn().mockResolvedValue({ data: subscriptions, error: null }),
    }),
  };
}

function buildUpsertChain(campaignId: string) {
  return {
    upsert: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({
          data: { id: campaignId, status: "draft" },
          error: null,
        }),
      }),
    }),
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: campaignId, status: "draft" },
            error: null,
          }),
        }),
      }),
    }),
  };
}

describe("runMonthlyCapGeneration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecordHealthEvent.mockResolvedValue(undefined);
    mockRunCampaign.mockResolvedValue({ status: "review", postsGenerated: 4 });
  });

  it("skips subscription with null template and records health event", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "cap_subscriptions") return buildSubscriptionQuery([SUB_WITHOUT_TEMPLATE]);
      return {};
    });

    const result = await runMonthlyCapGeneration();

    expect(result.skippedMissingTemplate).toBe(1);
    expect(result.campaignsGenerated).toBe(0);
    expect(mockRecordHealthEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceName: "cap-cron",
        eventType: "missing_objective_template",
        severity: "warning",
        details: expect.objectContaining({
          cap_subscription_id: "sub-2",
          company_id: "company-2",
        }),
      }),
    );
  });

  it("uses monthly_objective_template as campaign objective when set", async () => {
    let campaignUpsertPayload: unknown;

    mockFrom.mockImplementation((table: string) => {
      if (table === "cap_subscriptions") return buildSubscriptionQuery([SUB_WITH_TEMPLATE]);
      if (table === "cap_campaigns") {
        return {
          upsert: vi.fn().mockImplementation((payload: unknown) => {
            campaignUpsertPayload = payload;
            return {
              select: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: "camp-1", status: "draft" },
                  error: null,
                }),
              }),
            };
          }),
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: "camp-1", status: "draft" },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      return {};
    });

    await runMonthlyCapGeneration();

    expect(campaignUpsertPayload).toMatchObject({
      monthly_objective: "Drive LinkedIn engagement for our MSP team.",
    });
    expect(mockRunCampaign).toHaveBeenCalledWith("camp-1");
  });

  it("excludes subscriptions with no voice profiles", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "cap_subscriptions") return buildSubscriptionQuery([SUB_NO_PROFILES]);
      return {};
    });

    const result = await runMonthlyCapGeneration();

    expect(result.subscriptionsProcessed).toBe(0);
    expect(mockRunCampaign).not.toHaveBeenCalled();
  });

  it("processes multiple subscriptions: skips null, generates for valid", async () => {
    let campaignCallCount = 0;

    mockFrom.mockImplementation((table: string) => {
      if (table === "cap_subscriptions") {
        return buildSubscriptionQuery([SUB_WITH_TEMPLATE, SUB_WITHOUT_TEMPLATE]);
      }
      if (table === "cap_campaigns") {
        campaignCallCount++;
        return {
          upsert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: `camp-${campaignCallCount}`, status: "draft" },
                error: null,
              }),
            }),
          }),
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: `camp-${campaignCallCount}`, status: "draft" },
                  error: null,
                }),
              }),
            }),
          }),
        };
      }
      return {};
    });

    const result = await runMonthlyCapGeneration();

    expect(result.subscriptionsProcessed).toBe(2);
    expect(result.skippedMissingTemplate).toBe(1);
    expect(result.campaignsGenerated).toBe(1);
  });

  it("counts failed when campaign upsert errors", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "cap_subscriptions") return buildSubscriptionQuery([SUB_WITH_TEMPLATE]);
      if (table === "cap_campaigns") {
        return {
          upsert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: null,
                error: { message: "unique constraint violated" },
              }),
            }),
          }),
        };
      }
      return {};
    });

    const result = await runMonthlyCapGeneration();

    expect(result.failed).toBe(1);
    expect(mockRunCampaign).not.toHaveBeenCalled();
  });
});
