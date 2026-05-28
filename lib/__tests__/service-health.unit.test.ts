import { describe, expect, test, vi, beforeEach } from "vitest";

// Mock server-only before any module that uses it
vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/email/sendgrid", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/redis", () => ({ getRedisClient: vi.fn().mockReturnValue(null) }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// record.ts makes its own svc calls — stub it so tests don't need a real DB
vi.mock("@/lib/platform/service-health/record", () => ({
  recordHealthEvent: vi.fn().mockResolvedValue(undefined),
  recordRecovery: vi.fn().mockResolvedValue(undefined),
  hasUnresolvedHealthEvent: vi.fn().mockResolvedValue(false),
}));

import { classifyHttpError, classifyThrownError } from "@/lib/platform/service-health/classify";
import { NOTIFY_COOLDOWN_MS } from "@/lib/platform/service-health/notify";
import { __resetRecipientsCacheForTests } from "@/lib/platform/service-health/recipients";

// ---------------------------------------------------------------------------
// classify
// ---------------------------------------------------------------------------

describe("classifyHttpError", () => {
  test("401 → auth_failure critical", () => {
    expect(classifyHttpError(401, "any")).toEqual({ eventType: "auth_failure", severity: "critical" });
  });

  test("403 → auth_failure critical", () => {
    expect(classifyHttpError(403, "any")).toEqual({ eventType: "auth_failure", severity: "critical" });
  });

  test("402 → billing_failure critical", () => {
    expect(classifyHttpError(402, "any")).toEqual({ eventType: "billing_failure", severity: "critical" });
  });

  test("429 → rate_limit warning", () => {
    expect(classifyHttpError(429, "any")).toEqual({ eventType: "rate_limit", severity: "warning" });
  });

  test("500 → service_5xx warning for generic service", () => {
    expect(classifyHttpError(500, "some-service")).toEqual({ eventType: "service_5xx", severity: "warning" });
  });

  test("500 → service_5xx critical for sendgrid", () => {
    expect(classifyHttpError(500, "sendgrid")).toEqual({ eventType: "service_5xx", severity: "critical" });
  });

  test("503 → service_5xx critical for bundle-social", () => {
    expect(classifyHttpError(503, "bundle-social")).toEqual({ eventType: "service_5xx", severity: "critical" });
  });

  test("non-HTTP status → connection_failure critical", () => {
    expect(classifyHttpError(0, "any")).toEqual({ eventType: "connection_failure", severity: "critical" });
  });
});

describe("classifyThrownError", () => {
  test("any thrown error → connection_failure critical", () => {
    expect(classifyThrownError(new Error("ECONNREFUSED"))).toEqual({
      eventType: "connection_failure",
      severity: "critical",
    });
  });
});

// ---------------------------------------------------------------------------
// notify cooldown constant
// ---------------------------------------------------------------------------

describe("NOTIFY_COOLDOWN_MS", () => {
  test("is 30 minutes in ms", () => {
    expect(NOTIFY_COOLDOWN_MS).toBe(30 * 60 * 1000);
  });
});

// ---------------------------------------------------------------------------
// SendGrid self-monitoring exclusion
// ---------------------------------------------------------------------------

describe("notifyHealthAlert self-monitoring exclusion", () => {
  const mockEvent = (serviceName: string) => ({
    id: "evt-1",
    service_name: serviceName,
    event_type: "service_5xx" as const,
    severity: "critical" as const,
    operation: null,
    occurrence_count: 5,
    first_seen_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
    resolved_at: null,
    notified_at: null,
    details: {},
    raised_by_user_id: null,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    __resetRecipientsCacheForTests();
  });

  test("skips email when service_name === sendgrid", async () => {
    const { notifyHealthAlert } = await import("@/lib/platform/service-health/notify");
    const { sendEmail } = await import("@/lib/email/sendgrid");
    await notifyHealthAlert(mockEvent("sendgrid"));
    expect(sendEmail).not.toHaveBeenCalled();
  });

  test("sends email when service_name is not sendgrid (admin found)", async () => {
    const { getServiceRoleClient } = await import("@/lib/supabase");
    const { sendEmail } = await import("@/lib/email/sendgrid");

    vi.mocked(getServiceRoleClient).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            is: vi.fn().mockResolvedValue({ data: [{ email: "admin@opollo.com" }], error: null }),
          }),
        }),
      }),
    } as unknown as ReturnType<typeof getServiceRoleClient>);

    vi.mocked(sendEmail).mockResolvedValue(undefined as never);
    __resetRecipientsCacheForTests();

    const { notifyHealthAlert } = await import("@/lib/platform/service-health/notify");
    await notifyHealthAlert(mockEvent("bundle.social"));
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// recipients cache
// ---------------------------------------------------------------------------

describe("getPlatformAdminEmails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRecipientsCacheForTests();
  });

  test("returns empty array when DB query fails", async () => {
    const { getServiceRoleClient } = await import("@/lib/supabase");
    vi.mocked(getServiceRoleClient).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            is: vi.fn().mockResolvedValue({ data: null, error: { message: "DB error" } }),
          }),
        }),
      }),
    } as unknown as ReturnType<typeof getServiceRoleClient>);

    const { getPlatformAdminEmails } = await import("@/lib/platform/service-health/recipients");
    const result = await getPlatformAdminEmails();
    expect(result).toEqual([]);
  });

  test("returns staff emails on success", async () => {
    const { getServiceRoleClient } = await import("@/lib/supabase");
    vi.mocked(getServiceRoleClient).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            is: vi.fn().mockResolvedValue({
              data: [{ email: "alice@opollo.com" }, { email: "bob@opollo.com" }],
              error: null,
            }),
          }),
        }),
      }),
    } as unknown as ReturnType<typeof getServiceRoleClient>);

    __resetRecipientsCacheForTests();
    const { getPlatformAdminEmails } = await import("@/lib/platform/service-health/recipients");
    const result = await getPlatformAdminEmails();
    expect(result).toEqual(["alice@opollo.com", "bob@opollo.com"]);
  });
});

// ---------------------------------------------------------------------------
// withHealthMonitoring cross-process recovery sweep
//
// Regression: the previous implementation used an in-memory Map
// (`lastCallFailed`) to gate `recordRecovery`. Vercel functions are stateless
// across cold-starts, so the flag was never set when a new process observed
// a successful call after a failure recorded by a different process. Result:
// unresolved rows accumulated forever (e.g. the 7-day-stuck bundle.social
// row from PR #904's env-var typo, even after PR #1128 fixed the typo).
//
// The fix replaces the Map with a DB query against service_health_events.
// These tests cover the three outcomes.
// ---------------------------------------------------------------------------

describe("withHealthMonitoring cross-process recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("(a) successful call fires recordRecovery when unresolved row exists", async () => {
    const { hasUnresolvedHealthEvent, recordRecovery } = await import(
      "@/lib/platform/service-health/record"
    );
    vi.mocked(hasUnresolvedHealthEvent).mockResolvedValueOnce(true);

    const { withHealthMonitoring } = await import(
      "@/lib/platform/service-health/monitor"
    );
    const result = await withHealthMonitoring("bundle.social", "analytics", async () => "ok");

    expect(result).toBe("ok");
    expect(hasUnresolvedHealthEvent).toHaveBeenCalledWith("bundle.social", "analytics");
    expect(recordRecovery).toHaveBeenCalledWith("bundle.social", "analytics");
  });

  test("(b) successful call does NOT fire recordRecovery when no unresolved row", async () => {
    const { hasUnresolvedHealthEvent, recordRecovery } = await import(
      "@/lib/platform/service-health/record"
    );
    vi.mocked(hasUnresolvedHealthEvent).mockResolvedValueOnce(false);

    const { withHealthMonitoring } = await import(
      "@/lib/platform/service-health/monitor"
    );
    const result = await withHealthMonitoring("bundle.social", "analytics", async () => "ok");

    expect(result).toBe("ok");
    expect(hasUnresolvedHealthEvent).toHaveBeenCalledWith("bundle.social", "analytics");
    expect(recordRecovery).not.toHaveBeenCalled();
  });

  test("(c) detector failure does not throw or block the success path", async () => {
    const { hasUnresolvedHealthEvent, recordRecovery } = await import(
      "@/lib/platform/service-health/record"
    );
    // Real impl returns false on internal failure; mirror that contract here.
    vi.mocked(hasUnresolvedHealthEvent).mockResolvedValueOnce(false);

    const { withHealthMonitoring } = await import(
      "@/lib/platform/service-health/monitor"
    );
    const result = await withHealthMonitoring("bundle.social", "analytics", async () => "ok");

    expect(result).toBe("ok");
    expect(recordRecovery).not.toHaveBeenCalled();
  });

  test("error path records a health event and re-throws (no recovery query)", async () => {
    const { hasUnresolvedHealthEvent, recordHealthEvent, recordRecovery } = await import(
      "@/lib/platform/service-health/record"
    );
    const err = Object.assign(new Error("boom"), { status: 500 });

    const { withHealthMonitoring } = await import(
      "@/lib/platform/service-health/monitor"
    );
    await expect(
      withHealthMonitoring("bundle.social", "analytics", async () => {
        throw err;
      }),
    ).rejects.toThrow("boom");

    expect(recordHealthEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceName: "bundle.social",
        operation: "analytics",
        eventType: "service_5xx",
      }),
    );
    expect(hasUnresolvedHealthEvent).not.toHaveBeenCalled();
    expect(recordRecovery).not.toHaveBeenCalled();
  });
});
