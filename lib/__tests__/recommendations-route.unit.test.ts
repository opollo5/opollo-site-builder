import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase", () => ({ getServiceRoleClient: vi.fn() }));
vi.mock("@/lib/platform/auth/api-gate", () => ({
  requireCanDoForApi: vi.fn(),
}));
vi.mock("@/lib/http", () => ({
  validationError: (msg: string) =>
    NextResponse.json({ ok: false, error: { message: msg } }, { status: 400 }),
  notFound: (msg: string) =>
    NextResponse.json({ ok: false, error: { message: msg } }, { status: 404 }),
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), error: vi.fn() } }));

import { GET as listRecs } from "@/app/api/insights/recommendations/route";
import { POST as dismissRec } from "@/app/api/insights/recommendations/[id]/dismiss/route";

const { requireCanDoForApi } = await import("@/lib/platform/auth/api-gate");
const { getServiceRoleClient } = await import("@/lib/supabase");
const mockRequireCanDoForApi = vi.mocked(requireCanDoForApi);
const mockGetServiceRoleClient = vi.mocked(getServiceRoleClient);

const COMPANY_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const REC_ID = "bbbbbbbb-0000-0000-0000-000000000001";

const ALLOW_GATE = { kind: "allow" as const, userId: "user-1", supabase: {} as never };
const DENY_GATE = {
  kind: "deny" as const,
  response: NextResponse.json({ ok: false }, { status: 403 }),
};

function makeSvcChain(overrides: Record<string, unknown> = {}) {
  const chain = {
    from: vi.fn(),
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    eq: vi.fn(),
    gt: vi.fn(),
    in: vi.fn(),
    filter: vi.fn(),
    is: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    single: vi.fn(),
    ...overrides,
  };
  // Wire all methods to return chain (chainable)
  (Object.keys(chain) as (keyof typeof chain)[]).forEach((k) => {
    if (k !== "limit" && k !== "single" && k !== "insert") {
      (chain[k] as ReturnType<typeof vi.fn>).mockReturnValue(chain);
    }
  });
  chain.limit.mockResolvedValue({ data: [], error: null });
  chain.single.mockResolvedValue({ data: null, error: { message: "not found" } });
  chain.insert.mockResolvedValue({ data: null, error: null });
  chain.from.mockReturnValue(chain);
  mockGetServiceRoleClient.mockReturnValue(chain as never);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/insights/recommendations", () => {
  it("returns 400 when company_id missing", async () => {
    const req = new NextRequest("http://localhost/api/insights/recommendations?platform=LINKEDIN");
    const res = await listRecs(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when platform is invalid", async () => {
    const req = new NextRequest(
      `http://localhost/api/insights/recommendations?company_id=${COMPANY_ID}&platform=TWITTER`,
    );
    const res = await listRecs(req);
    expect(res.status).toBe(400);
  });

  it("returns 403 when user cannot view_insights", async () => {
    mockRequireCanDoForApi.mockResolvedValue(DENY_GATE);
    const req = new NextRequest(
      `http://localhost/api/insights/recommendations?company_id=${COMPANY_ID}&platform=LINKEDIN`,
    );
    const res = await listRecs(req);
    expect(res.status).toBe(403);
  });

  it("returns recommendations when authorized", async () => {
    mockRequireCanDoForApi.mockResolvedValue(ALLOW_GATE);
    const chain = makeSvcChain();
    chain.limit.mockResolvedValue({
      data: [
        {
          id: REC_ID,
          recommendation_type: "BEST_LENGTH_BAND",
          headline: "Test",
          body: "Body",
          confidence_band: "strong",
          confidence_score: 0.82,
        },
      ],
      error: null,
    });

    const req = new NextRequest(
      `http://localhost/api/insights/recommendations?company_id=${COMPANY_ID}&platform=LINKEDIN`,
    );
    const res = await listRecs(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.recommendations).toHaveLength(1);
    expect(body.recommendations[0].id).toBe(REC_ID);
  });
});

describe("POST /api/insights/recommendations/[id]/dismiss", () => {
  it("returns 400 when reason is invalid", async () => {
    mockRequireCanDoForApi.mockResolvedValue(ALLOW_GATE);
    makeSvcChain();

    const req = new NextRequest(
      `http://localhost/api/insights/recommendations/${REC_ID}/dismiss?company_id=${COMPANY_ID}`,
      { method: "POST", body: JSON.stringify({ reason: "fake_reason" }) },
    );
    const res = await dismissRec(req, { params: { id: REC_ID } });
    expect(res.status).toBe(400);
  });

  it("returns 404 when rec not found", async () => {
    mockRequireCanDoForApi.mockResolvedValue(ALLOW_GATE);
    makeSvcChain(); // single returns null by default

    const req = new NextRequest(
      `http://localhost/api/insights/recommendations/${REC_ID}/dismiss?company_id=${COMPANY_ID}`,
      { method: "POST", body: JSON.stringify({ reason: "not_relevant" }) },
    );
    const res = await dismissRec(req, { params: { id: REC_ID } });
    expect(res.status).toBe(404);
  });

  it("dismisses single rec when strike count < 3", async () => {
    mockRequireCanDoForApi.mockResolvedValue(ALLOW_GATE);
    const chain = makeSvcChain();
    chain.single.mockResolvedValue({
      data: { id: REC_ID, company_id: COMPANY_ID, recommendation_type: "BEST_LENGTH_BAND" },
      error: null,
    });
    chain.is.mockResolvedValue({ count: 1, error: null });

    const req = new NextRequest(
      `http://localhost/api/insights/recommendations/${REC_ID}/dismiss?company_id=${COMPANY_ID}`,
      { method: "POST", body: JSON.stringify({ reason: "not_relevant" }) },
    );
    const res = await dismissRec(req, { params: { id: REC_ID } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.suppressedAllOfType).toBe(false);
  });

  it("suppresses all of type when strike count reaches 3", async () => {
    mockRequireCanDoForApi.mockResolvedValue(ALLOW_GATE);
    const chain = makeSvcChain();
    chain.single.mockResolvedValue({
      data: { id: REC_ID, company_id: COMPANY_ID, recommendation_type: "BEST_LENGTH_BAND" },
      error: null,
    });
    chain.is.mockResolvedValue({ count: 3, error: null });

    const req = new NextRequest(
      `http://localhost/api/insights/recommendations/${REC_ID}/dismiss?company_id=${COMPANY_ID}`,
      { method: "POST", body: JSON.stringify({ reason: "tried_before", notes: "Been there" }) },
    );
    const res = await dismissRec(req, { params: { id: REC_ID } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.suppressedAllOfType).toBe(true);
  });

  it("returns 403 when user cannot manage_insights", async () => {
    mockRequireCanDoForApi.mockResolvedValue(DENY_GATE);
    const req = new NextRequest(
      `http://localhost/api/insights/recommendations/${REC_ID}/dismiss?company_id=${COMPANY_ID}`,
      { method: "POST", body: JSON.stringify({ reason: "not_relevant" }) },
    );
    const res = await dismissRec(req, { params: { id: REC_ID } });
    expect(res.status).toBe(403);
  });
});
