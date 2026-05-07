import "server-only";

import { NextResponse } from "next/server";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { logger } from "@/lib/logger";
import {
  getExtractionProgress,
  runExtractionBatch,
} from "@/lib/image-metadata-extract";

export const dynamic = "force-dynamic";
export const maxDuration = 299;

// GET — progress snapshot for the admin UI poller.
export async function GET() {
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  try {
    const progress = await getExtractionProgress();
    return NextResponse.json(progress);
  } catch (err) {
    logger.error("extract.admin_get_error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

// POST — trigger one synchronous batch from the admin UI.
export async function POST() {
  const gate = await requireAdminForApi({ roles: ["super_admin"] });
  if (gate.kind === "deny") return gate.response;

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_IMAGES_API_TOKEN;
  if (!accountId || !apiToken) {
    logger.error("extract.admin_missing_cf_creds", {});
    return NextResponse.json(
      { error: "Cloudflare credentials not configured on this deployment" },
      { status: 500 },
    );
  }

  try {
    const result = await runExtractionBatch({ accountId, apiToken, batchSize: 25 });
    return NextResponse.json(result);
  } catch (err) {
    logger.error("extract.admin_post_error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
