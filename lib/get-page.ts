import {
  GetPageInputSchema,
  type GetPageData,
  type ToolResponse,
} from "@/lib/tool-schemas";
import { readWpConfig, wpGetPage } from "@/lib/wordpress";

const DS_VERSION = "1.0.0";

export async function executeGetPage(
  rawInput: unknown,
): Promise<ToolResponse<GetPageData>> {
  const timestamp = new Date().toISOString();

  const parsed = GetPageInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "Input failed schema validation.",
        details: { issues: parsed.error.issues },
        retryable: true,
        suggested_action:
          "Review error details and regenerate the tool call with valid fields.",
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

  const wp = await wpGetPage(cfg.value, parsed.data.page_id);
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

  const { ok, ...data } = wp;
  return {
    ok: true,
    data,
    validation: { passed: true, checks: ["schema"] },
    ds_version: DS_VERSION,
    timestamp,
  };
}
