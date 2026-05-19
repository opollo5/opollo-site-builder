import { NextResponse, type NextRequest } from "next/server";

import { validationError, internalError } from "@/lib/http";
import { requireCapOperatorForApi } from "@/lib/cap/api-gate";
import { updateCampaignPostStatus, type PostStatus } from "@/lib/cap/campaigns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-fA-F-]{36}$/;
const VALID_STATUSES = new Set<PostStatus>(["approved", "rejected"]);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!UUID_RE.test(id)) return validationError("id must be a UUID.");

  const gate = await requireCapOperatorForApi();
  if (gate.kind === "deny") return gate.response;

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return validationError("Request body must be JSON.");
  }

  const { status, rejection_reason } = body;

  if (typeof status !== "string" || !VALID_STATUSES.has(status as PostStatus)) {
    return validationError("status must be one of: approved, rejected.");
  }

  if (status === "rejected" && (typeof rejection_reason !== "string" || rejection_reason.trim().length === 0)) {
    return validationError("rejection_reason is required when rejecting.");
  }

  try {
    await updateCampaignPostStatus(
      id,
      status as PostStatus,
      status === "rejected" ? (rejection_reason as string).trim() : undefined,
    );
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    return internalError(err instanceof Error ? err.message : "Failed to update post status");
  }
}
