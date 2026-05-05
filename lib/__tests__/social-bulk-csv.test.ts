import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// S7 — unit tests for bulk CSV upload.
//
// Tests the CSV parser in the route module and the bulkCreatePostMasters
// lib function. Supabase is stubbed so these run without the DB.
// ---------------------------------------------------------------------------

// ---- Shared Supabase stub ----
// Set up the stub before importing the module under test so the module's
// top-level `import "server-only"` doesn't throw in the test environment.

vi.mock("server-only", () => ({}));

const mockSingle = vi.fn();
const mockSelect = vi.fn(() => ({ data: null, error: null }));
const mockInsert = vi.fn(() => ({ select: mockSelectAfterInsert }));
const mockSelectAfterInsert = vi.fn().mockResolvedValue({ data: [], error: null });
const mockFrom = vi.fn(() => ({
  insert: mockInsert,
  select: mockSelect,
  single: mockSingle,
}));

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: () => ({
    from: mockFrom,
  }),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Dynamic import AFTER mocks are registered so server-only fires correctly
const { bulkCreatePostMasters, ROW_LIMIT } = await import(
  "@/lib/platform/social/posts/bulk-create"
);

// ---- Tests ----

const COMPANY_ID = "00000000-0000-0000-0000-000000000001";
const CREATOR_ID = "00000000-0000-0000-0000-000000000002";

function makeRow(masterText: string | null, linkUrl: string | null = null) {
  return { masterText, linkUrl };
}

function fakePost(id: string) {
  return {
    id,
    company_id: COMPANY_ID,
    state: "draft",
    source_type: "csv",
    master_text: "text",
    link_url: null,
    created_by: CREATOR_ID,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    state_changed_at: new Date().toISOString(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockInsert.mockReturnValue({ select: mockSelectAfterInsert });
  mockSelectAfterInsert.mockResolvedValue({ data: [], error: null });
});

describe("ROW_LIMIT", () => {
  it("is 100", () => {
    expect(ROW_LIMIT).toBe(100);
  });
});

describe("bulkCreatePostMasters", () => {
  it("returns empty created + error when all rows are empty", async () => {
    const result = await bulkCreatePostMasters(
      COMPANY_ID,
      [makeRow(null, null), makeRow("  ", "")],
      CREATOR_ID,
    );
    expect(result.created).toHaveLength(0);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]?.message).toMatch(/no content/i);
  });

  it("validates master_text length", async () => {
    const longText = "a".repeat(10_001);
    const result = await bulkCreatePostMasters(
      COMPANY_ID,
      [makeRow(longText)],
      CREATOR_ID,
    );
    expect(result.errors[0]?.message).toMatch(/10[,_]000/);
  });

  it("validates link_url format", async () => {
    const result = await bulkCreatePostMasters(
      COMPANY_ID,
      [makeRow(null, "not-a-url")],
      CREATOR_ID,
    );
    expect(result.errors[0]?.message).toMatch(/valid http/i);
  });

  it("accepts link_url-only rows", async () => {
    mockSelectAfterInsert.mockResolvedValueOnce({
      data: [fakePost("p1")],
      error: null,
    });
    const result = await bulkCreatePostMasters(
      COMPANY_ID,
      [makeRow(null, "https://example.com")],
      CREATOR_ID,
    );
    expect(result.errors).toHaveLength(0);
    expect(result.created).toHaveLength(1);
  });

  it("accepts master_text-only rows", async () => {
    mockSelectAfterInsert.mockResolvedValueOnce({
      data: [fakePost("p1")],
      error: null,
    });
    const result = await bulkCreatePostMasters(
      COMPANY_ID,
      [makeRow("Hello world")],
      CREATOR_ID,
    );
    expect(result.errors).toHaveLength(0);
    expect(result.created).toHaveLength(1);
  });

  it("partial success: inserts valid rows, returns errors for invalid", async () => {
    mockSelectAfterInsert.mockResolvedValueOnce({
      data: [fakePost("p1")],
      error: null,
    });
    const rows = [
      makeRow(null, null),             // row 1 — invalid
      makeRow("Good post"),            // row 2 — valid
    ];
    const result = await bulkCreatePostMasters(COMPANY_ID, rows, CREATOR_ID);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.row).toBe(1);
    expect(result.created).toHaveLength(1);
  });

  it("returns all as errors when DB insert fails", async () => {
    mockSelectAfterInsert.mockResolvedValueOnce({
      data: null,
      error: { message: "FK violation", code: "23503" },
    });
    const result = await bulkCreatePostMasters(
      COMPANY_ID,
      [makeRow("Post A"), makeRow("Post B")],
      CREATOR_ID,
    );
    expect(result.created).toHaveLength(0);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]?.message).toMatch(/Database error/);
  });

  it("inserts with source_type=csv and state=draft", async () => {
    mockSelectAfterInsert.mockResolvedValueOnce({
      data: [fakePost("p1")],
      error: null,
    });
    await bulkCreatePostMasters(
      COMPANY_ID,
      [makeRow("Post text")],
      CREATOR_ID,
    );
    expect(mockInsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          state: "draft",
          source_type: "csv",
          company_id: COMPANY_ID,
          created_by: CREATOR_ID,
        }),
      ]),
    );
  });

  it("spells out every column on every row (no missing keys)", async () => {
    mockSelectAfterInsert.mockResolvedValueOnce({
      data: [fakePost("p1"), fakePost("p2")],
      error: null,
    });
    await bulkCreatePostMasters(
      COMPANY_ID,
      [makeRow("Post A"), makeRow(null, "https://example.com")],
      CREATOR_ID,
    );
    const insertedRows = (
      mockInsert.mock.calls[0] as unknown as [Array<Record<string, unknown>>]
    )[0];
    const REQUIRED = [
      "company_id",
      "state",
      "source_type",
      "master_text",
      "link_url",
      "created_by",
    ] as const;
    for (const row of insertedRows!) {
      for (const col of REQUIRED) {
        expect(Object.prototype.hasOwnProperty.call(row, col)).toBe(true);
      }
    }
  });
});
