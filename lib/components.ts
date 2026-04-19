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

export type DesignComponent = {
  id: string;
  design_system_id: string;
  name: string;
  variant: string | null;
  category: string;
  html_template: string;
  css: string;
  content_schema: Record<string, unknown>;
  image_slots: Record<string, unknown> | null;
  usage_notes: string | null;
  preview_html: string | null;
  version_lock: number;
  created_at: string;
};

const SELECT_ALL = "*";
const RESOURCE = "design_component";

function now(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

// content_schema is user-supplied JSON Schema (see brief §3.5). We don't
// attempt to validate the JSON Schema itself here — that's Layer 3 enforcement
// at generation time (M3). At this layer we only require a JSON object.
const JsonObjectSchema = z.record(z.string(), z.unknown());

export const CreateDesignComponentSchema = z.object({
  design_system_id: z.string().uuid(),
  name: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9-]+$/, {
      message: "Component name must be lowercase kebab-case.",
    }),
  variant: z.string().min(1).max(60).nullable().optional(),
  category: z.string().min(1).max(60),
  html_template: z.string().min(1),
  css: z.string(),
  content_schema: JsonObjectSchema,
  image_slots: JsonObjectSchema.nullable().optional(),
  usage_notes: z.string().nullable().optional(),
  preview_html: z.string().nullable().optional(),
});
export type CreateDesignComponentInput = z.infer<
  typeof CreateDesignComponentSchema
>;

export const UpdateDesignComponentSchema = z
  .object({
    category: z.string().min(1).max(60).optional(),
    html_template: z.string().min(1).optional(),
    css: z.string().optional(),
    content_schema: JsonObjectSchema.optional(),
    image_slots: JsonObjectSchema.nullable().optional(),
    usage_notes: z.string().nullable().optional(),
    preview_html: z.string().nullable().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    message: "At least one updatable field must be provided.",
  });
export type UpdateDesignComponentInput = z.infer<
  typeof UpdateDesignComponentSchema
>;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listComponents(
  design_system_id: string,
): Promise<ApiResponse<DesignComponent[]>> {
  return guardImpl(RESOURCE, async () => {
    const supabase = getServiceRoleClient();
    const { data, error } = await supabase
      .from("design_components")
      .select(SELECT_ALL)
      .eq("design_system_id", design_system_id)
      .order("category", { ascending: true })
      .order("name", { ascending: true });

    if (error) return mapPgError(RESOURCE, error);
    return {
      ok: true,
      data: (data ?? []) as DesignComponent[],
      timestamp: now(),
    };
  });
}

export async function getComponent(
  id: string,
): Promise<ApiResponse<DesignComponent>> {
  return guardImpl(RESOURCE, async () => {
    const supabase = getServiceRoleClient();
    const { data, error } = await supabase
      .from("design_components")
      .select(SELECT_ALL)
      .eq("id", id)
      .maybeSingle();

    if (error) return mapPgError(RESOURCE, error);
    if (!data) return notFound(RESOURCE, id);
    return { ok: true, data: data as DesignComponent, timestamp: now() };
  });
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createComponent(
  input: unknown,
): Promise<ApiResponse<DesignComponent>> {
  const parsed = CreateDesignComponentSchema.safeParse(input);
  if (!parsed.success) return validationFailed(RESOURCE, parsed.error);

  return guardImpl(RESOURCE, async () => {
    const supabase = getServiceRoleClient();
    const { data, error } = await supabase
      .from("design_components")
      .insert({
        design_system_id: parsed.data.design_system_id,
        name: parsed.data.name,
        variant: parsed.data.variant ?? null,
        category: parsed.data.category,
        html_template: parsed.data.html_template,
        css: parsed.data.css,
        content_schema: parsed.data.content_schema,
        image_slots: parsed.data.image_slots ?? null,
        usage_notes: parsed.data.usage_notes ?? null,
        preview_html: parsed.data.preview_html ?? null,
      })
      .select(SELECT_ALL)
      .single();

    if (error) return mapPgError(RESOURCE, error);
    if (!data) return internalError("INSERT returned no row.");
    return { ok: true, data: data as DesignComponent, timestamp: now() };
  });
}

export async function updateComponent(
  id: string,
  patch: unknown,
  expected_version_lock: number,
): Promise<ApiResponse<DesignComponent>> {
  const parsed = UpdateDesignComponentSchema.safeParse(patch);
  if (!parsed.success) return validationFailed(RESOURCE, parsed.error);

  return guardImpl(RESOURCE, async () => {
    const supabase = getServiceRoleClient();
    const { data, error } = await supabase
      .from("design_components")
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
      return { ok: true, data: data as DesignComponent, timestamp: now() };
    }
    return disambiguateMissingUpdate(supabase, id, expected_version_lock);
  });
}

// Hard delete. Requires expected_version_lock to prevent deleting a component
// another operator just edited (Q5). Zero rows affected → NOT_FOUND vs
// VERSION_CONFLICT disambiguated by follow-up SELECT.
export async function deleteComponent(
  id: string,
  expected_version_lock: number,
): Promise<ApiResponse<{ id: string }>> {
  return guardImpl(RESOURCE, async () => {
    const supabase = getServiceRoleClient();
    const { data, error } = await supabase
      .from("design_components")
      .delete()
      .eq("id", id)
      .eq("version_lock", expected_version_lock)
      .select("id")
      .maybeSingle();

    if (error) return mapPgError(RESOURCE, error);
    if (data) {
      return { ok: true, data: { id: data.id as string }, timestamp: now() };
    }

    // Zero rows deleted. Disambiguate.
    const follow = await supabase
      .from("design_components")
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
): Promise<ApiResponse<DesignComponent>> {
  const { data, error } = await supabase
    .from("design_components")
    .select("id,version_lock")
    .eq("id", id)
    .maybeSingle();

  if (error) return mapPgError(RESOURCE, error);
  if (!data) return notFound(RESOURCE, id);
  return versionConflict(RESOURCE, id, expected_version_lock);
}
