/**
 * lib/route-registry.ts
 *
 * Data layer for the route_registry table (M16-1 migration).
 * Every internal URL in the site is a record here.
 * Nothing stores a URL string — all internal links are routeRef UUIDs.
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
import type { PageType } from "@/lib/types/page-document";

// ─── Types ──────────────────────────────────────────────────────────────────

export type RouteStatus = "planned" | "live" | "redirected" | "removed";

export type RouteRegistryRow = {
  id:              string;
  site_id:         string;
  slug:            string;
  page_type:       PageType;
  label:           string;
  status:          RouteStatus;
  redirect_to:     string | null;
  wp_page_id:      number | null;
  wp_content_hash: string | null;
  version_lock:    number;
  created_at:      string;
  updated_at:      string;
};

const RESOURCE = "route_registry";
const SELECT_ALL = "*";

function now(): string { return new Date().toISOString(); }

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const PAGE_TYPES = [
  "homepage", "service", "about", "contact",
  "landing", "blog-index", "blog-post",
] as const;

const ROUTE_STATUSES = ["planned", "live", "redirected", "removed"] as const;

export const CreateRouteSchema = z.object({
  site_id:   z.string().uuid(),
  slug:      z.string().min(1).startsWith("/"),
  page_type: z.enum(PAGE_TYPES),
  label:     z.string().min(1).max(200),
  status:    z.enum(ROUTE_STATUSES).optional().default("planned"),
});
export type CreateRouteInput = z.infer<typeof CreateRouteSchema>;

export const UpdateRouteSchema = z.object({
  slug:        z.string().min(1).startsWith("/").optional(),
  label:       z.string().min(1).max(200).optional(),
  status:      z.enum(ROUTE_STATUSES).optional(),
  redirect_to: z.string().uuid().nullable().optional(),
  wp_page_id:      z.number().int().positive().nullable().optional(),
  wp_content_hash: z.string().nullable().optional(),
}).refine(patch => Object.keys(patch).length > 0, {
  message: "At least one updatable field must be provided.",
});
export type UpdateRouteInput = z.infer<typeof UpdateRouteSchema>;

// ─── Reads ───────────────────────────────────────────────────────────────────

export async function listRoutes(
  site_id: string,
  opts?: { status?: RouteStatus },
): Promise<ApiResponse<RouteRegistryRow[]>> {
  return guardImpl(RESOURCE, async () => {
    const supabase = getServiceRoleClient();
    let q = supabase
      .from("route_registry")
      .select(SELECT_ALL)
      .eq("site_id", site_id)
      .order("created_at", { ascending: true });

    if (opts?.status) q = q.eq("status", opts.status);

    const { data, error } = await q;
    if (error) return mapPgError(RESOURCE, error);
    return { ok: true, data: (data ?? []) as RouteRegistryRow[], timestamp: now() };
  });
}

/** Returns all non-removed routes — the set passed to the payload builder. */
export async function listActiveRoutes(
  site_id: string,
): Promise<ApiResponse<RouteRegistryRow[]>> {
  return guardImpl(RESOURCE, async () => {
    const supabase = getServiceRoleClient();
    const { data, error } = await supabase
      .from("route_registry")
      .select(SELECT_ALL)
      .eq("site_id", site_id)
      .neq("status", "removed")
      .order("created_at", { ascending: true });

    if (error) return mapPgError(RESOURCE, error);
    return { ok: true, data: (data ?? []) as RouteRegistryRow[], timestamp: now() };
  });
}

export async function getRouteById(
  id: string,
): Promise<ApiResponse<RouteRegistryRow>> {
  return guardImpl(RESOURCE, async () => {
    const supabase = getServiceRoleClient();
    const { data, error } = await supabase
      .from("route_registry")
      .select(SELECT_ALL)
      .eq("id", id)
      .maybeSingle();

    if (error) return mapPgError(RESOURCE, error);
    if (!data) return notFound(RESOURCE, id);
    return { ok: true, data: data as RouteRegistryRow, timestamp: now() };
  });
}

// ─── Writes ──────────────────────────────────────────────────────────────────

export async function createRoute(
  input: unknown,
): Promise<ApiResponse<RouteRegistryRow>> {
  const parsed = CreateRouteSchema.safeParse(input);
  if (!parsed.success) return validationFailed(RESOURCE, parsed.error);

  return guardImpl(RESOURCE, async () => {
    const supabase = getServiceRoleClient();
    const { data, error } = await supabase
      .from("route_registry")
      .insert({
        site_id:   parsed.data.site_id,
        slug:      parsed.data.slug,
        page_type: parsed.data.page_type,
        label:     parsed.data.label,
        status:    parsed.data.status,
      })
      .select(SELECT_ALL)
      .single();

    if (error) return mapPgError(RESOURCE, error);
    if (!data) return internalError("INSERT returned no row.");

    revalidatePath(`/admin/sites/${parsed.data.site_id}`);
    return { ok: true, data: data as RouteRegistryRow, timestamp: now() };
  });
}

export async function updateRoute(
  id: string,
  patch: unknown,
  expected_version_lock: number,
): Promise<ApiResponse<RouteRegistryRow>> {
  const parsed = UpdateRouteSchema.safeParse(patch);
  if (!parsed.success) return validationFailed(RESOURCE, parsed.error);

  return guardImpl(RESOURCE, async () => {
    const supabase = getServiceRoleClient();
    const { data, error } = await supabase
      .from("route_registry")
      .update({ ...parsed.data, version_lock: expected_version_lock + 1 })
      .eq("id", id)
      .eq("version_lock", expected_version_lock)
      .select(SELECT_ALL)
      .maybeSingle();

    if (error) return mapPgError(RESOURCE, error);
    if (data) {
      const row = data as RouteRegistryRow;
      revalidatePath(`/admin/sites/${row.site_id}`);
      return { ok: true, data: row, timestamp: now() };
    }
    return disambiguateMissingUpdate(supabase, id, expected_version_lock);
  });
}

/**
 * Bulk-upsert routes from the site planner output.
 * Called once per site after Pass 0+1 completes.
 * Idempotent: matching (site_id, slug) rows are updated.
 */
export async function upsertRoutesFromPlan(
  site_id: string,
  routes: { slug: string; page_type: PageType; label: string; priority: number }[],
): Promise<ApiResponse<RouteRegistryRow[]>> {
  return guardImpl(RESOURCE, async () => {
    const supabase = getServiceRoleClient();
    const rows = routes.map(r => ({
      site_id,
      slug:      r.slug,
      page_type: r.page_type,
      label:     r.label,
      status:    "planned" as const,
    }));

    const { data, error } = await supabase
      .from("route_registry")
      .upsert(rows, { onConflict: "site_id,slug", ignoreDuplicates: false })
      .select(SELECT_ALL);

    if (error) return mapPgError(RESOURCE, error);
    revalidatePath(`/admin/sites/${site_id}`);
    return { ok: true, data: (data ?? []) as RouteRegistryRow[], timestamp: now() };
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function disambiguateMissingUpdate(
  supabase: ReturnType<typeof getServiceRoleClient>,
  id: string,
  expected_version_lock: number,
): Promise<ApiResponse<RouteRegistryRow>> {
  const { data, error } = await supabase
    .from("route_registry")
    .select("id,version_lock")
    .eq("id", id)
    .maybeSingle();

  if (error) return mapPgError(RESOURCE, error);
  if (!data) return notFound(RESOURCE, id);
  return versionConflict(RESOURCE, id, expected_version_lock);
}
