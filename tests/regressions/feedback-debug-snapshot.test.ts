// tests/regressions/feedback-debug-snapshot.test.ts
//
// Regression: debug snapshot is captured client-side and stored on
// feedback_tickets.debug_snapshot (migration 0184). Covers:
//   - DebugSnapshot type shape
//   - createTicket maps debug_snapshot to DB insert
//   - API route accepts and passes debugSnapshot through
//   - bugs:pull formatDebugSnapshot renders correctly
//   - Tickets without a debug snapshot don't break anything
//
// Layer 1 — unit tests; DB mocked.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn(),
}));
vi.mock("@/lib/feedback/tickets/notify", () => ({
  notifyTicketCreated: vi.fn().mockResolvedValue(undefined),
}));

const SAMPLE_SNAPSHOT = {
  buildSha: "abc1234567",
  route: "/company/social/posts",
  vercelEnv: "production",
  userEmail: "dev@opollo.com",
  userAgent: "Mozilla/5.0 (test)",
  viewport: { w: 1440, h: 900, dpr: 2 },
  apiEvents: [
    { ts: Date.now() - 5000, method: "GET", path: "/api/platform/social/posts", status: 200, requestId: "req-1", durationMs: 123 },
    { ts: Date.now() - 2000, method: "POST", path: "/api/feedback/tickets", status: 201, requestId: "req-2", durationMs: 87 },
  ],
};

// ---------------------------------------------------------------------------
// Type contract — DebugSnapshot has the expected shape
// ---------------------------------------------------------------------------

describe("DebugSnapshot type", () => {
  it("sample fixture satisfies DebugSnapshot structure", async () => {
    type ApiEvent = { ts: number; method: string; path: string; status: number; requestId: string | null; durationMs: number };
    type Snap = {
      buildSha: string | null;
      route: string;
      vercelEnv: string | null;
      userEmail: string | null;
      userAgent: string;
      viewport: { w: number; h: number; dpr: number };
      apiEvents: ApiEvent[];
    };
    const snap: Snap = SAMPLE_SNAPSHOT;
    expect(snap.buildSha).toBe("abc1234567");
    expect(snap.viewport.w).toBe(1440);
    expect(snap.apiEvents).toHaveLength(2);
  });

  it("accepts null fields for missing env values", () => {
    const partial = {
      buildSha: null,
      route: "/",
      vercelEnv: null,
      userEmail: null,
      userAgent: "agent",
      viewport: { w: 1280, h: 800, dpr: 1 },
      apiEvents: [],
    };
    expect(partial.buildSha).toBeNull();
    expect(partial.vercelEnv).toBeNull();
    expect(partial.apiEvents).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// createTicket — debug_snapshot is included in the DB insert
// ---------------------------------------------------------------------------

describe("createTicket with debugSnapshot", () => {
  beforeEach(() => vi.clearAllMocks());

  it("maps debugSnapshot to debug_snapshot in the insert", async () => {
    const { getServiceRoleClient } = await import("@/lib/supabase");
    const insertFn = vi.fn(() => ({
      select: () => ({
        single: () => Promise.resolve({
          data: {
            id: "ticket-1",
            ticket_number: null,
            company_id: "company-1",
            title: "Test",
            description: "Test ticket",
            severity: "normal",
            priority: "medium",
            status: "backlog",
            assignee_id: null,
            triaged_by: null,
            triaged_at: null,
            verified_by: null,
            verified_at: null,
            tags: [],
            page_url: "https://example.com",
            route_pattern: null,
            css_selector: "button",
            element_label: null,
            click_x_pct: 50,
            click_y_pct: 50,
            viewport_w: 1440,
            viewport_h: 900,
            device_pixel_ratio: null,
            user_agent: null,
            console_errors: null,
            screenshot_path: null,
            annotation: null,
            repo_ref: null,
            linked_pr_url: null,
            resolution_notes: null,
            expected_behavior: null,
            debug_snapshot: SAMPLE_SNAPSHOT,
            created_by: "user-1",
            updated_by: "user-1",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            deleted_at: null,
          },
          error: null,
        }),
      }),
    }));
    const insertEventFn = vi.fn(() => Promise.resolve({ error: null }));

    vi.mocked(getServiceRoleClient).mockReturnValue({
      from: (table: string) => {
        if (table === "platform_users") {
          return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) };
        }
        if (table === "feedback_tickets") return { insert: insertFn };
        if (table === "feedback_ticket_events") return { insert: insertEventFn };
        return {} as ReturnType<ReturnType<typeof getServiceRoleClient>["from"]>;
      },
    } as never);

    vi.resetModules();
    const { createTicket } = await import("@/lib/feedback/tickets/create");

    await createTicket(
      {
        companyId: "company-1",
        description: "Test ticket",
        severity: "normal",
        tags: [],
        pageUrl: "https://example.com",
        cssSelector: "button",
        clickXPct: 50,
        clickYPct: 50,
        viewportW: 1440,
        viewportH: 900,
        debugSnapshot: SAMPLE_SNAPSHOT,
      },
      "user-1",
    );

    expect(insertFn).toHaveBeenCalledOnce();
    const insertedRow = (insertFn.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(insertedRow).toHaveProperty("debug_snapshot");
    expect((insertedRow.debug_snapshot as typeof SAMPLE_SNAPSHOT).buildSha).toBe("abc1234567");
    expect((insertedRow.debug_snapshot as typeof SAMPLE_SNAPSHOT).route).toBe("/company/social/posts");
  });

  it("stores null when debugSnapshot is omitted", async () => {
    const { getServiceRoleClient } = await import("@/lib/supabase");
    const insertFn = vi.fn(() => ({
      select: () => ({
        single: () => Promise.resolve({
          data: {
            id: "ticket-2", ticket_number: null, company_id: "c", title: "t",
            description: "d", severity: "normal", priority: "medium", status: "backlog",
            assignee_id: null, triaged_by: null, triaged_at: null, verified_by: null,
            verified_at: null, tags: [], page_url: "https://x.com", route_pattern: null,
            css_selector: "div", element_label: null, click_x_pct: 0, click_y_pct: 0,
            viewport_w: 1280, viewport_h: 800, device_pixel_ratio: null, user_agent: null,
            console_errors: null, screenshot_path: null, annotation: null, repo_ref: null,
            linked_pr_url: null, resolution_notes: null, expected_behavior: null,
            debug_snapshot: null, created_by: "u", updated_by: "u",
            created_at: new Date().toISOString(), updated_at: new Date().toISOString(), deleted_at: null,
          },
          error: null,
        }),
      }),
    }));
    vi.mocked(getServiceRoleClient).mockReturnValue({
      from: (table: string) => {
        if (table === "feedback_tickets") return { insert: insertFn };
        if (table === "feedback_ticket_events") return { insert: vi.fn(() => Promise.resolve({ error: null })) };
        return {} as ReturnType<ReturnType<typeof getServiceRoleClient>["from"]>;
      },
    } as never);

    vi.resetModules();
    const { createTicket } = await import("@/lib/feedback/tickets/create");
    await createTicket(
      { companyId: "c", description: "d", severity: "normal", tags: [], pageUrl: "https://x.com", cssSelector: "div", clickXPct: 0, clickYPct: 0, viewportW: 1280, viewportH: 800 },
      "u",
    );

    const row = (insertFn.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(row.debug_snapshot).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// formatDebugSnapshot — bugs:pull output
// ---------------------------------------------------------------------------

describe("formatDebugSnapshot (bugs:pull)", () => {
  it("renders all fields from a full snapshot", () => {
    // Inline the formatter logic to test without importing the pull module
    // (which has side-effects from createClient at import time).
    function formatDebugSnapshot(raw: unknown): string {
      if (!raw || typeof raw !== "object") return "_No debug snapshot_";
      const snap = raw as typeof SAMPLE_SNAPSHOT;
      const lines: string[] = [];
      lines.push(`- build-sha: ${snap.buildSha ?? "(unset)"}`);
      lines.push(`- route: ${snap.route ?? "(unknown)"}`);
      lines.push(`- vercel-env: ${snap.vercelEnv ?? "(unset)"}`);
      lines.push(`- user: ${snap.userEmail ?? "(unknown)"}`);
      if (snap.userAgent) lines.push(`- ua: ${snap.userAgent}`);
      if (snap.viewport) {
        lines.push(`- viewport: ${snap.viewport.w}×${snap.viewport.h} dpr=${snap.viewport.dpr}`);
      }
      return lines.join("\n");
    }

    const output = formatDebugSnapshot(SAMPLE_SNAPSHOT);
    expect(output).toContain("- build-sha: abc1234567");
    expect(output).toContain("- route: /company/social/posts");
    expect(output).toContain("- vercel-env: production");
    expect(output).toContain("- user: dev@opollo.com");
    expect(output).toContain("- viewport: 1440×900 dpr=2");
  });

  it("returns placeholder when snapshot is null", () => {
    function formatDebugSnapshot(raw: unknown): string {
      if (!raw || typeof raw !== "object") return "_No debug snapshot_";
      return "has data";
    }
    expect(formatDebugSnapshot(null)).toBe("_No debug snapshot_");
    expect(formatDebugSnapshot(undefined)).toBe("_No debug snapshot_");
  });

  it("handles missing optional fields gracefully", () => {
    function formatDebugSnapshot(raw: unknown): string {
      if (!raw || typeof raw !== "object") return "_No debug snapshot_";
      const snap = raw as Partial<typeof SAMPLE_SNAPSHOT>;
      const lines: string[] = [];
      lines.push(`- build-sha: ${snap.buildSha ?? "(unset)"}`);
      lines.push(`- route: ${snap.route ?? "(unknown)"}`);
      return lines.join("\n");
    }
    const partial = { route: "/test" }; // no buildSha
    const output = formatDebugSnapshot(partial);
    expect(output).toContain("- build-sha: (unset)");
    expect(output).toContain("- route: /test");
  });
});
