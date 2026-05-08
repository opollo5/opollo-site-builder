import { describe, expect, it, beforeEach } from "vitest";

import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Migration 0110 -- expires_at + last_validated_at on social_connections.
//
// Verifies:
//   1. Both columns exist with the expected types (nullable timestamptz).
//   2. Valid timestamptz values can be written and read back.
//   3. Pre-expiry warning query returns only connections expiring within 7 days.
// ---------------------------------------------------------------------------

const COMPANY_ID = "00001100-0000-0000-0000-000000000001";

describe("migration 0110 -- social_connections expiry columns", () => {
  beforeEach(async () => {
    const svc = getServiceRoleClient();
    await svc.from("social_connections").delete().eq("company_id", COMPANY_ID);
    await svc.from("platform_companies").delete().eq("id", COMPANY_ID);
    await svc
      .from("platform_companies")
      .insert({
        id: COMPANY_ID,
        name: "Expiry Test Co",
        slug: "m0110-expiry-test",
        domain: "m0110-expiry.test",
        is_opollo_internal: false,
        timezone: "Australia/Melbourne",
        approval_default_rule: "any_one",
      });
  });

  it("allows inserting a connection with expires_at = NULL (column is nullable)", async () => {
    const svc = getServiceRoleClient();
    const { error } = await svc.from("social_connections").insert({
      company_id: COMPANY_ID,
      platform: "instagram",
      bundle_social_account_id: "m0110-acc-001",
      display_name: "Test Account",
      status: "healthy",
      expires_at: null,
      last_validated_at: null,
    });
    expect(error).toBeNull();
  });

  it("allows inserting a connection with explicit expires_at value", async () => {
    const svc = getServiceRoleClient();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await svc
      .from("social_connections")
      .insert({
        company_id: COMPANY_ID,
        platform: "facebook",
        bundle_social_account_id: "m0110-acc-002",
        display_name: "Test Facebook",
        status: "healthy",
        expires_at: expiresAt,
        last_validated_at: new Date().toISOString(),
      })
      .select("expires_at, last_validated_at")
      .single();

    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data!.expires_at).not.toBeNull();
    expect(data!.last_validated_at).not.toBeNull();
  });

  it("pre-expiry warning query returns only connections expiring within 7 days", async () => {
    const svc = getServiceRoleClient();

    const soonExpiry = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const farExpiry = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();

    await svc.from("social_connections").insert([
      {
        company_id: COMPANY_ID,
        platform: "linkedin",
        bundle_social_account_id: "m0110-acc-soon",
        display_name: "Soon Expires",
        status: "healthy",
        expires_at: soonExpiry,
        last_validated_at: new Date().toISOString(),
      },
      {
        company_id: COMPANY_ID,
        platform: "instagram",
        bundle_social_account_id: "m0110-acc-far",
        display_name: "Far Expiry",
        status: "healthy",
        expires_at: farExpiry,
        last_validated_at: new Date().toISOString(),
      },
      {
        company_id: COMPANY_ID,
        platform: "facebook",
        bundle_social_account_id: "m0110-acc-null",
        display_name: "No Expiry",
        status: "healthy",
        expires_at: null,
        last_validated_at: null,
      },
    ]);

    const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    const { data, error } = await svc
      .from("social_connections")
      .select("bundle_social_account_id")
      .lt("expires_at", sevenDaysFromNow)
      .gt("expires_at", now)
      .eq("status", "healthy")
      .eq("company_id", COMPANY_ID);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0]!.bundle_social_account_id).toBe("m0110-acc-soon");
  });
});
