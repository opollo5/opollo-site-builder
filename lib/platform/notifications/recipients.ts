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

// ---------------------------------------------------------------------------
// resolveOpolloAdmins — returns ALL platform_users where is_opollo_staff=true.
//
// Returns [] when no staff exist (graceful empty, not a throw). The empty
// case is logged as an error so it surfaces in observability; the caller
// (dispatch.ts) will see 0 recipients and the standard no_recipients log.
//
// DB errors throw — those are connection/permission failures, not a
// misconfiguration, and should surface immediately.
//
// SEAM — future assigned-staff filter goes here (e.g. narrow to staff who
// manage this company). If narrowing to assigned staff ever yields empty,
// fall back to ALL staff — never throw.
// ---------------------------------------------------------------------------
export async function resolveOpolloAdmins(): Promise<ResolvedRecipient[]> {
  const svc = getServiceRoleClient();

  const staffResult = await svc
    .from("platform_users")
    .select("id, email, full_name")
    .eq("is_opollo_staff", true);

  if (staffResult.error) {
    logger.error("notifications.recipients.opollo_staff_db_error", {
      err: staffResult.error.message,
    });
    throw new Error(
      `resolveOpolloAdmins: DB query failed — ${staffResult.error.message}`,
    );
  }

  const staff: ResolvedRecipient[] = (staffResult.data ?? []).map((u) => ({
    userId: u.id as string,
    email: u.email as string,
    fullName: (u.full_name as string | null) ?? null,
  }));

  if (staff.length === 0) {
    logger.error("notifications.recipients.opollo_staff_empty", {
      message:
        "No is_opollo_staff=true rows in platform_users — " +
        "blocker/admin notifications will not fire. " +
        "Add at least one Opollo staff user to platform_users.",
    });
  }

  return staff;
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
