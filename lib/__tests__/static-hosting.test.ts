import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { writeStaticPage } from "@/lib/static-hosting";

// OPTIMISER PHASE 1.5 SLICE 14 — static hosting dry-run path.
//
// The real SFTP path requires a running SiteGround target; we cover
// the dry-run branch (when env vars are missing) here. The SFTP path
// is exercised end-to-end by the operator gate in production.

describe("writeStaticPage (dry-run mode)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.OPOLLO_HOSTING_HOST;
    delete process.env.OPOLLO_HOSTING_USER;
    delete process.env.OPOLLO_HOSTING_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns dry-run when none of the env vars are set", async () => {
    const result = await writeStaticPage({
      client_slug: "planet6",
      page_slug: "lawyer-marketing",
      html: "<html>Hello</html>",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (!("dry_run" in result) || !result.dry_run) {
      throw new Error("expected dry-run result");
    }
    expect(result.payload.reason).toBe("credentials_not_configured");
    expect(result.payload.missing_env_vars).toEqual([
      "OPOLLO_HOSTING_HOST",
      "OPOLLO_HOSTING_USER",
      "OPOLLO_HOSTING_KEY",
    ]);
    expect(result.payload.target_path).toBe(
      "/var/www/ads-opollo/planet6/lawyer-marketing.html",
    );
    expect(result.payload.body_size).toBe(18); // "<html>Hello</html>" = 18 bytes
    expect(result.payload.body_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.payload.would_have_archived_to).toMatch(
      /^\/var\/www\/ads-opollo\/history\/planet6\/lawyer-marketing-/,
    );
  });

  it("lists only the missing env vars when some are set", async () => {
    process.env.OPOLLO_HOSTING_HOST = "host.example.com";
    process.env.OPOLLO_HOSTING_USER = "opollo";
    // KEY still missing
    const result = await writeStaticPage({
      client_slug: "x",
      page_slug: "y",
      html: "z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (!("dry_run" in result) || !result.dry_run) {
      throw new Error("expected dry-run result");
    }
    expect(result.payload.missing_env_vars).toEqual(["OPOLLO_HOSTING_KEY"]);
  });

  it("captures byte size + sha256 for the body", async () => {
    const html = "<!DOCTYPE html><html><body>hello world</body></html>";
    const result = await writeStaticPage({
      client_slug: "c",
      page_slug: "p",
      html,
    });
    if (!result.ok) throw new Error("unexpected failure");
    if (!("dry_run" in result) || !result.dry_run) {
      throw new Error("expected dry-run result");
    }
    expect(result.payload.body_size).toBe(Buffer.byteLength(html, "utf8"));
    // sha256 of the literal body is deterministic.
    const { createHash } = await import("node:crypto");
    const expected = createHash("sha256").update(html).digest("hex");
    expect(result.payload.body_sha256).toBe(expected);
  });
});
