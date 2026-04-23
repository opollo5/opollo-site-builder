import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AuthRedirectBaseUnavailable,
  __resetAuthRedirectWarningsForTests,
  buildAuthRedirectUrl,
  getAuthRedirectBase,
} from "@/lib/auth-redirect";

// ---------------------------------------------------------------------------
// M14-2 — auth-redirect helper.
//
// Matrix:
//   1. NEXT_PUBLIC_SITE_URL set → env wins, trailing slash stripped.
//   2. NEXT_PUBLIC_SITE_URL unset + Request provided → request origin.
//   3. NEXT_PUBLIC_SITE_URL unset + no Request → AuthRedirectBaseUnavailable.
//   4. Malformed env value → throws (caught at call time, not silently dropped).
//   5. Non-http protocol → throws.
//   6. Env set with trailing slash → returned without it.
//   7. Env value takes precedence over request origin.
//   8. buildAuthRedirectUrl happy path + leading-slash assertion.
// ---------------------------------------------------------------------------

const originalEnv = process.env.NEXT_PUBLIC_SITE_URL;

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_SITE_URL;
  __resetAuthRedirectWarningsForTests();
});

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env.NEXT_PUBLIC_SITE_URL;
  } else {
    process.env.NEXT_PUBLIC_SITE_URL = originalEnv;
  }
});

describe("getAuthRedirectBase — env source", () => {
  it("returns NEXT_PUBLIC_SITE_URL when set", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://opollo.vercel.app";
    expect(getAuthRedirectBase()).toBe("https://opollo.vercel.app");
  });

  it("strips a trailing slash from NEXT_PUBLIC_SITE_URL", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://opollo.vercel.app/";
    expect(getAuthRedirectBase()).toBe("https://opollo.vercel.app");
  });

  it("preserves port in NEXT_PUBLIC_SITE_URL", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
    expect(getAuthRedirectBase()).toBe("http://localhost:3000");
  });

  it("throws on malformed NEXT_PUBLIC_SITE_URL", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "not a url";
    expect(() => getAuthRedirectBase()).toThrow();
  });

  it("throws on a non-http(s) protocol in NEXT_PUBLIC_SITE_URL", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "ftp://opollo.vercel.app";
    expect(() => getAuthRedirectBase()).toThrow();
  });

  it("treats whitespace-only NEXT_PUBLIC_SITE_URL as unset", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "   ";
    expect(() => getAuthRedirectBase()).toThrow(AuthRedirectBaseUnavailable);
  });

  it("prefers env over request origin when both are present", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://opollo.vercel.app";
    const req = new Request("https://different-host.example.com/some/path");
    expect(getAuthRedirectBase(req)).toBe("https://opollo.vercel.app");
  });
});

describe("getAuthRedirectBase — request source", () => {
  it("derives from Request.url when env is unset", () => {
    const req = new Request("https://preview-abc.vercel.app/some/path?q=1");
    expect(getAuthRedirectBase(req)).toBe("https://preview-abc.vercel.app");
  });

  it("reads nextUrl.origin when the request carries it", () => {
    // Simulate a NextRequest-like object without instantiating Next.
    const nextLike = {
      url: "https://nextlike.example.com/x",
      nextUrl: { origin: "https://nextlike.example.com" },
      headers: new Headers(),
    } as unknown as Request;
    expect(getAuthRedirectBase(nextLike)).toBe("https://nextlike.example.com");
  });
});

describe("getAuthRedirectBase — no sources", () => {
  it("throws AuthRedirectBaseUnavailable when env unset and no Request", () => {
    expect(() => getAuthRedirectBase()).toThrow(AuthRedirectBaseUnavailable);
  });
});

describe("buildAuthRedirectUrl", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://opollo.vercel.app";
  });

  it("appends a leading-slash path", () => {
    expect(buildAuthRedirectUrl("/auth/reset-password")).toBe(
      "https://opollo.vercel.app/auth/reset-password",
    );
  });

  it("preserves query strings in the path", () => {
    expect(buildAuthRedirectUrl("/api/auth/callback?next=%2Fadmin")).toBe(
      "https://opollo.vercel.app/api/auth/callback?next=%2Fadmin",
    );
  });

  it("throws when path does not start with a slash", () => {
    expect(() => buildAuthRedirectUrl("auth/reset-password")).toThrow();
  });
});
