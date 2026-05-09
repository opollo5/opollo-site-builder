import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// LAYER 6 — Security: qstash webhook signature authenticity.
//
// Drives a real HTTP request through the actual `app/api/webhooks/
// qstash/social-publish` route handler. Mirrors the bundle.social
// webhook security test — different signing scheme (Upstash uses
// JWT-shaped signatures via @upstash/qstash Receiver), same threat
// model:
//
//   1. Missing Upstash-Signature → 401 INVALID_SIGNATURE
//   2. Wrong-signed → 401 INVALID_SIGNATURE
//   3. No env (no_receiver)      → 503 RECEIVER_NOT_CONFIGURED
//
// Why the receiver is mocked rather than driven with a real Upstash
// keypair: @upstash/qstash's Receiver verifies a JWT signature
// produced by Upstash's edge — we can't reproduce that key locally
// without leaking signing secrets. Instead, we mock
// verifyQstashSignature directly and prove that the route's response
// shape ↔ verify result are wired correctly. The signature
// algorithm itself is third-party-tested by Upstash; what we own is
// "does the route reject when verify says no".
// ---------------------------------------------------------------------------

let mockVerifyResult:
  | { ok: true }
  | { ok: false; reason: "no_receiver" | "missing_signature" | "invalid" };

vi.mock("@/lib/qstash", () => ({
  verifyQstashSignature: vi.fn(async () => mockVerifyResult),
  __resetQstashForTests: vi.fn(),
}));

vi.mock("@/lib/platform/social/publishing", () => ({
  fireScheduledPublish: vi.fn(async () => ({
    ok: true,
    data: { kind: "ok" },
    timestamp: new Date().toISOString(),
  })),
}));

import { POST } from "@/app/api/webhooks/qstash/social-publish/route";

function buildRequest(body: string, signature: string | null): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (signature !== null) headers["upstash-signature"] = signature;
  return new Request("http://localhost/api/webhooks/qstash/social-publish", {
    method: "POST",
    body,
    headers,
  });
}

beforeEach(() => {
  mockVerifyResult = { ok: true };
});

afterEach(() => vi.clearAllMocks());

describe("SECURITY: qstash social-publish webhook signature enforcement", () => {
  it("EXPLOIT BLOCKED — missing Upstash-Signature → 401", async () => {
    mockVerifyResult = { ok: false, reason: "missing_signature" };
    const body = JSON.stringify({
      scheduleEntryId: "11111111-1111-4111-8111-111111111111",
    });
    const res = await POST(buildRequest(body, null) as never);
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error?: { code: string } };
    expect(json.error?.code).toBe("INVALID_SIGNATURE");
  });

  it("EXPLOIT BLOCKED — invalid signature → 401", async () => {
    mockVerifyResult = { ok: false, reason: "invalid" };
    const body = JSON.stringify({
      scheduleEntryId: "11111111-1111-4111-8111-111111111111",
    });
    const res = await POST(buildRequest(body, "forged-jwt") as never);
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error?: { code: string } };
    expect(json.error?.code).toBe("INVALID_SIGNATURE");
  });

  it("NO RECEIVER — env unset → 503 RECEIVER_NOT_CONFIGURED (not 200)", async () => {
    mockVerifyResult = { ok: false, reason: "no_receiver" };
    const body = JSON.stringify({
      scheduleEntryId: "11111111-1111-4111-8111-111111111111",
    });
    const res = await POST(buildRequest(body, "any") as never);
    expect(res.status).toBe(503);
    const json = (await res.json()) as { error?: { code: string } };
    expect(json.error?.code).toBe("RECEIVER_NOT_CONFIGURED");
  });

  it("VALID — verified signature + good body → 200", async () => {
    mockVerifyResult = { ok: true };
    const body = JSON.stringify({
      scheduleEntryId: "11111111-1111-4111-8111-111111111111",
    });
    const res = await POST(buildRequest(body, "valid-sig") as never);
    expect(res.status).toBe(200);
  });

  it("VALID + MALFORMED BODY — 400 (not 200, not 500)", async () => {
    mockVerifyResult = { ok: true };
    const res = await POST(buildRequest("not-json", "valid-sig") as never);
    expect(res.status).toBe(400);
  });

  it("VALID + UNKNOWN-SHAPED BODY — 400 (Zod rejects scheduleEntryId missing)", async () => {
    mockVerifyResult = { ok: true };
    const res = await POST(
      buildRequest(JSON.stringify({ wrong: "field" }), "valid-sig") as never,
    );
    expect(res.status).toBe(400);
  });
});
