import { beforeEach, describe, expect, it, vi } from "vitest";

// LAYER 6 — Security. Signature-verification enforcement on the
// post-history-import QStash callback. A missing or invalid Upstash
// signature must NOT reach the runner.
//
// Test name pattern includes "SECURITY" so test:security picks it up.

const mockVerify = vi.hoisted(() => vi.fn());
const mockRunImport = vi.hoisted(() => vi.fn());

vi.mock("@/lib/qstash", () => ({
  verifyQstashSignature: mockVerify,
}));

vi.mock("@/lib/platform/social/analytics-ingest", () => ({
  runPostHistoryImport: mockRunImport,
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { POST } from "@/app/api/webhooks/qstash/social-post-history-import/route";

const VALID_BODY = JSON.stringify({
  importRowId: "c0a801aa-1111-4111-a111-111111111111",
});

function req(body: string, sig: string | null = "fake-sig"): Request {
  return new Request(
    "http://localhost/api/webhooks/qstash/social-post-history-import",
    {
      method: "POST",
      headers: sig ? { "upstash-signature": sig } : {},
      body,
    },
  );
}

beforeEach(() => {
  mockVerify.mockReset();
  mockRunImport.mockReset();
});

describe("SECURITY: QStash post-history-import callback signature gate", () => {
  it("rejects with 401 when signature header is missing", async () => {
    mockVerify.mockResolvedValue({ ok: false, reason: "missing_signature" });
    const res = await POST(req(VALID_BODY, null) as Parameters<typeof POST>[0]);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_SIGNATURE");
    expect(mockRunImport).not.toHaveBeenCalled();
  });

  it("rejects with 401 when signature is invalid", async () => {
    mockVerify.mockResolvedValue({ ok: false, reason: "invalid" });
    const res = await POST(
      req(VALID_BODY, "bad-sig") as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(401);
    expect(mockRunImport).not.toHaveBeenCalled();
  });

  it("rejects with 503 when receiver isn't configured (signing key unset)", async () => {
    mockVerify.mockResolvedValue({ ok: false, reason: "no_receiver" });
    const res = await POST(
      req(VALID_BODY, "any-sig") as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(503);
    expect(mockRunImport).not.toHaveBeenCalled();
  });

  it("400 on malformed body (signature valid but body unparseable)", async () => {
    mockVerify.mockResolvedValue({ ok: true });
    const res = await POST(
      req("not-json", "ok-sig") as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(400);
    expect(mockRunImport).not.toHaveBeenCalled();
  });

  it("invokes the runner when signature is valid + body matches schema", async () => {
    mockVerify.mockResolvedValue({ ok: true });
    mockRunImport.mockResolvedValue({ kind: "succeeded", postsImported: 50 });
    const res = await POST(
      req(VALID_BODY, "ok-sig") as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(200);
    expect(mockRunImport).toHaveBeenCalledWith({
      importRowId: "c0a801aa-1111-4111-a111-111111111111",
    });
  });
});
