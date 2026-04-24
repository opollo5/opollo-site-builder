import { describe, expect, it } from "vitest";

import {
  extractWpRestCode,
  translateWpError,
} from "@/lib/error-translations";
import type { WpError } from "@/lib/wordpress";

// ---------------------------------------------------------------------------
// M13-2 — translateWpError table tests.
//
// Verifies that every curated mapping (WP `rest_*` code + HTTP
// WpErrorCode) returns a sensible operator-facing translation, and
// that unknown codes fall through to the generic message rather than
// throwing.
// ---------------------------------------------------------------------------

function mkAuthFailed(
  wpCode?: string,
): WpError {
  return {
    ok: false,
    code: "AUTH_FAILED",
    message: "WordPress rejected the Application Password credentials.",
    details: wpCode
      ? { wp_response: { code: wpCode, message: "x" } }
      : undefined,
    retryable: false,
    suggested_action: "reset password",
  };
}

function mkWpApiError(status: number, wpCode?: string): WpError {
  return {
    ok: false,
    code: "WP_API_ERROR",
    message: `WordPress API error (HTTP ${status}).`,
    details: {
      status,
      ...(wpCode ? { wp_response: { code: wpCode, message: "x" } } : {}),
    },
    retryable: status >= 500,
    suggested_action: "check wp",
  };
}

// ---------------------------------------------------------------------------
// extractWpRestCode
// ---------------------------------------------------------------------------

describe("extractWpRestCode", () => {
  it("returns null when details is undefined", () => {
    expect(extractWpRestCode(mkAuthFailed())).toBeNull();
  });

  it("returns null when wp_response is absent", () => {
    const err: WpError = {
      ok: false,
      code: "WP_API_ERROR",
      message: "x",
      details: { status: 500 },
      retryable: false,
      suggested_action: "x",
    };
    expect(extractWpRestCode(err)).toBeNull();
  });

  it("returns the string code from details.wp_response.code", () => {
    expect(extractWpRestCode(mkAuthFailed("rest_cannot_create"))).toBe(
      "rest_cannot_create",
    );
  });

  it("returns null when wp_response.code isn't a string", () => {
    const err: WpError = {
      ok: false,
      code: "WP_API_ERROR",
      message: "x",
      details: { wp_response: { code: 42 } },
      retryable: false,
      suggested_action: "x",
    };
    expect(extractWpRestCode(err)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// translateWpError — WP-level rest_* codes take priority
// ---------------------------------------------------------------------------

describe("translateWpError — WP rest_* codes", () => {
  it("maps rest_cannot_create to a permission severity", () => {
    const t = translateWpError(mkAuthFailed("rest_cannot_create"));
    expect(t.severity).toBe("permission");
    expect(t.title).toMatch(/publish/i);
    expect(t.nextAction).toMatch(/editor|author|application password/i);
  });

  it("maps rest_cannot_edit to a permission severity", () => {
    const t = translateWpError(mkAuthFailed("rest_cannot_edit"));
    expect(t.severity).toBe("permission");
    expect(t.title).toMatch(/edit/i);
  });

  it("maps rest_post_invalid_id to a not_found severity", () => {
    const t = translateWpError(mkWpApiError(404, "rest_post_invalid_id"));
    expect(t.severity).toBe("not_found");
    expect(t.title).toMatch(/no longer|not found|orphaned/i);
  });

  it("maps rest_invalid_param to a validation severity", () => {
    const t = translateWpError(mkWpApiError(400, "rest_invalid_param"));
    expect(t.severity).toBe("validation");
    expect(t.title).toMatch(/rejected/i);
  });

  it("maps rest_forbidden to a permission severity", () => {
    const t = translateWpError(mkAuthFailed("rest_forbidden"));
    expect(t.severity).toBe("permission");
  });

  it("maps rest_forbidden_context to a permission severity with edit-context note", () => {
    const t = translateWpError(mkAuthFailed("rest_forbidden_context"));
    expect(t.severity).toBe("permission");
    expect(t.title).toMatch(/context|edit/i);
  });

  it("maps upload_dir_error to an upstream severity", () => {
    const t = translateWpError(mkWpApiError(500, "upload_dir_error"));
    expect(t.severity).toBe("upstream");
    expect(t.title).toMatch(/uploads|write/i);
  });

  it("maps invalid_term to a validation severity", () => {
    const t = translateWpError(mkWpApiError(400, "invalid_term"));
    expect(t.severity).toBe("validation");
    expect(t.title).toMatch(/category|tag|taxonomy/i);
  });

  it("maps term_exists to a validation severity", () => {
    const t = translateWpError(mkWpApiError(400, "term_exists"));
    expect(t.severity).toBe("validation");
    expect(t.title).toMatch(/already exists/i);
  });

  it("maps yoast_meta_error to an seo severity", () => {
    const t = translateWpError(mkWpApiError(400, "yoast_meta_error"));
    expect(t.severity).toBe("seo");
    expect(t.title).toMatch(/yoast/i);
  });

  it("maps rank_math_meta_error to an seo severity", () => {
    const t = translateWpError(mkWpApiError(400, "rank_math_meta_error"));
    expect(t.severity).toBe("seo");
    expect(t.title).toMatch(/rank math/i);
  });
});

// ---------------------------------------------------------------------------
// translateWpError — HTTP-tier fallbacks
// ---------------------------------------------------------------------------

describe("translateWpError — HTTP-tier fallbacks", () => {
  it("AUTH_FAILED without a rest_* code maps to auth severity", () => {
    const t = translateWpError(mkAuthFailed());
    expect(t.severity).toBe("auth");
    expect(t.title).toMatch(/application password/i);
    expect(t.nextAction).toMatch(/re-issue|users → profile/i);
  });

  it("UPSTREAM_BLOCKED maps to upstream severity with WAF hint", () => {
    const err: WpError = {
      ok: false,
      code: "UPSTREAM_BLOCKED",
      message: "Non-JSON 403",
      retryable: false,
      suggested_action: "check WAF",
    };
    const t = translateWpError(err);
    expect(t.severity).toBe("upstream");
    expect(t.detail).toMatch(/waf|firewall|cloudflare|wordfence/i);
  });

  it("NOT_FOUND maps to not_found severity", () => {
    const err: WpError = {
      ok: false,
      code: "NOT_FOUND",
      message: "gone",
      retryable: false,
      suggested_action: "verify",
    };
    const t = translateWpError(err);
    expect(t.severity).toBe("not_found");
  });

  it("RATE_LIMIT maps to rate_limit severity", () => {
    const err: WpError = {
      ok: false,
      code: "RATE_LIMIT",
      message: "slow down",
      retryable: true,
      suggested_action: "backoff",
    };
    const t = translateWpError(err);
    expect(t.severity).toBe("rate_limit");
    expect(t.nextAction).toMatch(/back off|retry/i);
  });

  it("NETWORK_ERROR maps to network severity", () => {
    const err: WpError = {
      ok: false,
      code: "NETWORK_ERROR",
      message: "DNS failed",
      retryable: true,
      suggested_action: "check DNS",
    };
    const t = translateWpError(err);
    expect(t.severity).toBe("network");
    expect(t.detail).toMatch(/dns|tls|offline|network/i);
  });

  it("WP_API_ERROR with an unknown rest_* code falls back to the HTTP-tier translation", () => {
    const t = translateWpError(mkWpApiError(500, "some_unknown_plugin_code"));
    // Falls to WP_API_ERROR tier, not an unhandled throw.
    expect(t.severity).toBe("upstream");
    expect(t.title).toMatch(/unexpected|rejected/i);
  });
});

// ---------------------------------------------------------------------------
// Unknown codes fall through to the generic translation
// ---------------------------------------------------------------------------

describe("translateWpError — generic fallback", () => {
  it("returns a generic message for an unrecognised rest_* code", () => {
    const t = translateWpError(mkAuthFailed("some_plugin_specific_code"));
    // Still translated — either from the HTTP-tier table (AUTH_FAILED)
    // or the generic fallback.
    expect(t.title.length).toBeGreaterThan(0);
    expect(t.detail.length).toBeGreaterThan(0);
    expect(t.nextAction.length).toBeGreaterThan(0);
  });

  it("never throws on an entirely malformed error", () => {
    const weird: WpError = {
      ok: false,
      code: "WP_API_ERROR",
      message: "",
      retryable: false,
      suggested_action: "",
    };
    expect(() => translateWpError(weird)).not.toThrow();
  });
});
