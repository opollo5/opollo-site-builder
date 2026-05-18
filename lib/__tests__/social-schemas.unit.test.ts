import { describe, expect, it } from "vitest";

import {
  ApproveSchema,
} from "@/lib/social/schemas/approve";
import {
  BulkRowSchema,
} from "@/lib/social/schemas/bulk-upload";
import {
  CreateDraftSchema,
} from "@/lib/social/schemas/create-draft";

// ---------------------------------------------------------------------------
// ApproveSchema
// ---------------------------------------------------------------------------
describe("ApproveSchema", () => {
  it("accepts approved decision with no rejection_reason", () => {
    const result = ApproveSchema.safeParse({ decision: "approved" });
    expect(result.success).toBe(true);
  });

  it("accepts rejected decision with valid 30-500 char reason", () => {
    const result = ApproveSchema.safeParse({
      decision: "rejected",
      rejection_reason: "This post needs more context before we can approve it for publication.",
    });
    expect(result.success).toBe(true);
  });

  it("rejects rejected decision with no rejection_reason", () => {
    const result = ApproveSchema.safeParse({ decision: "rejected" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join("."));
      expect(paths).toContain("rejection_reason");
    }
  });

  it("rejects rejected decision with reason < 30 chars", () => {
    const result = ApproveSchema.safeParse({
      decision: "rejected",
      rejection_reason: "Too short",
    });
    expect(result.success).toBe(false);
  });

  it("rejects rejected decision with reason > 500 chars", () => {
    const result = ApproveSchema.safeParse({
      decision: "rejected",
      rejection_reason: "a".repeat(501),
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown decision value", () => {
    const result = ApproveSchema.safeParse({ decision: "maybe" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// BulkRowSchema
// ---------------------------------------------------------------------------
describe("BulkRowSchema", () => {
  it("accepts a valid row", () => {
    const result = BulkRowSchema.safeParse({
      content: "Hello world",
      date: "05/18/2026",
      time: "14:00",
      channel: "linkedin|facebook",
    });
    expect(result.success).toBe(true);
  });

  it("defaults channel to empty string", () => {
    const result = BulkRowSchema.safeParse({
      content: "Hello",
      date: "05/18/2026",
      time: "09:30",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.channel).toBe("");
    }
  });

  it("rejects invalid date format (ISO instead of MM/DD/YYYY)", () => {
    const result = BulkRowSchema.safeParse({
      content: "Hello",
      date: "2026-05-18",
      time: "09:30",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid time format (12h instead of HH:MM 24h)", () => {
    const result = BulkRowSchema.safeParse({
      content: "Hello",
      date: "05/18/2026",
      time: "2:30pm",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty content", () => {
    const result = BulkRowSchema.safeParse({
      content: "",
      date: "05/18/2026",
      time: "09:00",
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CreateDraftSchema
// ---------------------------------------------------------------------------
describe("CreateDraftSchema", () => {
  // Zod v4 validates RFC 4122 strictly: 4th group must start with [89ab]
  const VALID_UUID = "550e8400-e29b-41d4-a716-446655440000";

  const baseValid = {
    content: "Check out our latest post!",
    target_profile_ids: [VALID_UUID],
    mode: "draft" as const,
    approval_required: false,
  };

  it("accepts a minimal valid draft", () => {
    const result = CreateDraftSchema.safeParse(baseValid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.media_urls).toEqual([]);
      expect(result.data.platform_variants).toEqual({});
    }
  });

  it("accepts all four modes", () => {
    for (const mode of ["post_now", "schedule", "recurring", "draft"] as const) {
      const result = CreateDraftSchema.safeParse({ ...baseValid, mode });
      expect(result.success, `mode=${mode}`).toBe(true);
    }
  });

  it("accepts platform_variants with optional fields", () => {
    const result = CreateDraftSchema.safeParse({
      ...baseValid,
      platform_variants: {
        linkedin: { content: "Professional version", link: "https://example.com" },
        x: { content: "Short version" },
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid URL in media_urls", () => {
    const result = CreateDraftSchema.safeParse({
      ...baseValid,
      media_urls: ["not-a-url"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid UUID in target_profile_ids", () => {
    const result = CreateDraftSchema.safeParse({
      ...baseValid,
      target_profile_ids: ["not-a-uuid"],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid approver_user_id UUID", () => {
    const result = CreateDraftSchema.safeParse({
      ...baseValid,
      approval_required: true,
      approver_user_id: VALID_UUID,
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown mode", () => {
    const result = CreateDraftSchema.safeParse({
      ...baseValid,
      mode: "send_immediately",
    });
    expect(result.success).toBe(false);
  });

  it("rejects content exceeding 63206 chars", () => {
    const result = CreateDraftSchema.safeParse({
      ...baseValid,
      content: "x".repeat(63207),
    });
    expect(result.success).toBe(false);
  });

  it("accepts recurrence object for recurring mode", () => {
    const result = CreateDraftSchema.safeParse({
      ...baseValid,
      mode: "recurring",
      recurrence: {
        rule: "FREQ=WEEKLY;BYDAY=MO",
        starting_at: new Date(Date.now() + 86400000).toISOString(),
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts scheduled_at_list for schedule mode", () => {
    const result = CreateDraftSchema.safeParse({
      ...baseValid,
      mode: "schedule",
      scheduled_at_list: [new Date(Date.now() + 86400000).toISOString()],
    });
    expect(result.success).toBe(true);
  });
});
