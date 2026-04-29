import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { testWpConnection } from "@/lib/site-test-connection";
import * as wp from "@/lib/wordpress";

// AUTH-FOUNDATION P2.1 — capability + error mapping unit matrix.

describe("testWpConnection", () => {
  const originalGetMe = wp.wpGetMe;

  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.spyOn(wp, "wpGetMe");
  });

  // -------- happy paths --------

  it("succeeds when roles include administrator", async () => {
    vi.mocked(wp.wpGetMe).mockResolvedValueOnce({
      ok: true,
      user_id: 1,
      username: "admin",
      display_name: "Site Admin",
      roles: ["administrator"],
      capabilities: {},
    });

    const result = await testWpConnection({
      url: "https://example.com",
      username: "admin",
      app_password: "abcd efgh ijkl mnop qrst uvwx",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.user.display_name).toBe("Site Admin");
    expect(result.user.roles).toEqual(["administrator"]);
  });

  it("succeeds when roles include editor (no admin)", async () => {
    vi.mocked(wp.wpGetMe).mockResolvedValueOnce({
      ok: true,
      user_id: 2,
      username: "edith",
      display_name: "Edith",
      roles: ["editor"],
      capabilities: {},
    });

    const result = await testWpConnection({
      url: "https://example.com",
      username: "edith",
      app_password: "anything",
    });

    expect(result.ok).toBe(true);
  });

  it("succeeds on capabilities.publish_posts even with non-canonical role", async () => {
    vi.mocked(wp.wpGetMe).mockResolvedValueOnce({
      ok: true,
      user_id: 3,
      username: "ghost",
      display_name: "",
      roles: ["custom_publisher"],
      capabilities: { publish_posts: true },
    });

    const result = await testWpConnection({
      url: "https://example.com",
      username: "ghost",
      app_password: "x",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Falls back to username when display_name is empty.
    expect(result.user.display_name).toBe("ghost");
  });

  // -------- failure paths --------

  it("returns INSUFFICIENT_ROLE when neither role nor capability passes", async () => {
    vi.mocked(wp.wpGetMe).mockResolvedValueOnce({
      ok: true,
      user_id: 4,
      username: "sub",
      display_name: "Subscriber",
      roles: ["subscriber"],
      capabilities: { read: true },
    });

    const result = await testWpConnection({
      url: "https://example.com",
      username: "sub",
      app_password: "x",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INSUFFICIENT_ROLE");
    expect(result.error.message).toContain("publish");
  });

  it("translates AUTH_FAILED to a clear message", async () => {
    vi.mocked(wp.wpGetMe).mockResolvedValueOnce({
      ok: false,
      code: "AUTH_FAILED",
      message: "401",
      retryable: false,
      suggested_action: "ignore",
    });

    const result = await testWpConnection({
      url: "https://example.com",
      username: "x",
      app_password: "wrong",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("AUTH_FAILED");
    expect(result.error.message).toMatch(/credentials rejected/i);
  });

  it("translates NOT_FOUND to REST_UNREACHABLE", async () => {
    vi.mocked(wp.wpGetMe).mockResolvedValueOnce({
      ok: false,
      code: "NOT_FOUND",
      message: "404",
      retryable: false,
      suggested_action: "ignore",
    });

    const result = await testWpConnection({
      url: "https://example.com",
      username: "x",
      app_password: "y",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("REST_UNREACHABLE");
    expect(result.error.message).toMatch(/REST API not reachable/i);
  });

  it("translates NETWORK_ERROR to NETWORK", async () => {
    vi.mocked(wp.wpGetMe).mockResolvedValueOnce({
      ok: false,
      code: "NETWORK_ERROR",
      message: "ECONNREFUSED",
      retryable: true,
      suggested_action: "retry",
    });

    const result = await testWpConnection({
      url: "https://offline.example.com",
      username: "x",
      app_password: "y",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("NETWORK");
    expect(result.error.message).toContain("ECONNREFUSED");
  });

  // -------- input validation --------

  it("rejects an empty URL", async () => {
    const result = await testWpConnection({
      url: "",
      username: "x",
      app_password: "y",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_URL");
    expect(originalGetMe).not.toHaveBeenCalled();
  });

  it("rejects a non-http(s) URL", async () => {
    const result = await testWpConnection({
      url: "ftp://example.com",
      username: "x",
      app_password: "y",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("INVALID_URL");
  });

  it("rejects an empty app password after whitespace strip", async () => {
    const result = await testWpConnection({
      url: "https://example.com",
      username: "x",
      app_password: "   \n  ",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("AUTH_FAILED");
    expect(result.error.message).toMatch(/empty after stripping/i);
  });

  it("strips whitespace from the WP Application Password format", async () => {
    let receivedPassword = "";
    vi.mocked(wp.wpGetMe).mockImplementationOnce(async (cfg) => {
      receivedPassword = cfg.appPassword;
      return {
        ok: true,
        user_id: 1,
        username: "admin",
        display_name: "Admin",
        roles: ["administrator"],
        capabilities: {},
      };
    });

    await testWpConnection({
      url: "https://example.com",
      username: "admin",
      app_password: "abcd efgh ijkl mnop qrst uvwx",
    });

    // 24 chars after whitespace strip — matches the WP Application
    // Password canonical format.
    expect(receivedPassword).toBe("abcdefghijklmnopqrstuvwx");
    expect(receivedPassword).toHaveLength(24);
  });

  it("strips a single trailing slash from the URL before passing to wpGetMe", async () => {
    let receivedBaseUrl = "";
    vi.mocked(wp.wpGetMe).mockImplementationOnce(async (cfg) => {
      receivedBaseUrl = cfg.baseUrl;
      return {
        ok: true,
        user_id: 1,
        username: "admin",
        display_name: "Admin",
        roles: ["administrator"],
        capabilities: {},
      };
    });

    await testWpConnection({
      url: "https://example.com/",
      username: "admin",
      app_password: "x",
    });

    expect(receivedBaseUrl).toBe("https://example.com");
  });
});
