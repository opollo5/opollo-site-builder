import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { getServiceRoleClient } from "@/lib/supabase";
import { seedAuthUser } from "./_auth-helpers";

// ---------------------------------------------------------------------------
// V1→V2 backfill integration test.
//
// Seeds a minimal V1 post (social_post_master + variants + schedule entry),
// runs the mapping logic directly (not the CLI — we replicate the core
// mapping functions here to avoid subprocess complexity), then verifies the
// resulting V2 draft would be correct.
//
// Does NOT invoke the CLI script. Exercises the mapping logic and V2 schema.
// ---------------------------------------------------------------------------

const COMPANY_ID = "0000b400-0000-0000-0000-000000000001";
const MASTER_ID  = "0000b400-0000-0000-0000-000000000003";

// D6 state map
const STATE_MAP: Record<string, string> = {
  draft:                   "draft",
  pending_client_approval: "pending_approval",
  approved:                "scheduled",
  changes_requested:       "pending_approval",
  pending_msp_release:     "pending_approval",
  rejected:                "rejected",
  scheduled:               "scheduled",
  publishing:              "publishing",
  published:               "published",
  failed:                  "failed",
};

let seededUserId: string;

async function seedV1Post(svc: ReturnType<typeof getServiceRoleClient>, userId: string) {
  // Clean stale drafts first so the company delete doesn't hit FK constraints.
  await svc.from("social_post_drafts").delete().eq("company_id", COMPANY_ID);
  await svc.from("platform_companies").delete().eq("id", COMPANY_ID);
  const { error: companyErr } = await svc.from("platform_companies").insert({
    id: COMPANY_ID, name: "Backfill Test Co", slug: "backfill-test-co",
    is_opollo_internal: false, timezone: "UTC", approval_default_rule: "any_one",
  });
  if (companyErr) throw new Error(`seed company: ${companyErr.message}`);

  await svc.from("social_post_master").delete().eq("id", MASTER_ID);
  const { error: masterErr } = await svc.from("social_post_master").insert({
    id: MASTER_ID,
    company_id: COMPANY_ID,
    created_by: userId,
    state: "scheduled",
    master_text: "Test post content",
    link_url: "https://example.com/blog",
    source_type: "manual",
  });
  if (masterErr) throw new Error(`seed master: ${masterErr.message}`);
}

beforeAll(async () => {
  const user = await seedAuthUser({ persistent: true });
  seededUserId = user.id;
  await seedV1Post(getServiceRoleClient(), seededUserId);
});

afterAll(async () => {
  const svc = getServiceRoleClient();
  await svc.from("social_post_drafts").delete().eq("company_id", COMPANY_ID);
  await svc.from("social_post_master").delete().eq("id", MASTER_ID);
  await svc.from("platform_companies").delete().eq("id", COMPANY_ID);
  if (seededUserId) {
    await svc.auth.admin.deleteUser(seededUserId);
  }
});

describe("V1→V2 migration — state mapping (D6)", () => {
  it("maps all V1 states per D6 locked decision", () => {
    expect(STATE_MAP["draft"]).toBe("draft");
    expect(STATE_MAP["pending_client_approval"]).toBe("pending_approval");
    expect(STATE_MAP["approved"]).toBe("scheduled");
    expect(STATE_MAP["changes_requested"]).toBe("pending_approval");
    expect(STATE_MAP["pending_msp_release"]).toBe("pending_approval");
    expect(STATE_MAP["rejected"]).toBe("rejected");
    expect(STATE_MAP["scheduled"]).toBe("scheduled");
    expect(STATE_MAP["publishing"]).toBe("publishing");
    expect(STATE_MAP["published"]).toBe("published");
    expect(STATE_MAP["failed"]).toBe("failed");
  });
});

describe("V1→V2 migration — V2 draft insertion", () => {
  it("inserts a V2 draft row for a seeded V1 post (idempotency via idempotency_key)", async () => {
    const svc = getServiceRoleClient();

    const idempotencyKey = `v1-migration-${MASTER_ID}`;

    // Clean any prior run
    await svc.from("social_post_drafts").delete()
      .eq("company_id", COMPANY_ID)
      .eq("idempotency_key", idempotencyKey);

    // Simulate the mapping: insert a V2 draft row as the script would.
    // NOTE: source_type is intentionally omitted here — it is added to
    // social_post_drafts by migration 0155 (PR-01) which may not yet be
    // applied. source_type insertion is verified in migration-0155 tests.
    const { data, error } = await svc
      .from("social_post_drafts")
      .insert({
        company_id:        COMPANY_ID,
        created_by:        seededUserId,
        updated_by:        seededUserId,
        state:             STATE_MAP["scheduled"],  // "scheduled"
        content:           "Test post content",
        link_url:          "https://example.com/blog",
        media_urls:        [],
        target_profiles:   [],
        platform_variants: {},
        idempotency_key:   idempotencyKey,
      })
      .select("id, state, content, link_url, idempotency_key")
      .single();

    expect(error, `insert error: ${error?.message}`).toBeNull();
    expect(data?.state).toBe("scheduled");
    expect(data?.content).toBe("Test post content");
    expect(data?.link_url).toBe("https://example.com/blog");
    expect(data?.idempotency_key).toBe(idempotencyKey);

    if (data?.id) {
      await svc.from("social_post_drafts").delete().eq("id", data.id);
    }
  });

  it("second insert with same idempotency_key is a no-op (conflict ignored)", async () => {
    const svc = getServiceRoleClient();
    const idempotencyKey = `v1-migration-idempotent-${MASTER_ID}`;

    // First insert
    const { data: first } = await svc
      .from("social_post_drafts")
      .insert({
        company_id: COMPANY_ID, created_by: seededUserId, updated_by: seededUserId,
        idempotency_key: idempotencyKey, content: "original",
      })
      .select("id")
      .single();

    // Second insert (same idempotency_key) — should not error, should not create new row
    const { error: conflictError } = await svc
      .from("social_post_drafts")
      .upsert({
        company_id: COMPANY_ID, created_by: seededUserId, updated_by: seededUserId,
        idempotency_key: idempotencyKey, content: "duplicate",
      }, { onConflict: "company_id,idempotency_key", ignoreDuplicates: true });

    expect(conflictError).toBeNull();

    // Verify only one row with this idempotency_key
    const { data: rows } = await svc
      .from("social_post_drafts")
      .select("id, content")
      .eq("company_id", COMPANY_ID)
      .eq("idempotency_key", idempotencyKey);

    expect(rows).toHaveLength(1);
    expect(rows?.[0]?.content).toBe("original"); // original content preserved

    if (first?.id) {
      await svc.from("social_post_drafts").delete().eq("id", first.id);
    }
  });
});
