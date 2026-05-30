import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import type { AspectRatio, CompositionType } from "@/lib/image/types";
import type { LogoConfig } from "@/lib/image/compositing";

// ---------------------------------------------------------------------------
// Template access layer — reads image_templates from the database.
//
// Per §1.9 of MASS_IMAGE_GEN_BUILD_BRIEF_v3_ADDENDUM.md:
//   - All template writes go through update_image_template() RPC.
//   - Company-scoped templates override globals for the same name + ratio.
//   - Never call UPDATE directly on image_templates.
//
// Used by A-NEW-4 to replace the code-template constants from templates-v1.ts.
// ---------------------------------------------------------------------------

export interface TemplateDefinition {
  compositionType: CompositionType;
  /** Optional: explicit text-zone coordinates from canvas drag (overrides TEXT_ZONE_MAP). */
  customTextZone?: {
    x: number; y: number; width: number; height: number;
    alignment: "left" | "center" | "right";
  };
  overlayAlpha: number;
  logoPosition: LogoConfig["position"];
  logoSizePercent: number;
  logoPadding: number;
  maxHeadlineFontSize: number;
  fontFamily?: string; // defaults to "Inter" in the renderer
}

export interface ImageTemplate {
  id: string;
  companyId: string | null;
  name: string;
  aspectRatio: AspectRatio;
  definition: TemplateDefinition;
  version: number;
  /**
   * Added by migration 0166 (D1).
   * 1 = fixed-zone format (A-NEW-3, routes to compositeSharp).
   * 2 = layer-based format (v2 editor, routes to compositeLayerBased).
   */
  schemaVersion: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Row shape returned from the database */
interface TemplateRow {
  id: string;
  company_id: string | null;
  name: string;
  aspect_ratio: string;
  definition: TemplateDefinition;
  version: number;
  schema_version: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

function toTemplate(row: TemplateRow): ImageTemplate {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    aspectRatio: row.aspect_ratio as AspectRatio,
    definition: row.definition,
    version: row.version,
    schemaVersion: row.schema_version ?? 1,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Get the active template for a given company + aspect ratio.
 *
 * Resolution order (per §1.9):
 *   1. Company-scoped template with the given name (if nameOrId provided)
 *   2. Company-scoped default template for the ratio
 *   3. Global default template for the ratio
 *
 * Returns null only when no template of any scope exists (should not happen
 * after migration 0162 seeds the 5 global defaults).
 */
export async function get_template(
  companyId: string,
  aspectRatio: AspectRatio,
  name = "default",
): Promise<ImageTemplate | null> {
  const svc = getServiceRoleClient();

  const { data, error } = await svc
    .from("image_templates")
    .select("*")
    .eq("aspect_ratio", aspectRatio)
    .eq("name", name)
    .eq("is_active", true)
    .or(`company_id.eq.${companyId},company_id.is.null`)
    .order("company_id", { ascending: false, nullsFirst: false }) // company-scoped first
    .limit(1)
    .maybeSingle();

  if (error) {
    logger.error("image.templates.get_failed", { companyId, aspectRatio, error: error.message });
    return null;
  }

  return data ? toTemplate(data as TemplateRow) : null;
}

/**
 * List all templates visible to a company: global + company-scoped, active only.
 * Grouped by aspect ratio with company-scoped templates listed before globals.
 */
export async function list_templates(companyId: string): Promise<ImageTemplate[]> {
  const svc = getServiceRoleClient();

  const { data, error } = await svc
    .from("image_templates")
    .select("*")
    .eq("is_active", true)
    .or(`company_id.eq.${companyId},company_id.is.null`)
    .order("company_id", { ascending: false, nullsFirst: false })
    .order("aspect_ratio", { ascending: true })
    .order("name", { ascending: true });

  if (error) {
    logger.error("image.templates.list_failed", { companyId, error: error.message });
    return [];
  }

  return (data ?? []).map((row) => toTemplate(row as TemplateRow));
}

/**
 * Update a template's definition, incrementing its version and recording history.
 * This is the ONLY write path for templates — mirrors update_brand_profile().
 * Never call UPDATE directly on image_templates.
 */
export async function update_template(opts: {
  templateId: string;
  updatedBy: string;
  definition: TemplateDefinition;
  changeNote?: string;
}): Promise<ImageTemplate> {
  const svc = getServiceRoleClient();

  const { data, error } = await svc.rpc("update_image_template", {
    p_template_id: opts.templateId,
    p_updated_by: opts.updatedBy,
    p_definition: opts.definition,
    p_change_note: opts.changeNote ?? null,
  });

  if (error) {
    logger.error("image.templates.update_failed", {
      templateId: opts.templateId,
      error: error.message,
    });
    throw new Error(`Template update failed: ${error.message}`);
  }

  return toTemplate(data as TemplateRow);
}

/**
 * Create a new template (company-scoped or global).
 * Admins create company-scoped; Opollo staff create globals (company_id null).
 */
export async function create_template(opts: {
  companyId: string | null;
  name: string;
  aspectRatio: AspectRatio;
  definition: TemplateDefinition;
  createdBy: string;
}): Promise<ImageTemplate> {
  const svc = getServiceRoleClient();

  const { data, error } = await svc
    .from("image_templates")
    .insert({
      company_id: opts.companyId,
      name: opts.name,
      aspect_ratio: opts.aspectRatio,
      definition: opts.definition,
      created_by: opts.createdBy,
    })
    .select("*")
    .single();

  if (error) {
    logger.error("image.templates.create_failed", { error: error.message });
    throw new Error(`Template creation failed: ${error.message}`);
  }

  return toTemplate(data as TemplateRow);
}
