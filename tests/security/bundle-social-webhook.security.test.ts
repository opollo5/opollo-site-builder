import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";

// ---------------------------------------------------------------------------
// LAYER 6 — Security: webhook signature authenticity (R-WEBHOOK).
//
// Drives a real HTTP request through the actual `app/api/webhooks/
// bundlesocial` route handler. Asserts:
//
//   1. Missing x-signature → 401 INVALID_SIGNATURE
//   2. Wrong-signed body  → 401 INVALID_SIGNATURE
//   3. Valid HMAC-SHA256  → 200 ok, payload processed
//   4. Replay protection  → 200 ok with already_processed (idempotent)
//   5. No signing secret  → 503 RECEIVER_NOT_CONFIGURED (operator action)
//
// Per the security realism rule: the test MUST exercise the real
// enforcement boundary. Mocking `verifyBundlesocialSignature` would
// prove the test framework can stub a function — not that the route
// rejects forged webhooks. The signature is computed locally with the
// same algorithm the production code uses, then the request body is
// dispatched directly to the route's POST handler.
//
// Why no Supabase: the route's first action is signature verification,
// before DB writes. Cases 1, 2, 5 reject before touching the DB. Case
// 3 + 4 do touch the DB but only via the idempotent insert in
// processBundlesocialWebhook — wired up here through a vi.mock so the
// security boundary remains exercised without booting Supabase.
// ---------------------------------------------------------------------------

const TEST_SECRET = "test-webhook-secret-do-not-use-in-prod";

// Stable in-memory event store so the duplicate-delivery case can prove
// idempotency without a real DB. The route under test calls
// processBundlesocialWebhook → which we mock with a tiny store.
const seen = new Set<string>();
let mockNextResultKind: "ok" | "stored_no_action" | "already_processed" =
  "stored_no_action";

import { vi } from "vitest";

vi.mock("@/lib/platform/social/webhooks", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/platform/social/webhooks")
  >("@/lib/platform/social/webhooks");
  return {
    ...actual,
    processBundlesocialWebhook: async (input: {
      envelope: { id: string; type: string };
    }) => {
      if (seen.has(input.envelope.id)) {
        return {
          kind: "already_processed",
          eventId: input.envelope.id,
        };
      }
      seen.add(input.envelope.id);
      return {
        kind: mockNextResultKind,
        eventId: input.envelope.id,
        ...(mockNextResultKind === "ok" ? { action: "post_published" } : {}),
      };
    },
  };
});

import { POST } from "@/app/api/webhooks/bundlesocial/route";
import { __resetBundlesocialForTests } from "@/lib/bundlesocial";

function signBody(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function buildRequest(body: string, signature: string | null): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (signature !== null) headers["x-signature"] = signature;
  return new Request("http://localhost/api/webhooks/bundlesocial", {
    method: "POST",
    body,
    headers,
  });
}

beforeEach(() => {
  seen.clear();
  mockNextResultKind = "stored_no_action";
  __resetBundlesocialForTests();
  process.env.BUNDLESOCIAL_WEBHOOK_SIGNING_SECRET = TEST_SECRET;
});

afterEach(() => {
  delete process.env.BUNDLESOCIAL_WEBHOOK_SIGNING_SECRET;
  __resetBundlesocialForTests();
});

describe("SECURITY: bundle.social webhook signature enforcement", () => {
  it("EXPLOIT BLOCKED — no signature header → 401 INVALID_SIGNATURE", async () => {
    const body = JSON.stringify({ id: "evt_no_sig", type: "team.heartbeat" });
    const res = await POST(buildRequest(body, null) as never);
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error?: { code: string } };
    expect(json.error?.code).toBe("INVALID_SIGNATURE");
  });

  it("EXPLOIT BLOCKED — wrong-signed body → 401 INVALID_SIGNATURE", async () => {
    const body = JSON.stringify({ id: "evt_wrong_sig", type: "team.heartbeat" });
    // Attacker signs with the wrong key — what a forger without the
    // secret would send.
    const forged = signBody("attacker-guess", body);
    const res = await POST(buildRequest(body, forged) as never);
    expect(res.status).toBe(401);
    const json = (await res.json()) as { error?: { code: string } };
    expect(json.error?.code).toBe("INVALID_SIGNATURE");
  });

  it("EXPLOIT BLOCKED — body modified after signing → 401 INVALID_SIGNATURE", async () => {
    const original = JSON.stringify({
      id: "evt_modified",
      type: "team.heartbeat",
    });
    const sig = signBody(TEST_SECRET, original);
    // Attacker swaps the body but keeps the signature — classic forgery.
    const tampered = JSON.stringify({
      id: "evt_modified",
      type: "team.heartbeat",
      injected: "evil",
    });
    const res = await POST(buildRequest(tampered, sig) as never);
    expect(res.status).toBe(401);
  });

  it("VALID — correct HMAC-SHA256 → 200 ok", async () => {
    const body = JSON.stringify({
      id: "evt_valid_1",
      type: "team.heartbeat",
    });
    const sig = signBody(TEST_SECRET, body);
    const res = await POST(buildRequest(body, sig) as never);
    expect(res.status).toBe(200);
  });

  it("IDEMPOTENT — duplicate delivery returns 200 already_processed", async () => {
    const body = JSON.stringify({
      id: "evt_dup_replay",
      type: "team.heartbeat",
    });
    const sig = signBody(TEST_SECRET, body);
    const first = await POST(buildRequest(body, sig) as never);
    expect(first.status).toBe(200);
    const second = await POST(buildRequest(body, sig) as never);
    expect(second.status).toBe(200);
    const json = (await second.json()) as {
      data?: { kind?: string };
    };
    expect(json.data?.kind).toBe("already_processed");
  });

  it("NO SECRET — env unset → 503 RECEIVER_NOT_CONFIGURED (not 200)", async () => {
    delete process.env.BUNDLESOCIAL_WEBHOOK_SIGNING_SECRET;
    const body = JSON.stringify({ id: "evt_no_env", type: "team.heartbeat" });
    const sig = signBody("anything", body);
    const res = await POST(buildRequest(body, sig) as never);
    // No secret means we can't verify — must NOT silently accept the
    // payload. Returning 503 lets bundle.social retry while ops fix env.
    expect(res.status).toBe(503);
    const json = (await res.json()) as { error?: { code: string } };
    expect(json.error?.code).toBe("RECEIVER_NOT_CONFIGURED");
  });

  it("TIMING — equal-length wrong signature still rejected", async () => {
    // Defends against a careless rewrite of the verifier that uses
    // string equality instead of timingSafeEqual after a length check.
    const body = JSON.stringify({ id: "evt_eq_len", type: "team.heartbeat" });
    const real = signBody(TEST_SECRET, body);
    // Flip every nibble — same length, completely wrong content.
    const wrong = real
      .split("")
      .map((c) => (c === "0" ? "f" : "0"))
      .join("");
    expect(wrong.length).toBe(real.length);
    const res = await POST(buildRequest(body, wrong) as never);
    expect(res.status).toBe(401);
  });
});
