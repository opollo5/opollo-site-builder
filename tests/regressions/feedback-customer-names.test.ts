// tests/regressions/feedback-customer-names.test.ts
//
// Backlog item 3: customer-facing timeline + thread shows real staff names.
// Verifies the eventLabel resolution and TicketThread author name logic.
//
// Layer 1 — pure TypeScript logic tests; no DB or render required.

import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// eventLabel resolution helpers (mirrors FeedbackDetailClient logic)
// ---------------------------------------------------------------------------

type EventType =
  | "created" | "assigned" | "reassigned" | "status_changed"
  | "severity_changed" | "priority_changed" | "reopened_by_customer"
  | "verified" | "closed";

function eventLabel(
  e: { event_type: EventType; actor_id: string | null; from_value?: string | null; to_value?: string | null },
  actorNames: Record<string, string>,
): string {
  const actor = e.actor_id ? (actorNames[e.actor_id] ?? "Opollo") : "Opollo";
  switch (e.event_type) {
    case "created": return "Reported";
    case "assigned": return `Assigned to ${actor}`;
    case "reassigned": return `Reassigned to ${actor}`;
    case "status_changed": return `Status updated: ${e.from_value} → ${e.to_value}`;
    case "severity_changed": return `Severity updated: ${e.from_value} → ${e.to_value}`;
    case "priority_changed": return `Priority updated by ${actor}`;
    case "reopened_by_customer": return "You reported this is still broken";
    case "verified": return `Marked as resolved by ${actor}`;
    case "closed": return `Closed by ${actor}`;
    default: return e.event_type;
  }
}

function threadAuthorLabel(
  isStaff: boolean,
  authorId: string,
  authorNames: Record<string, string>,
): string {
  if (!isStaff) return "Reporter";
  return authorNames[authorId] ?? "Opollo";
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const ACTOR_NAMES: Record<string, string> = {
  "staff-1": "Steven Morey",
  "staff-2": "Jane Smith",
};

describe("eventLabel — resolves actor_id to display name", () => {
  it("created → always 'Reported' (no actor)", () => {
    expect(eventLabel({ event_type: "created", actor_id: null }, ACTOR_NAMES)).toBe("Reported");
  });

  it("assigned → shows resolved staff name", () => {
    expect(eventLabel({ event_type: "assigned", actor_id: "staff-1" }, ACTOR_NAMES))
      .toBe("Assigned to Steven Morey");
  });

  it("assigned → falls back to 'Opollo' when actor_id unknown", () => {
    expect(eventLabel({ event_type: "assigned", actor_id: "unknown-id" }, ACTOR_NAMES))
      .toBe("Assigned to Opollo");
  });

  it("assigned → falls back to 'Opollo' when actor_id is null", () => {
    expect(eventLabel({ event_type: "assigned", actor_id: null }, ACTOR_NAMES))
      .toBe("Assigned to Opollo");
  });

  it("verified → shows name", () => {
    expect(eventLabel({ event_type: "verified", actor_id: "staff-2" }, ACTOR_NAMES))
      .toBe("Marked as resolved by Jane Smith");
  });

  it("closed → shows name", () => {
    expect(eventLabel({ event_type: "closed", actor_id: "staff-1" }, ACTOR_NAMES))
      .toBe("Closed by Steven Morey");
  });

  it("reopened_by_customer → always the same string (no actor needed)", () => {
    expect(eventLabel({ event_type: "reopened_by_customer", actor_id: "user-1" }, ACTOR_NAMES))
      .toBe("You reported this is still broken");
  });

  it("status_changed → shows from/to values, not actor name", () => {
    expect(eventLabel({
      event_type: "status_changed",
      actor_id: "staff-1",
      from_value: "backlog",
      to_value: "in_progress",
    }, ACTOR_NAMES)).toBe("Status updated: backlog → in_progress");
  });

  it("empty actorNames map → all staff labels fall back to 'Opollo'", () => {
    expect(eventLabel({ event_type: "assigned", actor_id: "staff-1" }, {}))
      .toBe("Assigned to Opollo");
  });
});

describe("threadAuthorLabel — TicketThread author display", () => {
  it("non-staff comment always shows 'Reporter'", () => {
    expect(threadAuthorLabel(false, "user-1", ACTOR_NAMES)).toBe("Reporter");
  });

  it("staff comment shows resolved name when available", () => {
    expect(threadAuthorLabel(true, "staff-1", ACTOR_NAMES)).toBe("Steven Morey");
  });

  it("staff comment falls back to 'Opollo' when name not in map", () => {
    expect(threadAuthorLabel(true, "unknown", ACTOR_NAMES)).toBe("Opollo");
  });

  it("staff comment falls back to 'Opollo' with empty map", () => {
    expect(threadAuthorLabel(true, "staff-1", {})).toBe("Opollo");
  });
});
