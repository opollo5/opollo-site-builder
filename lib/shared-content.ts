/**
 * lib/shared-content.ts
 *
 * Data layer for the shared_content table (M16-1 migration).
 * Reusable content objects (CTAs, testimonials, services, FAQs, stats, offers)
 * referenced by ID from any page section. Soft-delete via deleted_at.
 *
 * Follows lib/design-systems.ts conventions.
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
import type { SharedContentType } from "@/lib/types/page-document";

// ─── Types ──────────────────────────────────────────────────────────────────

export type SharedContentRow = {
  id:           string;
  site_id:      string;
  content_type: SharedContentType;
  label:        string;
  content:      Record<string, unknown>;
  version_lock: number;
  deleted_at:   string | null;
  deleted_by:   string | null;
  created_at:   string;
  updated_at:   string;
  created_by:   string | null;
  updated_by:   string | null;
};

const RESOURCE = "shared_content";
const SELECT_ALL = "*";

function now(): string { return new Date().toISOString(); }

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const CONTENT_TYPES = ["cta", "testimonial", "service", "faq", "stat", "offer"] as const;

export const CreateSharedContentSchema = z.object({
  site_id:      z.string().uuid(),
  content_type: z.enum(CONTENT_TYPES),
  label:        z.string().min(1).max(200),
  content:      z.record(z.string(), z.unknown()).optional().default({}),
  created_by:   z.string().uuid().nullable().optional(),
});
export type CreateSharedContentInput = z.infer<typeof CreateSharedContentSchema>;

export const UpdateSharedContentSchema = z.object({
  label:      z.string().min(1).max(200).optional(),
  content:    z.record(z.string(), z.unknown()).optional(),
  updated_by: z.string().uuid().nullable().optional(),
}).refine(patch => Object.keys(patch).length > 0, {
  message: "At least one updatable field must be provided.",
});
export type UpdateSharedContentInput = z.infer<typeof UpdateSharedContentSchema>;

// ─── Reads ───────────────────────────────────────────────────────────────────

/** Returns all non-deleted shared content for a site. */
export async function listSharedContent(
  site_id: string,
  opts?: { content_type?: SharedContentType },
): Promise<ApiResponse<SharedContentRow[]>> {
  return guardImpl(RESOURCE, async () => {
    const supabase = getServiceRoleClient();
    let q = supabase
      .from("shared_content")
      .select(SELECT_ALL)
      .eq("site_id", site_id)
      .is("deleted_at", null)
      .order("created_at", { ascending: true });

    if (opts?.content_type) q = q.eq("content_type", opts.content_type);

    const { data, error } = await q;
    if (error) return mapPgError(RESOURCE, error);
    return { ok: true, data: (data ?? []) as SharedContentRow[], timestamp: now() };
  });
}

export async function getSharedContentById(
  id: string,
): Promise<ApiResponse<SharedContentRow>> {
  return guardImpl(RESOURCE, async () => {
    const supabase = getServiceRoleClient();
    const { data, error } = await supabase
      .from("shared_content")
      .select(SELECT_ALL)
      .eq("id", id)
      .maybeSingle();

    if (error) return mapPgError(RESOURCE, error);
    if (!data) return notFound(RESOURCE, id);
    return { ok: true, data: data as SharedContentRow, timestamp: now() };
  });
}

/**
 * Batch-fetch shared content by IDs.
 * Used by the ref-resolver to hydrate a PageDocument's refs in one query.
 */
export async function getSharedContentByIds(
  ids: string[],
): Promise<ApiResponse<SharedContentRow[]>> {
  if (ids.length === 0) {
    return { ok: true, data: [], timestamp: now() };
  }
  return guardImpl(RESOURCE, async () => {
    const supabase = getServiceRoleClient();
    const { data, error } = await supabase
      .from("shared_content")
      .select(SELECT_ALL)
      .in("id", ids)
      .is("deleted_at", null);

    if (error) return mapPgError(RESOURCE, error);
    return { ok: true, data: (data ?? []) as SharedContentRow[], timestamp: now() };
  });
}

// ─── Writes ──────────────────────────────────────────────────────────────────

export async function createSharedContent(
  input: unknown,
): Promise<ApiResponse<SharedContentRow>> {
  const parsed = CreateSharedContentSchema.safeParse(input);
  if (!parsed.success) return validationFailed(RESOURCE, parsed.error);

  return guardImpl(RESOURCE, async () => {
    const supabase = getServiceRoleClient();
    const { data, error } = await supabase
      .from("shared_content")
      .insert({
        site_id:      parsed.data.site_id,
        content_type: parsed.data.content_type,
        label:        parsed.data.label,
        content:      parsed.data.content,
        created_by:   parsed.data.created_by ?? null,
      })
      .select(SELECT_ALL)
      .single();

    if (error) return mapPgError(RESOURCE, error);
    if (!data) return internalError("INSERT returned no row.");

    revalidatePath(`/admin/sites/${parsed.data.site_id}/content`);
    return { ok: true, data: data as SharedContentRow, timestamp: now() };
  });
}

/**
 * Bulk-insert shared content from the site planner output.
 * Called once per site after Pass 0+1 completes.
 * Uses explicit row union so every row has all required columns.
 */
export async function bulkInsertSharedContent(
  site_id: string,
  items: { content_type: SharedContentType; label: string; content: Record<string, unknown> }[],
): Promise<ApiResponse<SharedContentRow[]>> {
  if (items.length === 0) {
    return { ok: true, data: [], timestamp: now() };
  }
  return guardImpl(RESOURCE, async () => {
    const supabase = getServiceRoleClient();
    const rows = items.map(item => ({
      site_id,
      content_type: item.content_type,
      label:        item.label,
      content:      item.content,
    }));

    const { data, error } = await supabase
      .from("shared_content")
      .insert(rows)
      .select(SELECT_ALL);

    if (error) return mapPgError(RESOURCE, error);

    revalidatePath(`/admin/sites/${site_id}/content`);
    return { ok: true, data: (data ?? []) as SharedContentRow[], timestamp: now() };
  });
}

export async function updateSharedContent(
  id: string,
  patch: unknown,
  expected_version_lock: number,
): Promise<ApiResponse<SharedContentRow>> {
  const parsed = UpdateSharedContentSchema.safeParse(patch);
  if (!parsed.success) return validationFailed(RESOURCE, parsed.error);

  return guardImpl(RESOURCE, async () => {
    const supabase = getServiceRoleClient();
    const { data, error } = await supabase
      .from("shared_content")
      .update({ ...parsed.data, version_lock: expected_version_lock + 1 })
      .eq("id", id)
      .eq("version_lock", expected_version_lock)
      .select(SELECT_ALL)
      .maybeSingle();

    if (error) return mapPgError(RESOURCE, error);
    if (data) {
      const row = data as SharedContentRow;
      revalidatePath(`/admin/sites/${row.site_id}/content`);
      return { ok: true, data: row, timestamp: now() };
    }
    return disambiguateMissingUpdate(supabase, id, expected_version_lock);
  });
}

/**
 * Soft-delete. Marks the row with deleted_at and deleted_by.
 * The row stays in the table; refs from existing pages resolve normally
 * but the content will not appear in the payload builder's available refs.
 */
export async function softDeleteSharedContent(
  id: string,
  deleted_by?: string | null,
): Promise<ApiResponse<{ deleted: true }>> {
  return guardImpl(RESOURCE, async () => {
    const supabase = getServiceRoleClient();
    const { data: existing, error: fetchErr } = await supabase
      .from("shared_content")
      .select("id, site_id")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();

    if (fetchErr) return mapPgError(RESOURCE, fetchErr);
    if (!existing) return notFound(RESOURCE, id);

    const { error } = await supabase
      .from("shared_content")
      .update({ deleted_at: now(), deleted_by: deleted_by ?? null })
      .eq("id", id);

    if (error) return mapPgError(RESOURCE, error);

    revalidatePath(`/admin/sites/${existing.site_id as string}/content`);
    return { ok: true, data: { deleted: true } as const, timestamp: now() };
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function disambiguateMissingUpdate(
  supabase: ReturnType<typeof getServiceRoleClient>,
  id: string,
  expected_version_lock: number,
): Promise<ApiResponse<SharedContentRow>> {
  const { data, error } = await supabase
    .from("shared_content")
    .select("id,version_lock")
    .eq("id", id)
    .maybeSingle();

  if (error) return mapPgError(RESOURCE, error);
  if (!data) return notFound(RESOURCE, id);
  return versionConflict(RESOURCE, id, expected_version_lock);
}
