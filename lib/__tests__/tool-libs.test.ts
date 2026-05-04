import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Unit tests for all 6 WP tool executor libs (M15-6 #14).
//
// Each lib follows the same 3-branch pattern:
//   1. Zod validation → VALIDATION_FAILED (or CONFIRMATION_REQUIRED for delete)
//   2. readWpConfig() fails → INTERNAL_ERROR
//   3. WP call fails → error from WP layer propagated
//   4. WP call succeeds → ToolSuccess envelope
//
// All tests mock `@/lib/wordpress` so no network or WP credentials needed.
// ---------------------------------------------------------------------------

const mockReadWpConfig = vi.hoisted(() => vi.fn());
const mockWpCreatePage = vi.hoisted(() => vi.fn());
const mockWpListPages = vi.hoisted(() => vi.fn());
const mockWpGetPage = vi.hoisted(() => vi.fn());
const mockWpUpdatePage = vi.hoisted(() => vi.fn());
const mockWpDeletePage = vi.hoisted(() => vi.fn());
const mockWpPublishPage = vi.hoisted(() => vi.fn());

vi.mock("@/lib/wordpress", () => ({
  readWpConfig: mockReadWpConfig,
  wpCreatePage: mockWpCreatePage,
  wpListPages: mockWpListPages,
  wpGetPage: mockWpGetPage,
  wpUpdatePage: mockWpUpdatePage,
  wpDeletePage: mockWpDeletePage,
  wpPublishPage: mockWpPublishPage,
  runWithWpCredentials: vi.fn().mockImplementation((_: unknown, fn: () => unknown) => fn()),
}));

import { executeCreatePage } from "@/lib/create-page";
import { executeListPages } from "@/lib/list-pages";
import { executeGetPage } from "@/lib/get-page";
import { executeUpdatePage } from "@/lib/update-page";
import { executeDeletePage } from "@/lib/delete-page";
import { executePublishPage } from "@/lib/publish-page";

const WP_CFG = { wp_url: "https://wp.test", wp_user: "admin", wp_app_password: "pass" };

const WP_CONFIG_OK = { ok: true as const, value: WP_CFG };
const WP_CONFIG_FAIL = { ok: false as const, missing: ["WP_URL"] };

const WP_ERROR = {
  ok: false as const,
  code: "WP_API_ERROR" as const,
  message: "WP returned 500",
  details: undefined,
  retryable: true,
  suggested_action: "Retry later.",
};

beforeEach(() => {
  mockReadWpConfig.mockReset().mockReturnValue(WP_CONFIG_OK);
  mockWpCreatePage.mockReset();
  mockWpListPages.mockReset();
  mockWpGetPage.mockReset();
  mockWpUpdatePage.mockReset();
  mockWpDeletePage.mockReset();
  mockWpPublishPage.mockReset();
});

// ---------------------------------------------------------------------------
// executeCreatePage
// ---------------------------------------------------------------------------

describe("executeCreatePage", () => {
  const VALID = {
    title: "Page Title Here",
    slug: "page-title-here",
    content: "x".repeat(200),
    meta_description: "y".repeat(50),
    template_type: "generic" as const,
    ds_version: "1.0.0",
  };

  it("VALIDATION_FAILED — missing required fields", async () => {
    const res = await executeCreatePage({});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("VALIDATION_FAILED");
  });

  it("INTERNAL_ERROR — readWpConfig fails", async () => {
    mockReadWpConfig.mockReturnValue(WP_CONFIG_FAIL);
    const res = await executeCreatePage(VALID);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe("INTERNAL_ERROR");
      expect(res.error.message).toContain("WP_URL");
    }
  });

  it("WP_API_ERROR — wpCreatePage fails", async () => {
    mockWpCreatePage.mockResolvedValue(WP_ERROR);
    const res = await executeCreatePage(VALID);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("WP_API_ERROR");
  });

  it("success — returns ToolSuccess envelope with ds_version", async () => {
    mockWpCreatePage.mockResolvedValue({
      ok: true,
      page_id: 42,
      preview_url: "https://wp.test/?p=42",
      admin_url: "https://wp.test/wp-admin/post.php?post=42",
      slug: "page-title-here",
      status: "draft",
    });
    const res = await executeCreatePage(VALID);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.page_id).toBe(42);
      expect(res.ds_version).toBe("1.0.0");
      expect(res.validation.passed).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// executeListPages
// ---------------------------------------------------------------------------

describe("executeListPages", () => {
  it("success — empty body, returns pages array", async () => {
    mockWpListPages.mockResolvedValue({ ok: true, pages: [] });
    const res = await executeListPages({});
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.pages).toEqual([]);
  });

  it("success — filters status=draft", async () => {
    mockWpListPages.mockResolvedValue({ ok: true, pages: [{ page_id: 1, title: "Draft", slug: "draft", status: "draft", parent_id: null, modified_date: "2026-01-01T00:00:00Z" }] });
    const res = await executeListPages({ status: "draft" });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.pages).toHaveLength(1);
  });

  it("VALIDATION_FAILED — invalid status value", async () => {
    const res = await executeListPages({ status: "invalid-status" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("VALIDATION_FAILED");
  });

  it("INTERNAL_ERROR — readWpConfig fails", async () => {
    mockReadWpConfig.mockReturnValue(WP_CONFIG_FAIL);
    const res = await executeListPages({});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("INTERNAL_ERROR");
  });

  it("WP_API_ERROR — wpListPages fails", async () => {
    mockWpListPages.mockResolvedValue(WP_ERROR);
    const res = await executeListPages({});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("WP_API_ERROR");
  });
});

// ---------------------------------------------------------------------------
// executeGetPage
// ---------------------------------------------------------------------------

describe("executeGetPage", () => {
  it("VALIDATION_FAILED — missing page_id", async () => {
    const res = await executeGetPage({});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("VALIDATION_FAILED");
  });

  it("VALIDATION_FAILED — page_id is 0 (not positive)", async () => {
    const res = await executeGetPage({ page_id: 0 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("VALIDATION_FAILED");
  });

  it("INTERNAL_ERROR — readWpConfig fails", async () => {
    mockReadWpConfig.mockReturnValue(WP_CONFIG_FAIL);
    const res = await executeGetPage({ page_id: 1 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("INTERNAL_ERROR");
  });

  it("WP_API_ERROR — wpGetPage fails", async () => {
    mockWpGetPage.mockResolvedValue(WP_ERROR);
    const res = await executeGetPage({ page_id: 1 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("WP_API_ERROR");
  });

  it("success — returns ToolSuccess envelope", async () => {
    mockWpGetPage.mockResolvedValue({
      ok: true,
      page_id: 1,
      title: "My Page",
      slug: "my-page",
      content: "<p>hello</p>",
      meta_description: "desc",
      status: "draft",
      parent_id: null,
      modified_date: "2026-01-01T00:00:00Z",
    });
    const res = await executeGetPage({ page_id: 1 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.page_id).toBe(1);
      expect(res.validation.passed).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// executeUpdatePage
// ---------------------------------------------------------------------------

describe("executeUpdatePage", () => {
  const VALID = {
    page_id: 11,
    title: "Updated Title",
    change_scope: "minor_edit" as const,
  };

  it("VALIDATION_FAILED — missing change_scope", async () => {
    const res = await executeUpdatePage({ page_id: 11, title: "x" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("VALIDATION_FAILED");
  });

  it("VALIDATION_FAILED — no content fields provided (only page_id + change_scope)", async () => {
    const res = await executeUpdatePage({ page_id: 11, change_scope: "minor_edit" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("VALIDATION_FAILED");
  });

  it("INTERNAL_ERROR — readWpConfig fails", async () => {
    mockReadWpConfig.mockReturnValue(WP_CONFIG_FAIL);
    const res = await executeUpdatePage(VALID);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("INTERNAL_ERROR");
  });

  it("WP_API_ERROR — wpUpdatePage fails", async () => {
    mockWpUpdatePage.mockResolvedValue(WP_ERROR);
    const res = await executeUpdatePage(VALID);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("WP_API_ERROR");
  });

  it("success — returns ToolSuccess envelope", async () => {
    mockWpUpdatePage.mockResolvedValue({
      ok: true,
      page_id: 11,
      status: "draft",
      modified_date: "2026-04-24T00:00:00Z",
    });
    const res = await executeUpdatePage(VALID);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.page_id).toBe(11);
    }
  });
});

// ---------------------------------------------------------------------------
// executeDeletePage
// ---------------------------------------------------------------------------

describe("executeDeletePage", () => {
  it("CONFIRMATION_REQUIRED — user_confirmed missing", async () => {
    const res = await executeDeletePage({ page_id: 99 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("CONFIRMATION_REQUIRED");
  });

  it("CONFIRMATION_REQUIRED — user_confirmed false", async () => {
    const res = await executeDeletePage({ page_id: 99, user_confirmed: false });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("CONFIRMATION_REQUIRED");
  });

  it("INTERNAL_ERROR — readWpConfig fails", async () => {
    mockReadWpConfig.mockReturnValue(WP_CONFIG_FAIL);
    const res = await executeDeletePage({ page_id: 99, user_confirmed: true });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("INTERNAL_ERROR");
  });

  it("WP_API_ERROR — wpDeletePage fails", async () => {
    mockWpDeletePage.mockResolvedValue(WP_ERROR);
    const res = await executeDeletePage({ page_id: 99, user_confirmed: true });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("WP_API_ERROR");
  });

  it("success — returns ToolSuccess with status=trash", async () => {
    mockWpDeletePage.mockResolvedValue({ ok: true, page_id: 99, status: "trash" });
    const res = await executeDeletePage({ page_id: 99, user_confirmed: true });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.status).toBe("trash");
      expect(res.data.page_id).toBe(99);
    }
  });
});

// ---------------------------------------------------------------------------
// executePublishPage
// ---------------------------------------------------------------------------

describe("executePublishPage", () => {
  it("VALIDATION_FAILED — missing page_id", async () => {
    const res = await executePublishPage({});
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("VALIDATION_FAILED");
  });

  it("INTERNAL_ERROR — readWpConfig fails", async () => {
    mockReadWpConfig.mockReturnValue(WP_CONFIG_FAIL);
    const res = await executePublishPage({ page_id: 55 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("INTERNAL_ERROR");
  });

  it("WP_API_ERROR — wpPublishPage fails", async () => {
    mockWpPublishPage.mockResolvedValue(WP_ERROR);
    const res = await executePublishPage({ page_id: 55 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("WP_API_ERROR");
  });

  it("success — returns ToolSuccess with published_url", async () => {
    mockWpPublishPage.mockResolvedValue({
      ok: true,
      page_id: 55,
      status: "publish",
      published_url: "https://wp.test/my-page/",
    });
    const res = await executePublishPage({ page_id: 55 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.status).toBe("publish");
      expect(res.data.published_url).toBe("https://wp.test/my-page/");
    }
  });
});
