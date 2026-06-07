/**
 * scripts/seed-staging.ts — seed the staging Supabase project with test users,
 * roles, a test company, and an optional smoke-test feedback ticket.
 *
 * HARD GUARD: throws immediately if SUPABASE_URL points at the production
 * project. It is structurally impossible to run this script against prod.
 *
 * Usage (from repo root):
 *   SUPABASE_URL=https://bjiiqnetaxoibhcaukqm.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<staging-srk> \
 *     npx tsx scripts/seed-staging.ts
 *
 * Idempotent — safe to re-run. Users whose auth row already exists are
 * skipped; rows in opollo_users / platform_users / platform_companies are
 * upserted on conflict. Passwords are generated fresh on each run for users
 * that don't yet exist in auth.users, and printed once to stdout.
 *
 * Seed personas:
 *   steven.m@opollo.com           super_admin, is_opollo_staff=true
 *   uat-bot@staging.opollo.com    admin,       is_opollo_staff=true
 *   test-member@staging.opollo.com user,        is_opollo_staff=false (company member)
 */

import { createClient } from "@supabase/supabase-js";
import * as crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Hard prod guard — must be the first executable code.
// ---------------------------------------------------------------------------

const PROD_REF = "sazapxgmrdaewrkwoxby";
const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (SUPABASE_URL.includes(PROD_REF)) {
  throw new Error(
    `ABORT: SUPABASE_URL contains the production project ref ("${PROD_REF}"). ` +
    `This script must never run against the production database. ` +
    `Set SUPABASE_URL to the staging project URL and retry.`,
  );
}

if (!SUPABASE_URL || !SUPABASE_URL.startsWith("https://")) {
  throw new Error(
    `ABORT: SUPABASE_URL is not set or is not a valid https URL. Got: "${SUPABASE_URL}". ` +
    `Set SUPABASE_URL=https://bjiiqnetaxoibhcaukqm.supabase.co and retry.`,
  );
}

if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("ABORT: SUPABASE_SERVICE_ROLE_KEY is not set.");
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function strongPassword(): string {
  // 20 hex chars (lowercase + digits) prefixed with a fixed uppercase char.
  // No shell-special characters — safe to echo.
  return `T${crypto.randomBytes(10).toString("hex")}Mz4`;
}

function log(msg: string) {
  console.log(`[seed-staging] ${msg}`);
}

async function upsertRow(
  table: string,
  row: Record<string, unknown>,
  conflictCol = "id",
) {
  const { error } = await supa
    .from(table)
    .upsert(row, { onConflict: conflictCol });
  if (error) {
    throw new Error(`upsert ${table} failed: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Personas
// ---------------------------------------------------------------------------

const PERSONAS: Array<{
  email: string;
  fullName: string;
  opolloRole: "super_admin" | "admin" | "user";
  isOpolloStaff: boolean;
  addToCompany: boolean;
}> = [
  {
    email: "steven.m@opollo.com",
    fullName: "Steven Morey",
    opolloRole: "super_admin",
    isOpolloStaff: true,
    addToCompany: false,
  },
  {
    email: "uat-bot@staging.opollo.com",
    fullName: "UAT Bot",
    opolloRole: "admin",
    isOpolloStaff: true,
    addToCompany: false,
  },
  {
    email: "test-member@staging.opollo.com",
    fullName: "Test Member",
    opolloRole: "user",
    isOpolloStaff: false,
    addToCompany: true,
  },
];

const TEST_COMPANY_NAME = "Staging Test Co";

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log(`Target: ${SUPABASE_URL}`);
  log("Prod guard: PASSED — URL does not contain production ref");
  log("─".repeat(60));

  const printed: Array<{ email: string; password: string; action: string }> = [];

  // 1. Auth users — create only if missing
  const userIds = new Map<string, string>(); // email → auth uid

  for (const persona of PERSONAS) {
    // List users and find by email (admin API doesn't have get-by-email directly)
    const { data: listData, error: listErr } = await supa.auth.admin.listUsers({
      perPage: 1000,
    });
    if (listErr) throw new Error(`listUsers failed: ${listErr.message}`);

    const existing = listData.users.find((u) => u.email === persona.email);

    if (existing) {
      log(`auth user: ${persona.email} — already exists (${existing.id})`);
      userIds.set(persona.email, existing.id);
      printed.push({ email: persona.email, password: "(existing — unchanged)", action: "skipped" });
    } else {
      const pwd = strongPassword();
      const { data, error } = await supa.auth.admin.createUser({
        email: persona.email,
        password: pwd,
        email_confirm: true,
      });
      if (error) throw new Error(`createUser ${persona.email}: ${error.message}`);
      const uid = data.user.id;
      log(`auth user: ${persona.email} — created (${uid})`);
      userIds.set(persona.email, uid);
      printed.push({ email: persona.email, password: pwd, action: "created" });
    }
  }

  // 2. opollo_users rows
  for (const persona of PERSONAS) {
    const uid = userIds.get(persona.email)!;
    await upsertRow("opollo_users", {
      id: uid,
      email: persona.email,
      role: persona.opolloRole,
    });
    log(`opollo_users: ${persona.email} role=${persona.opolloRole}`);
  }

  // 3. platform_users rows
  for (const persona of PERSONAS) {
    const uid = userIds.get(persona.email)!;
    await upsertRow("platform_users", {
      id: uid,
      email: persona.email,
      full_name: persona.fullName,
      is_opollo_staff: persona.isOpolloStaff,
    });
    log(`platform_users: ${persona.email} is_opollo_staff=${persona.isOpolloStaff}`);
  }

  // 4. Test company
  const { data: existingCo } = await supa
    .from("platform_companies")
    .select("id")
    .eq("name", TEST_COMPANY_NAME)
    .maybeSingle();

  let companyId: string;
  if (existingCo?.id) {
    companyId = existingCo.id as string;
    log(`platform_companies: "${TEST_COMPANY_NAME}" — already exists (${companyId})`);
  } else {
    const { data: newCo, error: coErr } = await supa
      .from("platform_companies")
      .insert({ name: TEST_COMPANY_NAME, slug: "staging-test-co" })
      .select("id")
      .single();
    if (coErr) throw new Error(`insert platform_companies: ${coErr.message}`);
    companyId = (newCo as { id: string }).id;
    log(`platform_companies: "${TEST_COMPANY_NAME}" — created (${companyId})`);
  }

  // 5. Add test-member to the company
  const memberEmail = "test-member@staging.opollo.com";
  const memberUid = userIds.get(memberEmail)!;

  const { data: existingMembership } = await supa
    .from("platform_company_users")
    .select("id")
    .eq("user_id", memberUid)
    .eq("company_id", companyId)
    .maybeSingle();

  if (existingMembership) {
    log(`company membership: ${memberEmail} — already member of ${TEST_COMPANY_NAME}`);
  } else {
    const { error: memErr } = await supa.from("platform_company_users").insert({
      user_id: memberUid,
      company_id: companyId,
      role: "admin",
    });
    if (memErr) {
      // Non-fatal: table name may differ — log and continue
      log(`company membership: ${memberEmail} — WARN: ${memErr.message}`);
    } else {
      log(`company membership: ${memberEmail} — added to ${TEST_COMPANY_NAME} as admin`);
    }
  }

  // 6. Optional smoke-test feedback ticket (only if feedback_tickets exists)
  const { error: ftErr } = await supa
    .from("feedback_tickets")
    .select("id")
    .limit(1);

  if (ftErr) {
    log("feedback_tickets: table not present — skipping smoke ticket (migrations not yet pushed?)");
  } else {
    const { data: existingTicket } = await supa
      .from("feedback_tickets")
      .select("id")
      .eq("company_id", companyId)
      .eq("title", "[SEED] Smoke test ticket")
      .maybeSingle();

    if (existingTicket) {
      log("feedback_tickets: smoke ticket already exists — skipping");
    } else {
      const staffUid = userIds.get("steven.m@opollo.com")!;
      const { error: tErr } = await supa.from("feedback_tickets").insert({
        company_id: companyId,
        title: "[SEED] Smoke test ticket",
        description: "Seeded by seed-staging.ts. Confirms feedback_tickets table is accessible from staging.",
        severity: "normal",
        priority: "low",
        status: "backlog",
        tags: ["seed"],
        page_url: "https://staging.opollo.com/",
        css_selector: "body",
        click_x_pct: 50,
        click_y_pct: 50,
        viewport_w: 1440,
        viewport_h: 900,
        created_by: staffUid,
        updated_by: staffUid,
      });
      if (tErr) {
        log(`feedback_tickets: WARN: ${tErr.message}`);
      } else {
        log("feedback_tickets: smoke ticket created");
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  log("─".repeat(60));
  log("Seed complete. Credentials for new users:");
  log("─".repeat(60));
  for (const { email, password, action } of printed) {
    if (action === "created") {
      console.log(`  ${email.padEnd(38)}  ${password}`);
    } else {
      console.log(`  ${email.padEnd(38)}  (existing — password unchanged)`);
    }
  }
  log("─".repeat(60));
  log("Store passwords in 1Password or your team password manager. This script will not print them again.");
}

main().catch((err) => {
  console.error("[seed-staging] FATAL:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
