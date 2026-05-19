import { describe, it, expect, afterEach } from "vitest";

// Tests for guardedCronSkip + sendgrid staging redirect live in their
// respective module tests. This file covers the integration between
// runtime-env.ts and cron-shared.ts.

import { sideEffectsGuarded } from "@/lib/runtime-env";

describe("sideEffectsGuarded integration with cron guard", () => {
  afterEach(() => {
    delete process.env.APP_ENV;
    delete process.env.STAGING_SIDE_EFFECTS_ENABLED;
  });

  it("is false in non-staging — crons run normally", () => {
    delete process.env.APP_ENV;
    expect(sideEffectsGuarded()).toBe(false);
  });

  it("is true in staging by default — crons are blocked", () => {
    process.env.APP_ENV = "staging";
    expect(sideEffectsGuarded()).toBe(true);
  });

  it("is false in staging when opted in — crons run", () => {
    process.env.APP_ENV = "staging";
    process.env.STAGING_SIDE_EFFECTS_ENABLED = "1";
    expect(sideEffectsGuarded()).toBe(false);
  });
});
