import "server-only";

import { logger } from "@/lib/logger";
import { getServiceRoleClient } from "@/lib/supabase";
import type { ApiResponse } from "@/lib/tool-schemas";

import type { ListConnectionsInput, SocialConnection } from "./types";

// ---------------------------------------------------------------------------
// S1-12 — list social_connections rows for a company.
//
// Caller is responsible for canDo("view_calendar", company_id). Anyone
// who can see the calendar can see the connection roster.
//
// Default ordering: connected_at desc — most recently added at the top.
// ---------------------------------------------------------------------------

export async function listConnections(
  input: ListConnectionsInput,
): Promise<ApiResponse<{ connections: SocialConnection[] }>> {
  if (!input.companyId) {
    return validation("Company id is required.");
  }

  const svc = getServiceRoleClient();
  const result = await svc
    .from("social_connections")
    .select(
      "id, company_id, platform, bundle_social_account_id, display_name, avatar_url, status, last_error, connected_at, disconnected_at, last_health_check_at, created_at, updated_at",
    )
    .eq("company_id", input.companyId)
    .order("connected_at", { ascending: false });

  if (result.error) {
    logger.error("social.connections.list.failed", {
      err: result.error.message,
      company_id: input.companyId,
    });
    return internal(`Failed to list connections: ${result.error.message}`);
  }

  return {
    ok: true,
    data: { connections: (result.data ?? []) as SocialConnection[] },
    timestamp: new Date().toISOString(),
  };
}

function validation(
  message: string,
): ApiResponse<{ connections: SocialConnection[] }> {
  return {
    ok: false,
    error: {
      code: "VALIDATION_FAILED",
      message,
      retryable: false,
      suggested_action: "Fix the input and resubmit.",
    },
    timestamp: new Date().toISOString(),
  };
}

function internal(
  message: string,
): ApiResponse<{ connections: SocialConnection[] }> {
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
