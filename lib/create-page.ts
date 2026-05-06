import {
  CreatePageInputSchema,
  type CreatePageData,
  type ToolResponse,
} from "@/lib/tool-schemas";
import { logger } from "@/lib/logger";
import { readWpConfig, wpCreatePage } from "@/lib/wordpress";

export async function executeCreatePage(
  rawInput: unknown,
): Promise<ToolResponse<CreatePageData>> {
  const timestamp = new Date().toISOString();

  const parsed = CreatePageInputSchema.safeParse(rawInput);
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
    logger.error("create_page.execute.missing_wp_env_vars", { missing: cfg.missing });
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

  const wp = await wpCreatePage(cfg.value, parsed.data);
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
    ds_version: parsed.data.ds_version,
    timestamp,
  };
}
