import { describe, expect, it } from "vitest";

import {
  CloudflareCallError,
  classifyHttpStatus,
  uploadImage,
  type CloudflareFetchFn,
  type CloudflareImageRecord,
} from "@/lib/cloudflare-images";

// ---------------------------------------------------------------------------
// M4-3 — Cloudflare Images client tests.
//
// In-process unit tests. No network, no DB. Exercises the HTTP status
// classifier + the 409 adoption path + the envelope parser using a
// fake fetch.
// ---------------------------------------------------------------------------

const FAKE_CONFIG = {
  accountId: "acct_test",
  apiToken: "cf_token_test",
  deliveryHash: "hash-xyz",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function record(id: string): CloudflareImageRecord {
  return { id, filename: "x.jpg", uploaded: "2026-04-21T00:00:00Z", variants: [] };
}

describe("classifyHttpStatus", () => {
  it("429 → retryable rate-limited", () => {
    const c = classifyHttpStatus(429);
    expect(c.code).toBe("CLOUDFLARE_RATE_LIMITED");
    expect(c.retryable).toBe(true);
  });

  it("500 → retryable server error", () => {
    const c = classifyHttpStatus(500);
    expect(c.code).toBe("CLOUDFLARE_SERVER_ERROR");
    expect(c.retryable).toBe(true);
  });

  it("401 → non-retryable auth error", () => {
    const c = classifyHttpStatus(401);
    expect(c.code).toBe("CLOUDFLARE_AUTH_ERROR");
    expect(c.retryable).toBe(false);
  });

  it("413 → non-retryable payload too large", () => {
    const c = classifyHttpStatus(413);
    expect(c.code).toBe("CLOUDFLARE_PAYLOAD_TOO_LARGE");
    expect(c.retryable).toBe(false);
  });

  it("422 → non-retryable unprocessable", () => {
    const c = classifyHttpStatus(422);
    expect(c.code).toBe("CLOUDFLARE_UNPROCESSABLE");
    expect(c.retryable).toBe(false);
  });

  it("400 → non-retryable bad request (default)", () => {
    const c = classifyHttpStatus(400);
    expect(c.code).toBe("CLOUDFLARE_BAD_REQUEST");
    expect(c.retryable).toBe(false);
  });
});

describe("uploadImage — happy path", () => {
  it("returns the parsed record on 200+success:true", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const fakeFetch: CloudflareFetchFn = async (url, init) => {
      calls.push({ url, method: init.method ?? "GET" });
      return jsonResponse(200, {
        success: true,
        errors: [],
        messages: [],
        result: record("idem-1"),
      });
    };

    const out = await uploadImage(
      { id: "idem-1", url: "https://src.test/a.jpg" },
      { config: FAKE_CONFIG, fetchImpl: fakeFetch },
    );
    expect(out.id).toBe("idem-1");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toContain("/accounts/acct_test/images/v1");
  });

  it("passes the idempotency id as the `id` form field", async () => {
    let observed: FormData | null = null;
    const fakeFetch: CloudflareFetchFn = async (_url, init) => {
      observed = init.body as FormData;
      return jsonResponse(200, {
        success: true,
        errors: [],
        messages: [],
        result: record("idem-2"),
      });
    };

    await uploadImage(
      { id: "idem-2", url: "https://src.test/b.jpg" },
      { config: FAKE_CONFIG, fetchImpl: fakeFetch },
    );
    expect(observed).not.toBeNull();
    expect(observed!.get("id")).toBe("idem-2");
    expect(observed!.get("url")).toBe("https://src.test/b.jpg");
  });
});

describe("uploadImage — 409 adoption", () => {
  it("switches to GET-by-id and returns the existing record on HTTP 409", async () => {
    let uploadCalled = false;
    let getCalled = false;
    const fakeFetch: CloudflareFetchFn = async (url, init) => {
      if (init.method === "POST") {
        uploadCalled = true;
        return jsonResponse(409, {
          success: false,
          errors: [{ code: 5461, message: "Image with that id already exists" }],
          messages: [],
          result: null,
        });
      }
      getCalled = true;
      expect(url).toContain("/images/v1/idem-dup");
      return jsonResponse(200, {
        success: true,
        errors: [],
        messages: [],
        result: record("idem-dup"),
      });
    };

    const out = await uploadImage(
      { id: "idem-dup", url: "https://src.test/c.jpg" },
      { config: FAKE_CONFIG, fetchImpl: fakeFetch },
    );
    expect(uploadCalled).toBe(true);
    expect(getCalled).toBe(true);
    expect(out.id).toBe("idem-dup");
  });

  it("adopts on 200+success:false+already-exists error body", async () => {
    const fakeFetch: CloudflareFetchFn = async (_url, init) => {
      if (init.method === "POST") {
        return jsonResponse(200, {
          success: false,
          errors: [{ code: 5461, message: "RESOURCE_ALREADY_EXISTS" }],
          messages: [],
          result: null,
        });
      }
      return jsonResponse(200, {
        success: true,
        errors: [],
        messages: [],
        result: record("idem-exist"),
      });
    };

    const out = await uploadImage(
      { id: "idem-exist", url: "https://src.test/d.jpg" },
      { config: FAKE_CONFIG, fetchImpl: fakeFetch },
    );
    expect(out.id).toBe("idem-exist");
  });
});

describe("uploadImage — error classification", () => {
  it("throws retryable CloudflareCallError on 429", async () => {
    const fakeFetch: CloudflareFetchFn = async () =>
      jsonResponse(429, {
        success: false,
        errors: [{ code: 1000, message: "rate limit" }],
        messages: [],
        result: null,
      });
    try {
      await uploadImage(
        { id: "x", url: "https://src.test/e.jpg" },
        { config: FAKE_CONFIG, fetchImpl: fakeFetch },
      );
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CloudflareCallError);
      expect((err as CloudflareCallError).code).toBe("CLOUDFLARE_RATE_LIMITED");
      expect((err as CloudflareCallError).retryable).toBe(true);
      expect((err as CloudflareCallError).httpStatus).toBe(429);
    }
  });

  it("throws non-retryable CloudflareCallError on 413", async () => {
    const fakeFetch: CloudflareFetchFn = async () =>
      jsonResponse(413, {
        success: false,
        errors: [{ code: 5450, message: "too large" }],
        messages: [],
        result: null,
      });
    try {
      await uploadImage(
        { id: "x", url: "https://src.test/f.jpg" },
        { config: FAKE_CONFIG, fetchImpl: fakeFetch },
      );
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as CloudflareCallError).code).toBe(
        "CLOUDFLARE_PAYLOAD_TOO_LARGE",
      );
      expect((err as CloudflareCallError).retryable).toBe(false);
    }
  });

  it("throws non-retryable CloudflareCallError on 401", async () => {
    const fakeFetch: CloudflareFetchFn = async () =>
      jsonResponse(401, {
        success: false,
        errors: [{ code: 9999, message: "bad token" }],
        messages: [],
        result: null,
      });
    try {
      await uploadImage(
        { id: "x", url: "https://src.test/g.jpg" },
        { config: FAKE_CONFIG, fetchImpl: fakeFetch },
      );
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as CloudflareCallError).code).toBe("CLOUDFLARE_AUTH_ERROR");
      expect((err as CloudflareCallError).retryable).toBe(false);
    }
  });
});

describe("uploadImage — parse failure guard", () => {
  it("throws CLOUDFLARE_PARSE_FAILED when success=true but result is missing/invalid", async () => {
    const fakeFetch: CloudflareFetchFn = async () =>
      jsonResponse(200, {
        success: true,
        errors: [],
        messages: [],
        result: { filename: "x" }, // no id
      });
    try {
      await uploadImage(
        { id: "x", url: "https://src.test/h.jpg" },
        { config: FAKE_CONFIG, fetchImpl: fakeFetch },
      );
      throw new Error("should have thrown");
    } catch (err) {
      expect((err as CloudflareCallError).code).toBe("CLOUDFLARE_PARSE_FAILED");
      expect((err as CloudflareCallError).retryable).toBe(false);
    }
  });
});
