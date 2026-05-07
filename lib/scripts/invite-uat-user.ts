/**
 * invite-uat-user.ts
 *
 * Sends a platform invitation to a customer user for a specific UAT company.
 *
 * Usage:
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config \
 *     lib/scripts/invite-uat-user.ts <company-slug> <email> [role]
 *
 * Examples:
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config \
 *     lib/scripts/invite-uat-user.ts vincovi user@vincovi.com admin
 *
 *   DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config \
 *     lib/scripts/invite-uat-user.ts ascii-group contact@ascii.com.au admin
 *
 * Role defaults to "admin" if not supplied (for UAT, all customers start as admin).
 * Valid roles: admin | approver | editor | viewer
 *
 * Accept URL is built from NEXT_PUBLIC_SITE_URL env var.
 */

import "dotenv/config";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const svcUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");

const [, , companySlug, email, roleArg] = process.argv;
const role = (roleArg ?? "admin") as "admin" | "approver" | "editor" | "viewer";

if (!companySlug || !email) {
  console.error("Usage: invite-uat-user.ts <company-slug> <email> [role]");
  process.exit(1);
}
if (!["admin", "approver", "editor", "viewer"].includes(role)) {
  console.error("role must be one of: admin | approver | editor | viewer");
  process.exit(1);
}
if (!svcUrl || !svcKey) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars.");
  process.exit(1);
}
if (!siteUrl) {
  console.error("Missing NEXT_PUBLIC_SITE_URL env var — needed to build the accept link.");
  process.exit(1);
}

const svc = createClient(svcUrl, svcKey, { auth: { persistSession: false } });

const VALID_ROLES = new Set(["admin", "approver", "editor", "viewer"]);
const TOKEN_BYTES = 32;
const EXPIRY_DAYS = 14;

async function main() {
  console.log(`\n=== INVITE UAT USER ===`);
  console.log(`Company: ${companySlug}`);
  console.log(`Email:   ${email}`);
  console.log(`Role:    ${role}\n`);

  // 1. Resolve company
  const { data: company, error: companyErr } = await svc
    .from("platform_companies")
    .select("id, name")
    .eq("slug", companySlug)
    .maybeSingle();

  if (companyErr) { console.error("Company lookup failed:", companyErr.message); process.exit(1); }
  if (!company) { console.error(`No company with slug "${companySlug}". Run provision-uat-companies.ts first.`); process.exit(1); }

  console.log(`Company resolved: ${company.name} (${company.id})`);

  // 2. Check for existing membership
  const { data: existingUser } = await svc
    .from("platform_users")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (existingUser) {
    const { data: membership } = await svc
      .from("platform_company_users")
      .select("company_id, role")
      .eq("user_id", existingUser.id)
      .maybeSingle();

    if (membership) {
      console.log(`⚠  ${email} is already a member of a company (${membership.company_id}, ${membership.role}).`);
      console.log("   V1 constraint: one user, one company. No action taken.");
      process.exit(0);
    }
  }

  // 3. Check for pending invite
  const { data: existingInvite } = await svc
    .from("platform_invitations")
    .select("id, status")
    .eq("company_id", company.id)
    .eq("email", email)
    .eq("status", "pending")
    .maybeSingle();

  if (existingInvite) {
    console.log(`⚠  Pending invitation already exists for ${email} in ${company.name}.`);
    console.log(`   Invitation ID: ${existingInvite.id}`);
    console.log("   No new invitation created.");
    process.exit(0);
  }

  // 4. Generate token + hash (same approach as lib/platform/invitations.ts)
  const rawToken = crypto.randomBytes(TOKEN_BYTES).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: invitation, error: insertErr } = await svc
    .from("platform_invitations")
    .insert({
      company_id: company.id,
      email,
      role,
      token_hash: tokenHash,
      status: "pending",
      expires_at: expiresAt,
      invited_by: null, // script-generated; no platform_users row for service role
    })
    .select("id, email, role, expires_at")
    .single();

  if (insertErr) { console.error("Insert invitation failed:", insertErr.message); process.exit(1); }

  const acceptUrl = `${siteUrl}/invite/${rawToken}`;

  console.log(`\n✓ Invitation created:`);
  console.log(`  ID:         ${invitation.id}`);
  console.log(`  Email:      ${invitation.email}`);
  console.log(`  Role:       ${invitation.role}`);
  console.log(`  Expires:    ${invitation.expires_at}`);
  console.log(`\n  Accept URL: ${acceptUrl}`);
  console.log(`\n  Send this link to ${email} so they can set their password and access the platform.`);

  process.exit(0);
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
