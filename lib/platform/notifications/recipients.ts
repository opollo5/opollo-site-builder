import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

import type { ResolvedRecipient } from "./types";

// Recipient resolvers. Each returns the resolved set of recipients for
// the given context. Callers in dispatch.ts compose these into the
// final recipient list per event.
//
// Service-role only. RLS bypass is fine — the dispatcher is server-only
// and the caller has already authorized the action that triggers the
// notification.

export async function resolveCompanyAdmins(
  companyId: string,
): Promise<ResolvedRecipient[]> {
  const svc = getServiceRoleClient();

  const memberships = await svc
    .from("platform_company_users")
    .select("user_id")
    .eq("company_id", companyId)
    .eq("role", "admin");
  if (memberships.error) {
    logger.error("notifications.recipients.company_admins_failed", {
      err: memberships.error.message,
    });
    return [];
  }
  if ((memberships.data?.length ?? 0) === 0) return [];

  const userIds = (memberships.data ?? []).map((m) => m.user_id as string);
  return resolveUsersByIds(userIds);
}

export async function resolveOpolloAdmins(): Promise<ResolvedRecipient[]> {
  // Two ways an Opollo admin can be reachable:
  //   1. PLATFORM_ADMIN_ALERT_EMAILS env (configurable list, used until V2
  //      has a UI for it per the platform-customer-management skill).
  //   2. platform_users where is_opollo_staff = true (in-platform users).
  // The env list is authoritative for email; the in-platform users get
  // in-app notifications via their user_id.
  const svc = getServiceRoleClient();

  const staffResult = await svc
    .from("platform_users")
    .select("id, email, full_name")
    .eq("is_opollo_staff", true);

  if (staffResult.error) {
    logger.error("notifications.recipients.opollo_staff_failed", {
      err: staffResult.error.message,
    });
    return [];
  }

  const staff: ResolvedRecipient[] = (staffResult.data ?? []).map((u) => ({
    userId: u.id as string,
    email: u.email as string,
    fullName: (u.full_name as string | null) ?? null,
  }));

  // Env-configured email-only recipients (no userId — they're not
  // platform users, just inboxes that should always be alerted).
  const envEmails = (process.env.PLATFORM_ADMIN_ALERT_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0 && e.includes("@"));

  const seen = new Set(staff.map((r) => r.email.toLowerCase()));
  const envRecipients: ResolvedRecipient[] = envEmails
    .filter((email) => !seen.has(email))
    .map((email) => ({ userId: null, email, fullName: null }));

  return [...staff, ...envRecipients];
}

export async function resolveUserById(
  userId: string,
): Promise<ResolvedRecipient | null> {
  const list = await resolveUsersByIds([userId]);
  return list[0] ?? null;
}

export async function resolveUsersByIds(
  userIds: string[],
): Promise<ResolvedRecipient[]> {
  if (userIds.length === 0) return [];
  const svc = getServiceRoleClient();
  const result = await svc
    .from("platform_users")
    .select("id, email, full_name")
    .in("id", userIds);
  if (result.error) {
    logger.error("notifications.recipients.users_by_ids_failed", {
      err: result.error.message,
    });
    return [];
  }
  return (result.data ?? []).map((u) => ({
    userId: u.id as string,
    email: u.email as string,
    fullName: (u.full_name as string | null) ?? null,
  }));
}

// Deduplicate by email — a person should only receive one copy even if
// they qualify under multiple recipient kinds (e.g. submitter who is
// also a company admin).
export function dedupeByEmail(
  recipients: ResolvedRecipient[],
): ResolvedRecipient[] {
  const seen = new Set<string>();
  const out: ResolvedRecipient[] = [];
  for (const r of recipients) {
    const key = r.email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}
