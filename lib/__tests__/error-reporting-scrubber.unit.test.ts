import { describe, expect, it } from "vitest";

import { scrubPayload, scrubUrl } from "@/lib/error-reporting/scrubber";

// ---------------------------------------------------------------------------
// Scrubber — unit tests with attack-case fixtures.
// ---------------------------------------------------------------------------

describe("scrubPayload", () => {
  it("redacts sensitive keys", () => {
    const result = scrubPayload({ password: "hunter2", token: "abc", safeKey: "hello" });
    expect(result).toEqual({ password: "[redacted]", token: "[redacted]", safeKey: "hello" });
  });

  it("redacts api_key and apiKey variants", () => {
    expect(scrubPayload({ api_key: "secret", apiKey: "secret2", "api-key": "secret3" })).toEqual({
      api_key: "[redacted]",
      apiKey: "[redacted]",
      "api-key": "[redacted]",
    });
  });

  it("redacts authorization and cookie keys", () => {
    expect(scrubPayload({ authorization: "Bearer xyz", cookie: "session=abc" })).toEqual({
      authorization: "[redacted]",
      cookie: "[redacted]",
    });
  });

  it("redacts JWT tokens in string values", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const result = scrubPayload({ breadcrumb: `user clicked button, token=${jwt}` });
    expect((result as Record<string, string>).breadcrumb).toContain("[jwt-redacted]");
    expect((result as Record<string, string>).breadcrumb).not.toContain("eyJ");
  });

  it("redacts JWT in URL string values", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const result = scrubPayload({ url: `https://example.com?token=${jwt}` }) as { url: string };
    expect(result.url).not.toContain("eyJ");
  });

  it("redacts Luhn-valid credit card numbers", () => {
    // Visa test number
    const result = scrubPayload({ msg: "card 4111111111111111 was declined" });
    expect((result as Record<string, string>).msg).toContain("[card-redacted]");
    expect((result as Record<string, string>).msg).not.toContain("4111111111111111");
  });

  it("does NOT redact Luhn-invalid digit strings", () => {
    const result = scrubPayload({ msg: "error code 1234567890123456" });
    // 1234567890123456 does not pass Luhn
    expect((result as Record<string, string>).msg).not.toContain("[card-redacted]");
  });

  it("redacts email addresses in free-form text", () => {
    const result = scrubPayload({ note: "user john@example.com left a comment" });
    expect((result as Record<string, string>).note).toContain("[email-redacted]");
    expect((result as Record<string, string>).note).not.toContain("john@example.com");
  });

  it("handles deeply nested objects", () => {
    const input = { a: { b: { c: { password: "deep-secret" } } } };
    const result = scrubPayload(input) as typeof input;
    expect(result.a.b.c.password).toBe("[redacted]");
  });

  it("handles arrays", () => {
    const result = scrubPayload([{ token: "abc" }, { safe: "value" }]) as Array<Record<string, unknown>>;
    expect(result[0]!["token"]).toBe("[redacted]");
    expect(result[1]!["safe"]).toBe("value");
  });

  it("passes through safe primitive values unchanged", () => {
    expect(scrubPayload(42)).toBe(42);
    expect(scrubPayload(true)).toBe(true);
    expect(scrubPayload(null)).toBeNull();
    expect(scrubPayload("hello world")).toBe("hello world");
  });
});

describe("scrubUrl", () => {
  it("redacts sensitive query params", () => {
    const url = "https://example.com/reset?token=abc123&other=visible";
    const result = scrubUrl(url);
    expect(result).not.toContain("abc123");
    // The param value is replaced — verify via URL parsing.
    const u = new URL(result);
    expect(u.searchParams.get("token")).toBe("[redacted]");
    expect(u.searchParams.get("other")).toBe("visible");
  });

  it("leaves non-sensitive query params intact", () => {
    const url = "https://example.com/search?q=test&page=2";
    const result = scrubUrl(url);
    expect(result).toContain("q=test");
    expect(result).toContain("page=2");
  });

  it("handles relative URLs with sensitive params", () => {
    // Uses a key name that matches SENSITIVE_KEY_RE.
    const url = "/api/auth/callback?token=secretcode123";
    const result = scrubUrl(url);
    expect(result).not.toContain("secretcode123");
  });

  it("handles URLs with no query params", () => {
    expect(scrubUrl("https://example.com/page")).toBe("https://example.com/page");
  });
});
