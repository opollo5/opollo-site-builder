import { NextResponse } from "next/server";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { readJsonBody, validationError } from "@/lib/http";
import { executeListPages } from "@/lib/list-pages";
import { logger } from "@/lib/logger";
import {
  checkRateLimit,
  getClientIp,
  rateLimitExceeded,
} from "@/lib/rate-limit";
import { errorCodeToStatus } from "@/lib/tool-schemas";
import { resolveToolWpCreds } from "@/lib/tools-wp-creds";
import { runWithWpCredentials } from "@/lib/wordpress";

export const runtime = "nodejs";

export async function POST(req: Request) {
  // M15-4 #11: upgraded from session-optional to requireAdminForApi so the
  // site_id credential lookup below cannot run unauthenticated.
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  const rlId = gate.user ? `user:${gate.user.id}` : `ip:${getClientIp(req)}`;
  const rl = await checkRateLimit("tools", rlId);
  if (!rl.ok) return rateLimitExceeded(rl);

  const body = await readJsonBody(req);
  if (body === undefined) return validationError("Request body must be valid JSON.");

  const siteId =
    typeof (body as Record<string, unknown>).site_id === "string"
      ? ((body as Record<string, unknown>).site_id as string)
      : undefined;
  const wpCredsResult = await resolveToolWpCreds(siteId);
  if (!wpCredsResult.ok) return wpCredsResult.response;

  const result = await runWithWpCredentials(wpCredsResult.creds, () =>
    executeListPages(body),
  );
  if (!result.ok) logger.error("executeListPages failed", { code: result.error.code });
  const status = result.ok ? 200 : errorCodeToStatus(result.error.code);
  return NextResponse.json(result, { status });
}
