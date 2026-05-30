import { describe, it, expect, vi, beforeEach } from "vitest";
import ExcelJS from "exceljs";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { mockGate } = vi.hoisted(() => ({ mockGate: vi.fn() }));
vi.mock("@/lib/platform/auth/api-gate", () => ({
  requireCanDoForApi: mockGate,
}));

const { mockRateLimit } = vi.hoisted(() => ({ mockRateLimit: vi.fn() }));
vi.mock("@/lib/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit");
  return {
    ...actual,
    checkRateLimit: mockRateLimit,
  };
});

const { mockInterpret } = vi.hoisted(() => ({ mockInterpret: vi.fn() }));
vi.mock("@/lib/ingestion/interpret", () => ({
  interpretPosts: mockInterpret,
}));

const { mockDispatch } = vi.hoisted(() => ({ mockDispatch: vi.fn() }));
vi.mock("@/lib/image/dispatch", () => ({
  dispatchImageBatch: mockDispatch,
}));

// docx-parse depends on mammoth dynamic import; mock to keep tests
// deterministic + decoupled from real docx parsing.
const { mockParseDocx } = vi.hoisted(() => ({ mockParseDocx: vi.fn() }));
vi.mock("@/lib/ingestion/docx-parse", () => ({
  parseDocxBuffer: mockParseDocx,
}));

import { POST } from "@/app/api/platform/image/ingest/route";
import { fanOutJobs } from "@/lib/image/fan-out";
import type { InterpretedPost } from "@/lib/ingestion/interpret";
import type { NextRequest } from "next/server";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const COMPANY_UUID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER_UUID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const BATCH_UUID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

async function buildXlsxBuffer(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Posts");
  // Row 1/2 = preamble (title/description), row 3 = headers, row 4+ = data
  // (matches the canonical template format read by the parser)
  ws.addRow(["Mass Image Generation"]); // row 1: title
  ws.addRow(["Instructions"]);           // row 2: description
  ws.addRow(["post_topic", "headline_text", "body_text", "target_platforms"]); // row 3: headers
  ws.addRow(["Topic 1", "Head 1", "Body 1", "linkedin, instagram"]); // row 4
  ws.addRow(["Topic 2", "Head 2", "Body 2", "x"]);                   // row 5
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

function makeRequest(opts: {
  url?: string;
  companyId: string;
  fileName: string;
  fileMime?: string;
  fileBytes: Buffer | Uint8Array;
}): NextRequest {
  const form = new FormData();
  form.append("company_id", opts.companyId);
  form.append(
    "file",
    new File([new Uint8Array(opts.fileBytes)], opts.fileName, opts.fileMime ? { type: opts.fileMime } : undefined),
  );
  return new Request(opts.url ?? "http://localhost/api/platform/image/ingest", {
    method: "POST",
    body: form,
  }) as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGate.mockResolvedValue({ kind: "allow", userId: USER_UUID });
  mockRateLimit.mockResolvedValue({ ok: true, limit: 5, remaining: 4, reset: 0 });
  mockInterpret.mockResolvedValue({
    ok: true,
    posts: [
      {
        sourceRow: 2,
        post_text: "Body 1",
        image_brief: {
          style_id: "clean_corporate",
          composition_type: "split_layout",
          primary_colour: "#1A56DB",
          headline_text: "Head 1",
          aspect_ratios: ["1x1", "4x5"],
          target_platforms: ["linkedin", "instagram"],
        },
      },
      {
        sourceRow: 3,
        post_text: "Body 2",
        image_brief: {
          style_id: "bold_promo",
          composition_type: "full_background",
          primary_colour: "#1A56DB",
          headline_text: "Head 2",
          aspect_ratios: ["16x9"],
          target_platforms: ["x"],
        },
      },
    ] satisfies InterpretedPost[],
  });
  mockDispatch.mockResolvedValue({
    ok: true,
    batchId: BATCH_UUID,
    totalJobs: 3,
    mode: "generate",
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/platform/image/ingest — validation", () => {
  it("rejects non-multipart body", async () => {
    const req = new Request("http://localhost/api/platform/image/ingest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }) as unknown as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects missing company_id", async () => {
    const form = new FormData();
    form.append("file", new File([new Uint8Array([1, 2, 3])], "x.xlsx"));
    const req = new Request("http://localhost/api/platform/image/ingest", {
      method: "POST",
      body: form,
    }) as unknown as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects missing file", async () => {
    const form = new FormData();
    form.append("company_id", COMPANY_UUID);
    const req = new Request("http://localhost/api/platform/image/ingest", {
      method: "POST",
      body: form,
    }) as unknown as NextRequest;
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects unknown file extension", async () => {
    const req = makeRequest({
      companyId: COMPANY_UUID,
      fileName: "something.txt",
      fileBytes: Buffer.from("hello"),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects oversized files (> 5 MB)", async () => {
    const req = makeRequest({
      companyId: COMPANY_UUID,
      fileName: "big.xlsx",
      fileBytes: Buffer.alloc(5 * 1024 * 1024 + 1),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(JSON.stringify(body)).toMatch(/too large/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Happy paths
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/platform/image/ingest — happy paths", () => {
  it("routes .xlsx to xlsx parser, calls interpret, dispatches batch", async () => {
    const xlsxBuf = await buildXlsxBuffer();
    const req = makeRequest({
      companyId: COMPANY_UUID,
      fileName: "posts.xlsx",
      fileBytes: xlsxBuf,
    });
    const res = await POST(req);
    expect(res.status).toBe(201);

    const json = (await res.json()) as {
      ok: boolean;
      data: { batchId: string; totalJobs: number; postCount: number; mode: string };
    };
    expect(json.ok).toBe(true);
    expect(json.data.batchId).toBe(BATCH_UUID);
    expect(json.data.postCount).toBe(2);
    expect(json.data.mode).toBe("generate");

    expect(mockInterpret).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: COMPANY_UUID }),
    );
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: COMPANY_UUID,
        triggeredBy: USER_UUID,
        mode: "generate",
        sourceFilename: "posts.xlsx",
        sourceRowCount: 2,
      }),
    );

    // Fan-out: post 1 → 2 ratios (1x1, 4x5); post 2 → 1 ratio (16x9). Total 3 jobs.
    const dispatchCall = mockDispatch.mock.calls[0][0];
    expect(dispatchCall.jobs).toHaveLength(3);
  });

  it("?mode=preview routes preview to dispatch", async () => {
    mockDispatch.mockResolvedValue({
      ok: true,
      batchId: BATCH_UUID,
      totalJobs: 3,
      mode: "preview",
    });
    const xlsxBuf = await buildXlsxBuffer();
    const req = makeRequest({
      url: "http://localhost/api/platform/image/ingest?mode=preview",
      companyId: COMPANY_UUID,
      fileName: "posts.xlsx",
      fileBytes: xlsxBuf,
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "preview" }),
    );
  });

  it("routes .docx to docx parser", async () => {
    mockParseDocx.mockResolvedValue({
      ok: true,
      posts: [
        {
          sourceRow: 1,
          post_topic: "Topic 1",
          headline_text: "Head",
          body_text: "Body",
          target_platforms: ["linkedin"],
        },
      ],
      warnings: [],
    });
    mockInterpret.mockResolvedValue({
      ok: true,
      posts: [
        {
          sourceRow: 1,
          post_text: "Body",
          image_brief: {
            style_id: "clean_corporate",
            composition_type: "split_layout",
            primary_colour: "#1A56DB",
            headline_text: "Head",
            aspect_ratios: ["1x1"],
            target_platforms: ["linkedin"],
          },
        },
      ],
    });
    mockDispatch.mockResolvedValue({
      ok: true,
      batchId: BATCH_UUID,
      totalJobs: 1,
      mode: "generate",
    });

    const req = makeRequest({
      companyId: COMPANY_UUID,
      fileName: "posts.docx",
      fileBytes: Buffer.from("synthetic-docx-bytes"),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(mockParseDocx).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Failure cascades
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/platform/image/ingest — failure cascades", () => {
  it("returns 422 PARSE_FAILED when the file is malformed", async () => {
    const req = makeRequest({
      companyId: COMPANY_UUID,
      fileName: "broken.xlsx",
      fileBytes: Buffer.from("not real xlsx bytes"),
    });
    const res = await POST(req);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("PARSE_FAILED");
    expect(mockInterpret).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("returns 422 INTERPRET_FAILED when AI rejects", async () => {
    mockInterpret.mockResolvedValue({
      ok: false,
      error: "AI bad",
      details: { sourceRow: 2 },
    });
    const req = makeRequest({
      companyId: COMPANY_UUID,
      fileName: "posts.xlsx",
      fileBytes: await buildXlsxBuffer(),
    });
    const res = await POST(req);
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INTERPRET_FAILED");
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("returns 402 BUDGET_EXCEEDED when dispatch rejects on budget", async () => {
    mockDispatch.mockResolvedValue({
      ok: false,
      code: "BUDGET_EXCEEDED",
      message: "Over budget",
      details: { projected_cents: 600, remaining_cents: 0 },
    });
    const req = makeRequest({
      companyId: COMPANY_UUID,
      fileName: "posts.xlsx",
      fileBytes: await buildXlsxBuffer(),
    });
    const res = await POST(req);
    expect(res.status).toBe(402);
    const body = (await res.json()) as { error: { code: string; projected_cents: number } };
    expect(body.error.code).toBe("BUDGET_EXCEEDED");
    expect(body.error.projected_cents).toBe(600);
  });

  it("rejects 401/403 verbatim from auth gate", async () => {
    mockGate.mockResolvedValue({
      kind: "deny",
      response: new Response(JSON.stringify({ ok: false }), { status: 403 }),
    });
    const req = makeRequest({
      companyId: COMPANY_UUID,
      fileName: "posts.xlsx",
      fileBytes: await buildXlsxBuffer(),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
    expect(mockInterpret).not.toHaveBeenCalled();
  });

  it("returns 429 when rate-limited", async () => {
    mockRateLimit.mockResolvedValue({
      ok: false,
      limit: 5,
      remaining: 0,
      reset: Math.floor(Date.now() / 1000) + 60,
      retryAfter: 60,
    });
    const req = makeRequest({
      companyId: COMPANY_UUID,
      fileName: "posts.xlsx",
      fileBytes: await buildXlsxBuffer(),
    });
    const res = await POST(req);
    expect(res.status).toBe(429);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fanOutJobs unit
// ─────────────────────────────────────────────────────────────────────────────

describe("fanOutJobs", () => {
  const POST_A: InterpretedPost = {
    sourceRow: 2,
    post_text: "A",
    image_brief: {
      style_id: "clean_corporate",
      composition_type: "split_layout",
      primary_colour: "#1A56DB",
      headline_text: "Head A",
      aspect_ratios: ["1x1", "4x5"],
      target_platforms: ["linkedin", "instagram"],
    },
  };

  const POST_B: InterpretedPost = {
    sourceRow: 3,
    post_text: "B",
    image_brief: {
      style_id: "bold_promo",
      composition_type: "geometric",
      primary_colour: "#FF03A5",
      headline_text: "Head B",
      aspect_ratios: ["1x1"],
      target_platforms: ["linkedin", "facebook"],
    },
  };

  it("creates one job per distinct ratio per post; tags parentPostIndex", () => {
    const jobs = fanOutJobs([POST_A, POST_B]);
    expect(jobs).toHaveLength(3); // 1x1+4x5 from A, 1x1 from B (linkedin+facebook → same ratio)

    expect(jobs[0]).toEqual(
      expect.objectContaining({
        styleId: "clean_corporate",
        aspectRatio: "1x1",
        parentPostIndex: 0,
        targetPlatforms: ["linkedin"],
      }),
    );
    expect(jobs[1]).toEqual(
      expect.objectContaining({
        aspectRatio: "4x5",
        parentPostIndex: 0,
        targetPlatforms: ["instagram"],
      }),
    );
    expect(jobs[2]).toEqual(
      expect.objectContaining({
        styleId: "bold_promo",
        aspectRatio: "1x1",
        parentPostIndex: 1,
        targetPlatforms: ["linkedin", "facebook"],
      }),
    );
  });

  it("threads publish_date through the lookup map", () => {
    const lookup = new Map<number, string>([
      [2, "2026-06-15"],
      // POST_B has no publish_date
    ]);
    const jobs = fanOutJobs([POST_A, POST_B], lookup);
    expect(jobs[0].targetPublishDate).toBe("2026-06-15");
    expect(jobs[1].targetPublishDate).toBe("2026-06-15");
    expect(jobs[2].targetPublishDate).toBeUndefined();
  });
});
