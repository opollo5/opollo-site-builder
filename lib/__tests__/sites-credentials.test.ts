import { describe, expect, it } from "vitest";

import { getSite, updateSiteCredentials } from "@/lib/sites";
import { getServiceRoleClient } from "@/lib/supabase";

import { seedSite } from "./_helpers";

// ---------------------------------------------------------------------------
// Regression tests for the pending_pairing / credential upsert bugs.
//
// Migration 0056 deleted every site_credentials row and reset all sites to
// pending_pairing. Prior to this fix:
//
//   1. getSite with includeCredentials:true returned NOT_FOUND (404) when
//      the credentials row was missing, blocking the edit page.
//   2. updateSiteCredentials used UPDATE on site_credentials — a no-op when
//      the row doesn't exist — so credentials could never be saved post-0056.
//   3. Even when credentials were rotated, the site status stayed
//      pending_pairing forever because nothing flipped it back to active.
// ---------------------------------------------------------------------------

async function seedSiteWithoutCredentials(): Promise<{ id: string }> {
  const svc = getServiceRoleClient();
  const prefix = `cr${Math.random().toString(36).slice(2, 6)}`;
  const { data, error } = await svc
    .from("sites")
    .insert({
      name: `Credential Test ${prefix}`,
      wp_url: `https://${prefix}.test`,
      prefix,
      status: "pending_pairing",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`seed failed: ${error?.message}`);
  await svc.from("site_credentials").delete().eq("site_id", data.id as string);
  return { id: data.id as string };
}

describe("getSite with missing credentials row", () => {
  it("returns ok:true with credentials:null instead of NOT_FOUND", async () => {
    const { id } = await seedSiteWithoutCredentials();
    const result = await getSite(id, { includeCredentials: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.credentials).toBeNull();
    expect(result.data.site.id).toBe(id);
  });
});

describe("updateSiteCredentials upsert + status flip", () => {
  it("inserts a credentials row when none exists (post-migration-0056 case)", async () => {
    const { id } = await seedSiteWithoutCredentials();
    const result = await updateSiteCredentials(id, {
      wp_user: "admin",
      wp_app_password: "xxxx xxxx xxxx xxxx xxxx xxxx",
    });
    expect(result.ok).toBe(true);

    const svc = getServiceRoleClient();
    const { data } = await svc
      .from("site_credentials")
      .select("wp_user")
      .eq("site_id", id)
      .maybeSingle();
    expect(data?.wp_user).toBe("admin");
  });

  it("flips pending_pairing to active after a full credential save", async () => {
    const { id } = await seedSiteWithoutCredentials();
    const before = await getSite(id);
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    expect(before.data.site.status).toBe("pending_pairing");

    await updateSiteCredentials(id, {
      wp_user: "admin",
      wp_app_password: "xxxx xxxx xxxx xxxx xxxx xxxx",
    });

    const after = await getSite(id);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.data.site.status).toBe("active");
  });

  it("does not flip paused sites to active during credential rotation", async () => {
    const svc = getServiceRoleClient();
    const site = await seedSite();
    await svc.from("site_credentials").insert({
      site_id: site.id,
      wp_user: "paused-user",
      site_secret_encrypted: "\\x00",
      iv: "\\x00",
      key_version: 1,
    });
    await svc.from("sites").update({ status: "paused" }).eq("id", site.id);

    await updateSiteCredentials(site.id, {
      wp_user: "paused-user",
      wp_app_password: "zzzz zzzz zzzz zzzz zzzz zzzz",
    });

    const after = await getSite(site.id);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.data.site.status).toBe("paused");
  });
});
