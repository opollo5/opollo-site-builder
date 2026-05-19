import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Reset module state between tests so env changes are picked up.
// We can't use vi.resetModules() easily here since we import at top level,
// so we call the functions directly — they read process.env each call.

import { getRuntimeEnv, isProduction, isStaging, isPreview, isDevelopment, sideEffectsGuarded, stagingEmailRecipient } from "@/lib/runtime-env";

describe("getRuntimeEnv", () => {
  const orig = { ...process.env };

  afterEach(() => {
    // Restore originals
    Object.assign(process.env, orig);
    delete process.env.APP_ENV;
    delete process.env.VERCEL_ENV;
  });

  it("returns production when VERCEL_ENV=production", () => {
    process.env.VERCEL_ENV = "production";
    delete process.env.APP_ENV;
    expect(getRuntimeEnv()).toBe("production");
  });

  it("returns preview when VERCEL_ENV=preview", () => {
    process.env.VERCEL_ENV = "preview";
    delete process.env.APP_ENV;
    expect(getRuntimeEnv()).toBe("preview");
  });

  it("returns development when VERCEL_ENV unset", () => {
    delete process.env.VERCEL_ENV;
    delete process.env.APP_ENV;
    expect(getRuntimeEnv()).toBe("development");
  });

  it("APP_ENV overrides VERCEL_ENV — staging over preview", () => {
    process.env.VERCEL_ENV = "preview";
    process.env.APP_ENV = "staging";
    expect(getRuntimeEnv()).toBe("staging");
  });

  it("APP_ENV overrides VERCEL_ENV — production explicit", () => {
    process.env.VERCEL_ENV = "preview";
    process.env.APP_ENV = "production";
    expect(getRuntimeEnv()).toBe("production");
  });

  it("ignores unknown APP_ENV values, falls back to VERCEL_ENV", () => {
    process.env.VERCEL_ENV = "production";
    process.env.APP_ENV = "qa-east-1";
    expect(getRuntimeEnv()).toBe("production");
  });
});

describe("boolean helpers", () => {
  afterEach(() => {
    delete process.env.APP_ENV;
    delete process.env.VERCEL_ENV;
  });

  it("isProduction true only in production", () => {
    process.env.VERCEL_ENV = "production";
    expect(isProduction()).toBe(true);
    expect(isStaging()).toBe(false);
    expect(isPreview()).toBe(false);
    expect(isDevelopment()).toBe(false);
  });

  it("isStaging true only when APP_ENV=staging", () => {
    process.env.VERCEL_ENV = "preview";
    process.env.APP_ENV = "staging";
    expect(isStaging()).toBe(true);
    expect(isProduction()).toBe(false);
  });
});

describe("sideEffectsGuarded", () => {
  afterEach(() => {
    delete process.env.APP_ENV;
    delete process.env.VERCEL_ENV;
    delete process.env.STAGING_SIDE_EFFECTS_ENABLED;
  });

  it("returns false in production — side effects allowed", () => {
    process.env.VERCEL_ENV = "production";
    expect(sideEffectsGuarded()).toBe(false);
  });

  it("returns true in staging by default", () => {
    process.env.APP_ENV = "staging";
    expect(sideEffectsGuarded()).toBe(true);
  });

  it("returns false in staging when STAGING_SIDE_EFFECTS_ENABLED=1", () => {
    process.env.APP_ENV = "staging";
    process.env.STAGING_SIDE_EFFECTS_ENABLED = "1";
    expect(sideEffectsGuarded()).toBe(false);
  });

  it("returns false in development — side effects allowed locally", () => {
    delete process.env.VERCEL_ENV;
    expect(sideEffectsGuarded()).toBe(false);
  });
});

describe("stagingEmailRecipient", () => {
  afterEach(() => {
    delete process.env.APP_ENV;
    delete process.env.STAGING_EMAIL_RECIPIENT;
  });

  it("returns null outside staging", () => {
    delete process.env.APP_ENV;
    expect(stagingEmailRecipient()).toBeNull();
  });

  it("returns null in staging when STAGING_EMAIL_RECIPIENT unset", () => {
    process.env.APP_ENV = "staging";
    delete process.env.STAGING_EMAIL_RECIPIENT;
    expect(stagingEmailRecipient()).toBeNull();
  });

  it("returns override email in staging when STAGING_EMAIL_RECIPIENT set", () => {
    process.env.APP_ENV = "staging";
    process.env.STAGING_EMAIL_RECIPIENT = "staging@example.com";
    expect(stagingEmailRecipient()).toBe("staging@example.com");
  });
});
