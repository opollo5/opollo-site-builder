import { z } from "zod";

import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import type { ApiResponse } from "@/lib/tool-schemas";

// ---------------------------------------------------------------------------
// Spec 22 PR 1 — draft types + DB helpers for social_post_drafts.
//
// DraftData is the content layer stored in draft_data JSONB. The top-level
// Draft type adds identity + concurrency metadata (id, company_id, version).
// ---------------------------------------------------------------------------

export const MediaRefSchema = z.object({
  type: z.enum(["upload", "ai_generated", "istock", "tenor_gif"]),
  url: z.string().url(),
  cloudflare_id: z.string().optional(),
  alt_text: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  source_metadata: z.record(z.string(), z.unknown()).optional(),
});
export type MediaRef = z.infer<typeof MediaRefSchema>;

export const DraftDataSchema = z.object({
  master_text: z.string().default(""),
  link_url: z.string().url().optional().nullable(),
  media_refs: z.array(MediaRefSchema).default([]),
  target_connection_ids: z.array(z.string().uuid()).default([]),
  schedule: z
    .object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      times: z.array(z.string().regex(/^\d{2}:\d{2}$/)),
    })
    .optional()
    .nullable(),
  approval_required: z.boolean().default(false),
  ai_metadata: z
    .object({
      prompt: z.string(),
      tone: z.string(),
      generated_at: z.string(),
    })
    .optional()
    .nullable(),
});
export type DraftData = z.infer<typeof DraftDataSchema>;

export type Draft = {
  id: string;
  company_id: string;
  created_by: string;
  updated_by: string;
  draft_version: number;
  draft_data: DraftData;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

// ---------------------------------------------------------------------------
// createDraft — inserts a new row and returns the full draft.
// ---------------------------------------------------------------------------

export async function createDraft(params: {
  companyId: string;
  userId: string;
  idempotencyKey?: string;
}): Promise<ApiResponse<Draft>> {
  const client = getServiceRoleClient();

  // When an idempotency_key is supplied, return the existing draft if one
  // already exists for (company_id, idempotency_key) — CAP retry safety.
  if (params.idempotencyKey) {
    const { data: existing } = await client
      .from("social_post_drafts")
      .select()
      .eq("company_id", params.companyId)
      .eq("idempotency_key", params.idempotencyKey)
      .is("archived_at", null)
      .maybeSingle();

    if (existing) {
      return { ok: true, data: existing as unknown as Draft, timestamp: new Date().toISOString() };
    }
  }

  const insertRow: Record<string, unknown> = {
    company_id: params.companyId,
    created_by: params.userId,
    updated_by: params.userId,
    draft_version: 1,
    draft_data: DraftDataSchema.parse({}),
  };
  if (params.idempotencyKey) insertRow.idempotency_key = params.idempotencyKey;

  const { data, error } = await client
    .from("social_post_drafts")
    .insert(insertRow)
    .select()
    .single();

  if (error || !data) {
    return {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: error?.message ?? "Failed to create draft.",
        retryable: true,
        suggested_action: "Try again.",
      },
      timestamp: new Date().toISOString(),
    };
  }

  return {
    ok: true,
    data: data as unknown as Draft,
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// getDraft — loads a draft by ID. Returns NOT_FOUND if no row.
// ---------------------------------------------------------------------------

export async function getDraft(params: {
  draftId: string;
  companyId: string;
}): Promise<ApiResponse<Draft>> {
  const client = getServiceRoleClient();

  const { data, error } = await client
    .from("social_post_drafts")
    .select()
    .eq("id", params.draftId)
    .eq("company_id", params.companyId)
    .is("archived_at", null)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: error.message,
        retryable: true,
        suggested_action: "Try again.",
      },
      timestamp: new Date().toISOString(),
    };
  }

  if (!data) {
    return {
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: `Draft ${params.draftId} not found.`,
        retryable: false,
        suggested_action: "The draft may have been published or deleted.",
      },
      timestamp: new Date().toISOString(),
    };
  }

  // Resolve media_asset_ids → signed URLs so the Composer can display
  // auto-attached images (Gap 3 fix). Uses the same resolveMediaForPublish
  // logic as the publish pipeline — no duplication.
  //
  // Resolution is merged into media_urls for the API response only.
  // The DB row is not modified here; asset IDs remain the authoritative source.
  const row = data as Record<string, unknown>;
  const rawAssetIds = (row.media_asset_ids as string[] | null) ?? [];
  let resolvedData = data;

  if (rawAssetIds.length > 0) {
    try {
      const { resolveMediaForPublish } = await import("@/lib/social/publishing/resolve-media");
      const rawMediaUrls = (row.media_urls as string[] | null) ?? [];
      const resolvedUrls = await resolveMediaForPublish({
        mediaAssetIds: rawAssetIds,
        legacyMediaUrls: rawMediaUrls,
      });
      resolvedData = { ...data, media_urls: resolvedUrls };
    } catch (err) {
      // Fail-soft: if resolution fails, return the draft without images rather
      // than blocking the Composer from opening. The publish pipeline will
      // re-resolve from media_asset_ids at publish time.
      logger.warn("social.drafts.get.asset_resolve_failed", {
        draftId: params.draftId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    ok: true,
    data: resolvedData as unknown as Draft,
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// saveDraft — optimistic CAS UPDATE per ADR-0002.
//
// Returns VERSION_CONFLICT (409) with `currentDraft` details when the
// expected_version doesn't match the server row. The client shows a
// "Reload latest?" prompt instead of silently overwriting.
// ---------------------------------------------------------------------------

export async function saveDraft(params: {
  draftId: string;
  companyId: string;
  userId: string;
  expectedVersion: number;
  draftData: DraftData;
}): Promise<ApiResponse<Draft>> {
  const client = getServiceRoleClient();

  const { data, error } = await client
    .from("social_post_drafts")
    .update({
      updated_by: params.userId,
      draft_version: params.expectedVersion + 1,
      draft_data: params.draftData,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.draftId)
    .eq("company_id", params.companyId)
    .eq("draft_version", params.expectedVersion)
    .is("archived_at", null)
    .select()
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      error: {
        code: "INTERNAL_ERROR",
        message: error.message,
        retryable: true,
        suggested_action: "Try again.",
      },
      timestamp: new Date().toISOString(),
    };
  }

  if (!data) {
    // CAS miss — fetch current row for the conflict prompt.
    const current = await getDraft({ draftId: params.draftId, companyId: params.companyId });
    return {
      ok: false,
      error: {
        code: "VERSION_CONFLICT",
        message: "Draft was modified by another tab or user.",
        details: {
          current_draft: current.ok ? current.data : null,
        },
        retryable: false,
        suggested_action: "Reload the latest draft and re-apply your changes.",
      },
      timestamp: new Date().toISOString(),
    };
  }

  return {
    ok: true,
    data: data as unknown as Draft,
    timestamp: new Date().toISOString(),
  };
}
