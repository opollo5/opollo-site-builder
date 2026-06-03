// tests/regressions/feedback-repo-bridge.test.ts
// P7 acceptance: bugs:push CANNOT write terminal states; valid states write back.
// Layer 1 — unit tests, mocked Supabase and fs. No DB or filesystem required.

import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Front-matter parse helper (imported from the module under test)
// ---------------------------------------------------------------------------
const VALID_UUID = "aaaaaaaa-0000-4000-8000-000000000001";

function makeFrontmatter(status: string, linkedPr: string | null = null): string {
  return `---
ticket_id: ${VALID_UUID}
slug: test-bug-${VALID_UUID.slice(0, 8)}
status: ${status}
severity: high
priority: urgent
company: company-1
assignee: unassigned
route: /test
page_url: https://example.com/test
selector: '[data-testid="submit"]'
click_pct: { x: 50.0, y: 50.0 }
viewport: { w: 1280, h: 900 }
screenshot: null
reported_by: user@test.com
reported_at: 2026-06-03T00:00:00Z
linked_pr_url: ${linkedPr ?? "null"}
---

## Report
Test description.
`;
}

// ---------------------------------------------------------------------------
// The pushBugs function reads fs — we mock node:fs and supabase.
// ---------------------------------------------------------------------------

describe("bugs:push — terminal state rejection guard (§1 governance)", () => {
  const TERMINAL = ["verified", "closed", "wont_fix"];
  const ALLOWED = ["in_progress", "fixed"];

  TERMINAL.forEach((status) => {
    it(`rejects status=${status} and does not call Supabase update`, async () => {
      const { getServiceRoleClient } = await import("@/lib/supabase");
      const updateFn = vi.fn(() => ({ eq: vi.fn(() => ({ error: null })) }));
      vi.mocked(getServiceRoleClient).mockReturnValue({
        from: () => ({ update: updateFn }),
      } as never);

      // Mock the fs module with one file containing the terminal status.
      vi.doMock("node:fs", () => ({
        default: {
          existsSync: vi.fn(() => true),
          readdirSync: vi.fn(() => ["test-bug.md"]),
          readFileSync: vi.fn(() => makeFrontmatter(status)),
          mkdirSync: vi.fn(),
        },
        existsSync: vi.fn(() => true),
        readdirSync: vi.fn(() => ["test-bug.md"]),
        readFileSync: vi.fn(() => makeFrontmatter(status)),
        mkdirSync: vi.fn(),
      }));

      // Re-import to pick up fresh mocks.
      vi.resetModules();
      const { pushBugs } = await import("@/lib/feedback/repo-bridge/push");

      const result = await pushBugs();
      expect(result.rejected).toBe(1);
      expect(result.updated).toBe(0);
      expect(updateFn).not.toHaveBeenCalled();

      vi.doUnmock("node:fs");
    });
  });

  ALLOWED.forEach((status) => {
    it(`allows status=${status} and calls Supabase update`, async () => {
      const { getServiceRoleClient } = await import("@/lib/supabase");
      const eqFn = vi.fn(() => ({ error: null }));
      const updateFn = vi.fn(() => ({ eq: eqFn }));
      vi.mocked(getServiceRoleClient).mockReturnValue({
        from: () => ({ update: updateFn }),
      } as never);

      vi.doMock("node:fs", () => ({
        default: {
          existsSync: vi.fn(() => true),
          readdirSync: vi.fn(() => ["test-bug.md"]),
          readFileSync: vi.fn(() => makeFrontmatter(status, "https://github.com/org/repo/pull/1")),
          mkdirSync: vi.fn(),
        },
        existsSync: vi.fn(() => true),
        readdirSync: vi.fn(() => ["test-bug.md"]),
        readFileSync: vi.fn(() => makeFrontmatter(status, "https://github.com/org/repo/pull/1")),
        mkdirSync: vi.fn(),
      }));

      vi.resetModules();
      const { pushBugs } = await import("@/lib/feedback/repo-bridge/push");

      const result = await pushBugs();
      expect(result.rejected).toBe(0);
      expect(result.updated).toBe(1);
      expect(updateFn).toHaveBeenCalledWith(
        expect.objectContaining({ status, linked_pr_url: "https://github.com/org/repo/pull/1" }),
      );

      vi.doUnmock("node:fs");
    });
  });
});
