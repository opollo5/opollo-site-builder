import { requireAdminForApi } from "@/lib/admin-api-gate";
import { getSiteBlueprint } from "@/lib/site-blueprint";
import { listSharedContent } from "@/lib/shared-content";
import { getSite } from "@/lib/sites";
import { publishSiteToWordPress } from "@/lib/wp-site-publish";
import { respond, validateUuidParam } from "@/lib/http";
import type { ErrorCode } from "@/lib/tool-schemas";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

type RouteContext = { params: { id: string; blueprint_id: string } };

// POST /api/sites/[id]/blueprints/[blueprint_id]/publish-site
//
// M16-8 — Pushes site-level WP assets:
//   - theme.json tokens → WP Global Styles
//   - Shared content → WP Synced Patterns (reusable blocks)
//
// Idempotent. Safe to call repeatedly (all WP operations are upserts).
// Does NOT publish individual pages — that is handled by the batch publisher.
export async function POST(_req: Request, ctx: RouteContext) {
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  const siteParam = validateUuidParam(ctx.params.id, "id");
  if (!siteParam.ok) return siteParam.response;

  const bpParam = validateUuidParam(ctx.params.blueprint_id, "blueprint_id");
  if (!bpParam.ok) return bpParam.response;

  const siteId        = siteParam.value;
  const blueprintId   = bpParam.value;

  // Load site with credentials
  const siteResult = await getSite(siteId, { includeCredentials: true });
  if (!siteResult.ok) return respond(siteResult);
  const { site, credentials } = siteResult.data;
  if (!credentials || !site.wp_url) {
    return respond({
      ok: false,
      error: {
        code: "WP_CREDENTIALS_MISSING",
        message: "Site has no WordPress credentials configured.",
        retryable: false,
        suggested_action: "Add WP URL and app password in site settings.",
        details: {},
      },
      timestamp: new Date().toISOString(),
    });
  }

  // Load blueprint
  const bpResult = await getSiteBlueprint(siteId);
  if (!bpResult.ok || !bpResult.data) {
    return respond({
      ok: false,
      error: {
        code: "BLUEPRINT_NOT_FOUND",
        message: `No blueprint found for site ${siteId}.`,
        retryable: false,
        suggested_action: "Run the site planner first to create a blueprint.",
        details: {},
      },
      timestamp: new Date().toISOString(),
    });
  }
  if (bpResult.data.id !== blueprintId) {
    return respond({
      ok: false,
      error: {
        code: "BLUEPRINT_MISMATCH",
        message: "Blueprint ID does not match the site's active blueprint.",
        retryable: false,
        suggested_action: "Use the current blueprint ID from GET /blueprints.",
        details: {},
      },
      timestamp: new Date().toISOString(),
    });
  }

  // Load shared content
  const contentResult = await listSharedContent(siteId);
  const sharedContent = contentResult.ok ? contentResult.data : [];

  const cfg = {
    baseUrl: site.wp_url as string,
    user: credentials.wp_user,
    appPassword: credentials.wp_app_password,
  };

  const result = await publishSiteToWordPress(cfg, bpResult.data, sharedContent);

  logger.info("publish-site.done", {
    siteId,
    blueprintId,
    themeSkipped:    result.ok ? result.themeSkipped    : null,
    patternsCreated: result.ok ? result.patternsCreated : null,
    patternsUpdated: result.ok ? result.patternsUpdated : null,
    errors:          result.ok ? result.errors.length   : null,
  });

  if (!result.ok) {
    return respond({
      ok: false,
      error: {
        code: (result.code as ErrorCode) ?? "INTERNAL_ERROR",
        message: result.message,
        retryable: false,
        suggested_action: "Check WP credentials and theme configuration.",
        details: {},
      },
      timestamp: new Date().toISOString(),
    });
  }

  return respond({
    ok: true,
    data: {
      themeSkipped:    result.themeSkipped ?? false,
      patternsCreated: result.patternsCreated,
      patternsUpdated: result.patternsUpdated,
      warnings:        result.errors,
    },
    timestamp: new Date().toISOString(),
  });
}
