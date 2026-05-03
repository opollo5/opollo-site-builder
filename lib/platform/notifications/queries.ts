import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse, ErrorCode } from "@/lib/tool-schemas";

// ---------------------------------------------------------------------------
// S1-29 — query helpers for platform_notifications (in-app bell UI).
// ---------------------------------------------------------------------------

export type InAppNotification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  action_url: string | null;
  read_at: string | null;
  created_at: string;
};

export async function getNotifications(input: {
  userId: string;
  companyId: string;
  limit?: number;
}): Promise<ApiResponse<{ notifications: InAppNotification[]; unreadCount: number }>> {
  if (!input.userId || !input.companyId) {
    return err("VALIDATION_FAILED", "userId and companyId required.", false);
  }
  const limit = Math.min(input.limit ?? 20, 50);
  const svc = getServiceRoleClient();

  const [rows, countResult] = await Promise.all([
    svc
      .from("platform_notifications")
      .select("id, type, title, body, action_url, read_at, created_at")
      .eq("user_id", input.userId)
      .eq("company_id", input.companyId)
      .order("created_at", { ascending: false })
      .limit(limit),
    svc
      .from("platform_notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", input.userId)
      .eq("company_id", input.companyId)
      .is("read_at", null),
  ]);

  if (rows.error) {
    return err("INTERNAL_ERROR", `Failed to read notifications: ${rows.error.message}`, true);
  }

  return {
    ok: true,
    data: {
      notifications: (rows.data ?? []) as InAppNotification[],
      unreadCount: countResult.count ?? 0,
    },
    timestamp: new Date().toISOString(),
  };
}

export async function markAllRead(input: {
  userId: string;
  companyId: string;
}): Promise<ApiResponse<{ marked: number }>> {
  if (!input.userId || !input.companyId) {
    return err("VALIDATION_FAILED", "userId and companyId required.", false);
  }
  const svc = getServiceRoleClient();

  const update = await svc
    .from("platform_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", input.userId)
    .eq("company_id", input.companyId)
    .is("read_at", null)
    .select("id");

  if (update.error) {
    return err("INTERNAL_ERROR", `Failed to mark notifications read: ${update.error.message}`, true);
  }

  return {
    ok: true,
    data: { marked: update.data?.length ?? 0 },
    timestamp: new Date().toISOString(),
  };
}

function err<T>(
  code: ErrorCode,
  message: string,
  retryable: boolean,
): ApiResponse<T> {
  return {
    ok: false,
    error: {
      code,
      message,
      retryable,
      suggested_action: retryable ? "Retry. If the error persists, contact support." : "Fix the input.",
    },
    timestamp: new Date().toISOString(),
  };
}
