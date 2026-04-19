import {
  DeletePageInputSchema,
  type DeletePageData,
  type ToolResponse,
} from "@/lib/tool-schemas";
import { readWpConfig, wpDeletePage } from "@/lib/wordpress";

const DS_VERSION = "1.0.0";

export async function executeDeletePage(
  rawInput: unknown,
): Promise<ToolResponse<DeletePageData>> {
  const timestamp = new Date().toISOString();

  const parsed = DeletePageInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const missingConfirm = parsed.error.issues.some(
      (i) => i.path.includes("user_confirmed"),
    );
    return {
      ok: false,
      error: {
        code: missingConfirm ? "CONFIRMATION_REQUIRED" : "VALIDATION_FAILED",
        message: missingConfirm
          ? "HC-5: delete_page requires user_confirmed=true."
          : "Input failed schema validation.",
        details: { issues: parsed.error.issues },
        retryable: true,
        suggested_action: missingConfirm
          ? "Ask the user to confirm deletion, then re-call delete_page with user_confirmed=true."
          : "Review error details and regenerate the tool call with valid fields.",
      },
      timestamp,
    };
  }

  const cfg = readWpConfig();
  if (!cfg.ok) {
    return {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: `Missing WordPress environment variables: ${cfg.missing.join(", ")}`,
        details: { missing: cfg.missing },
        retryable: false,
        suggested_action:
          "Set the missing env vars in the deployment environment and redeploy.",
      },
      timestamp,
    };
  }

  const wp = await wpDeletePage(cfg.value, parsed.data.page_id);
  if (!wp.ok) {
    return {
      ok: false,
      error: {
        code: wp.code,
        message: wp.message,
        details: wp.details,
        retryable: wp.retryable,
        suggested_action: wp.suggested_action,
      },
      timestamp,
    };
  }

  return {
    ok: true,
    data: { page_id: wp.page_id, status: "trash" },
    validation: { passed: true, checks: ["schema", "hc5"] },
    ds_version: DS_VERSION,
    timestamp,
  };
}
