import { NextResponse } from "next/server";

import { listSites } from "@/lib/sites";
import { errorCodeToStatus } from "@/lib/tool-schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const result = await listSites();
  const status = result.ok ? 200 : errorCodeToStatus(result.error.code);
  return NextResponse.json(result, { status });
}
