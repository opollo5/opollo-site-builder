import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetValidationForTests,
  validateEnvCoupling,
  validateEnvCouplingOnce,
} from "@/lib/env-validation";

// validateEnvCoupling() emits warn-level log lines via the shared logger.
// The real logger writes JSON to stderr for warn-level calls, so we spy
// on console.error and parse the captured lines.

let stderr: string[];
const ENV_KEYS = [
  "LEADSOURCE_WP_URL",
  "NEXT_PUBLIC_LEADSOURCE_WP_URL",
  "NEXT_PUBLIC_SITE_URL",
  "CLOUDFLARE_IMAGES_HASH",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_IMAGES_API_TOKEN",
  "VERCEL_ENV",
];

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  stderr = [];
  vi.spyOn(console, "error").mockImplementation((line: unknown) => {
    stderr.push(String(line));
  });
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  __resetValidationForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

function parse(line: string): Record<string, unknown> {
  return JSON.parse(line) as Record<string, unknown>;
}

function warningsFor(check: string): Record<string, unknown>[] {
  return stderr
    .map(parse)
    .filter((rec) => rec.msg === "env_coupling_warning" && rec.check === check);
}

describe("validateEnvCoupling", () => {
  it("is silent when no relevant env vars are set", () => {
    validateEnvCoupling();
    expect(stderr).toEqual([]);
  });

  describe("leadsource_wp_url coupling", () => {
    it("is silent when both server and client URLs match", () => {
      process.env.LEADSOURCE_WP_URL = "https://wp.example.com";
      process.env.NEXT_PUBLIC_LEADSOURCE_WP_URL = "https://wp.example.com";
      validateEnvCoupling();
      expect(warningsFor("leadsource_wp_url")).toEqual([]);
    });

    it("warns when only the server URL is set", () => {
      process.env.LEADSOURCE_WP_URL = "https://wp.example.com";
      validateEnvCoupling();
      const warnings = warningsFor("leadsource_wp_url");
      expect(warnings).toHaveLength(1);
      expect(warnings[0].issue).toBe("server_set_client_missing");
    });

    it("warns when only the client URL is set", () => {
      process.env.NEXT_PUBLIC_LEADSOURCE_WP_URL = "https://wp.example.com";
      validateEnvCoupling();
      const warnings = warningsFor("leadsource_wp_url");
      expect(warnings).toHaveLength(1);
      expect(warnings[0].issue).toBe("client_set_server_missing");
    });

    it("warns when server and client URLs disagree", () => {
      process.env.LEADSOURCE_WP_URL = "https://wp.example.com";
      process.env.NEXT_PUBLIC_LEADSOURCE_WP_URL =
        "https://different.example.com";
      validateEnvCoupling();
      const warnings = warningsFor("leadsource_wp_url");
      expect(warnings).toHaveLength(1);
      expect(warnings[0].issue).toBe("server_client_mismatch");
      expect(warnings[0].server).toBe("https://wp.example.com");
      expect(warnings[0].client).toBe("https://different.example.com");
    });
  });

  describe("next_public_site_url", () => {
    it("warns when unset in production", () => {
      process.env.VERCEL_ENV = "production";
      validateEnvCoupling();
      const warnings = warningsFor("next_public_site_url");
      expect(warnings).toHaveLength(1);
      expect(warnings[0].issue).toBe("unset_in_production");
    });

    it("does not warn when unset outside production", () => {
      process.env.VERCEL_ENV = "preview";
      validateEnvCoupling();
      expect(warningsFor("next_public_site_url")).toEqual([]);
    });

    it("does not warn when unset with no VERCEL_ENV (local dev)", () => {
      validateEnvCoupling();
      expect(warningsFor("next_public_site_url")).toEqual([]);
    });

    it("warns when http:// in production", () => {
      process.env.VERCEL_ENV = "production";
      process.env.NEXT_PUBLIC_SITE_URL = "http://opollo.example.com";
      validateEnvCoupling();
      const warnings = warningsFor("next_public_site_url");
      expect(warnings).toHaveLength(1);
      expect(warnings[0].issue).toBe("non_https_in_production");
      expect(warnings[0].value).toBe("http://opollo.example.com");
    });

    it("is silent when https:// in production", () => {
      process.env.VERCEL_ENV = "production";
      process.env.NEXT_PUBLIC_SITE_URL = "https://opollo.example.com";
      validateEnvCoupling();
      expect(warningsFor("next_public_site_url")).toEqual([]);
    });

    it("is silent when http:// outside production", () => {
      process.env.VERCEL_ENV = "preview";
      process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
      validateEnvCoupling();
      expect(warningsFor("next_public_site_url")).toEqual([]);
    });
  });

  describe("cloudflare_images_hash", () => {
    it("is silent when both hash and creds are unset", () => {
      validateEnvCoupling();
      expect(warningsFor("cloudflare_images_hash")).toEqual([]);
    });

    it("warns when account id is set but hash is missing", () => {
      process.env.CLOUDFLARE_ACCOUNT_ID = "test-account";
      validateEnvCoupling();
      const warnings = warningsFor("cloudflare_images_hash");
      expect(warnings).toHaveLength(1);
      expect(warnings[0].issue).toBe("hash_missing_while_configured");
    });

    it("warns when api token is set but hash is missing", () => {
      process.env.CLOUDFLARE_IMAGES_API_TOKEN = "test-token";
      validateEnvCoupling();
      const warnings = warningsFor("cloudflare_images_hash");
      expect(warnings).toHaveLength(1);
      expect(warnings[0].issue).toBe("hash_missing_while_configured");
    });

    it("is silent when hash is set alongside creds", () => {
      process.env.CLOUDFLARE_ACCOUNT_ID = "test-account";
      process.env.CLOUDFLARE_IMAGES_API_TOKEN = "test-token";
      process.env.CLOUDFLARE_IMAGES_HASH = "abc123";
      validateEnvCoupling();
      expect(warningsFor("cloudflare_images_hash")).toEqual([]);
    });
  });

  describe("validateEnvCouplingOnce", () => {
    it("runs validation on first call", () => {
      process.env.LEADSOURCE_WP_URL = "https://wp.example.com";
      validateEnvCouplingOnce();
      expect(warningsFor("leadsource_wp_url")).toHaveLength(1);
    });

    it("is a no-op on subsequent calls", () => {
      process.env.LEADSOURCE_WP_URL = "https://wp.example.com";
      validateEnvCouplingOnce();
      validateEnvCouplingOnce();
      validateEnvCouplingOnce();
      expect(warningsFor("leadsource_wp_url")).toHaveLength(1);
    });

    it("resets after __resetValidationForTests", () => {
      process.env.LEADSOURCE_WP_URL = "https://wp.example.com";
      validateEnvCouplingOnce();
      __resetValidationForTests();
      validateEnvCouplingOnce();
      expect(warningsFor("leadsource_wp_url")).toHaveLength(2);
    });
  });
});
