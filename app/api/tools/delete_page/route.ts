import { NextResponse } from "next/server";

import { executeDeletePage } from "@/lib/delete-page";
import { errorCodeToStatus } from "@/lib/tool-schemas";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const result = await executeDeletePage(body);
  const status = result.ok ? 200 : errorCodeToStatus(result.error.code);
  return NextResponse.json(result, { status });
}
