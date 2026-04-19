import { NextResponse } from "next/server";

import { getSite } from "@/lib/sites";
import { errorCodeToStatus } from "@/lib/tool-schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  // Never include credentials in a response served over HTTP. Internal
  // consumers (chat route) must call getSite directly with includeCredentials.
  const result = await getSite(params.id, { includeCredentials: false });
  const status = result.ok ? 200 : errorCodeToStatus(result.error.code);
  return NextResponse.json(result, { status });
}
