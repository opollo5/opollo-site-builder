import { NextResponse } from "next/server";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { checkRateLimit, rateLimitExceeded } from "@/lib/rate-limit";
import { listSites } from "@/lib/sites";
import { errorCodeToStatus } from "@/lib/tool-schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // PLATFORM-AUDIT PR3 — listSites returns every site row across tenants;
  // gate to admin tier minimum. Previously this route had no auth gate,
  // surfacing the full sites list to any caller including unauthenticated.
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  const rl = await checkRateLimit("admin_write", `user:${gate.user?.id ?? "unknown"}`);
  if (!rl.ok) return rateLimitExceeded(rl);

  const result = await listSites();
  const status = result.ok ? 200 : errorCodeToStatus(result.error.code);
  return NextResponse.json(result, { status });
}
