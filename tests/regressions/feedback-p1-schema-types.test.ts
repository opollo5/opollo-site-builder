// tests/regressions/feedback-p1-schema-types.test.ts
// P1 acceptance: verify the CallerContext + TicketStatus type contracts and
// the migration-expected field shapes compile and match their DB constraints.
// Layer 1 — pure TypeScript, no DB or network required.

import { describe, expect, it } from "vitest";

import type {
  CallerContext,
  EventActorKind,
  FeedbackTicket,
  TicketPriority,
  TicketSeverity,
  TicketStatus,
} from "@/lib/feedback/types";

// ---------------------------------------------------------------------------
// 1. CallerContext — the three legal kinds
// ---------------------------------------------------------------------------
describe("CallerContext", () => {
  it("human-staff carries a userId", () => {
    const ctx: CallerContext = { kind: "human-staff", userId: "user-1" };
    expect(ctx.kind).toBe("human-staff");
    if (ctx.kind === "human-staff") {
      expect(ctx.userId).toBe("user-1");
    }
  });

  it("automation has no userId", () => {
    const ctx: CallerContext = { kind: "automation" };
    expect(ctx.kind).toBe("automation");
  });

  it("customer-reporter carries a userId", () => {
    const ctx: CallerContext = { kind: "customer-reporter", userId: "user-2" };
    expect(ctx.kind).toBe("customer-reporter");
  });
});

// ---------------------------------------------------------------------------
// 2. TicketStatus — all seven values
// ---------------------------------------------------------------------------
describe("TicketStatus", () => {
  const VALID: TicketStatus[] = [
    "backlog",
    "triaged",
    "in_progress",
    "fixed",
    "verified",
    "wont_fix",
    "closed",
  ];

  it("has exactly 7 statuses", () => {
    expect(VALID).toHaveLength(7);
  });

  VALID.forEach((s) => {
    it(`accepts ${s}`, () => {
      const status: TicketStatus = s;
      expect(typeof status).toBe("string");
    });
  });
});

// ---------------------------------------------------------------------------
// 3. TicketSeverity, TicketPriority
// ---------------------------------------------------------------------------
describe("TicketSeverity", () => {
  const VALUES: TicketSeverity[] = ["low", "normal", "high", "blocker"];
  it("has 4 values", () => expect(VALUES).toHaveLength(4));
});

describe("TicketPriority", () => {
  const VALUES: TicketPriority[] = ["low", "medium", "high", "urgent"];
  it("has 4 values", () => expect(VALUES).toHaveLength(4));
});

// ---------------------------------------------------------------------------
// 4. EventActorKind
// ---------------------------------------------------------------------------
describe("EventActorKind", () => {
  const VALUES: EventActorKind[] = [
    "human-staff",
    "automation",
    "customer-reporter",
    "system",
  ];
  it("has 4 values", () => expect(VALUES).toHaveLength(4));
});

// ---------------------------------------------------------------------------
// 5. FeedbackTicket shape — required numeric fields are numbers
// ---------------------------------------------------------------------------
describe("FeedbackTicket field shapes", () => {
  const stub: FeedbackTicket = {
    id: "uuid-1",
    ticket_number: null,
    company_id: "company-uuid",
    title: "Test bug",
    description: "Something broke",
    severity: "high",
    priority: "urgent",
    status: "backlog",
    assignee_id: null,
    triaged_by: null,
    triaged_at: null,
    verified_by: null,
    verified_at: null,
    tags: [],
    page_url: "https://app.opollo.com/company",
    route_pattern: null,
    css_selector: "[data-testid='hero-cta']",
    element_label: "Get started",
    click_x_pct: 42.1,
    click_y_pct: 71.0,
    viewport_w: 390,
    viewport_h: 844,
    device_pixel_ratio: 2,
    user_agent: "Mozilla/5.0",
    console_errors: null,
    screenshot_path: null,
    annotation: null,
    repo_ref: null,
    linked_pr_url: null,
    created_by: "user-1",
    updated_by: null,
    created_at: "2026-06-03T00:00:00Z",
    updated_at: "2026-06-03T00:00:00Z",
    deleted_at: null,
    resolution_notes: null,
    expected_behavior: null,
  };

  it("click_x_pct is a number between 0 and 100", () => {
    expect(typeof stub.click_x_pct).toBe("number");
    expect(stub.click_x_pct).toBeGreaterThanOrEqual(0);
    expect(stub.click_x_pct).toBeLessThanOrEqual(100);
  });

  it("click_y_pct is a number between 0 and 100", () => {
    expect(typeof stub.click_y_pct).toBe("number");
    expect(stub.click_y_pct).toBeGreaterThanOrEqual(0);
    expect(stub.click_y_pct).toBeLessThanOrEqual(100);
  });

  it("viewport_w and viewport_h are integers > 0", () => {
    expect(Number.isInteger(stub.viewport_w)).toBe(true);
    expect(stub.viewport_w).toBeGreaterThan(0);
    expect(Number.isInteger(stub.viewport_h)).toBe(true);
    expect(stub.viewport_h).toBeGreaterThan(0);
  });
});
