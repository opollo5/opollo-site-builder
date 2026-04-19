import {
  UpdatePageInputSchema,
  type ToolResponse,
  type UpdatePageData,
} from "@/lib/tool-schemas";
import {
  readWpConfig,
  wpGetPage,
  wpUpdatePage,
  type WpUpdateFields,
} from "@/lib/wordpress";

const DS_VERSION = "1.0.0";

export async function executeUpdatePage(
  rawInput: unknown,
): Promise<ToolResponse<UpdatePageData>> {
  const timestamp = new Date().toISOString();

  const parsed = UpdatePageInputSchema.safeParse(rawInput);
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

  const input = parsed.data;

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

  if (input.change_scope === "major_rewrite" && !input.user_confirmed) {
    const current = await wpGetPage(cfg.value, input.page_id);
    if (!current.ok) {
      return {
        ok: false,
        error: {
          code: current.code,
          message: current.message,
          details: current.details,
          retryable: current.retryable,
          suggested_action: current.suggested_action,
        },
        timestamp,
      };
    }
    if (current.status === "publish") {
      return {
        ok: false,
        error: {
          code: "CONFIRMATION_REQUIRED",
          message:
            "HC-5: major_rewrite on a published page requires user confirmation.",
          details: {
            page_id: input.page_id,
            current_status: current.status,
            change_scope: input.change_scope,
          },
          retryable: true,
          suggested_action:
            "Ask the user to confirm, then re-call update_page with user_confirmed=true.",
        },
        timestamp,
      };
    }
  }

  const fields: WpUpdateFields = {};
  if (input.title !== undefined) fields.title = input.title;
  if (input.content !== undefined) fields.content = input.content;
  if (input.meta_description !== undefined) {
    fields.meta_description = input.meta_description;
  }

  const wp = await wpUpdatePage(cfg.value, input.page_id, fields);
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
    data: {
      page_id: wp.page_id,
      status: wp.status,
      modified_date: wp.modified_date,
    },
    validation: { passed: true, checks: ["schema", "hc5"] },
    ds_version: DS_VERSION,
    timestamp,
  };
}
