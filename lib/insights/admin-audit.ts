import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";

export interface AuditEntry {
  operatorUserId: string;
  clientCompanyId: string;
  action: "view" | "dismiss" | "annotate" | "export" | "override" | "unsuppress" | "add_competitor" | "remove_competitor";
  actionDetails: Record<string, unknown>;
  clientIp?: string;
  userAgent?: string;
}

export class AuditFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditFailedError";
  }
}

/**
 * Writes an audit row to ins_admin_audit.
 * For mutating actions (isMutating=true) this MUST succeed before the action completes.
 * If isMutating=true and the write fails, throws AuditFailedError.
 * If isMutating=false, logs a warning but doesn't throw.
 */
export async function writeAdminAudit(
  entry: AuditEntry,
  isMutating: boolean,
): Promise<void> {
  const svc = getServiceRoleClient();
  const { error } = await svc.from("ins_admin_audit").insert({
    operator_user_id: entry.operatorUserId,
    client_company_id: entry.clientCompanyId,
    action: entry.action,
    action_details: entry.actionDetails,
    client_ip: entry.clientIp ?? null,
    user_agent: entry.userAgent ?? null,
  });

  if (error) {
    if (isMutating) {
      throw new AuditFailedError(`Admin audit write failed: ${error.message}`);
    } else {
      console.warn("Admin audit write failed (non-blocking):", error.message);
    }
  }
}
