import "server-only";

import { type NextRequest, NextResponse } from "next/server";

import { constantTimeEqual } from "@/lib/crypto-compare";
import { logger } from "@/lib/logger";
import { runExtractionBatch } from "@/lib/image-metadata-extract";

export const dynamic = "force-dynamic";
export const maxDuration = 299;

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const header = req.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) return false;
  return constantTimeEqual(header.slice(7).trim(), secret);
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_IMAGES_API_TOKEN;
  if (!accountId || !apiToken) {
    logger.error("extract.missing_cf_credentials", {});
    return NextResponse.json({ error: "Missing Cloudflare credentials" }, { status: 500 });
  }

  try {
    const result = await runExtractionBatch({ accountId, apiToken, batchSize: 10 });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    logger.error("extract.cron_handler_error", {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
