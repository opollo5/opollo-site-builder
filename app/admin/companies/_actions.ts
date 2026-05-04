"use server";

import { redirect } from "next/navigation";

import { logger } from "@/lib/logger";
import { getCurrentPlatformSession } from "@/lib/platform/auth";
import { getServiceRoleClient } from "@/lib/supabase";

// Opollo-staff-only: add the current operator to a company as admin.
// Removes any existing company membership first (V1: one company per user).
// Redirects to /company on success so the operator can immediately start
// using the social platform in the context of the chosen company.
export async function joinCompanyAsAdmin(companyId: string): Promise<void> {
  const session = await getCurrentPlatformSession();
  if (!session?.isOpolloStaff) {
    throw new Error("Unauthorized: Opollo staff only");
  }

  const svc = getServiceRoleClient();

  // Remove any existing membership (V1 unique constraint: one company per user).
  await svc
    .from("platform_company_users")
    .delete()
    .eq("user_id", session.userId);

  const { error } = await svc.from("platform_company_users").insert({
    company_id: companyId,
    user_id: session.userId,
    role: "admin",
    added_by: session.userId,
  });

  if (error) {
    logger.error("platform.admin.join_company.failed", {
      err: error.message,
      company_id: companyId,
      user_id: session.userId,
    });
    throw new Error(`Failed to join company: ${error.message}`);
  }

  redirect("/company");
}
