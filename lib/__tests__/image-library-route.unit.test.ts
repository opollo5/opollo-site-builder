import { beforeEach, describe, expect, it, vi } from "vitest";

// LAYER 1 — Unit. Route handler auth + happy path + validation for
// GET /api/platform/social/media/image-library.

const mockCanDo = vi.hoisted(() => vi.fn());
const mockFrom = vi.hoisted(() => vi.fn());

vi.mock("@/lib/platform/auth/api-gate", () => ({
  requireCanDoForApi: mockCanDo,
}));

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn(() => ({ from: mockFrom })),
}));

vi.mock("server-only", () => ({}));

import { GET } from "@/app/api/platform/social/media/image-library/route";

const COMPANY_A = "a0a0a0a0-1111-4111-a111-111111111111";

// Build a Supabase query chain that resolves with the given result.
function chainResult(result: { data: unknown; error: null | { message: string } }) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
  };
  // limit is the last call in the chain; return a thenable
  chain.limit.mockResolvedValue(result);
  return chain;
}

function req(companyId?: string, before?: string) {
  const u = new URL("http://localhost/api/platform/social/media/image-library");
  if (companyId) u.searchParams.set("company_id", companyId);
  if (before) u.searchParams.set("before", before);
  return new Request(u.toString(), { method: "GET" }) as Parameters<typeof GET>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCanDo.mockResolvedValue({ kind: "allow", userId: "user-1" });
});

describe("GET /api/platform/social/media/image-library", () => {
  it("returns 400 when company_id is missing", async () => {
    const res = await GET(req());
    expect(res.status).toBe(400);
  });

  it("returns 400 when company_id is not a UUID", async () => {
    const res = await GET(req("not-a-uuid"));
    expect(res.status).toBe(400);
  });

  it("delegates 401 from the auth gate", async () => {
    mockCanDo.mockResolvedValue({
      kind: "deny",
      response: new Response("denied", { status: 401 }),
    });
    const res = await GET(req(COMPANY_A));
    expect(res.status).toBe(401);
  });

  it("returns paginated assets with Cloudflare delivery URLs", async () => {
    process.env.CLOUDFLARE_IMAGES_HASH = "test-hash";
    const rows = [
      { id: "img-1", cloudflare_id: "cf-aaa", bytes: 12345, created_at: "2026-05-20T10:00:00Z" },
      { id: "img-2", cloudflare_id: "cf-bbb", bytes: 67890, created_at: "2026-05-19T10:00:00Z" },
    ];
    mockFrom.mockReturnValue(chainResult({ data: rows, error: null }));

    const res = await GET(req(COMPANY_A));
    expect(res.status).toBe(200);

    const json = (await res.json()) as {
      ok: boolean;
      data: { assets: unknown[]; next_cursor: string | null };
    };
    expect(json.ok).toBe(true);
    expect(json.data.assets).toHaveLength(2);

    const first = json.data.assets[0] as {
      id: string;
      source_url: string;
      mime_type: string;
      scope: string;
    };
    expect(first.id).toBe("img-1");
    expect(first.source_url).toBe(
      "https://imagedelivery.net/test-hash/cf-aaa/public",
    );
    expect(first.mime_type).toBe("image/jpeg");
    expect(first.scope).toBe("global");
    expect(json.data.next_cursor).toBeNull();
  });

  it("sets next_cursor when a full page is returned", async () => {
    // Returns 51 rows (PAGE_SIZE + 1), so hasMore = true.
    const rows = Array.from({ length: 51 }, (_, i) => ({
      id: `img-${i}`,
      cloudflare_id: `cf-${i}`,
      bytes: 1000,
      created_at: `2026-05-${String(20 - i).padStart(2, "0")}T10:00:00Z`,
    }));
    mockFrom.mockReturnValue(chainResult({ data: rows, error: null }));

    const res = await GET(req(COMPANY_A));
    const json = (await res.json()) as {
      data: { assets: unknown[]; next_cursor: string };
    };
    expect((json.data.assets as unknown[]).length).toBe(50);
    expect(json.data.next_cursor).not.toBeNull();
  });

  it("handles null cloudflare_id gracefully (source_url = null)", async () => {
    mockFrom.mockReturnValue(
      chainResult({
        data: [{ id: "img-x", cloudflare_id: null, bytes: 0, created_at: "2026-05-01T00:00:00Z" }],
        error: null,
      }),
    );
    const res = await GET(req(COMPANY_A));
    const json = (await res.json()) as { data: { assets: Array<{ source_url: unknown }> } };
    expect(json.data.assets[0].source_url).toBeNull();
  });

  it("returns 500 when Supabase errors", async () => {
    mockFrom.mockReturnValue(chainResult({ data: null, error: { message: "DB down" } }));
    const res = await GET(req(COMPANY_A));
    expect(res.status).toBe(500);
  });
});
