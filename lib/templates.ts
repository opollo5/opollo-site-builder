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

export type DesignTemplate = {
  id: string;
  design_system_id: string;
  page_type: string;
  name: string;
  composition: Array<Record<string, unknown>>;
  required_fields: Record<string, unknown>;
  seo_defaults: Record<string, unknown> | null;
  is_default: boolean;
  version_lock: number;
  created_at: string;
};

const SELECT_ALL = "*";
const RESOURCE = "design_template";

function now(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const JsonObjectSchema = z.record(z.string(), z.unknown());

// Composition is an ordered array of component references (see brief §3.4).
// Each entry has at minimum { component, content_source }. We don't enforce
// tighter structure here — that's verified at generation time against the
// component registry.
const CompositionEntrySchema = z.object({
  component: z.string().min(1),
  content_source: z.string().min(1),
}).and(z.record(z.string(), z.unknown()));

export const CreateDesignTemplateSchema = z.object({
  design_system_id: z.string().uuid(),
  page_type: z.string().min(1).max(60),
  name: z.string().min(1).max(120),
  composition: z.array(CompositionEntrySchema).min(1),
  required_fields: JsonObjectSchema,
  seo_defaults: JsonObjectSchema.nullable().optional(),
  is_default: z.boolean().optional(),
});
export type CreateDesignTemplateInput = z.infer<
  typeof CreateDesignTemplateSchema
>;

export const UpdateDesignTemplateSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    composition: z.array(CompositionEntrySchema).min(1).optional(),
    required_fields: JsonObjectSchema.optional(),
    seo_defaults: JsonObjectSchema.nullable().optional(),
    is_default: z.boolean().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "At least one updatable field must be provided.",
  });
export type UpdateDesignTemplateInput = z.infer<
  typeof UpdateDesignTemplateSchema
>;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listTemplates(
  design_system_id: string,
): Promise<ApiResponse<DesignTemplate[]>> {
  return guardImpl(RESOURCE, async () => {
    const supabase = getServiceRoleClient();
    const { data, error } = await supabase
      .from("design_templates")
      .select(SELECT_ALL)
      .eq("design_system_id", design_system_id)
      .order("page_type", { ascending: true })
      .order("name", { ascending: true });

    if (error) return mapPgError(RESOURCE, error);
    return {
      ok: true,
      data: (data ?? []) as DesignTemplate[],
      timestamp: now(),
    };
  });
}

export async function getTemplate(
  id: string,
): Promise<ApiResponse<DesignTemplate>> {
  return guardImpl(RESOURCE, async () => {
    const supabase = getServiceRoleClient();
    const { data, error } = await supabase
      .from("design_templates")
      .select(SELECT_ALL)
      .eq("id", id)
      .maybeSingle();

    if (error) return mapPgError(RESOURCE, error);
    if (!data) return notFound(RESOURCE, id);
    return { ok: true, data: data as DesignTemplate, timestamp: now() };
  });
}

export async function getDefaultTemplate(
  design_system_id: string,
  page_type: string,
): Promise<ApiResponse<DesignTemplate | null>> {
  return guardImpl(RESOURCE, async () => {
    const supabase = getServiceRoleClient();
    const { data, error } = await supabase
      .from("design_templates")
      .select(SELECT_ALL)
      .eq("design_system_id", design_system_id)
      .eq("page_type", page_type)
      .eq("is_default", true)
      .maybeSingle();

    if (error) return mapPgError(RESOURCE, error);
    return {
      ok: true,
      data: (data ?? null) as DesignTemplate | null,
      timestamp: now(),
    };
  });
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createTemplate(
  input: unknown,
): Promise<ApiResponse<DesignTemplate>> {
  const parsed = CreateDesignTemplateSchema.safeParse(input);
  if (!parsed.success) return validationFailed(RESOURCE, parsed.error);

  return guardImpl(RESOURCE, async () => {
    const supabase = getServiceRoleClient();
    const { data, error } = await supabase
      .from("design_templates")
      .insert({
        design_system_id: parsed.data.design_system_id,
        page_type: parsed.data.page_type,
        name: parsed.data.name,
        composition: parsed.data.composition,
        required_fields: parsed.data.required_fields,
        seo_defaults: parsed.data.seo_defaults ?? null,
        is_default: parsed.data.is_default ?? false,
      })
      .select(SELECT_ALL)
      .single();

    if (error) return mapPgError(RESOURCE, error);
    if (!data) return internalError("INSERT returned no row.");
    return { ok: true, data: data as DesignTemplate, timestamp: now() };
  });
}

export async function updateTemplate(
  id: string,
  patch: unknown,
  expected_version_lock: number,
): Promise<ApiResponse<DesignTemplate>> {
  const parsed = UpdateDesignTemplateSchema.safeParse(patch);
  if (!parsed.success) return validationFailed(RESOURCE, parsed.error);

  return guardImpl(RESOURCE, async () => {
    const supabase = getServiceRoleClient();
    const { data, error } = await supabase
      .from("design_templates")
      .update({
        ...parsed.data,
        version_lock: expected_version_lock + 1,
      })
      .eq("id", id)
      .eq("version_lock", expected_version_lock)
      .select(SELECT_ALL)
      .maybeSingle();

    if (error) return mapPgError(RESOURCE, error);
    if (data) {
      return { ok: true, data: data as DesignTemplate, timestamp: now() };
    }
    return disambiguateMissingUpdate(supabase, id, expected_version_lock);
  });
}

export async function deleteTemplate(
  id: string,
  expected_version_lock: number,
): Promise<ApiResponse<{ id: string }>> {
  return guardImpl(RESOURCE, async () => {
    const supabase = getServiceRoleClient();
    const { data, error } = await supabase
      .from("design_templates")
      .delete()
      .eq("id", id)
      .eq("version_lock", expected_version_lock)
      .select("id")
      .maybeSingle();

    if (error) return mapPgError(RESOURCE, error);
    if (data) {
      return { ok: true, data: { id: data.id as string }, timestamp: now() };
    }

    const follow = await supabase
      .from("design_templates")
      .select("id,version_lock")
      .eq("id", id)
      .maybeSingle();

    if (follow.error) return mapPgError(RESOURCE, follow.error);
    if (!follow.data) return notFound(RESOURCE, id);
    return versionConflict(RESOURCE, id, expected_version_lock);
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function disambiguateMissingUpdate(
  supabase: SupabaseClient,
  id: string,
  expected_version_lock: number,
): Promise<ApiResponse<DesignTemplate>> {
  const { data, error } = await supabase
    .from("design_templates")
    .select("id,version_lock")
    .eq("id", id)
    .maybeSingle();

  if (error) return mapPgError(RESOURCE, error);
  if (!data) return notFound(RESOURCE, id);
  return versionConflict(RESOURCE, id, expected_version_lock);
}
