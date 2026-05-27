import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";

export interface StaffAuditParams {
  staffUserId: string;
  staffEmail: string;
  companyId?: string | null;
  companyName?: string | null;
  action: string;
  resourceId?: string | null;
  ipAddress?: string | null;
  metadata?: Record<string, unknown>;
}

// Writes one row to platform_staff_audit_log. Never throws — a write failure
// is logged but must not abort the parent operation (audit is best-effort
// from the caller's perspective; the parent action already succeeded).
export async function logStaffAction(params: StaffAuditParams): Promise<void> {
  const svc = getServiceRoleClient();
  const { error } = await svc.from("platform_staff_audit_log").insert({
    staff_user_id: params.staffUserId,
    staff_email: params.staffEmail,
    company_id: params.companyId ?? null,
    company_name: params.companyName ?? null,
    action: params.action,
    resource_id: params.resourceId ?? null,
    ip_address: params.ipAddress ?? null,
    metadata: params.metadata ?? {},
  });
  if (error) {
    logger.error("staff_audit.write_failed", {
      action: params.action,
      staff_user_id: params.staffUserId,
      err: error.message,
    });
  }
}
