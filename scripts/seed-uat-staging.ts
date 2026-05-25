#!/usr/bin/env -S npx tsx
// scripts/seed-uat-staging.ts
//
// Idempotent UAT seed for the staging Supabase project.
// Run once after migrations to populate deterministic test data.
//
// Exit codes:
//   0 — full success
//   1 — hard failure (DB error, wrong environment, missing required env var)
//   2 — partial success (user created but seed data failed; check logs)
//
// Usage:
//   # Pull staging env first, then run:
//   vercel env pull --environment=preview .env.staging.local
//   npx tsx scripts/seed-uat-staging.ts
//
//   # Or supply env vars directly:
//   SUPABASE_URL=https://bjiiqnetaxoibhcaukqm.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=... \
//   npx tsx scripts/seed-uat-staging.ts
//
// Idempotency:
//   - User: looked up by email, updated if exists
//   - Company: looked up by slug='uat-staging', created if missing
//   - Child data (drafts, connections, images, snapshots): wiped and
//     re-seeded on every run so the state is always predictable

import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const STAGING_PROJECT_REF = "bjiiqnetaxoibhcaukqm";
const UAT_COMPANY_SLUG = "uat-staging";
const UAT_COMPANY_NAME = "UAT Test Company";
const DEFAULT_UAT_EMAIL = "uat-bot@staging.opollo.com";

function log(msg: string) {
  console.log(`[SEED] ${msg}`);
}

function warn(msg: string) {
  console.warn(`[SEED WARN] ${msg}`);
}

function fail(msg: string): never {
  console.error(`[SEED FAIL] ${msg}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Environment guard — hard-fail if not pointing at staging Supabase
// ---------------------------------------------------------------------------

function getEnv() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const uatEmail = process.env.STAGING_UAT_EMAIL ?? DEFAULT_UAT_EMAIL;
  const uatPassword = process.env.STAGING_UAT_PASSWORD ?? "";

  if (!url) fail("SUPABASE_URL is not set. Run: vercel env pull --environment=preview .env.staging.local");
  if (!key) fail("SUPABASE_SERVICE_ROLE_KEY is not set.");

  if (!url.includes(STAGING_PROJECT_REF)) {
    fail(
      `Refusing to seed — SUPABASE_URL does not contain staging project ref '${STAGING_PROJECT_REF}'.\n` +
        `  Got: ${url}\n` +
        `  This guard prevents accidentally seeding the production database.`,
    );
  }

  if (!uatPassword) {
    warn(
      "STAGING_UAT_PASSWORD is not set. User will be created without a password " +
        "and cannot sign in via the normal login flow. Set the STAGING_UAT_PASSWORD " +
        "env var (or GitHub secret) and re-run to set the password.",
    );
  }

  return { url, key, uatEmail, uatPassword };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { url, key, uatEmail, uatPassword } = getEnv();

  log(`Target: ${url}`);
  log(`UAT email: ${uatEmail}`);

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // -------------------------------------------------------------------------
  // 1. UAT auth user
  // -------------------------------------------------------------------------

  log("Creating/updating UAT auth user...");

  let uatUserId: string;

  const { data: listData, error: listError } = await supabase.auth.admin.listUsers({
    perPage: 1000,
  });

  if (listError) fail(`Failed to list auth users: ${listError.message}`);

  const existingAuthUser = listData.users.find((u) => u.email === uatEmail);

  if (existingAuthUser) {
    log(`  Auth user exists (${existingAuthUser.id}), updating password if set...`);
    uatUserId = existingAuthUser.id;
    if (uatPassword) {
      const { error: updateError } = await supabase.auth.admin.updateUserById(uatUserId, {
        password: uatPassword,
      });
      if (updateError) warn(`  Failed to update password: ${updateError.message}`);
      else log("  Password updated.");
    }
  } else {
    log("  Creating new auth user...");
    const createPayload: Parameters<typeof supabase.auth.admin.createUser>[0] = {
      email: uatEmail,
      email_confirm: true,
    };
    if (uatPassword) {
      (createPayload as Record<string, unknown>).password = uatPassword;
    }
    const { data: newUser, error: createError } = await supabase.auth.admin.createUser(createPayload);
    if (createError) fail(`Failed to create auth user: ${createError.message}`);
    uatUserId = newUser.user.id;
    log(`  Created auth user: ${uatUserId}`);
  }

  // -------------------------------------------------------------------------
  // 2. platform_users row (extended profile)
  // -------------------------------------------------------------------------

  log("Upserting platform_users row...");

  const { error: puError } = await supabase.from("platform_users").upsert(
    {
      id: uatUserId,
      email: uatEmail,
      full_name: "UAT Bot",
      is_opollo_staff: false,
    },
    { onConflict: "id" },
  );
  if (puError) fail(`Failed to upsert platform_users: ${puError.message}`);
  log("  platform_users OK");

  // -------------------------------------------------------------------------
  // 3. UAT staging company
  // -------------------------------------------------------------------------

  log("Upserting UAT company...");

  let uatCompanyId: string;

  const { data: existingCompany, error: companyLookupError } = await supabase
    .from("platform_companies")
    .select("id")
    .eq("slug", UAT_COMPANY_SLUG)
    .maybeSingle();

  if (companyLookupError) fail(`Failed to look up company: ${companyLookupError.message}`);

  if (existingCompany) {
    uatCompanyId = existingCompany.id as string;
    log(`  Company exists: ${uatCompanyId}`);
  } else {
    const { data: newCompany, error: companyCreateError } = await supabase
      .from("platform_companies")
      .insert({ name: UAT_COMPANY_NAME, slug: UAT_COMPANY_SLUG })
      .select("id")
      .single();
    if (companyCreateError) fail(`Failed to create company: ${companyCreateError.message}`);
    uatCompanyId = newCompany.id as string;
    log(`  Created company: ${uatCompanyId}`);
  }

  // -------------------------------------------------------------------------
  // 4. Company membership
  // -------------------------------------------------------------------------

  log("Upserting company membership...");

  const { error: membershipError } = await supabase.from("platform_company_users").upsert(
    {
      company_id: uatCompanyId,
      user_id: uatUserId,
      role: "admin",
    },
    { onConflict: "user_id" },
  );
  if (membershipError) fail(`Failed to upsert membership: ${membershipError.message}`);
  log("  Membership OK (role: admin)");

  // -------------------------------------------------------------------------
  // 5. Wipe existing child seed data for this company
  // -------------------------------------------------------------------------

  log("Wiping existing seed child data...");

  const wipeResults = await Promise.all([
    supabase
      .from("social_post_drafts")
      .delete()
      .eq("company_id", uatCompanyId),
    supabase
      .from("social_connections")
      .delete()
      .eq("company_id", uatCompanyId),
    // image_library is global (no company_id). Wipe by uat- source_ref prefix.
    supabase
      .from("image_library")
      .delete()
      .like("source_ref", "uat-%"),
    // login_challenges: the UAT user is synthetic and must never be rate-limited.
    // The login action caps at 5 challenges/hour (lib/2fa/challenges.ts +
    // app/login/actions.ts:157). Clear all rows so every seed run resets the count.
    supabase
      .from("login_challenges")
      .delete()
      .eq("user_id", uatUserId),
  ]);

  for (const { error } of wipeResults) {
    if (error) warn(`  Wipe partial failure: ${error.message}`);
  }
  log("  Wipe complete");

  // -------------------------------------------------------------------------
  // 6. Social connections (3 rows)
  // -------------------------------------------------------------------------

  log("Seeding social connections...");

  const connections = [
    {
      company_id: uatCompanyId,
      platform: "linkedin_company",
      bundle_social_account_id: "uat-stub-linkedin-001",
      display_name: "UAT Test Company (LinkedIn)",
      status: "healthy",
    },
    {
      company_id: uatCompanyId,
      platform: "facebook_page",
      bundle_social_account_id: "uat-stub-facebook-002",
      display_name: "UAT Test Company (Facebook)",
      status: "auth_required",
    },
    {
      company_id: uatCompanyId,
      platform: "x",
      bundle_social_account_id: "uat-stub-x-003",
      display_name: "@uat_test_company",
      status: "healthy",
    },
  ];

  const { error: connError } = await supabase.from("social_connections").insert(connections);
  if (connError) {
    warn(`Failed to insert connections: ${connError.message}`);
    process.exit(2);
  }
  log(`  Inserted ${connections.length} connections`);

  // -------------------------------------------------------------------------
  // 7. Social post drafts (5 rows)
  // -------------------------------------------------------------------------

  log("Seeding social post drafts...");

  const now = new Date();
  const inThreeDays = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString();
  const inSevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();

  const drafts = [
    {
      company_id: uatCompanyId,
      created_by: uatUserId,
      updated_by: uatUserId,
      state: "draft",
      content: "UAT draft post — not yet scheduled.",
      media_urls: [] as string[],
      target_profiles: [] as unknown[],
      platform_variants: {} as unknown,
      draft_data: {},
    },
    {
      company_id: uatCompanyId,
      created_by: uatUserId,
      updated_by: uatUserId,
      state: "scheduled",
      content: "UAT scheduled post #1 — going out in 3 days.",
      media_urls: ["https://placehold.co/600x400.jpg"] as string[],
      target_profiles: [] as unknown[],
      platform_variants: {} as unknown,
      scheduled_at: inThreeDays,
      draft_data: {},
    },
    {
      company_id: uatCompanyId,
      created_by: uatUserId,
      updated_by: uatUserId,
      state: "scheduled",
      content: "UAT scheduled post #2 — going out in 7 days. #uat #staging",
      media_urls: ["https://placehold.co/800x600.jpg"] as string[],
      target_profiles: [] as unknown[],
      platform_variants: {} as unknown,
      scheduled_at: inSevenDays,
      draft_data: {},
    },
    {
      company_id: uatCompanyId,
      created_by: uatUserId,
      updated_by: uatUserId,
      state: "publishing",
      content: "UAT post currently being published...",
      media_urls: [] as string[],
      target_profiles: [] as unknown[],
      platform_variants: {} as unknown,
      draft_data: {},
    },
    {
      company_id: uatCompanyId,
      created_by: uatUserId,
      updated_by: uatUserId,
      state: "published",
      content: "UAT published post — already live.",
      media_urls: [] as string[],
      target_profiles: [] as unknown[],
      platform_variants: {} as unknown,
      published_at: twoDaysAgo,
      published_url: "https://www.linkedin.com/posts/uat-stub-post-001",
      draft_data: {},
    },
  ];

  const { data: insertedDrafts, error: draftsError } = await supabase
    .from("social_post_drafts")
    .insert(drafts)
    .select("id, state");
  if (draftsError) {
    warn(`Failed to insert drafts: ${draftsError.message}`);
    process.exit(2);
  }
  log(`  Inserted ${insertedDrafts?.length ?? 0} drafts`);

  // -------------------------------------------------------------------------
  // 8. Image library (10 rows)
  // -------------------------------------------------------------------------

  log("Seeding image_library...");

  const imageSources = [
    { source: "istock", source_ref: "uat-istock-001", filename: "business-meeting.jpg", caption: "Business team meeting around a table", alt_text: "Team meeting", tags: ["business", "meeting", "team", "office"] },
    { source: "istock", source_ref: "uat-istock-002", filename: "technology-abstract.jpg", caption: "Abstract technology background with blue light", alt_text: "Technology abstract", tags: ["technology", "abstract", "blue", "digital"] },
    { source: "istock", source_ref: "uat-istock-003", filename: "marketing-strategy.jpg", caption: "Marketing strategy planning on whiteboard", alt_text: "Marketing planning", tags: ["marketing", "strategy", "whiteboard", "planning"] },
    { source: "upload", source_ref: "uat-upload-004", filename: "company-logo.png", caption: "Company brand logo on white background", alt_text: "Company logo", tags: ["brand", "logo", "identity"] },
    { source: "upload", source_ref: "uat-upload-005", filename: "team-photo.jpg", caption: "Company team photo outdoors", alt_text: "Team photo", tags: ["team", "people", "outdoor"] },
    { source: "istock", source_ref: "uat-istock-006", filename: "social-media-icons.jpg", caption: "Social media icons on smartphone screen", alt_text: "Social media", tags: ["social", "media", "smartphone", "icons"] },
    { source: "upload", source_ref: "uat-upload-007", filename: "product-showcase.jpg", caption: "Product showcase photography on clean background", alt_text: "Product photo", tags: ["product", "photography", "showcase"] },
    { source: "istock", source_ref: "uat-istock-008", filename: "growth-chart.jpg", caption: "Business growth chart showing upward trend", alt_text: "Growth chart", tags: ["growth", "chart", "business", "analytics"] },
    { source: "upload", source_ref: "uat-upload-009", filename: "event-photo.jpg", caption: "Corporate event with attendees networking", alt_text: "Networking event", tags: ["event", "networking", "corporate"] },
    { source: "istock", source_ref: "uat-istock-010", filename: "creative-workspace.jpg", caption: "Modern creative workspace with laptop and plants", alt_text: "Creative workspace", tags: ["workspace", "creative", "laptop", "office"] },
  ];

  // image_library is a global table (no company_id). created_by references
  // opollo_users, not platform_users — leave NULL for seed rows.
  const imageRows = imageSources.map((img) => ({
    cloudflare_id: null,
    filename: img.filename,
    caption: img.caption,
    alt_text: img.alt_text,
    tags: img.tags,
    source: img.source,
    source_ref: img.source_ref,
    license_type: img.source === "istock" ? "istock_standard" : null,
  }));

  const { data: insertedImages, error: imagesError } = await supabase
    .from("image_library")
    .insert(imageRows)
    .select("id");
  if (imagesError) {
    warn(`Failed to insert images: ${imagesError.message}`);
    process.exit(2);
  }
  log(`  Inserted ${insertedImages?.length ?? 0} images`);

  // -------------------------------------------------------------------------
  // 9. Analytics snapshot for the published post
  // -------------------------------------------------------------------------

  log("Seeding analytics snapshot...");

  const publishedDraft = insertedDrafts?.find((d) => d.state === "published");
  if (publishedDraft) {
    // Analytics snapshots require a profile_id; look up or skip gracefully
    const { data: profiles } = await supabase
      .from("platform_social_profiles")
      .select("id")
      .eq("company_id", uatCompanyId)
      .limit(1)
      .maybeSingle();

    if (profiles) {
      const { error: snapError } = await supabase
        .from("social_post_analytics_snapshots")
        .insert({
          profile_id: profiles.id,
          bundle_post_id: "uat-stub-bundle-post-001",
          platform: "linkedin_company",
          bundle_social_account_id: "uat-stub-linkedin-001",
          snapshot_date: new Date(twoDaysAgo).toISOString().slice(0, 10),
          posted_at: twoDaysAgo,
          post_url: "https://www.linkedin.com/posts/uat-stub-post-001",
          content: "UAT published post — already live.",
          impressions: 142,
          likes: 12,
          comments: 3,
          shares: 1,
          // engagement_rate is a GENERATED ALWAYS column — do not insert
        });
      if (snapError) {
        warn(`Failed to insert analytics snapshot: ${snapError.message}`);
      } else {
        log("  Inserted 1 analytics snapshot");
      }
    } else {
      log("  Skipping analytics snapshot — no social profiles yet (expected on fresh seed)");
    }
  }

  // -------------------------------------------------------------------------
  // 10. Summary
  // -------------------------------------------------------------------------

  log("");
  log("=== Seed complete ===");
  log(`  Auth user:    ${uatEmail} (${uatUserId})`);
  log(`  Company:      ${UAT_COMPANY_NAME} (${uatCompanyId})`);
  log(`  Role:         company_admin`);
  log(`  Connections:  ${connections.length} (LinkedIn healthy, Facebook auth_required, X healthy)`);
  log(`  Drafts:       ${insertedDrafts?.length ?? 0} (1 draft, 2 scheduled, 1 publishing, 1 published)`);
  log(`  Images:       ${insertedImages?.length ?? 0}`);
  log("");

  if (!uatPassword) {
    log("NOTE: STAGING_UAT_PASSWORD was not set. The UAT user cannot sign in via password.");
    log("      Set this env var and re-run, or sign in via magic link.");
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[SEED FATAL] Unhandled error: ${message}`);
  process.exit(1);
});
