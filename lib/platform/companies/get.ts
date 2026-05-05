import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

import type { PlatformCompany } from "./types";

// P3-3 — load a company + its members + its pending invitations.
//
// Two FKs from platform_company_users to platform_users (user_id +
// added_by) prevent embedded joins (PGRST ambiguity); same constraint
// applies in send.ts. Three parallel queries are simpler and resilient
// to future audit-FK additions.
//
// Returns NOT_FOUND when the id doesn't exist. The caller (route handler)
// already gated on operator role, so service-role read here is fine.

export type CompanyMember = {
  user_id: string;
  email: string;
  full_name: string | null;
  role: "admin" | "approver" | "editor" | "viewer";
  joined_at: string;
};

export type CompanyPendingInvitation = {
  id: string;
  email: string;
  role: "admin" | "approver" | "editor" | "viewer";
  expires_at: string;
  invited_by: string | null;
  reminder_sent_at: string | null;
  created_at: string;
};

export type CompanyDetail = {
  company: PlatformCompany;
  members: CompanyMember[];
  pending_invitations: CompanyPendingInvitation[];
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getPlatformCompany(
  id: string,
): Promise<ApiResponse<CompanyDetail>> {
  if (!UUID_RE.test(id)) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "Company id must be a UUID.",
        retryable: false,
        suggested_action: "Check the URL and retry.",
      },
      timestamp: new Date().toISOString(),
    };
  }

  const svc = getServiceRoleClient();

  // Three queries in parallel: company, members (joined to platform_users
  // for email + name), pending invitations.
  const [companyResult, membersResult, invitationsResult] = await Promise.all([
    svc
      .from("platform_companies")
      .select(
        "id, name, slug, domain, timezone, is_opollo_internal, approval_default_required, approval_default_rule, concurrent_publish_limit, created_at, updated_at",
      )
      .eq("id", id)
      .maybeSingle(),
    svc
      .from("platform_company_users")
      .select("user_id, role, created_at")
      .eq("company_id", id)
      .order("created_at", { ascending: true }),
    svc
      .from("platform_invitations")
      .select(
        "id, email, role, expires_at, invited_by, reminder_sent_at, created_at",
      )
      .eq("company_id", id)
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
  ]);

  if (companyResult.error) {
    logger.error("platform.companies.get.company_failed", {
      err: companyResult.error.message,
    });
    return internal(`Failed to load company: ${companyResult.error.message}`);
  }
  if (!companyResult.data) {
    return {
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: "No company with that id.",
        retryable: false,
        suggested_action: "Check the URL.",
      },
      timestamp: new Date().toISOString(),
    };
  }

  if (membersResult.error) {
    logger.error("platform.companies.get.members_failed", {
      err: membersResult.error.message,
    });
    return internal(
      `Failed to load members: ${membersResult.error.message}`,
    );
  }
  if (invitationsResult.error) {
    logger.error("platform.companies.get.invitations_failed", {
      err: invitationsResult.error.message,
    });
    return internal(
      `Failed to load invitations: ${invitationsResult.error.message}`,
    );
  }

  // Resolve member emails + names via a single follow-up query keyed by
  // user_id (no embed → no PGRST ambiguity).
  const userIds = (membersResult.data ?? []).map((m) => m.user_id as string);
  const userById = new Map<string, { email: string; full_name: string | null }>();
  if (userIds.length > 0) {
    const usersResult = await svc
      .from("platform_users")
      .select("id, email, full_name")
      .in("id", userIds);
    if (usersResult.error) {
      logger.error("platform.companies.get.users_failed", {
        err: usersResult.error.message,
      });
      return internal(
        `Failed to load member profiles: ${usersResult.error.message}`,
      );
    }
    for (const u of usersResult.data ?? []) {
      userById.set(u.id as string, {
        email: u.email as string,
        full_name: (u.full_name as string | null) ?? null,
      });
    }
  }

  const members: CompanyMember[] = (membersResult.data ?? []).map((m) => {
    const profile = userById.get(m.user_id as string);
    return {
      user_id: m.user_id as string,
      email: profile?.email ?? "",
      full_name: profile?.full_name ?? null,
      role: m.role as CompanyMember["role"],
      joined_at: m.created_at as string,
    };
  });

  const pending: CompanyPendingInvitation[] = (
    invitationsResult.data ?? []
  ).map((inv) => ({
    id: inv.id as string,
    email: inv.email as string,
    role: inv.role as CompanyPendingInvitation["role"],
    expires_at: inv.expires_at as string,
    invited_by: (inv.invited_by as string | null) ?? null,
    reminder_sent_at: (inv.reminder_sent_at as string | null) ?? null,
    created_at: inv.created_at as string,
  }));

  return {
    ok: true,
    data: {
      company: companyResult.data as PlatformCompany,
      members,
      pending_invitations: pending,
    },
    timestamp: new Date().toISOString(),
  };
}

function internal(message: string): ApiResponse<CompanyDetail> {
  return {
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message,
      retryable: false,
      suggested_action: "Retry. If the error persists, contact support.",
    },
    timestamp: new Date().toISOString(),
  };
}
