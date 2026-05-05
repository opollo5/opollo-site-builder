import { describe, expect, it } from "vitest";

import { planAuthCallback } from "@/lib/auth-callback";

// ---------------------------------------------------------------------------
// planAuthCallback — the URL-shape decision function backing the
// client-side /auth/callback page. Three shapes Supabase emits land
// here depending on the project's auth flow; the planner has to route
// each to the right next action.
// ---------------------------------------------------------------------------

const ORIGIN = "https://opollo-site-builder.vercel.app";

describe("planAuthCallback: implicit flow (#access_token=...)", () => {
  it("sets the session and lands on /auth/reset-password for type=recovery", () => {
    const plan = planAuthCallback(
      `${ORIGIN}/auth/callback?next=%2Fauth%2Freset-password#access_token=at-1&refresh_token=rt-1&token_type=bearer&type=recovery`,
    );
    expect(plan).toEqual({
      kind: "set_session",
      access_token: "at-1",
      refresh_token: "rt-1",
      destination: "/auth/reset-password",
    });
  });

  it("sets the session and honours `next` for type=signup / magiclink", () => {
    for (const type of ["signup", "magiclink", "invite", "email_change"]) {
      const plan = planAuthCallback(
        `${ORIGIN}/auth/callback?next=%2Fadmin%2Fsites#access_token=at&refresh_token=rt&type=${type}`,
      );
      expect(plan).toEqual({
        kind: "set_session",
        access_token: "at",
        refresh_token: "rt",
        destination: "/admin/sites",
      });
    }
  });

  it("falls back to /admin/sites when `next` is absent", () => {
    const plan = planAuthCallback(
      `${ORIGIN}/auth/callback#access_token=at&refresh_token=rt`,
    );
    expect(plan).toEqual({
      kind: "set_session",
      access_token: "at",
      refresh_token: "rt",
      destination: "/admin/sites",
    });
  });

  it("requires BOTH access_token and refresh_token — alone, neither qualifies", () => {
    const onlyAccess = planAuthCallback(
      `${ORIGIN}/auth/callback#access_token=at-only`,
    );
    expect(onlyAccess).toEqual({
      kind: "auth_error",
      reason: "missing_code",
    });

    const onlyRefresh = planAuthCallback(
      `${ORIGIN}/auth/callback#refresh_token=rt-only`,
    );
    expect(onlyRefresh).toEqual({
      kind: "auth_error",
      reason: "missing_code",
    });
  });
});

describe("planAuthCallback: error fragments", () => {
  it("forwards `error` from the fragment", () => {
    const plan = planAuthCallback(
      `${ORIGIN}/auth/callback#error=access_denied&error_description=link+expired`,
    );
    expect(plan).toEqual({
      kind: "auth_error",
      reason: "access_denied",
    });
  });

  it("forwards `error_code` when `error` is absent", () => {
    const plan = planAuthCallback(
      `${ORIGIN}/auth/callback#error_code=otp_expired`,
    );
    expect(plan).toEqual({
      kind: "auth_error",
      reason: "otp_expired",
    });
  });

  it("error fragment outranks an access_token also present", () => {
    const plan = planAuthCallback(
      `${ORIGIN}/auth/callback#error=access_denied&access_token=at&refresh_token=rt`,
    );
    expect(plan).toEqual({
      kind: "auth_error",
      reason: "access_denied",
    });
  });
});

describe("planAuthCallback: server-handled query shapes", () => {
  it("forwards ?code= to /api/auth/callback with the full query intact", () => {
    const plan = planAuthCallback(
      `${ORIGIN}/auth/callback?code=pkce-1&next=%2Fauth%2Freset-password`,
    );
    expect(plan).toEqual({
      kind: "forward_to_api",
      target: "/api/auth/callback?code=pkce-1&next=%2Fauth%2Freset-password",
    });
  });

  it("forwards ?token_hash=&type= to /api/auth/callback", () => {
    const plan = planAuthCallback(
      `${ORIGIN}/auth/callback?token_hash=hash-1&type=recovery&next=%2Fauth%2Freset-password`,
    );
    expect(plan).toEqual({
      kind: "forward_to_api",
      target:
        "/api/auth/callback?token_hash=hash-1&type=recovery&next=%2Fauth%2Freset-password",
    });
  });

  it("hash-fragment session beats query-string code (implicit wins)", () => {
    // If both shapes are present (shouldn't happen but defend against
    // it), prefer the implicit-flow path because it's the one this
    // page is uniquely positioned to handle. The server route can
    // still be reached by direct navigation.
    const plan = planAuthCallback(
      `${ORIGIN}/auth/callback?code=pkce-1#access_token=at&refresh_token=rt&type=recovery`,
    );
    expect(plan.kind).toBe("set_session");
  });
});

describe("planAuthCallback: open-redirect guards on ?next=", () => {
  it("ignores absolute ?next= URLs (cross-origin)", () => {
    const plan = planAuthCallback(
      `${ORIGIN}/auth/callback?next=https%3A%2F%2Fevil.example%2Fphish#access_token=at&refresh_token=rt`,
    );
    expect(plan).toEqual({
      kind: "set_session",
      access_token: "at",
      refresh_token: "rt",
      destination: "/admin/sites",
    });
  });

  it("ignores protocol-relative ?next= (//evil)", () => {
    const plan = planAuthCallback(
      `${ORIGIN}/auth/callback?next=%2F%2Fevil.example#access_token=at&refresh_token=rt`,
    );
    expect(plan).toEqual({
      kind: "set_session",
      access_token: "at",
      refresh_token: "rt",
      destination: "/admin/sites",
    });
  });

  it("recovery destination is unaffected by ?next= — always /auth/reset-password", () => {
    // A recovery link with `next=/admin/sites` would be a misconfiguration
    // (recovery means "set new password," not "go to admin"). The page
    // pins the destination to /auth/reset-password regardless of `next`.
    const plan = planAuthCallback(
      `${ORIGIN}/auth/callback?next=%2Fadmin%2Fsites#access_token=at&refresh_token=rt&type=recovery`,
    );
    expect(plan).toEqual({
      kind: "set_session",
      access_token: "at",
      refresh_token: "rt",
      destination: "/auth/reset-password",
    });
  });
});

describe("planAuthCallback: nothing recognised", () => {
  it("returns auth_error(missing_code) when no token shape is present", () => {
    const plan = planAuthCallback(`${ORIGIN}/auth/callback`);
    expect(plan).toEqual({
      kind: "auth_error",
      reason: "missing_code",
    });
  });

  it("returns auth_error(missing_code) when only `next` is present", () => {
    const plan = planAuthCallback(
      `${ORIGIN}/auth/callback?next=%2Fadmin%2Fsites`,
    );
    expect(plan).toEqual({
      kind: "auth_error",
      reason: "missing_code",
    });
  });
});
