import { NextResponse } from "next/server";

import { checkAdminAccess } from "@/lib/admin-gate";
import { runDiagnostics } from "@/lib/optimiser/diagnostics";

// GET /api/optimiser/diagnostics — admin-only operator surface.
//
// Reports per-source provisioning status (env vars, connected clients,
// last sync, last error) plus module-wide checks (schema, master key,
// cron secret, email provider). Operators hit this after each Opollo-
// wide credential is provisioned to confirm the system saw the change.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const access = await checkAdminAccess({ requiredRoles: ["admin"] });
  if (access.kind === "redirect") {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "UNAUTHORIZED", message: "Admin access required" },
      },
      { status: 401 },
    );
  }
  const report = await runDiagnostics();
  return NextResponse.json({ ok: true, data: report });
}
