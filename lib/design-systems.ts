import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const DESIGN_SYSTEM_STATUSES = ["draft", "active", "archived"] as const;
export type DesignSystemStatus = (typeof DESIGN_SYSTEM_STATUSES)[number];

export type DesignSystem = {
  id: string;
  site_id: string;
  version: number;
  status: DesignSystemStatus;
  tokens_css: string;
  base_styles: string;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  activated_at: string | null;
  archived_at: string | null;
  version_lock: number;
};

const SELECT_ALL = "*";
const RESOURCE = "design_system";

function now(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const CreateDesignSystemSchema = z.object({
  site_id: z.string().uuid(),
  version: z.number().int().positive(),
  tokens_css: z.string(),
  base_styles: z.string(),
  notes: z.string().nullable().optional(),
  created_by: z.string().uuid().nullable().optional(),
});
export type CreateDesignSystemInput = z.infer<typeof CreateDesignSystemSchema>;

export const UpdateDesignSystemSchema = z
  .object({
    tokens_css: z.string().optional(),
    base_styles: z.string().optional(),
    notes: z.string().nullable().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "At least one updatable field must be provided.",
  });
export type UpdateDesignSystemInput = z.infer<typeof UpdateDesignSystemSchema>;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listDesignSystems(
  site_id: string,
): Promise<ApiResponse<DesignSystem[]>> {
  return guardImpl(RESOURCE, async () => {
    const supabase = getServiceRoleClient();
    const { data, error } = await supabase
      .from("design_systems")
      .select(SELECT_ALL)
      .eq("site_id", site_id)
      .order("version", { ascending: false });

    if (error) return mapPgError(RESOURCE, error);
    return { ok: true, data: (data ?? []) as DesignSystem[], timestamp: now() };
  });
}

export async function getDesignSystem(
  id: string,
): Promise<ApiResponse<DesignSystem>> {
  return guardImpl(RESOURCE, async () => {
    const supabase = getServiceRoleClient();
    const { data, error } = await supabase
      .from("design_systems")
      .select(SELECT_ALL)
      .eq("id", id)
      .maybeSingle();

    if (error) return mapPgError(RESOURCE, error);
    if (!data) return notFound(RESOURCE, id);
    return { ok: true, data: data as DesignSystem, timestamp: now() };
  });
}

// Returns null-data on found-but-no-active, rather than NOT_FOUND, because
// "no active version yet" is an expected state for a newly-created site.
// Callers that treat this as an error should check `data === null`.
export async function getActiveDesignSystem(
  site_id: string,
): Promise<ApiResponse<DesignSystem | null>> {
  return guardImpl(RESOURCE, async () => {
    const supabase = getServiceRoleClient();
    const { data, error } = await supabase
      .from("design_systems")
      .select(SELECT_ALL)
      .eq("site_id", site_id)
      .eq("status", "active")
      .maybeSingle();

    if (error) return mapPgError(RESOURCE, error);
    return {
      ok: true,
      data: (data ?? null) as DesignSystem | null,
      timestamp: now(),
    };
  });
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createDesignSystem(
  input: unknown,
): Promise<ApiResponse<DesignSystem>> {
  const parsed = CreateDesignSystemSchema.safeParse(input);
  if (!parsed.success) return validationFailed(RESOURCE, parsed.error);

  return guardImpl(RESOURCE, async () => {
    const supabase = getServiceRoleClient();
    const { data, error } = await supabase
      .from("design_systems")
      .insert({
        site_id: parsed.data.site_id,
        version: parsed.data.version,
        tokens_css: parsed.data.tokens_css,
        base_styles: parsed.data.base_styles,
        notes: parsed.data.notes ?? null,
        created_by: parsed.data.created_by ?? null,
        status: "draft",
      })
      .select(SELECT_ALL)
      .single();

    if (error) return mapPgError(RESOURCE, error);
    if (!data) return internalError("INSERT returned no row.");
    return { ok: true, data: data as DesignSystem, timestamp: now() };
  });
}

// Optimistic lock: UPDATE with WHERE id=$id AND version_lock=$expected. If
// zero rows affected, follow-up SELECT disambiguates NOT_FOUND vs
// VERSION_CONFLICT. Does not touch status — use activate/archive for that.
export async function updateDesignSystem(
  id: string,
  patch: unknown,
  expected_version_lock: number,
): Promise<ApiResponse<DesignSystem>> {
  const parsed = UpdateDesignSystemSchema.safeParse(patch);
  if (!parsed.success) return validationFailed(RESOURCE, parsed.error);

  return guardImpl(RESOURCE, async () => {
    const supabase = getServiceRoleClient();
    const { data, error } = await supabase
      .from("design_systems")
      .update({
        ...parsed.data,
        version_lock: expected_version_lock + 1,
      })
      .eq("id", id)
      .eq("version_lock", expected_version_lock)
      .select(SELECT_ALL)
      .maybeSingle();

    if (error) return mapPgError(RESOURCE, error);
    if (data) return { ok: true, data: data as DesignSystem, timestamp: now() };

    return disambiguateMissingUpdate(supabase, id, expected_version_lock);
  });
}

// Atomic. Delegates to the activate_design_system RPC (0003 migration) which
// archives the current active DS and promotes the target in a single SQL
// body. Version-lock mismatch surfaces as SQLSTATE 40001 → VERSION_CONFLICT.
export async function activateDesignSystem(
  id: string,
  expected_version_lock: number,
): Promise<ApiResponse<DesignSystem>> {
  return guardImpl(RESOURCE, async () => {
    const supabase = getServiceRoleClient();
    const { data, error } = await supabase
      .rpc("activate_design_system", {
        p_ds_id: id,
        p_expected_version_lock: expected_version_lock,
      })
      .single();

    if (error) {
      // 40001 from the RPC means optimistic-lock mismatch; we know the
      // expected value, so surface it in the response.
      if (error.code === "40001") {
        return versionConflict(RESOURCE, id, expected_version_lock);
      }
      return mapPgError(RESOURCE, error);
    }
    if (!data) return internalError("RPC returned no row.");
    return { ok: true, data: data as DesignSystem, timestamp: now() };
  });
}

// Archive is allowed on any status. Archiving the active DS leaves the site
// with no active design system — we surface that as a soft warning on the
// payload rather than an error (per Q6). Archiving an already-archived row
// is a no-op success that still bumps version_lock.
export async function archiveDesignSystem(
  id: string,
  expected_version_lock: number,
): Promise<
  ApiResponse<{ design_system: DesignSystem; warnings: string[] }>
> {
  return guardImpl(RESOURCE, async () => {
    const supabase = getServiceRoleClient();
    const { data, error } = await supabase
      .from("design_systems")
      .update({
        status: "archived",
        archived_at: now(),
        version_lock: expected_version_lock + 1,
      })
      .eq("id", id)
      .eq("version_lock", expected_version_lock)
      .select(SELECT_ALL)
      .maybeSingle();

    if (error) return mapPgError(RESOURCE, error);
    if (!data) {
      const follow = await disambiguateMissingUpdate(
        supabase,
        id,
        expected_version_lock,
      );
      return follow as ApiResponse<{
        design_system: DesignSystem;
        warnings: string[];
      }>;
    }

    const ds = data as DesignSystem;
    const warnings: string[] = [];

    // If the archived row was the previously-active one, check whether the
    // site now has any active design system. Read-after-write is safe here:
    // RLS service-role bypass + partial unique index guarantee at most one.
    const { data: stillActive, error: checkErr } = await supabase
      .from("design_systems")
      .select("id")
      .eq("site_id", ds.site_id)
      .eq("status", "active")
      .maybeSingle();

    if (checkErr) return mapPgError(RESOURCE, checkErr);
    if (!stillActive) {
      warnings.push(
        `Site ${ds.site_id} has no active design system after this archive. Activate another version before generating new pages.`,
      );
    }

    return {
      ok: true,
      data: { design_system: ds, warnings },
      timestamp: now(),
    };
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function disambiguateMissingUpdate(
  supabase: SupabaseClient,
  id: string,
  expected_version_lock: number,
): Promise<ApiResponse<DesignSystem>> {
  const { data, error } = await supabase
    .from("design_systems")
    .select("id,version_lock")
    .eq("id", id)
    .maybeSingle();

  if (error) return mapPgError(RESOURCE, error);
  if (!data) return notFound(RESOURCE, id);
  return versionConflict(RESOURCE, id, expected_version_lock);
}
