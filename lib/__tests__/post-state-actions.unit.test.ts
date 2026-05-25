import { describe, expect, it } from "vitest";

import {
  ALLOWED_ACTIONS,
  canPerform,
  isReadOnlyState,
  isTerminalForMutation,
  type PostAction,
  type PostState,
} from "@/lib/social/post-state-actions";

// ---------------------------------------------------------------------------
// post-state-actions matrix — one assertion per (state, action) cell.
//
// The matrix is the single source of truth for composer + PATCH guard.
// If any cell flips, both the UI and the server contract have to change
// in lockstep. This test pins the matrix so a silent drift fails CI.
// ---------------------------------------------------------------------------

const ALL_STATES: readonly PostState[] = [
  "draft",
  "pending_approval",
  "rejected",
  "scheduled",
  "recurring",
  "paused",
  "publishing",
  "published",
  "failed",
];

const ALL_ACTIONS: readonly PostAction[] = [
  "edit",
  "schedule",
  "reschedule",
  "save_draft",
  "convert_to_draft",
  "delete",
  "view",
  "view_on_platform",
  "view_analytics",
  "repost_as_new",
  "delete_from_records",
  "cancel_publish",
  "retry_publish",
  "approve",
  "reject",
];

// Explicit expected matrix — duplicated here intentionally so a change
// in lib/social/post-state-actions.ts cannot pass tests by accident.
const EXPECTED: Record<PostState, readonly PostAction[]> = {
  draft: ["edit", "schedule", "save_draft", "delete"],
  pending_approval: ["view", "approve", "reject", "delete"],
  rejected: ["edit", "save_draft", "delete"],
  scheduled: ["edit", "reschedule", "convert_to_draft", "delete"],
  recurring: ["view", "convert_to_draft", "delete"],
  paused: ["view", "convert_to_draft", "delete"],
  publishing: ["view"],
  published: [
    "view",
    "view_on_platform",
    "view_analytics",
    "repost_as_new",
    "delete_from_records",
  ],
  failed: ["edit", "retry_publish", "save_draft", "delete"],
};

describe("post-state-actions — matrix shape", () => {
  it("covers every state in the DraftState enum", () => {
    for (const s of ALL_STATES) {
      expect(ALLOWED_ACTIONS[s]).toBeDefined();
    }
  });

  it("matches the expected matrix exactly", () => {
    for (const s of ALL_STATES) {
      expect([...ALLOWED_ACTIONS[s]].sort()).toEqual(
        [...EXPECTED[s]].sort(),
      );
    }
  });
});

describe("canPerform — every (state, action) cell", () => {
  for (const state of ALL_STATES) {
    for (const action of ALL_ACTIONS) {
      const expected = EXPECTED[state].includes(action);
      it(`${state} → ${action} = ${expected}`, () => {
        expect(canPerform(state, action)).toBe(expected);
      });
    }
  }
});

describe("isReadOnlyState — terminal/transient states", () => {
  it("returns true for published", () => {
    expect(isReadOnlyState("published")).toBe(true);
  });

  it("returns true for publishing", () => {
    expect(isReadOnlyState("publishing")).toBe(true);
  });

  it("returns true for pending_approval (editors view only)", () => {
    expect(isReadOnlyState("pending_approval")).toBe(true);
  });

  it("returns true for recurring + paused (use convert-to-draft to edit)", () => {
    expect(isReadOnlyState("recurring")).toBe(true);
    expect(isReadOnlyState("paused")).toBe(true);
  });

  it("returns false for draft, scheduled, rejected, failed", () => {
    expect(isReadOnlyState("draft")).toBe(false);
    expect(isReadOnlyState("scheduled")).toBe(false);
    expect(isReadOnlyState("rejected")).toBe(false);
    expect(isReadOnlyState("failed")).toBe(false);
  });
});

describe("isTerminalForMutation — PATCH guard contract", () => {
  it("returns true only for published and publishing", () => {
    expect(isTerminalForMutation("published")).toBe(true);
    expect(isTerminalForMutation("publishing")).toBe(true);
  });

  it("returns false for every other state", () => {
    const guarded: PostState[] = ["published", "publishing"];
    for (const s of ALL_STATES) {
      if (guarded.includes(s)) continue;
      expect(isTerminalForMutation(s)).toBe(false);
    }
  });
});

describe("safety invariants", () => {
  it("published never allows edit/schedule/save_draft/convert_to_draft/reschedule", () => {
    const forbidden: PostAction[] = [
      "edit",
      "schedule",
      "save_draft",
      "convert_to_draft",
      "reschedule",
    ];
    for (const a of forbidden) {
      expect(canPerform("published", a)).toBe(false);
    }
  });

  it("publishing only allows view — no mutations of a transient state", () => {
    const forbidden: PostAction[] = [
      "edit",
      "schedule",
      "save_draft",
      "convert_to_draft",
      "reschedule",
      "delete",
      "delete_from_records",
    ];
    for (const a of forbidden) {
      expect(canPerform("publishing", a)).toBe(false);
    }
  });

  it("published exposes view_on_platform + view_analytics so users can find the live post", () => {
    expect(canPerform("published", "view_on_platform")).toBe(true);
    expect(canPerform("published", "view_analytics")).toBe(true);
    expect(canPerform("published", "repost_as_new")).toBe(true);
  });
});
