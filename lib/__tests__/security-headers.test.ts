import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import {
  applySecurityHeaders,
  ensureRequestId,
  __internal,
} from "@/lib/security-headers";

// ---------------------------------------------------------------------------
// Header contract pins. Tightening the policy without updating these tests
// should be the review prompt — so changes to the header set are a conscious
// decision, not an accidental drift.
// ---------------------------------------------------------------------------

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function makeResponse(): NextResponse {
  return NextResponse.next();
}

function makeRequest(headers?: Record<string, string>): NextRequest {
  return new NextRequest("https://example.test/", {
    headers: new Headers(headers),
  });
}

describe("applySecurityHeaders", () => {
  it("sets all enforced headers", () => {
    const res = applySecurityHeaders(makeResponse(), "test-id");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(res.headers.get("Permissions-Policy")).toContain("camera=()");
    expect(res.headers.get("X-DNS-Prefetch-Control")).toBe("on");
    expect(res.headers.get("Strict-Transport-Security")).toContain(
      "max-age=63072000",
    );
  });

  it("propagates the request id on the response", () => {
    const res = applySecurityHeaders(makeResponse(), "abc-123");
    expect(res.headers.get("x-request-id")).toBe("abc-123");
  });

  it("emits CSP in report-only mode", () => {
    const res = applySecurityHeaders(makeResponse(), "id");
    const csp = res.headers.get("Content-Security-Policy-Report-Only");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    // Enforce-mode header must NOT be set — we're still in report-only
    // until we migrate to nonces.
    expect(res.headers.get("Content-Security-Policy")).toBeNull();
  });

  it("includes the Supabase + WP origins in connect-src when configured", () => {
    process.env.SUPABASE_URL = "https://xyz.supabase.co";
    process.env.NEXT_PUBLIC_LEADSOURCE_WP_URL = "https://wp.example.com";
    const csp = __internal.buildReportOnlyCsp();
    expect(csp).toContain("connect-src 'self' https://xyz.supabase.co https://wp.example.com");
    expect(csp).toContain("frame-src https://wp.example.com");
  });

  it("does not include undefined origins as literal 'undefined'", () => {
    delete process.env.SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_LEADSOURCE_WP_URL;
    const csp = __internal.buildReportOnlyCsp();
    expect(csp).not.toContain("undefined");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-src 'none'");
  });
});

describe("ensureRequestId", () => {
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  it("propagates a well-formed incoming UUID", () => {
    const id = "12345678-1234-1234-1234-123456789012";
    const req = makeRequest({ "x-request-id": id });
    expect(ensureRequestId(req)).toBe(id);
  });

  it("generates a fresh UUID when header is missing", () => {
    const req = makeRequest();
    expect(ensureRequestId(req)).toMatch(UUID_RE);
  });

  it("ignores malformed incoming ids (log-injection defence)", () => {
    const req = makeRequest({ "x-request-id": "nope; DROP TABLE x" });
    const id = ensureRequestId(req);
    expect(id).toMatch(UUID_RE);
    expect(id).not.toContain("DROP");
  });
});
