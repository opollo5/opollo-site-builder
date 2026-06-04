// tests/regressions/health-alert-stale-dedup.test.ts
//
// Regression tests for the health-check cron dedup fix.
//
// Root cause being tested: the old query
//   `notified_at IS NULL OR notified_at < NOW() - 30min`
// re-alerted every 30 min regardless of whether new failures had occurred.
// A stale event (last_seen_at frozen since the original incident) would
// re-notify forever — confirmed in prod: one 2-minute bundle.social blip
// on 2026-06-03 09:00 produced ~49 identical alerts over 24 h.
//
// Fix: add `last_seen_at > notified_at` as a gate on re-notifications.
// A never-notified event always fires (notified_at IS NULL).
//
// Tests:
//   1. NEW failure (never notified) → alert fires immediately regardless of service
//   2. STALE event (last_seen_at == notified_at) → suppressed
//   3. ACTIVE event (last_seen_at > notified_at, cooldown elapsed) → fires again
//   4. Active event within cooldown → suppressed
//   5. New failure on a DIFFERENT service (sendgrid) still fires immediately
//      — the dedup must never suppress a first alert on any service
//
// Layer 1 — unit tests. No real DB or network.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/platform/service-health/notify", () => ({
  notifyHealthAlert: vi.fn(async () => {}),
}));
vi.mock("@/lib/platform/cron/cron-shared", () => ({
  authorisedCronRequest: vi.fn(() => true),
  unauthorisedResponse: vi.fn(),
  updateHeartbeat: vi.fn(async () => {}),
}));
vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal ServiceHealthEvent-like object for the mock DB. */
function makeEvent(overrides: {
  id: string;
  service_name?: string;
  operation?: string;
  notified_at: string | null;
  last_seen_at: string;
}) {
  return {
    id: overrides.id,
    service_name: overrides.service_name ?? "bundle.social",
    operation: overrides.operation ?? "publish",
    event_type: "connection_failure",
    severity: "critical",
    occurrence_count: 3,
    first_seen_at: "2026-06-03T09:00:00.000Z",
    last_seen_at: overrides.last_seen_at,
    notified_at: overrides.notified_at,
    resolved_at: null,
    details: { status: null, message: "fetch failed" },
    raised_by_user_id: null,
  };
}

/** The re-notification cooldown in the cron is 4 hours. */
const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

function makeSvcMock(events: ReturnType<typeof makeEvent>[]) {
  const updateFn = vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ error: null })) }));
  const svc = {
    from: (table: string) => {
      if (table === "service_health_events") {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                or: () => ({
                  order: () => ({
                    limit: () => Promise.resolve({ data: events, error: null }),
                  }),
                }),
              }),
            }),
            update: updateFn,
          }),
          update: updateFn,
        };
      }
      return {};
    },
  };
  return { svc, updateFn };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("health-check cron — stale-dedup filter", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.clearAllMocks());

  it("1 — NEW failure (notified_at IS NULL) → notifyHealthAlert fires immediately", async () => {
    const now = Date.now();
    const event = makeEvent({
      id: "evt-new",
      notified_at: null,   // never notified
      last_seen_at: new Date(now - 60_000).toISOString(),  // 1 min ago
    });

    const { svc } = makeSvcMock([event]);
    const { getServiceRoleClient } = await import("@/lib/supabase");
    vi.mocked(getServiceRoleClient).mockReturnValue(svc as never);

    vi.resetModules();
    const { POST } = await import("@/app/api/internal/cron/health-check/route");
    const { notifyHealthAlert } = await import("@/lib/platform/service-health/notify");

    const req = new Request("http://localhost/api/internal/cron/health-check", { method: "POST" });
    const resp = await POST(req as never);
    const body = await resp.json();

    expect(vi.mocked(notifyHealthAlert)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notifyHealthAlert)).toHaveBeenCalledWith(
      expect.objectContaining({ id: "evt-new" }),
    );
    expect(body.data.notified).toBe(1);
    expect(body.data.stale_suppressed).toBe(0);
  });

  it("2 — STALE event (last_seen_at == notified_at, no new failures) → suppressed", async () => {
    const now = Date.now();
    // Notified 5 hours ago, but last_seen_at is ALSO 5 hours ago.
    // No new failures have occurred since the last notification.
    const ts = new Date(now - 5 * 60 * 60 * 1000).toISOString();
    const event = makeEvent({
      id: "evt-stale",
      notified_at: ts,
      last_seen_at: ts,  // equal → no new failures since last notification
    });

    const { svc } = makeSvcMock([event]);
    const { getServiceRoleClient } = await import("@/lib/supabase");
    vi.mocked(getServiceRoleClient).mockReturnValue(svc as never);

    vi.resetModules();
    const { POST } = await import("@/app/api/internal/cron/health-check/route");
    const { notifyHealthAlert } = await import("@/lib/platform/service-health/notify");

    const req = new Request("http://localhost/api/internal/cron/health-check", { method: "POST" });
    const resp = await POST(req as never);
    const body = await resp.json();

    // Suppressed — no new failures since last notification.
    expect(vi.mocked(notifyHealthAlert)).not.toHaveBeenCalled();
    expect(body.data.notified).toBe(0);
    expect(body.data.stale_suppressed).toBe(1);
  });

  it("3 — ACTIVE event (last_seen_at > notified_at, 4h cooldown elapsed) → fires again", async () => {
    const now = Date.now();
    // Notified 5 hours ago, but new failures came in 10 minutes ago.
    const notifiedAt = new Date(now - 5 * 60 * 60 * 1000).toISOString();
    const lastSeenAt = new Date(now - 10 * 60 * 1000).toISOString();  // 10 min ago
    const event = makeEvent({
      id: "evt-active",
      notified_at: notifiedAt,
      last_seen_at: lastSeenAt,  // newer than notified_at → new failures occurred
    });

    const { svc } = makeSvcMock([event]);
    const { getServiceRoleClient } = await import("@/lib/supabase");
    vi.mocked(getServiceRoleClient).mockReturnValue(svc as never);

    vi.resetModules();
    const { POST } = await import("@/app/api/internal/cron/health-check/route");
    const { notifyHealthAlert } = await import("@/lib/platform/service-health/notify");

    const req = new Request("http://localhost/api/internal/cron/health-check", { method: "POST" });
    const resp = await POST(req as never);
    const body = await resp.json();

    // Active incident with new failures → re-alert fires.
    expect(vi.mocked(notifyHealthAlert)).toHaveBeenCalledTimes(1);
    expect(body.data.notified).toBe(1);
    expect(body.data.stale_suppressed).toBe(0);
  });

  it("4 — Active event within cooldown window → query never returns it (time gate)", async () => {
    const now = Date.now();
    // Notified 30 min ago — inside the 4h cooldown. The SQL query won't
    // return this event (notified_at >= cutoff), so it never reaches the
    // TypeScript filter. DB mock returns empty.
    const { svc } = makeSvcMock([]);  // query returns nothing for within-cooldown events
    const { getServiceRoleClient } = await import("@/lib/supabase");
    vi.mocked(getServiceRoleClient).mockReturnValue(svc as never);

    vi.resetModules();
    const { POST } = await import("@/app/api/internal/cron/health-check/route");
    const { notifyHealthAlert } = await import("@/lib/platform/service-health/notify");

    const req = new Request("http://localhost/api/internal/cron/health-check", { method: "POST" });
    const resp = await POST(req as never);
    const body = await resp.json();

    expect(vi.mocked(notifyHealthAlert)).not.toHaveBeenCalled();
    expect(body.data.notified).toBe(0);
    expect(body.data.candidates).toBe(0);
  });

  it("5 — NEW failure on a DIFFERENT service (sendgrid) fires immediately — dedup never suppresses first alerts on any service", async () => {
    const now = Date.now();
    // sendgrid has a brand-new critical event, never notified.
    const sendgridEvent = makeEvent({
      id: "evt-sendgrid-new",
      service_name: "sendgrid",
      operation: "notify_approver",
      notified_at: null,   // never notified
      last_seen_at: new Date(now - 30_000).toISOString(),  // 30s ago
    });
    // bundle.social has a STALE event — should be suppressed.
    const staleTs = new Date(now - 5 * 60 * 60 * 1000).toISOString();
    const bundleStaleEvent = makeEvent({
      id: "evt-bundle-stale",
      service_name: "bundle.social",
      operation: "publish",
      notified_at: staleTs,
      last_seen_at: staleTs,  // equal → stale
    });

    const { svc } = makeSvcMock([sendgridEvent, bundleStaleEvent]);
    const { getServiceRoleClient } = await import("@/lib/supabase");
    vi.mocked(getServiceRoleClient).mockReturnValue(svc as never);

    vi.resetModules();
    const { POST } = await import("@/app/api/internal/cron/health-check/route");
    const { notifyHealthAlert } = await import("@/lib/platform/service-health/notify");

    const req = new Request("http://localhost/api/internal/cron/health-check", { method: "POST" });
    const resp = await POST(req as never);
    const body = await resp.json();

    // sendgrid alert fires; bundle.social stale alert is suppressed.
    expect(vi.mocked(notifyHealthAlert)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notifyHealthAlert)).toHaveBeenCalledWith(
      expect.objectContaining({ id: "evt-sendgrid-new", service_name: "sendgrid" }),
    );
    expect(vi.mocked(notifyHealthAlert)).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: "evt-bundle-stale" }),
    );
    expect(body.data.notified).toBe(1);
    expect(body.data.stale_suppressed).toBe(1);
  });
});
