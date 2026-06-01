/**
 * Unit tests for GET /api/platform/image/batch/[id]/download (Stream B Phase 3).
 *
 * Tests cover:
 *  - Company-scope guard: batch company_id must match query company_id
 *  - 404 when batch not found
 *  - 404 when batch belongs to a different company
 *  - 422 when batch has no completed jobs
 *  - 413 when completed job count exceeds hard cap (500)
 *  - 200 streaming response with correct headers
 *  - ZIP content: correct entry names for base and variant jobs
 *  - Per-image failure: skipped entry + manifest.txt included
 *  - Soft-warning header when >100 images
 *
 * The streaming ZIP body is collected in tests using Response.arrayBuffer()
 * and unzipped with fflate.unzip to assert entry names.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { unzipSync } from "fflate";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ─── Auth gate ────────────────────────────────────────────────────────────────
const mockGate = vi.fn();
vi.mock("@/lib/platform/auth/api-gate", () => ({
  requireCanDoForApi: (...args: unknown[]) => mockGate(...args),
}));

// ─── Supabase ─────────────────────────────────────────────────────────────────
// Build an infinitely-chainable mock (same approach as fork test).
function makeChain(leaf: Record<string, unknown>) {
  const proxy: Record<string, unknown> = {};
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop: string) {
      if (prop === "then") return undefined;
      if (prop in leaf) return leaf[prop];
      return vi.fn().mockReturnValue(new Proxy({}, handler));
    },
  };
  return new Proxy(proxy, handler);
}

const mockSvc = {
  from: vi.fn(),
  storage: {
    from: vi.fn(),
  },
};

vi.mock("@/lib/supabase", () => ({
  getServiceRoleClient: vi.fn(() => mockSvc),
}));

// ─── Constants ────────────────────────────────────────────────────────────────

const COMPANY_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_UUID   = "99999999-9999-4999-8999-999999999999";
const BATCH_UUID   = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const JOB_UUID_1   = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const JOB_UUID_2   = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const TINY_PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108020000009001" +
  "2e000000" + "0c4944415408d76360f8cfc00000000200013400129f00000000049454e44ae426082",
  "hex",
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest(batchId: string, companyId: string): NextRequest {
  return new NextRequest(
    `http://localhost/api/platform/image/batch/${batchId}/download?company_id=${companyId}`,
  );
}

type QueryChain = {
  select: () => QueryChain;
  eq: () => QueryChain;
  not: () => QueryChain;
  order: () => QueryChain;
  single: () => Promise<{ data: unknown; error: null | { code?: string; message?: string } }>;
};

/** Wire up mockSvc.from() to return given data for sequential calls. */
function setupDb({
  batch,
  jobs,
  batchError,
}: {
  batch?: Record<string, unknown> | null;
  jobs?: Record<string, unknown>[];
  batchError?: { code?: string; message?: string } | null;
}): void {
  let callCount = 0;
  mockSvc.from.mockImplementation(() => {
    callCount++;
    if (callCount === 1) {
      // First call: batch fetch
      const q: QueryChain = {
        select: () => q,
        eq: () => q,
        not: () => q,
        order: () => q,
        single: async () => ({ data: batch ?? null, error: batchError ?? null }),
      };
      return q;
    }
    // Second call: jobs fetch
    const q: QueryChain = {
      select: () => q,
      eq: () => q,
      not: () => q,
      order: () => q,
      single: async () => ({ data: null, error: null }),
    };
    // Return jobs array for the jobs query
    return {
      select: () => ({
        eq: () => ({
          eq: () => ({
            not: () => ({
              order: () => ({
                order: () => ({ data: jobs ?? [], error: null }),
              }),
            }),
          }),
        }),
      }),
    };
  });
}

function setupSignedUrls(urlMap: Record<string, string>): void {
  mockSvc.storage.from.mockReturnValue({
    createSignedUrls: async (paths: string[]) => ({
      data: paths.map((p) => ({ path: p, signedUrl: urlMap[p] ?? null })),
      error: null,
    }),
  });
}

// ─── Import handler after mocks ───────────────────────────────────────────────

import { GET } from "@/app/api/platform/image/batch/[id]/download/route";

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("batch download route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGate.mockResolvedValue({ kind: "allow", userId: "user-1" });
  });

  it("returns 404 when batch is not found", async () => {
    setupDb({ batch: null, batchError: { code: "PGRST116" } });
    const res = await GET(makeRequest(BATCH_UUID, COMPANY_UUID), { params: Promise.resolve({ id: BATCH_UUID }) });
    expect(res.status).toBe(404);
  });

  it("returns 404 when batch belongs to a different company", async () => {
    setupDb({ batch: { id: BATCH_UUID, company_id: OTHER_UUID, state: "completed", total_jobs: 1 } });
    const res = await GET(makeRequest(BATCH_UUID, COMPANY_UUID), { params: Promise.resolve({ id: BATCH_UUID }) });
    // company_id mismatch → notFound
    expect(res.status).toBe(404);
  });

  it("returns 422 when batch has no completed jobs", async () => {
    setupDb({
      batch: { id: BATCH_UUID, company_id: COMPANY_UUID, state: "running", total_jobs: 2 },
      jobs: [],
    });
    const res = await GET(makeRequest(BATCH_UUID, COMPANY_UUID), { params: Promise.resolve({ id: BATCH_UUID }) });
    expect(res.status).toBe(422);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("NO_COMPLETED_IMAGES");
  });

  it("returns 413 when completed job count exceeds hard cap", async () => {
    const manyJobs = Array.from({ length: 501 }, (_, i) => ({
      id: `job-${i}`,
      result_storage_path: `path/${i}.png`,
      parent_post_index: i,
      generation_params: null,
    }));
    setupDb({
      batch: { id: BATCH_UUID, company_id: COMPANY_UUID, state: "completed", total_jobs: 501 },
      jobs: manyJobs,
    });
    const res = await GET(makeRequest(BATCH_UUID, COMPANY_UUID), { params: Promise.resolve({ id: BATCH_UUID }) });
    expect(res.status).toBe(413);
  });

  it("returns 200 streaming response with correct content-type header", async () => {
    setupDb({
      batch: { id: BATCH_UUID, company_id: COMPANY_UUID, state: "completed", total_jobs: 1 },
      jobs: [{ id: JOB_UUID_1, result_storage_path: "c1/img.png", parent_post_index: 0, generation_params: null }],
    });
    setupSignedUrls({ "c1/img.png": "https://storage.example.com/c1/img.png" });

    // Mock fetch for the signed URL image download
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => TINY_PNG.buffer,
    });

    const res = await GET(makeRequest(BATCH_UUID, COMPANY_UUID), { params: Promise.resolve({ id: BATCH_UUID }) });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/zip");
    expect(res.headers.get("Content-Disposition")).toContain(".zip");
  });

  it("ZIP contains correct entry name for base variant job", async () => {
    setupDb({
      batch: { id: BATCH_UUID, company_id: COMPANY_UUID, state: "completed", total_jobs: 1 },
      jobs: [{ id: JOB_UUID_1, result_storage_path: "c1/img.png", parent_post_index: 2, generation_params: { jobType: "template" } }],
    });
    setupSignedUrls({ "c1/img.png": "https://storage.example.com/c1/img.png" });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => TINY_PNG.buffer });

    const res = await GET(makeRequest(BATCH_UUID, COMPANY_UUID), { params: Promise.resolve({ id: BATCH_UUID }) });
    const buf = Buffer.from(await res.arrayBuffer());
    const entries = unzipSync(buf);

    const expectedName = `row-2/base-${JOB_UUID_1.slice(0, 8)}.png`;
    expect(Object.keys(entries)).toContain(expectedName);
  });

  it("ZIP contains correct entry name for named variant job", async () => {
    setupDb({
      batch: { id: BATCH_UUID, company_id: COMPANY_UUID, state: "completed", total_jobs: 1 },
      jobs: [{
        id: JOB_UUID_1,
        result_storage_path: "c1/img.png",
        parent_post_index: 0,
        generation_params: { jobType: "template", variantKey: "landscape" },
      }],
    });
    setupSignedUrls({ "c1/img.png": "https://storage.example.com/c1/img.png" });
    global.fetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => TINY_PNG.buffer });

    const res = await GET(makeRequest(BATCH_UUID, COMPANY_UUID), { params: Promise.resolve({ id: BATCH_UUID }) });
    const buf = Buffer.from(await res.arrayBuffer());
    const entries = unzipSync(buf);

    const expectedName = `row-0/landscape-${JOB_UUID_1.slice(0, 8)}.png`;
    expect(Object.keys(entries)).toContain(expectedName);
  });

  it("skips failed image fetch and includes manifest.txt", async () => {
    setupDb({
      batch: { id: BATCH_UUID, company_id: COMPANY_UUID, state: "completed", total_jobs: 2 },
      jobs: [
        { id: JOB_UUID_1, result_storage_path: "c1/img1.png", parent_post_index: 0, generation_params: null },
        { id: JOB_UUID_2, result_storage_path: "c1/img2.png", parent_post_index: 1, generation_params: null },
      ],
    });
    setupSignedUrls({
      "c1/img1.png": "https://storage.example.com/c1/img1.png",
      "c1/img2.png": "https://storage.example.com/c1/img2.png",
    });

    // First image succeeds; second returns 404
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => TINY_PNG.buffer })
      .mockResolvedValueOnce({ ok: false, status: 404 });

    const res = await GET(makeRequest(BATCH_UUID, COMPANY_UUID), { params: Promise.resolve({ id: BATCH_UUID }) });
    const buf = Buffer.from(await res.arrayBuffer());
    const entries = unzipSync(buf);
    const entryNames = Object.keys(entries);

    // Successful image present
    expect(entryNames).toContain(`row-0/base-${JOB_UUID_1.slice(0, 8)}.png`);
    // Failed image absent
    expect(entryNames).not.toContain(`row-1/base-${JOB_UUID_2.slice(0, 8)}.png`);
    // Manifest present
    expect(entryNames).toContain("manifest.txt");

    const manifest = Buffer.from(entries["manifest.txt"]!).toString("utf-8");
    expect(manifest).toContain("SKIPPED");
    expect(manifest).toContain(`row-1/base-${JOB_UUID_2.slice(0, 8)}.png`);
    expect(manifest).toContain("http_404");
  });

  it("includes X-Download-Warning header when jobs exceed soft threshold", async () => {
    const manyJobs = Array.from({ length: 101 }, (_, i) => ({
      id: `jj-${i.toString().padStart(8, "0")}-0000-4000-8000-000000000000`,
      result_storage_path: `path/${i}.png`,
      parent_post_index: i,
      generation_params: null,
    }));
    const urlMap: Record<string, string> = {};
    for (let i = 0; i < 101; i++) urlMap[`path/${i}.png`] = `https://s.example.com/${i}.png`;

    setupDb({
      batch: { id: BATCH_UUID, company_id: COMPANY_UUID, state: "completed", total_jobs: 101 },
      jobs: manyJobs,
    });
    setupSignedUrls(urlMap);
    global.fetch = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => TINY_PNG.buffer });

    const res = await GET(makeRequest(BATCH_UUID, COMPANY_UUID), { params: Promise.resolve({ id: BATCH_UUID }) });
    expect(res.headers.get("X-Download-Warning")).toMatch(/large-batch/);
  });
});
