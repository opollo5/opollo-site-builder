import { createClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Global setup — runs once before the E2E suite.
//
// Responsibilities:
//   1. Reach a local Supabase (tests assume `supabase start` has already
//      run; the e2e CI workflow handles this explicitly).
//   2. Seed a predictable admin user the suite can sign in as. Email +
//      password live in e2e/fixtures.ts so every spec shares them.
//   3. Seed a single active site + design system + template so the
//      batches spec has something to create against. Unit-test seeding
//      helpers can't be reused here — they live behind vitest's module
//      graph — so we re-implement the minimal path via the service
//      role REST client.
//
// This runs OUTSIDE the Next.js process, so no @/ imports. Direct
// supabase-js only.
// ---------------------------------------------------------------------------

import {
  E2E_ADMIN_EMAIL,
  E2E_ADMIN_PASSWORD,
  E2E_CUSTOMER_COMPANY_SLUG,
  E2E_CUSTOMER_EMAIL,
  E2E_CUSTOMER_PASSWORD,
  E2E_TEST_SITE_PREFIX,
} from "./fixtures";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `E2E globalSetup: ${name} is not set. Run \`supabase start\` and re-export the CLI output before running Playwright.`,
    );
  }
  return v;
}

async function ensureAdminUser(): Promise<void> {
  const supabase = createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // Look up existing user via listUsers; createUser is idempotent-ish
  // but errors loudly on duplicate email.
  const { data: list, error: listErr } = await supabase.auth.admin.listUsers();
  if (listErr) {
    throw new Error(`listUsers failed: ${listErr.message}`);
  }
  const existing = list.users.find(
    (u) => u.email?.toLowerCase() === E2E_ADMIN_EMAIL.toLowerCase(),
  );

  let userId: string;
  if (existing) {
    userId = existing.id;
  } else {
    const { data: created, error: createErr } =
      await supabase.auth.admin.createUser({
        email: E2E_ADMIN_EMAIL,
        password: E2E_ADMIN_PASSWORD,
        email_confirm: true,
      });
    if (createErr || !created.user) {
      throw new Error(
        `createUser failed: ${createErr?.message ?? "no user"}`,
      );
    }
    userId = created.user.id;
  }

  // Trigger in migration 0004 auto-inserts opollo_users on new
  // auth.users row with role='viewer'. Promote to admin.
  const { error: roleErr } = await supabase
    .from("opollo_users")
    .update({ role: "admin" })
    .eq("id", userId);
  if (roleErr) {
    throw new Error(`opollo_users promote failed: ${roleErr.message}`);
  }
}

async function ensureTestSite(): Promise<void> {
  const supabase = createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // Existing site with the E2E prefix? Use it.
  const { data: existing } = await supabase
    .from("sites")
    .select("id")
    .eq("prefix", E2E_TEST_SITE_PREFIX)
    .neq("status", "removed")
    .maybeSingle();
  if (existing) return;

  const { error } = await supabase.from("sites").insert({
    name: "E2E Test Site",
    wp_url: "https://e2e.test",
    prefix: E2E_TEST_SITE_PREFIX,
    status: "active",
  });
  if (error) {
    throw new Error(`seed test site failed: ${error.message}`);
  }
}

async function ensureCustomerCompanyAndAdmin(): Promise<void> {
  const supabase = createClient(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // 1. Auth user (idempotent).
  const { data: list, error: listErr } = await supabase.auth.admin.listUsers();
  if (listErr) throw new Error(`listUsers failed: ${listErr.message}`);
  const existing = list.users.find(
    (u) => u.email?.toLowerCase() === E2E_CUSTOMER_EMAIL.toLowerCase(),
  );

  let userId: string;
  if (existing) {
    userId = existing.id;
  } else {
    const { data: created, error: createErr } =
      await supabase.auth.admin.createUser({
        email: E2E_CUSTOMER_EMAIL,
        password: E2E_CUSTOMER_PASSWORD,
        email_confirm: true,
      });
    if (createErr || !created.user) {
      throw new Error(`createUser failed: ${createErr?.message ?? "no user"}`);
    }
    userId = created.user.id;
  }

  // 2. platform_companies row (idempotent on slug).
  let companyId: string;
  const { data: existingCo } = await supabase
    .from("platform_companies")
    .select("id")
    .eq("slug", E2E_CUSTOMER_COMPANY_SLUG)
    .maybeSingle();
  if (existingCo) {
    companyId = existingCo.id as string;
  } else {
    const { data: newCo, error: coErr } = await supabase
      .from("platform_companies")
      .insert({
        name: "E2E Customer Co",
        slug: E2E_CUSTOMER_COMPANY_SLUG,
      })
      .select("id")
      .single();
    if (coErr || !newCo) {
      throw new Error(`platform_companies insert failed: ${coErr?.message ?? "no row"}`);
    }
    companyId = newCo.id as string;
  }

  // 3. platform_users row (idempotent on id).
  const { error: puErr } = await supabase
    .from("platform_users")
    .upsert(
      { id: userId, email: E2E_CUSTOMER_EMAIL },
      { onConflict: "id", ignoreDuplicates: true },
    );
  if (puErr) throw new Error(`platform_users upsert failed: ${puErr.message}`);

  // 4. platform_company_users (admin role, idempotent on user_id).
  const { error: pcuErr } = await supabase
    .from("platform_company_users")
    .upsert(
      { company_id: companyId, user_id: userId, role: "admin" },
      { onConflict: "user_id", ignoreDuplicates: true },
    );
  if (pcuErr) {
    throw new Error(`platform_company_users upsert failed: ${pcuErr.message}`);
  }
}

export default async function globalSetup(): Promise<void> {
  await ensureAdminUser();
  await ensureTestSite();
  await ensureCustomerCompanyAndAdmin();
}
