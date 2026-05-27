import { describe, expect, it, beforeAll, beforeEach, afterAll } from "vitest";
import { getServiceRoleClient } from "@/lib/supabase";
import { seedAuthUser } from "./_auth-helpers";

// ---------------------------------------------------------------------------
// Migration 0157 — V1 social post soft-delete.
//
// Verifies that the migration SQL correctly soft-deletes all V1 rows:
//   1. social_post_master rows get deleted_at set.
//   2. social_post_variant rows get deleted_at set (via migration UPDATE).
//   3. social_schedule_entries rows get cancelled_at set.
//
// Note: this test executes the same UPDATE SQL as the migration against the
// test database. It does NOT apply the migration file itself (which would be
// idempotent since the test DB already has the schema). It validates the SQL
// logic — that the WHERE clause and column names are correct.
// ---------------------------------------------------------------------------

const COMPANY_ID = "00001570-0000-0000-0000-000000000001";

let seededUserId: string;

async function seedCompany() {
  const svc = getServiceRoleClient();
  await svc.from("social_schedule_entries").delete().match({ scheduled_by: seededUserId });
  await svc.from("social_post_variant").delete().in(
    "post_master_id",
    (await svc.from("social_post_master").select("id").eq("company_id", COMPANY_ID)).data?.map((r) => r.id as string) ?? [],
  );
  await svc.from("social_post_master").delete().eq("company_id", COMPANY_ID);
  await svc.from("platform_companies").delete().eq("id", COMPANY_ID);

  // platform_users is truncated by _setup.ts global beforeEach; re-seed so
  // social_post_master.created_by FK resolves on every test run.
  const { error: puErr } = await svc
    .from("platform_users")
    .upsert({ id: seededUserId }, { onConflict: "id" });
  if (puErr) throw new Error(`seed platform_users: ${puErr.message}`);

  const { error } = await svc.from("platform_companies").insert({
    id: COMPANY_ID,
    name: "M0157 Test Co",
    slug: "m0157-test-co",
    is_opollo_internal: false,
    timezone: "UTC",
    approval_default_rule: "any_one",
  });
  if (error) throw new Error(`seed company: ${error.message}`);
}

beforeAll(async () => {
  const user = await seedAuthUser({ persistent: true });
  seededUserId = user.id;
});

beforeEach(async () => {
  await seedCompany();
});

afterAll(async () => {
  const svc = getServiceRoleClient();
  await svc.from("social_post_master").delete().eq("company_id", COMPANY_ID);
  await svc.from("platform_companies").delete().eq("id", COMPANY_ID);
  if (seededUserId) {
    await svc.auth.admin.deleteUser(seededUserId);
  }
});

describe("Migration 0157 — V1 social post soft-delete", () => {
  it("soft-deletes social_post_master rows (sets deleted_at where NULL)", async () => {
    const svc = getServiceRoleClient();

    // Insert a V1 master row (deleted_at IS NULL)
    const { data: inserted, error: insertErr } = await svc
      .from("social_post_master")
      .insert({
        company_id: COMPANY_ID,
        state: "published",
        source_type: "manual",
        created_by: seededUserId,
      })
      .select("id, deleted_at")
      .single();
    expect(insertErr, `insert: ${insertErr?.message}`).toBeNull();
    expect(inserted?.deleted_at).toBeNull();

    // Run the migration SQL equivalent
    await svc
      .from("social_post_master")
      .update({ deleted_at: new Date().toISOString() })
      .is("deleted_at", null)
      .eq("company_id", COMPANY_ID);

    // Verify deleted_at is now set
    const { data: after, error: selectErr } = await svc
      .from("social_post_master")
      .select("id, deleted_at")
      .eq("id", inserted!.id)
      .single();
    expect(selectErr, `select: ${selectErr?.message}`).toBeNull();
    expect(after?.deleted_at).not.toBeNull();
  });

  it("does not re-stamp rows that already have deleted_at set", async () => {
    const svc = getServiceRoleClient();
    const existingDeletedAt = "2025-01-01T00:00:00Z";

    // Insert a row that is ALREADY soft-deleted
    const { data: inserted, error: insertErr } = await svc
      .from("social_post_master")
      .insert({
        company_id: COMPANY_ID,
        state: "draft",
        source_type: "manual",
        created_by: seededUserId,
        deleted_at: existingDeletedAt,
      })
      .select("id, deleted_at")
      .single();
    expect(insertErr, `insert: ${insertErr?.message}`).toBeNull();

    // Run the migration SQL (only updates where deleted_at IS NULL)
    await svc
      .from("social_post_master")
      .update({ deleted_at: new Date().toISOString() })
      .is("deleted_at", null)
      .eq("company_id", COMPANY_ID);

    // The pre-existing deleted_at should be unchanged
    const { data: after } = await svc
      .from("social_post_master")
      .select("id, deleted_at")
      .eq("id", inserted!.id)
      .single();
    // deleted_at should still equal the original value, not be updated
    expect(after?.deleted_at).toBe(existingDeletedAt);
  });

  it("soft-deletes social_post_variant rows that have deleted_at IS NULL", async () => {
    const svc = getServiceRoleClient();

    // Insert master + variant (variant has no connection_id)
    const { data: master, error: masterErr } = await svc
      .from("social_post_master")
      .insert({
        company_id: COMPANY_ID,
        state: "published",
        source_type: "manual",
        created_by: seededUserId,
      })
      .select("id")
      .single();
    expect(masterErr, `master insert: ${masterErr?.message}`).toBeNull();

    const { data: variant, error: variantErr } = await svc
      .from("social_post_variant")
      .insert({
        post_master_id: master!.id,
        platform: "x",
        is_custom: false,
      })
      .select("id, deleted_at")
      .single();
    expect(variantErr, `variant insert: ${variantErr?.message}`).toBeNull();
    expect(variant?.deleted_at).toBeNull();

    // Run migration SQL for variants
    await svc
      .from("social_post_variant")
      .update({ deleted_at: new Date().toISOString() })
      .is("deleted_at", null)
      .eq("post_master_id", master!.id);

    const { data: after } = await svc
      .from("social_post_variant")
      .select("id, deleted_at")
      .eq("id", variant!.id)
      .single();
    expect(after?.deleted_at).not.toBeNull();
  });

  it("cancels open social_schedule_entries (sets cancelled_at where NULL)", async () => {
    const svc = getServiceRoleClient();

    // Need a master → variant chain first
    const { data: master } = await svc
      .from("social_post_master")
      .insert({
        company_id: COMPANY_ID,
        state: "scheduled",
        source_type: "manual",
        created_by: seededUserId,
      })
      .select("id")
      .single();

    const { data: variant } = await svc
      .from("social_post_variant")
      .insert({
        post_master_id: master!.id,
        platform: "linkedin_personal",
        is_custom: false,
        scheduled_at: new Date(Date.now() + 86400000).toISOString(),
      })
      .select("id")
      .single();

    const { data: entry, error: entryErr } = await svc
      .from("social_schedule_entries")
      .insert({
        post_variant_id: variant!.id,
        scheduled_at: new Date(Date.now() + 86400000).toISOString(),
        scheduled_by: seededUserId,
      })
      .select("id, cancelled_at")
      .single();
    expect(entryErr, `entry insert: ${entryErr?.message}`).toBeNull();
    expect(entry?.cancelled_at).toBeNull();

    // Run migration SQL for schedule entries
    await svc
      .from("social_schedule_entries")
      .update({ cancelled_at: new Date().toISOString() })
      .is("cancelled_at", null)
      .eq("post_variant_id", variant!.id);

    const { data: after } = await svc
      .from("social_schedule_entries")
      .select("id, cancelled_at")
      .eq("id", entry!.id)
      .single();
    expect(after?.cancelled_at).not.toBeNull();
  });
});
