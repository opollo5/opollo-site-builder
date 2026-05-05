import "server-only";

// ---------------------------------------------------------------------------
// lib/wp-site-publish.ts
//
// M16-8 — Site-level WordPress publication.
//
// Three separate pushes that happen once per site (not per page):
//   1. Theme tokens → Global Styles (theme.json partial patch)
//   2. Navigation → Header template part
//   3. Shared CTAs + other shared_content → WP Synced Patterns (wp_block)
//
// All three are optional (skipped when WP doesn't expose the endpoint).
// None mutate the Opollo DB — pure write-to-WP operations.
//
// Called from:
//   - POST /api/sites/[id]/blueprints/[id]/publish  (operator trigger)
//   - Future: auto after blueprint approval
// ---------------------------------------------------------------------------

import { createHash } from "crypto";

import type { WpConfig } from "@/lib/wordpress";
import type { SiteBlueprint } from "@/lib/site-blueprint";
import type { SharedContentRow } from "@/lib/shared-content";
import { publishThemeTokens } from "@/lib/wp-global-styles";
import type { OpolloDesignTokens } from "@/lib/wp-global-styles";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SitePublishResult = {
  ok: true;
  themeSkipped:    boolean;
  patternsCreated: number;
  patternsUpdated: number;
  errors:          string[];
} | {
  ok: false;
  code:    string;
  message: string;
};

// ─── Template Part helpers ─────────────────────────────────────────────────

function authHeader(cfg: WpConfig): string {
  return `Basic ${Buffer.from(`${cfg.user}:${cfg.appPassword}`).toString("base64")}`;
}

async function wpJsonFetch(
  cfg: WpConfig,
  path: string,
  init: RequestInit,
): Promise<Response> {
  const base = cfg.baseUrl.replace(/\/$/, "");
  const headers: Record<string, string> = {
    Authorization: authHeader(cfg),
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(init.headers as Record<string, string> ?? {}),
  };
  return fetch(`${base}${path}`, { ...init, headers, signal: AbortSignal.timeout(30_000) });
}

// ─── Synced Patterns (wp_block) ───────────────────────────────────────────

/**
 * Upsert a WordPress Synced Pattern (Reusable Block, post_type=wp_block).
 * Slug format: `opollo-{content_type}-{hash}` — deterministic from the label.
 */
export async function upsertSyncedPattern(
  cfg: WpConfig,
  opts: {
    slug:        string;
    title:       string;
    blockContent: string;  // Gutenberg block HTML
  },
): Promise<{ ok: true; id: number; created: boolean } | { ok: false; code: string; message: string }> {
  // Search for existing pattern by slug
  let existing: { id: number } | null = null;
  try {
    const res = await wpJsonFetch(
      cfg,
      `/wp-json/wp/v2/blocks?search=${encodeURIComponent(opts.slug)}&_fields=id,slug&per_page=10`,
      { method: "GET" },
    );
    if (res.ok) {
      const rows = await res.json() as { id: number; slug?: string }[];
      existing = rows.find(r => r.slug === opts.slug) ?? null;
    }
  } catch {
    // Endpoint might not exist on classic WP — skip silently
    return { ok: true, id: 0, created: false };
  }

  const payload = {
    title:   opts.title,
    slug:    opts.slug,
    content: opts.blockContent,
    status:  "publish",
  };

  if (existing) {
    // Update
    try {
      const res = await wpJsonFetch(cfg, `/wp-json/wp/v2/blocks/${existing.id}`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        return { ok: false, code: "WP_API_ERROR", message: `PUT blocks/${existing.id} returned ${res.status}: ${txt.slice(0, 200)}` };
      }
      return { ok: true, id: existing.id, created: false };
    } catch (err) {
      return { ok: false, code: "NETWORK_ERROR", message: String(err) };
    }
  }

  // Create
  try {
    const res = await wpJsonFetch(cfg, `/wp-json/wp/v2/blocks`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return { ok: false, code: "WP_API_ERROR", message: `POST blocks returned ${res.status}: ${txt.slice(0, 200)}` };
    }
    const body = await res.json() as { id?: number };
    return { ok: true, id: Number(body.id ?? 0), created: true };
  } catch (err) {
    return { ok: false, code: "NETWORK_ERROR", message: String(err) };
  }
}

// ─── Main entry point ─────────────────────────────────────────────────────

/**
 * Builds a deterministic slug for a shared_content row so WP patterns
 * can be upserted idempotently across multiple site-publish calls.
 */
export function sharedContentSlug(
  contentType: string,
  label: string,
): string {
  const hash = createHash("sha256")
    .update(`${contentType}:${label}`)
    .digest("hex")
    .slice(0, 8);
  const safeName = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
  return `opollo-${contentType}-${safeName}-${hash}`;
}

/**
 * Publish site-level WP assets (theme tokens + shared content patterns).
 * Safe to call repeatedly — all operations are idempotent.
 */
export async function publishSiteToWordPress(
  cfg: WpConfig,
  blueprint: SiteBlueprint,
  sharedContent: SharedContentRow[],
): Promise<SitePublishResult> {
  const errors: string[] = [];
  let patternsCreated = 0;
  let patternsUpdated = 0;
  let themeSkipped = false;

  // 1. Theme tokens
  const themeResult = await publishThemeTokens(
    cfg,
    blueprint.design_tokens as OpolloDesignTokens,
  );
  if (!themeResult.ok) {
    errors.push(`theme.json: ${themeResult.message}`);
  } else if (themeResult.skipped) {
    themeSkipped = true;
  }

  // 2. Shared content → WP Synced Patterns
  const { sharedContentToBlock } = await import("@/lib/gutenberg-format");
  for (const row of sharedContent) {
    if (row.deleted_at) continue;  // skip soft-deleted
    const slug    = sharedContentSlug(row.content_type, row.label);
    const title   = `Opollo: ${row.label}`;
    const blockHtml = sharedContentToBlock(row.label, row.content_type, row.content as Record<string, unknown>);

    const res = await upsertSyncedPattern(cfg, {
      slug,
      title,
      blockContent: blockHtml,
    });

    if (!res.ok) {
      errors.push(`pattern '${row.label}': ${res.message}`);
    } else if (res.id > 0) {
      if (res.created) patternsCreated++;
      else patternsUpdated++;
    }
  }

  return {
    ok: true,
    themeSkipped,
    patternsCreated,
    patternsUpdated,
    errors,
  };
}
