import { describe, expect, it } from "vitest";

import { assertSafeUrl, SsrfBlockedError } from "@/lib/ssrf-guard";

// BP-6 — SSRF guard tests. Pure logic + injectable lookup so we don't
// hit real DNS during the test run.

const okLookup = async () => ({ address: "93.184.216.34", family: 4 });

describe("assertSafeUrl — scheme guard", () => {
  it("rejects ftp://", async () => {
    await expect(
      assertSafeUrl("ftp://example.com/foo.jpg"),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });
  it("rejects file://", async () => {
    await expect(
      assertSafeUrl("file:///etc/passwd"),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });
  it("accepts https", async () => {
    const r = await assertSafeUrl("https://example.com/foo.jpg", {
      lookupImpl: okLookup,
    });
    expect(r.resolvedIp).toBe("93.184.216.34");
  });
});

describe("assertSafeUrl — hostname blocklist", () => {
  it("blocks localhost", async () => {
    await expect(
      assertSafeUrl("https://localhost/foo.jpg"),
    ).rejects.toMatchObject({ reason: "hostname_blocked" });
  });
  it("blocks metadata.google.internal", async () => {
    await expect(
      assertSafeUrl("https://metadata.google.internal/computeMetadata/v1/"),
    ).rejects.toMatchObject({ reason: "hostname_blocked" });
  });
  it("blocks *.internal heuristic", async () => {
    await expect(
      assertSafeUrl("https://prod-db.svc.internal/foo.jpg"),
    ).rejects.toMatchObject({ reason: "hostname_blocked" });
  });
});

describe("assertSafeUrl — IPv4 literal blocks", () => {
  it("blocks 127.0.0.1", async () => {
    await expect(
      assertSafeUrl("https://127.0.0.1/foo.jpg"),
    ).rejects.toMatchObject({ reason: "ip_blocked" });
  });
  it("blocks 10.0.0.5", async () => {
    await expect(
      assertSafeUrl("https://10.0.0.5/foo.jpg"),
    ).rejects.toMatchObject({ reason: "ip_blocked" });
  });
  it("blocks 172.20.5.1 (RFC1918 mid-range)", async () => {
    await expect(
      assertSafeUrl("https://172.20.5.1/foo.jpg"),
    ).rejects.toMatchObject({ reason: "ip_blocked" });
  });
  it("blocks 169.254.169.254 (AWS/GCP metadata)", async () => {
    await expect(
      assertSafeUrl("https://169.254.169.254/latest/meta-data/"),
    ).rejects.toMatchObject({ reason: "ip_blocked" });
  });
  it("blocks 0.0.0.0", async () => {
    await expect(
      assertSafeUrl("https://0.0.0.0/foo.jpg"),
    ).rejects.toMatchObject({ reason: "ip_blocked" });
  });
  it("accepts 8.8.8.8 (public)", async () => {
    const r = await assertSafeUrl("https://8.8.8.8/foo.jpg");
    expect(r.resolvedIp).toBe("8.8.8.8");
  });
});

describe("assertSafeUrl — DNS resolution blocks", () => {
  it("blocks hostnames resolving to private IP", async () => {
    await expect(
      assertSafeUrl("https://attacker.example/foo.jpg", {
        lookupImpl: async () => ({ address: "10.5.5.5", family: 4 }),
      }),
    ).rejects.toMatchObject({ reason: "ip_blocked" });
  });
  it("blocks hostnames resolving to loopback", async () => {
    await expect(
      assertSafeUrl("https://attacker.example/foo.jpg", {
        lookupImpl: async () => ({ address: "127.0.0.5", family: 4 }),
      }),
    ).rejects.toMatchObject({ reason: "ip_blocked" });
  });
  it("surfaces DNS failures as SsrfBlockedError", async () => {
    await expect(
      assertSafeUrl("https://nope.invalid/foo.jpg", {
        lookupImpl: async () => {
          throw new Error("ENOTFOUND");
        },
      }),
    ).rejects.toMatchObject({ reason: "dns_failed" });
  });
});

describe("assertSafeUrl — IPv6", () => {
  it("blocks ::1 loopback literal", async () => {
    await expect(
      assertSafeUrl("https://[::1]/foo.jpg"),
    ).rejects.toMatchObject({ reason: "ip_blocked" });
  });
  it("blocks fe80:: link-local literal", async () => {
    await expect(
      assertSafeUrl("https://[fe80::1]/foo.jpg"),
    ).rejects.toMatchObject({ reason: "ip_blocked" });
  });
  it("blocks fc00:: unique-local resolution", async () => {
    await expect(
      assertSafeUrl("https://attacker.example/foo.jpg", {
        lookupImpl: async () => ({ address: "fc00::1", family: 6 }),
      }),
    ).rejects.toMatchObject({ reason: "ip_blocked" });
  });
});
