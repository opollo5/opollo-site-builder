import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// PR-07 — unit tests for POST /api/platform/social/posts writing to V2.
//
// Verifies that the POST handler inserts into social_post_drafts (not
// social_post_master) and maps connection_ids → target_profiles correctly.
// All Supabase + auth calls are mocked — no real credentials needed.
// ---------------------------------------------------------------------------

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn(() => ({ from: mockFrom })),
}));

const { mockRequireCanDo } = vi.hoisted(() => ({ mockRequireCanDo: vi.fn() }));
vi.mock("@/lib/platform/auth/api-gate", () => ({
  requireCanDoForApi: mockRequireCanDo,
}));

const { mockListConnections } = vi.hoisted(() => ({ mockListConnections: vi.fn() }));
vi.mock("@/lib/platform/social/connections", () => ({
  listConnections: mockListConnections,
}));

import { POST } from "@/app/api/platform/social/posts/route";

// RFC 4122 v4-compatible UUIDs (Zod v4 validates version/variant bits).
const COMPANY_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const USER_ID    = "bbbbbbbb-0000-4000-8000-000000000002";
const DRAFT_ID   = "cccccccc-0000-4000-8000-000000000003";
const CONN_ID_1  = "dddddddd-0000-4000-8000-000000000004";
const CONN_ID_2  = "eeeeeeee-0000-4000-8000-000000000005";

function fakeDraft(overrides?: Partial<Record<string, unknown>>) {
  return {
    id:         DRAFT_ID,
    company_id: COMPANY_ID,
    state:      "draft",
    source_type: "manual",
    content:    "Hello world",
    link_url:   null,
    created_by: USER_ID,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeInsertChain(result: { data: unknown; error: unknown }) {
  const mockSingle = vi.fn().mockResolvedValue(result);
  const mockSelect = vi.fn(() => ({ single: mockSingle }));
  const mockInsert = vi.fn(() => ({ select: mockSelect }));
  return { mockInsert, mockSelect, mockSingle };
}

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/platform/social/posts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireCanDo.mockResolvedValue({ kind: "allow", userId: USER_ID });
  mockListConnections.mockResolvedValue({ ok: true, data: { connections: [] } });
});

describe("POST /api/platform/social/posts — V2 migration (PR-07)", () => {
  it("inserts into social_post_drafts and returns 201", async () => {
    const { mockInsert } = makeInsertChain({ data: fakeDraft(), error: null });
    mockFrom.mockReturnValue({ insert: mockInsert });

    const res = await POST(makeRequest({ company_id: COMPANY_ID, master_text: "Hello world" }) as never);

    expect(res.status).toBe(201);
    const json = await res.json() as { ok: boolean; data: { post: { state: string } } };
    expect(json.ok).toBe(true);
    expect(json.data.post.state).toBe("draft");

    // Must target social_post_drafts, NOT social_post_master.
    expect(mockFrom).toHaveBeenCalledWith("social_post_drafts");
  });

  it("inserts with all required V2 columns spelled out", async () => {
    const { mockInsert } = makeInsertChain({ data: fakeDraft(), error: null });
    mockFrom.mockReturnValue({ insert: mockInsert });

    await POST(makeRequest({ company_id: COMPANY_ID, master_text: "Post text" }) as never);

    const insertArg = (mockInsert.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    const REQUIRED = [
      "company_id", "state", "source_type", "content", "link_url",
      "created_by", "updated_by", "media_urls", "target_profiles", "platform_variants",
    ] as const;
    for (const col of REQUIRED) {
      expect(Object.prototype.hasOwnProperty.call(insertArg, col), `missing column: ${col}`).toBe(true);
    }
    expect(insertArg.state).toBe("draft");
    expect(insertArg.source_type).toBe("manual");
    expect(insertArg.company_id).toBe(COMPANY_ID);
    expect(insertArg.created_by).toBe(USER_ID);
    expect(insertArg.updated_by).toBe(USER_ID);
  });

  it("returns 400 when both master_text and link_url are absent", async () => {
    const res = await POST(makeRequest({ company_id: COMPANY_ID }) as never);
    expect(res.status).toBe(400);
    const json = await res.json() as { ok: boolean };
    expect(json.ok).toBe(false);
  });

  it("returns 400 when body is invalid JSON shape", async () => {
    const res = await POST(makeRequest({ company_id: "not-a-uuid", master_text: "x" }) as never);
    expect(res.status).toBe(400);
  });

  it("maps connection_ids to target_profiles (only company-owned)", async () => {
    mockListConnections.mockResolvedValue({
      ok: true,
      data: {
        connections: [
          { id: CONN_ID_1, platform: "linkedin_company" },
          { id: CONN_ID_2, platform: "x" },
        ],
      },
    });
    const { mockInsert } = makeInsertChain({ data: fakeDraft(), error: null });
    mockFrom.mockReturnValue({ insert: mockInsert });

    const UNKNOWN_ID = "ffffffff-0000-4000-8000-000000000099";
    await POST(makeRequest({
      company_id: COMPANY_ID,
      master_text: "Post text",
      connection_ids: [CONN_ID_1, UNKNOWN_ID],
    }) as never);

    const insertArg = (mockInsert.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(insertArg.target_profiles).toEqual([{ profile_id: CONN_ID_1 }]);
  });

  it("returns 500 when DB insert fails", async () => {
    const { mockInsert } = makeInsertChain({
      data: null,
      error: { message: "connection refused", code: "PGRST000" },
    });
    mockFrom.mockReturnValue({ insert: mockInsert });

    const res = await POST(makeRequest({ company_id: COMPANY_ID, master_text: "Post" }) as never);
    expect(res.status).toBe(500);
  });

  it("accepts link_url-only posts", async () => {
    const { mockInsert } = makeInsertChain({
      data: fakeDraft({ content: null, link_url: "https://example.com" }),
      error: null,
    });
    mockFrom.mockReturnValue({ insert: mockInsert });

    const res = await POST(makeRequest({
      company_id: COMPANY_ID,
      link_url: "https://example.com",
    }) as never);

    expect(res.status).toBe(201);
    const insertArg = (mockInsert.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(insertArg.content).toBeNull();
    expect(insertArg.link_url).toBe("https://example.com");
  });

  it("forwards source_type from request body", async () => {
    const { mockInsert } = makeInsertChain({
      data: fakeDraft({ source_type: "csv" }),
      error: null,
    });
    mockFrom.mockReturnValue({ insert: mockInsert });

    await POST(makeRequest({ company_id: COMPANY_ID, master_text: "x", source_type: "csv" }) as never);

    const insertArg = (mockInsert.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(insertArg.source_type).toBe("csv");
  });
});
