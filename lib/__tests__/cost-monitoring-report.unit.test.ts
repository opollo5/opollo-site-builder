import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { mockSendEmail } = vi.hoisted(() => ({ mockSendEmail: vi.fn() }));
vi.mock("@/lib/email/sendgrid", () => ({ sendEmail: mockSendEmail }));

const { mockGetAdminEmails } = vi.hoisted(() => ({ mockGetAdminEmails: vi.fn() }));
vi.mock("@/lib/platform/service-health/recipients", () => ({
  getPlatformAdminEmails: mockGetAdminEmails,
}));

const { mockBuildCostReport } = vi.hoisted(() => ({ mockBuildCostReport: vi.fn() }));
vi.mock("@/lib/platform/cost-monitoring/queries", () => ({
  buildCostReport: mockBuildCostReport,
}));

import { sendDailyCostReport } from "@/lib/platform/cost-monitoring/report";

const EMPTY_REPORT = {
  generatedAt: new Date().toISOString(),
  periodHours: 24,
  cap: { rows: [], totalPeriodCostUsd: 0, subscriptionCount: 0, highUtilisationCount: 0 },
  tenant: { rows: [], siteCount: 0, dailyBreachedCount: 0, monthlyBreachedCount: 0 },
};

describe("sendDailyCostReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBuildCostReport.mockResolvedValue(EMPTY_REPORT);
    mockSendEmail.mockResolvedValue(undefined);
  });

  it("returns sent=0 when no recipients", async () => {
    mockGetAdminEmails.mockResolvedValue([]);
    const result = await sendDailyCostReport();
    expect(result.sent).toBe(0);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("sends one email per recipient", async () => {
    mockGetAdminEmails.mockResolvedValue(["a@example.com", "b@example.com"]);
    const result = await sendDailyCostReport();
    expect(result.sent).toBe(2);
    expect(mockSendEmail).toHaveBeenCalledTimes(2);
  });

  it("uses all-clear subject when no flags", async () => {
    mockGetAdminEmails.mockResolvedValue(["a@example.com"]);
    await sendDailyCostReport();
    const call = mockSendEmail.mock.calls[0][0] as { subject: string };
    expect(call.subject).toContain("[COST]");
    expect(call.subject).toContain("all clear");
  });

  it("includes high-utilisation flag in subject when above 80%", async () => {
    mockBuildCostReport.mockResolvedValue({
      ...EMPTY_REPORT,
      cap: { rows: [], totalPeriodCostUsd: 85, subscriptionCount: 1, highUtilisationCount: 1 },
    });
    mockGetAdminEmails.mockResolvedValue(["a@example.com"]);
    await sendDailyCostReport();
    const call = mockSendEmail.mock.calls[0][0] as { subject: string };
    expect(call.subject).toContain("high-utilisation");
  });

  it("includes daily breach flag in subject", async () => {
    mockBuildCostReport.mockResolvedValue({
      ...EMPTY_REPORT,
      tenant: { rows: [], siteCount: 3, dailyBreachedCount: 2, monthlyBreachedCount: 0 },
    });
    mockGetAdminEmails.mockResolvedValue(["a@example.com"]);
    await sendDailyCostReport();
    const call = mockSendEmail.mock.calls[0][0] as { subject: string };
    expect(call.subject).toContain("daily breach");
  });

  it("continues sending to remaining recipients when one fails", async () => {
    mockGetAdminEmails.mockResolvedValue(["a@example.com", "b@example.com"]);
    mockSendEmail.mockRejectedValueOnce(new Error("SendGrid 5xx")).mockResolvedValueOnce(undefined);
    const result = await sendDailyCostReport();
    expect(result.sent).toBe(1);
  });

  it("email body contains CAP and tenant sections", async () => {
    mockBuildCostReport.mockResolvedValue({
      ...EMPTY_REPORT,
      cap: {
        rows: [
          { company_id: "co-1", company_name: "Acme Ltd", subscription_id: "sub-1", tier: "starter", monthly_cap_usd: 200, period_cost_usd: 0.15, run_count: 3, cap_utilisation_pct: 0.075 },
        ],
        totalPeriodCostUsd: 0.15,
        subscriptionCount: 1,
        highUtilisationCount: 0,
      },
    });
    mockGetAdminEmails.mockResolvedValue(["a@example.com"]);
    await sendDailyCostReport();
    const call = mockSendEmail.mock.calls[0][0] as { html: string; text: string };
    expect(call.html).toContain("Acme Ltd");
    expect(call.text).toContain("Acme Ltd");
    expect(call.html).toContain("starter");
    expect(call.text).toContain("$0.1500");
  });
});
