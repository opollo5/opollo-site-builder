/**
 * lib/site-blueprint.ts
 *
 * Data layer for the site_blueprints table (M16-1 migration).
 * Follows lib/design-systems.ts conventions:
 *   - Zod validation on all writes
 *   - version_lock optimistic concurrency
 *   - error mapping via design-system-errors helpers
 *   - revalidatePath on mutations
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ApiResponse } from "@/lib/tool-schemas";
import { getServiceRoleClient } from "@/lib/supabase";
import {
  guardImpl,
  internalError,
  mapPgError,
  notFound,
  validationFailed,
  versionConflict,
} from "@/lib/design-system-errors";

// ─── Types ──────────────────────────────────────────────────────────────────

export type BlueprintStatus = "draft" | "approved";

export type SiteBlueprint = {
  id:             string;
  site_id:        string;
  status:         BlueprintStatus;
  brand_name:     string;
  brand_voice:    Record<string, unknown>;
  design_tokens:  Record<string, unknown>;
  logo_image_id:  string | null;
  nav_items:      unknown[];
  footer_items:   unknown[];
  seo_defaults:   Record<string, unknown>;
  route_plan:     unknown[];
  cta_catalogue:  unknown[];
  contact_data:   Record<string, unknown>;
  legal_data:     Record<string, unknown>;
  wp_theme_json:  Record<string, unknown>;
  version_lock:   number;
  created_at:     string;
  updated_at:     string;
  created_by:     string | null;
  updated_by:     string | null;
};

const RESOURCE = "site_blueprint";
const SELECT_ALL = "*";

function now(): string { return new Date().toISOString(); }

// ─── Zod schemas ─────────────────────────────────────────────────────────────

export const CreateSiteBlueprintSchema = z.object({
  site_id:       z.string().uuid(),
  brand_name:    z.string().max(200).optional().default(""),
  brand_voice:   z.record(z.string(), z.unknown()).optional().default({}),
  design_tokens: z.record(z.string(), z.unknown()).optional().default({}),
  seo_defaults:  z.record(z.string(), z.unknown()).optional().default({}),
  created_by:    z.string().uuid().nullable().optional(),
});
export type CreateSiteBlueprintInput = z.infer<typeof CreateSiteBlueprintSchema>;

export const UpdateSiteBlueprintSchema = z.object({
  brand_name:    z.string().max(200).optional(),
  brand_voice:   z.record(z.string(), z.unknown()).optional(),
  design_tokens: z.record(z.string(), z.unknown()).optional(),
  logo_image_id: z.string().uuid().nullable().optional(),
  nav_items:     z.array(z.unknown()).optional(),
  footer_items:  z.array(z.unknown()).optional(),
  seo_defaults:  z.record(z.string(), z.unknown()).optional(),
  route_plan:    z.array(z.unknown()).optional(),
  cta_catalogue: z.array(z.unknown()).optional(),
  contact_data:  z.record(z.string(), z.unknown()).optional(),
  legal_data:    z.record(z.string(), z.unknown()).optional(),
  wp_theme_json: z.record(z.string(), z.unknown()).optional(),
  updated_by:    z.string().uuid().nullable().optional(),
}).refine(patch => Object.keys(patch).length > 0, {
  message: "At least one updatable field must be provided.",
});
export type UpdateSiteBlueprintInput = z.infer<typeof UpdateSiteBlueprintSchema>;

// ─── Reads ───────────────────────────────────────────────────────────────────

export async function getSiteBlueprint(
  site_id: string,
): Promise<ApiResponse<SiteBlueprint | null>> {
  return guardImpl(RESOURCE, async () => {
    const supabase = getServiceRoleClient();
    const { data, error } = await supabase
      .from("site_blueprints")
      .select(SELECT_ALL)
      .eq("site_id", site_id)
      .maybeSingle();

    if (error) return mapPgError(RESOURCE, error);
    return { ok: true, data: (data ?? null) as SiteBlueprint | null, timestamp: now() };
  });
}

export async function getSiteBlueprintById(
  id: string,
): Promise<ApiResponse<SiteBlueprint>> {
  return guardImpl(RESOURCE, async () => {
    const supabase = getServiceRoleClient();
    const { data, error } = await supabase
      .from("site_blueprints")
      .select(SELECT_ALL)
      .eq("id", id)
      .maybeSingle();

    if (error) return mapPgError(RESOURCE, error);
    if (!data) return notFound(RESOURCE, id);
    return { ok: true, data: data as SiteBlueprint, timestamp: now() };
  });
}

// ─── Writes ──────────────────────────────────────────────────────────────────

export async function createSiteBlueprint(
  input: unknown,
): Promise<ApiResponse<SiteBlueprint>> {
  const parsed = CreateSiteBlueprintSchema.safeParse(input);
  if (!parsed.success) return validationFailed(RESOURCE, parsed.error);

  return guardImpl(RESOURCE, async () => {
    const supabase = getServiceRoleClient();
    const { data, error } = await supabase
      .from("site_blueprints")
      .insert({
        site_id:    parsed.data.site_id,
        brand_name: parsed.data.brand_name,
        brand_voice:   parsed.data.brand_voice,
        design_tokens: parsed.data.design_tokens,
        seo_defaults:  parsed.data.seo_defaults,
        created_by: parsed.data.created_by ?? null,
        status:     "draft",
      })
      .select(SELECT_ALL)
      .single();

    if (error) return mapPgError(RESOURCE, error);
    if (!data) return internalError("INSERT returned no row.");

    revalidatePath(`/admin/sites/${parsed.data.site_id}`);
    return { ok: true, data: data as SiteBlueprint, timestamp: now() };
  });
}

/**
 * Optimistic-lock update. Fails with VERSION_CONFLICT if version_lock
 * doesn't match the expected value.
 */
export async function updateSiteBlueprint(
  id: string,
  patch: unknown,
  expected_version_lock: number,
): Promise<ApiResponse<SiteBlueprint>> {
  const parsed = UpdateSiteBlueprintSchema.safeParse(patch);
  if (!parsed.success) return validationFailed(RESOURCE, parsed.error);

  return guardImpl(RESOURCE, async () => {
    const supabase = getServiceRoleClient();
    const { data, error } = await supabase
      .from("site_blueprints")
      .update({ ...parsed.data, version_lock: expected_version_lock + 1 })
      .eq("id", id)
      .eq("version_lock", expected_version_lock)
      .select(SELECT_ALL)
      .maybeSingle();

    if (error) return mapPgError(RESOURCE, error);
    if (data) {
      const bp = data as SiteBlueprint;
      revalidatePath(`/admin/sites/${bp.site_id}`);
      return { ok: true, data: bp, timestamp: now() };
    }
    return disambiguateMissingUpdate(supabase, id, expected_version_lock);
  });
}

/**
 * Transitions blueprint status. Only valid transition: draft → approved.
 * Approved blueprints gate page generation in lib/batch-worker.ts.
 */
export async function approveSiteBlueprint(
  id: string,
  expected_version_lock: number,
  updated_by?: string | null,
): Promise<ApiResponse<SiteBlueprint>> {
  return guardImpl(RESOURCE, async () => {
    const supabase = getServiceRoleClient();
    const { data, error } = await supabase
      .from("site_blueprints")
      .update({
        status:       "approved",
        updated_by:   updated_by ?? null,
        version_lock: expected_version_lock + 1,
      })
      .eq("id", id)
      .eq("version_lock", expected_version_lock)
      .select(SELECT_ALL)
      .maybeSingle();

    if (error) return mapPgError(RESOURCE, error);
    if (data) {
      const bp = data as SiteBlueprint;
      revalidatePath(`/admin/sites/${bp.site_id}`);
      return { ok: true, data: bp, timestamp: now() };
    }
    return disambiguateMissingUpdate(supabase, id, expected_version_lock);
  });
}

/**
 * Reverts an approved blueprint to draft (operator wants to revise the plan).
 * All pages remain untouched — status only gates new generation runs.
 */
export async function revertSiteBlueprintToDraft(
  id: string,
  expected_version_lock: number,
  updated_by?: string | null,
): Promise<ApiResponse<SiteBlueprint>> {
  return guardImpl(RESOURCE, async () => {
    const supabase = getServiceRoleClient();
    const { data, error } = await supabase
      .from("site_blueprints")
      .update({
        status:       "draft",
        updated_by:   updated_by ?? null,
        version_lock: expected_version_lock + 1,
      })
      .eq("id", id)
      .eq("version_lock", expected_version_lock)
      .select(SELECT_ALL)
      .maybeSingle();

    if (error) return mapPgError(RESOURCE, error);
    if (data) {
      const bp = data as SiteBlueprint;
      revalidatePath(`/admin/sites/${bp.site_id}`);
      return { ok: true, data: bp, timestamp: now() };
    }
    return disambiguateMissingUpdate(supabase, id, expected_version_lock);
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function disambiguateMissingUpdate(
  supabase: ReturnType<typeof getServiceRoleClient>,
  id: string,
  expected_version_lock: number,
): Promise<ApiResponse<SiteBlueprint>> {
  const { data, error } = await supabase
    .from("site_blueprints")
    .select("id,version_lock")
    .eq("id", id)
    .maybeSingle();

  if (error) return mapPgError(RESOURCE, error);
  if (!data) return notFound(RESOURCE, id);
  return versionConflict(RESOURCE, id, expected_version_lock);
}
