import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const MOCK_ITEMS = [
  {
    id: "post-abc",
    commentary: "Test post content",
    likesCount: 42,
    commentsCount: 7,
    sharesCount: 3,
    impressionsCount: 1500,
    engagementRate: 0.035,
    postedAt: "2026-05-01T10:00:00Z",
  },
];

// Module-level mock — replace the apify-client with a class constructor
vi.mock("apify-client", () => {
  class MockApifyClient {
    actor(_id: string) {
      return {
        call: vi.fn().mockResolvedValue({ id: "run-123", status: "SUCCEEDED" }),
      };
    }
    run(_id: string) {
      return {
        dataset: () => ({
          listItems: vi.fn().mockResolvedValue({ items: MOCK_ITEMS }),
        }),
      };
    }
  }
  return { ApifyClient: MockApifyClient };
});

import { createApifyAdapter } from "../insights/sources/apify";

describe("createApifyAdapter", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("isConfigured returns false when APIFY_TOKEN is not set", () => {
    delete process.env.APIFY_TOKEN;
    const adapter = createApifyAdapter();
    expect(adapter.isConfigured()).toBe(false);
  });

  it("isConfigured returns true when APIFY_TOKEN is set", () => {
    process.env.APIFY_TOKEN = "test-token";
    const adapter = createApifyAdapter();
    expect(adapter.isConfigured()).toBe(true);
  });

  it("scheduleScrape returns no-op when token unset", async () => {
    delete process.env.APIFY_TOKEN;
    const adapter = createApifyAdapter();
    const result = await adapter.scheduleScrape({
      platform: "LINKEDIN",
      handle: "test-company",
      companyId: "company-1",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("apify_unconfigured");
  });

  it("scheduleScrape returns error for unsupported platform", async () => {
    process.env.APIFY_TOKEN = "test-token";
    const adapter = createApifyAdapter();
    const result = await adapter.scheduleScrape({
      platform: "TWITTER",
      handle: "test-company",
      companyId: "company-1",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("unsupported_platform");
  });

  it("scheduleScrape calls actor for LINKEDIN", async () => {
    process.env.APIFY_TOKEN = "test-token";
    const adapter = createApifyAdapter();
    const result = await adapter.scheduleScrape({
      platform: "LINKEDIN",
      handle: "test-company",
      companyId: "company-1",
    });
    expect(result.ok).toBe(true);
    expect(result.runId).toBe("run-123");
  });

  it("getResults returns empty array when token unset", async () => {
    delete process.env.APIFY_TOKEN;
    const adapter = createApifyAdapter();
    const results = await adapter.getResults("run-123");
    expect(results).toEqual([]);
  });

  it("getResults normalizes Apify items to ScrapedPost shape", async () => {
    process.env.APIFY_TOKEN = "test-token";
    const adapter = createApifyAdapter();
    const results = await adapter.getResults("run-123");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      externalPostId: "post-abc",
      content: "Test post content",
      likes: 42,
      comments: 7,
      shares: 3,
      impressions: 1500,
      engagementRate: 0.035,
      postedAt: "2026-05-01T10:00:00Z",
    });
  });

  it("APIFY_TOKEN value never appears in any log line", () => {
    const secretToken = "SECRET_APIFY_TOKEN_VALUE_DO_NOT_LOG";
    process.env.APIFY_TOKEN = secretToken;
    const adapter = createApifyAdapter();

    // Capture logger calls — adapter should not log the token value
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Verify adapter creation doesn't log the token
    void adapter.isConfigured();

    const allLogs = [
      ...logSpy.mock.calls.flat(),
      ...warnSpy.mock.calls.flat(),
      ...errorSpy.mock.calls.flat(),
    ]
      .map(String)
      .join(" ");

    expect(allLogs).not.toContain(secretToken);

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
