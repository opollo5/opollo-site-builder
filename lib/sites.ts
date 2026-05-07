import type { Client as PgClient, ClientConfig } from "pg";

import {
  type ApiResponse,
  type RegisterSiteInput,
  type SiteListItem,
  type SiteRecord,
} from "@/lib/tool-schemas";
import { requireDbConfig } from "@/lib/db-direct";
import { decrypt, encrypt } from "@/lib/encryption";
import { logger } from "@/lib/logger";
import {
  testWpConnection,
  type TestConnectionResult,
} from "@/lib/site-test-connection";
import { getServiceRoleClient } from "@/lib/supabase";

export type SiteCredentials = {
  wp_user: string;
  wp_app_password: string;
};

export type SiteWithOptionalCredentials = {
  site: SiteRecord;
  credentials: SiteCredentials | null;
};

const LIGHT_SITE_FIELDS =
  "id,name,wp_url,prefix,status,last_successful_operation_at,last_connection_test_at,updated_at,company_id";

function now(): string {
  return new Date().toISOString();
}

// PostgREST returns bytea as "\x{hex}" strings by default. Normalize to Buffer.
function parseBytea(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "string") {
    if (value.startsWith("\\x")) {
      return Buffer.from(value.slice(2), "hex");
    }
    return Buffer.from(value, "base64");
  }
  throw new Error(`Unexpected bytea value type: ${typeof value}`);
}

function toByteaLiteral(buf: Buffer): string {
  return `\\x${buf.toString("hex")}`;
}

function internalError(
  message: string,
  details?: Record<string, unknown>,
): ApiResponse<never> {
  logger.error("sites.internal_error", { message });
  return {
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message,
      details,
      retryable: false,
      suggested_action: "Check Supabase connectivity and server logs.",
    },
    timestamp: now(),
  };
}

export async function createSite(
  input: RegisterSiteInput,
  opts?: { createdBy?: string | null },
): Promise<ApiResponse<SiteRecord>> {
  try {
    return await createSiteImpl(input, opts);
  } catch (err) {
    logger.error("sites.createSite.uncaught", { err: err instanceof Error ? err.message : String(err) });
    return internalError(
      `Unhandled error in createSite: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function createSiteImpl(
  input: RegisterSiteInput,
  opts?: { createdBy?: string | null },
): Promise<ApiResponse<SiteRecord>> {
  const supabase = getServiceRoleClient();

  // Auto-generate a prefix from the site name when the caller didn't
  // supply one. Operator-facing forms hide this field entirely per the
  // M2d UX cleanup; only programmatic callers that care about the
  // exact prefix (tests, the legacy Opollo admin scripts) still pass
  // it explicitly.
  let prefix = input.prefix;
  if (!prefix) {
    const generated = await generateUniquePrefix(input.name);
    if (!generated.ok) return generated;
    prefix = generated.prefix;
  }

  // 1. Insert sites row.
  const { data: siteRow, error: siteErr } = await supabase
    .from("sites")
    .insert({
      name: input.name,
      wp_url: input.wp_url,
      prefix,
      status: "active",
      created_by: opts?.createdBy ?? null,
      updated_by: opts?.createdBy ?? null,
    })
    .select()
    .single();

  if (siteErr || !siteRow) {
    // Unique-violation on the partial prefix index surfaces as Postgres 23505.
    if (siteErr?.code === "23505") {
      return {
        ok: false,
        error: {
          code: "PREFIX_TAKEN",
          message: `Scope prefix "${prefix}" is already in use by another active site.`,
          details: { prefix },
          retryable: true,
          suggested_action:
            "Choose a different 2–4 char prefix, or remove the existing site first.",
        },
        timestamp: now(),
      };
    }
    logger.error("sites.createSite.insert_failed", { supabase_error: siteErr?.message ?? null });
    return internalError("Failed to insert site row.", {
      supabase_error: siteErr ?? null,
    });
  }

  // 2. Encrypt password and insert credentials.
  let ciphertext: Buffer;
  let iv: Buffer;
  let keyVersion: number;
  try {
    const enc = encrypt(input.wp_app_password);
    ciphertext = enc.ciphertext;
    iv = enc.iv;
    keyVersion = enc.keyVersion;
  } catch (err) {
    await rollbackSite(siteRow.id);
    logger.error("sites.createSite.encryption_failed", { site_id: siteRow.id, err: err instanceof Error ? err.message : String(err) });
    return internalError(
      `Encryption failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const { error: credErr } = await supabase.from("site_credentials").insert({
    site_id: siteRow.id,
    wp_user: input.wp_user,
    site_secret_encrypted: toByteaLiteral(ciphertext),
    iv: toByteaLiteral(iv),
    key_version: keyVersion,
  });

  if (credErr) {
    await rollbackSite(siteRow.id);
    logger.error("sites.createSite.credentials_insert_failed", { site_id: siteRow.id, supabase_error: credErr.message });
    return internalError("Failed to insert site credentials row.", {
      supabase_error: credErr,
    });
  }

  return {
    ok: true,
    data: siteRow as SiteRecord,
    timestamp: now(),
  };
}

// Best-effort compensating delete after a failed credentials insert.
// If this also fails, the site row is orphaned; log and rely on the unique
// partial index to prevent silent reuse. Operator can clean up manually.
async function rollbackSite(siteId: string): Promise<void> {
  try {
    const supabase = getServiceRoleClient();
    const { error } = await supabase.from("sites").delete().eq("id", siteId);
    if (error) {
      logger.error("sites.createSite.rollback_delete_failed", {
        site_id: siteId,
        error,
      });
    }
  } catch (err) {
    logger.error("sites.createSite.rollback_threw", {
      site_id: siteId,
      error: err,
    });
  }
}

// Spec 01 — Sites admin cleanup.
// Sortable columns the operator can click in the table header. The set
// is deliberately narrow: name + wp_url are scalar text; company_name
// is joined data sorted in JS; status uses an explicit ordering map
// (active → not connected → paused → archived); last_connection_test_at
// is the freshness primary key.
export const SITE_SORTABLE_COLUMNS = [
  "name",
  "company_name",
  "wp_url",
  "status",
  "last_connection_test_at",
] as const;
export type SiteSortColumn = (typeof SITE_SORTABLE_COLUMNS)[number];
export type SiteSortDir = "asc" | "desc";

// Explicit ordering for the `status` sort key. Lexical sort would put
// 'active' before 'paused' before 'pending_pairing' before 'removed' —
// fine alphabetically, wrong operationally. Spec 01 §4 nails this down:
// active rows first, then setup-incomplete, then paused, then archived.
//
// The `Record<…, number>` typing is the spec-mandated exhaustiveness
// check: adding a new site_status enum value will fail to typecheck
// here until a sort weight is assigned, so the table can't silently
// drop new statuses to the bottom.
type SiteStatusForSort =
  | "active"
  | "pending_pairing"
  | "paused"
  | "removed";
export const STATUS_SORT_ORDER: Record<SiteStatusForSort, number> = {
  active: 0,
  pending_pairing: 1,
  paused: 2,
  removed: 3,
};

export type ListSitesOptions = {
  /**
   * Spec 01 §5 — server-side filter. `null`/undefined means the default
   * "hide archived" view (status != 'removed'); a specific status value
   * filters to that single status (including 'removed' for the
   * Archived chip).
   */
  status?: "active" | "pending_pairing" | "paused" | "removed" | null;
  /**
   * Spec 01 §4 — explicit user sort, e.g. URL `?sort=name&dir=asc`. When
   * absent, the default sort applies (status → last_connection_test_at
   * desc nulls last → name asc).
   */
  sort?: SiteSortColumn | null;
  dir?: SiteSortDir | null;
};

export async function listSites(
  opts: ListSitesOptions = {},
): Promise<ApiResponse<{ sites: SiteListItem[] }>> {
  try {
    return await listSitesImpl(opts);
  } catch (err) {
    logger.error("sites.listSites.uncaught", { err: err instanceof Error ? err.message : String(err) });
    return internalError(
      `Unhandled error in listSites: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function listSitesImpl(
  opts: ListSitesOptions,
): Promise<ApiResponse<{ sites: SiteListItem[] }>> {
  const supabase = getServiceRoleClient();
  let query = supabase.from("sites").select(LIGHT_SITE_FIELDS);
  if (opts.status) {
    query = query.eq("status", opts.status);
  } else {
    query = query.neq("status", "removed");
  }
  // Order at the SQL layer is just for stability; we re-sort in JS to
  // respect the STATUS_SORT_ORDER map and to sort joined company_name.
  query = query.order("updated_at", { ascending: false });

  const { data, error } = await query;

  if (error) {
    logger.error("sites.listSites.query_failed", { supabase_error: error.message });
    return internalError("Failed to list sites.", { supabase_error: error });
  }

  const rows = (data ?? []) as (SiteListItem & { company_id?: string | null })[];

  // Resolve company names in a single follow-up query (non-fatal on error).
  const companyIds = [...new Set(rows.map((r) => r.company_id).filter(Boolean))] as string[];
  const companyNameById = new Map<string, string>();
  if (companyIds.length > 0) {
    const { data: companies } = await supabase
      .from("platform_companies")
      .select("id,name")
      .in("id", companyIds);
    for (const c of companies ?? []) {
      companyNameById.set(c.id as string, c.name as string);
    }
  }

  const enriched: SiteListItem[] = rows.map((r) => ({
    ...r,
    company_name: r.company_id ? (companyNameById.get(r.company_id) ?? null) : null,
  }));

  const sites = sortSiteList(enriched, opts.sort ?? null, opts.dir ?? null);

  return {
    ok: true,
    data: { sites },
    timestamp: now(),
  };
}

function sortSiteList(
  sites: SiteListItem[],
  sort: SiteSortColumn | null,
  dir: SiteSortDir | null,
): SiteListItem[] {
  const out = [...sites];
  if (sort) {
    const ascending = dir !== "desc";
    out.sort((a, b) => compareByColumn(a, b, sort, ascending));
    return out;
  }
  // Default sort: status asc by STATUS_SORT_ORDER → last_connection_test_at
  // desc nulls last → name asc.
  out.sort((a, b) => {
    const sa = statusSortWeight(a.status);
    const sb = statusSortWeight(b.status);
    if (sa !== sb) return sa - sb;
    const tCmp = compareNullableDateDesc(
      a.last_connection_test_at,
      b.last_connection_test_at,
    );
    if (tCmp !== 0) return tCmp;
    return a.name.localeCompare(b.name);
  });
  return out;
}

function statusSortWeight(status: string): number {
  return Object.prototype.hasOwnProperty.call(STATUS_SORT_ORDER, status)
    ? STATUS_SORT_ORDER[status as SiteStatusForSort]
    : Number.MAX_SAFE_INTEGER;
}

function compareByColumn(
  a: SiteListItem,
  b: SiteListItem,
  column: SiteSortColumn,
  ascending: boolean,
): number {
  const sign = ascending ? 1 : -1;
  switch (column) {
    case "status": {
      const cmp = statusSortWeight(a.status) - statusSortWeight(b.status);
      return cmp !== 0 ? cmp * sign : a.name.localeCompare(b.name);
    }
    case "last_connection_test_at": {
      const cmp = compareNullableDateAsc(
        a.last_connection_test_at,
        b.last_connection_test_at,
      );
      return cmp !== 0 ? cmp * sign : a.name.localeCompare(b.name);
    }
    case "company_name": {
      const an = a.company_name ?? "";
      const bn = b.company_name ?? "";
      const cmp = an.localeCompare(bn);
      return cmp !== 0 ? cmp * sign : a.name.localeCompare(b.name);
    }
    case "wp_url":
      return a.wp_url.localeCompare(b.wp_url) * sign;
    case "name":
    default:
      return a.name.localeCompare(b.name) * sign;
  }
}

function compareNullableDateAsc(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1; // nulls last
  if (b === null) return -1;
  return new Date(a).getTime() - new Date(b).getTime();
}

function compareNullableDateDesc(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1; // nulls last
  if (b === null) return -1;
  return new Date(b).getTime() - new Date(a).getTime();
}

export async function getSite(
  id: string,
  opts: { includeCredentials?: boolean } = {},
): Promise<ApiResponse<SiteWithOptionalCredentials>> {
  try {
    return await getSiteImpl(id, opts);
  } catch (err) {
    logger.error("sites.getSite.uncaught", { site_id: id, err: err instanceof Error ? err.message : String(err) });
    return internalError(
      `Unhandled error in getSite: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function getSiteImpl(
  id: string,
  opts: { includeCredentials?: boolean } = {},
): Promise<ApiResponse<SiteWithOptionalCredentials>> {
  const supabase = getServiceRoleClient();

  const { data: site, error: siteErr } = await supabase
    .from("sites")
    .select("*")
    .eq("id", id)
    .neq("status", "removed")
    .maybeSingle();

  if (siteErr) {
    logger.error("sites.getSite.site_fetch_failed", { site_id: id, supabase_error: siteErr.message });
    return internalError("Failed to fetch site.", { supabase_error: siteErr });
  }
  if (!site) {
    return {
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: `No active site found with id ${id}.`,
        details: { id },
        retryable: false,
        suggested_action:
          "Verify the site id. Removed sites are excluded from lookups.",
      },
      timestamp: now(),
    };
  }

  if (!opts.includeCredentials) {
    return {
      ok: true,
      data: { site: site as SiteRecord, credentials: null },
      timestamp: now(),
    };
  }

  const { data: cred, error: credErr } = await supabase
    .from("site_credentials")
    .select("wp_user,site_secret_encrypted,iv,key_version")
    .eq("site_id", id)
    .maybeSingle();

  if (credErr) {
    logger.error("sites.getSite.credentials_fetch_failed", { site_id: id, supabase_error: credErr.message });
    return internalError("Failed to fetch site credentials.", {
      supabase_error: credErr,
    });
  }
  if (!cred) {
    // Site exists but credentials were wiped (e.g. migration 0056). Return
    // ok:true with null credentials so the edit page can still load and let
    // the operator re-enter them — rather than serving a 404.
    return {
      ok: true,
      data: { site: site as SiteRecord, credentials: null },
      timestamp: now(),
    };
  }

  let wp_app_password: string;
  try {
    const ciphertext = parseBytea(cred.site_secret_encrypted);
    const iv = parseBytea(cred.iv);
    wp_app_password = decrypt(ciphertext, iv, cred.key_version);
  } catch (err) {
    logger.error("sites.getSite.decryption_failed", { site_id: id, err: err instanceof Error ? err.message : String(err) });
    return internalError(
      `Credential decryption failed: ${err instanceof Error ? err.message : String(err)}`,
      { site_id: id },
    );
  }

  return {
    ok: true,
    data: {
      site: site as SiteRecord,
      credentials: { wp_user: cred.wp_user, wp_app_password },
    },
    timestamp: now(),
  };
}

// ---------------------------------------------------------------------------
// Auto-generated prefixes (M2d UX cleanup).
//
// Operator-facing forms no longer expose the scope_prefix field; we
// derive one from the site name at creation time. Algorithm:
//
//   1. Slugify name to [a-z0-9] (strip non-alphanumerics).
//   2. Try prefixes of length 4, 3, 2 (longest first, most distinctive).
//   3. On collision, fold a digit 2..9 onto the leading 1-3 chars of
//      the base so the final prefix stays within 4 chars.
//   4. Past digit 9, fall back to a base-36 counter derived from the
//      site name's hash prefix.
//
// The underlying sites_prefix_active_uniq index catches races between
// two concurrent creates picking the same candidate — on 23505 we
// advance to the next candidate and retry. Capped at 32 attempts to
// guarantee termination.
// ---------------------------------------------------------------------------

async function prefixExists(candidate: string): Promise<boolean> {
  const supabase = getServiceRoleClient();
  const { data } = await supabase
    .from("sites")
    .select("id")
    .eq("prefix", candidate)
    .neq("status", "removed")
    .limit(1)
    .maybeSingle();
  return !!data;
}

function enumerateCandidates(name: string): string[] {
  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const out: string[] = [];
  if (slug.length === 0) {
    // Name had no slug-able characters; push deterministic fallbacks.
    for (let i = 0; i < 10; i++) out.push(`st${i}`);
    return out;
  }

  // Longest clean base first.
  for (let len = Math.min(4, slug.length); len >= 2; len--) {
    const base = slug.slice(0, len);
    if (!out.includes(base)) out.push(base);
  }

  // Digit variants: keep total length <= 4.
  for (let digit = 2; digit <= 9; digit++) {
    for (let rootLen = Math.min(3, slug.length); rootLen >= 1; rootLen--) {
      const c = (slug.slice(0, rootLen) + String(digit)).slice(0, 4);
      if (c.length >= 2 && !out.includes(c)) out.push(c);
    }
  }

  // Base-36 counter fallback — 4-char pads keep the prefix unique
  // even if every digit variant was taken.
  for (let n = 10; n < 40; n++) {
    const tail = n.toString(36);
    const c = (slug.slice(0, 4 - tail.length) + tail).slice(0, 4);
    if (c.length >= 2 && !out.includes(c)) out.push(c);
  }

  return out;
}

async function generateUniquePrefix(
  name: string,
): Promise<
  | { ok: true; prefix: string }
  | { ok: false; error: { code: "INTERNAL_ERROR"; message: string; details: Record<string, unknown>; retryable: boolean; suggested_action: string }; timestamp: string }
> {
  const candidates = enumerateCandidates(name);
  for (const c of candidates) {
    if (!(await prefixExists(c))) return { ok: true, prefix: c };
  }
  logger.error("sites.generateUniquePrefix.exhausted", { name, attempted: candidates.length });
  return {
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "Could not auto-generate a unique prefix for this site name.",
      details: { name, attempted: candidates.length },
      retryable: false,
      suggested_action:
        "Supply a prefix explicitly or pick a more distinctive site name.",
    },
    timestamp: now(),
  };
}

// ---------------------------------------------------------------------------
// updateSiteBasics / archiveSite (M2d UX cleanup)
// ---------------------------------------------------------------------------

export async function updateSiteBasics(
  id: string,
  patch: { name?: string; wp_url?: string },
): Promise<ApiResponse<SiteRecord>> {
  try {
    if (!patch.name && !patch.wp_url) {
      return internalError("updateSiteBasics called with empty patch.");
    }
    const supabase = getServiceRoleClient();
    const { data, error } = await supabase
      .from("sites")
      .update({
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.wp_url !== undefined && { wp_url: patch.wp_url }),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .neq("status", "removed")
      .select()
      .maybeSingle();
    if (error) {
      logger.error("sites.updateSiteBasics.update_failed", { site_id: id, supabase_error: error.message });
      return internalError("Failed to update site.", {
        supabase_error: error,
      });
    }
    if (!data) {
      return {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: `No active site found with id ${id}.`,
          details: { id },
          retryable: false,
          suggested_action: "Verify the site id; removed sites are excluded.",
        },
        timestamp: now(),
      };
    }
    return { ok: true, data: data as SiteRecord, timestamp: now() };
  } catch (err) {
    logger.error("sites.updateSiteBasics.uncaught", { site_id: id, err: err instanceof Error ? err.message : String(err) });
    return internalError(
      `Unhandled error in updateSiteBasics: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// updateSiteCredentials (AUTH-FOUNDATION P2.3)
// ---------------------------------------------------------------------------

export async function updateSiteCredentials(
  id: string,
  patch: { wp_user?: string; wp_app_password?: string },
): Promise<ApiResponse<{ updated: boolean }>> {
  try {
    if (patch.wp_user === undefined && patch.wp_app_password === undefined) {
      return { ok: true, data: { updated: false }, timestamp: now() };
    }

    const supabase = getServiceRoleClient();

    // Confirm the site exists + isn't archived before mutating creds.
    const siteCheck = await supabase
      .from("sites")
      .select("id")
      .eq("id", id)
      .neq("status", "removed")
      .maybeSingle();
    if (siteCheck.error) {
      logger.error("sites.updateSiteCredentials.site_lookup_failed", { site_id: id, supabase_error: siteCheck.error.message });
      return internalError("Failed to look up site.", {
        supabase_error: siteCheck.error,
      });
    }
    if (!siteCheck.data) {
      return {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: `No active site found with id ${id}.`,
          details: { id },
          retryable: false,
          suggested_action:
            "Verify the site id; removed sites are excluded from credential updates.",
        },
        timestamp: now(),
      };
    }

    const update: Record<string, unknown> = {};
    if (patch.wp_user !== undefined) {
      update.wp_user = patch.wp_user;
    }
    if (patch.wp_app_password !== undefined) {
      try {
        const enc = encrypt(patch.wp_app_password);
        update.site_secret_encrypted = toByteaLiteral(enc.ciphertext);
        update.iv = toByteaLiteral(enc.iv);
        update.key_version = enc.keyVersion;
      } catch (err) {
        logger.error("sites.updateSiteCredentials.encryption_failed", { site_id: id, err: err instanceof Error ? err.message : String(err) });
        return internalError(
          `Encryption failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Migration 0056 deleted every site_credentials row. A plain UPDATE
    // silently does nothing when there is no existing row. Use UPSERT when
    // we have a full credential set (both user + encrypted password) so the
    // row is created if missing; fall back to UPDATE for partial patches.
    const hasFullCredentials =
      patch.wp_user !== undefined && patch.wp_app_password !== undefined;

    if (hasFullCredentials) {
      const { error } = await supabase
        .from("site_credentials")
        .upsert({ site_id: id, ...update }, { onConflict: "site_id" });
      if (error) {
        logger.error("sites.updateSiteCredentials.upsert_failed", { site_id: id, supabase_error: error.message });
        return internalError("Failed to upsert site credentials.", {
          supabase_error: error,
        });
      }
    } else {
      const { error } = await supabase
        .from("site_credentials")
        .update(update)
        .eq("site_id", id);
      if (error) {
        logger.error("sites.updateSiteCredentials.update_failed", { site_id: id, supabase_error: error.message });
        return internalError("Failed to update site credentials.", {
          supabase_error: error,
        });
      }
    }

    // After a successful credential save, flip pending_pairing → active.
    // Only touches pending_pairing — paused/active/removed are left alone.
    await supabase
      .from("sites")
      .update({ status: "active", updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "pending_pairing");

    return { ok: true, data: { updated: true }, timestamp: now() };
  } catch (err) {
    logger.error("sites.updateSiteCredentials.uncaught", { site_id: id, err: err instanceof Error ? err.message : String(err) });
    return internalError(
      `Unhandled error in updateSiteCredentials: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// updateSiteVoice (RS-2 — site-level brand voice & design direction)
// ---------------------------------------------------------------------------
//
// Patch the site's brand_voice / design_direction defaults. Operator UX:
// set once on the Site Settings page, every new brief inherits the
// values. Per-brief override on briefs.brand_voice / briefs.design_direction
// still wins at commit time.
//
// Optimistic concurrency on sites.version_lock — concurrent edits return
// VERSION_CONFLICT (409). Either field may be null to clear it; passing
// undefined leaves the existing value untouched.

export async function updateSiteVoice(
  id: string,
  expectedVersionLock: number,
  patch: { brand_voice?: string | null; design_direction?: string | null },
): Promise<ApiResponse<SiteRecord>> {
  try {
    if (
      patch.brand_voice === undefined &&
      patch.design_direction === undefined
    ) {
      return internalError("updateSiteVoice called with empty patch.");
    }
    const supabase = getServiceRoleClient();

    const updatePatch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      version_lock: expectedVersionLock + 1,
    };
    if (patch.brand_voice !== undefined) {
      updatePatch.brand_voice = patch.brand_voice;
    }
    if (patch.design_direction !== undefined) {
      updatePatch.design_direction = patch.design_direction;
    }

    const { data, error } = await supabase
      .from("sites")
      .update(updatePatch)
      .eq("id", id)
      .eq("version_lock", expectedVersionLock)
      .neq("status", "removed")
      .select()
      .maybeSingle();

    if (error) {
      logger.error("sites.updateSiteVoice.update_failed", { site_id: id, supabase_error: error.message });
      return internalError("Failed to update site voice.", {
        supabase_error: error,
      });
    }
    if (!data) {
      // Disambiguate NOT_FOUND vs VERSION_CONFLICT — re-read the row.
      const { data: present } = await supabase
        .from("sites")
        .select("version_lock")
        .eq("id", id)
        .neq("status", "removed")
        .maybeSingle();
      if (!present) {
        return {
          ok: false,
          error: {
            code: "NOT_FOUND",
            message: `No active site found with id ${id}.`,
            details: { id },
            retryable: false,
            suggested_action:
              "Verify the site id; removed sites are excluded.",
          },
          timestamp: now(),
        };
      }
      return {
        ok: false,
        error: {
          code: "VERSION_CONFLICT",
          message:
            "Another tab updated this site's voice settings. Reload to see the latest values, then re-apply your edit.",
          details: {
            id,
            expected_version_lock: expectedVersionLock,
            current_version_lock: present.version_lock,
          },
          retryable: false,
          suggested_action:
            "Reload the Settings page to see the latest version.",
        },
        timestamp: now(),
      };
    }
    return { ok: true, data: data as SiteRecord, timestamp: now() };
  } catch (err) {
    logger.error("sites.updateSiteVoice.uncaught", { site_id: id, err: err instanceof Error ? err.message : String(err) });
    return internalError(
      `Unhandled error in updateSiteVoice: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Soft-archive a site. Sets status='removed' so listSites filters it
 * out. The UNIQUE (prefix) WHERE status != 'removed' partial index
 * frees the prefix for re-use after archive. We label this "archive"
 * in the UI; the DB state is the pre-existing 'removed' ENUM value.
 */
export async function archiveSite(
  id: string,
): Promise<ApiResponse<{ id: string }>> {
  try {
    const supabase = getServiceRoleClient();
    const { data, error } = await supabase
      .from("sites")
      .update({
        status: "removed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .neq("status", "removed")
      .select("id")
      .maybeSingle();
    if (error) {
      logger.error("sites.archiveSite.update_failed", { site_id: id, supabase_error: error.message });
      return internalError("Failed to archive site.", {
        supabase_error: error,
      });
    }
    if (!data) {
      return {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: `No active site found with id ${id}.`,
          details: { id },
          retryable: false,
          suggested_action:
            "The site may already be archived, or the id is wrong.",
        },
        timestamp: now(),
      };
    }
    return { ok: true, data: { id: data.id as string }, timestamp: now() };
  } catch (err) {
    logger.error("sites.archiveSite.uncaught", { site_id: id, err: err instanceof Error ? err.message : String(err) });
    return internalError(
      `Unhandled error in archiveSite: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// testSiteConnection (Spec 01 §3.1)
// ---------------------------------------------------------------------------
//
// Single shared helper consumed by:
//   1. POST /api/sites/test-connection (form-driven preflight; called from
//      /admin/sites/new and /admin/sites/[id]/edit's Test button)
//   2. POST /api/sites/[id]/test-connection (row-dropdown action)
//
// Both surfaces invoke this exact function — they do NO additional
// normalisation, retry, or timeout wrapping. The 8s timeout, the
// trailing-slash strip, the credential decrypt path, and the
// capability-check pass/fail mapping all live here. Subtle divergence
// between surfaces was the failure mode this consolidation prevents.

const TEST_CONNECTION_TIMEOUT_MS = 8000;

export async function testSiteConnection(
  siteId: string,
): Promise<{ ok: true } | { ok: false; errorCode: string }> {
  const siteResult = await getSite(siteId, { includeCredentials: true });
  if (!siteResult.ok) {
    return { ok: false, errorCode: siteResult.error.code };
  }
  const creds = siteResult.data.credentials;
  if (!creds) {
    return { ok: false, errorCode: "NO_CREDENTIALS" };
  }

  // Wrap the upstream call with an 8s deadline matching the existing
  // edit-form fetch pattern. testWpConnection() doesn't accept an
  // AbortSignal; we race the call against a timeout sentinel and let
  // the caller treat slow upstream as REST_UNREACHABLE — the same
  // bucket the form's network failure path already uses.
  let result: TestConnectionResult;
  try {
    result = await Promise.race<TestConnectionResult>([
      testWpConnection({
        url: siteResult.data.site.wp_url,
        username: creds.wp_user,
        app_password: creds.wp_app_password,
      }),
      new Promise<TestConnectionResult>((_, reject) =>
        setTimeout(
          () => reject(new Error("test-connection timed out")),
          TEST_CONNECTION_TIMEOUT_MS,
        ),
      ),
    ]);
  } catch (err) {
    logger.warn("sites.testSiteConnection.timeout_or_error", {
      site_id: siteId,
      err: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, errorCode: "REST_UNREACHABLE" };
  }

  if (result.ok) return { ok: true };
  return { ok: false, errorCode: result.error.code };
}

export async function recordTestConnectionSuccess(
  siteId: string,
): Promise<void> {
  try {
    const supabase = getServiceRoleClient();
    const { error } = await supabase
      .from("sites")
      .update({ last_connection_test_at: new Date().toISOString() })
      .eq("id", siteId);
    if (error) {
      logger.warn("sites.recordTestConnectionSuccess.update_failed", {
        site_id: siteId,
        supabase_error: error.message,
      });
    }
  } catch (err) {
    logger.warn("sites.recordTestConnectionSuccess.threw", {
      site_id: siteId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// purgeSite (Spec 01 §3.2) — super_admin-only hard delete.
// ---------------------------------------------------------------------------
//
// Distinct from archiveSite (which flips status='removed'). Walks the
// information_schema FK graph at runtime to discover every table that
// transitively references sites.id, then deletes leaves first inside
// one transaction. Audit row inserted in the same transaction so a
// rolled-back delete also rolls back the audit record.
//
// Caller passes actor_id + actor_email so the audit row can record
// who fired the delete; route gating already enforces super_admin.

export type PurgeSiteResult =
  | {
      ok: true;
      data: {
        site_id: string;
        site_name: string;
        deleted_by_table: Record<string, number>;
      };
    }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        details?: Record<string, unknown>;
      };
    };

export type PurgeSiteOptions = {
  actorId: string | null;
  actorEmail: string | null;
};

export async function purgeSite(
  siteId: string,
  opts: PurgeSiteOptions,
): Promise<PurgeSiteResult> {
  // Lazy-load pg so the import doesn't bleed into Edge / browser bundles
  // — same pattern as the brief-runner workers (ARCH §6.1, §12).
  const { Client } = await import("pg");
  const cfg: ClientConfig = requireDbConfig();
  const client: PgClient = new Client(cfg);

  let depthAtFailure: number | null = null;
  let failingTable: string | null = null;
  let failingConstraint: string | null = null;

  try {
    await client.connect();
    await client.query("BEGIN");

    // 1. Lock the site row + read its name. SELECT ... FOR UPDATE so
    //    parallel purge attempts serialise. neq removed isn't applied
    //    here — super_admin can purge an already-archived row.
    const siteRows = await client.query<{ id: string; name: string }>(
      "SELECT id, name FROM sites WHERE id = $1 FOR UPDATE",
      [siteId],
    );
    if (siteRows.rowCount === 0) {
      await client.query("ROLLBACK");
      return {
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: `No site found with id ${siteId}.`,
          details: { site_id: siteId },
        },
      };
    }
    const siteName = siteRows.rows[0].name;

    // 2. Build the recursive FK dependency graph. Each entry is the
    //    table name + the foreign key constraint name + depth (0 = direct
    //    FK to sites; 1 = FK to a depth-0 table; etc). We walk until no
    //    new tables are added.
    const dependencyOrder = await buildSiteDependencyOrder(client);
    if (dependencyOrder.length === 0) {
      await client.query("ROLLBACK");
      logger.error("sites.purgeSite.no_dependencies_found", {
        site_id: siteId,
      });
      return {
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Could not resolve site dependency graph.",
          details: { site_id: siteId },
        },
      };
    }

    logger.info("sites.purgeSite.dependency_graph", {
      site_id: siteId,
      tables: dependencyOrder.map((t) => ({
        table: t.table,
        depth: t.depth,
      })),
    });

    // 3. Insert audit row inside the transaction. If anything below
    //    fails the audit insert rolls back too — desired (the spec
    //    explicitly chose this).
    await client.query(
      `INSERT INTO user_audit_log (actor_id, action, target_email, metadata)
       VALUES ($1, 'site_purged', $2, $3::jsonb)`,
      [
        opts.actorId,
        opts.actorEmail,
        JSON.stringify({ site_id: siteId, site_name: siteName }),
      ],
    );

    // 4. Walk the table list deepest-first and delete every row that
    //    transitively chains back to the target site. Track row counts
    //    for the structured log + return payload.
    const deletedByTable: Record<string, number> = {};
    for (const entry of dependencyOrder) {
      depthAtFailure = entry.depth;
      failingTable = entry.table;
      failingConstraint = entry.constraint;
      const deleteSql = entry.deleteSql.replace("$SITE_ID_PARAM$", "$1");
      const deleteResult = await client.query(deleteSql, [siteId]);
      deletedByTable[entry.table] = deleteResult.rowCount ?? 0;
      logger.info("sites.purgeSite.table_deleted", {
        site_id: siteId,
        table: entry.table,
        depth: entry.depth,
        rows_deleted: deleteResult.rowCount ?? 0,
      });
    }

    // 5. Finally delete the sites row itself.
    failingTable = "sites";
    failingConstraint = null;
    depthAtFailure = -1;
    const finalRes = await client.query(
      "DELETE FROM sites WHERE id = $1",
      [siteId],
    );
    deletedByTable.sites = finalRes.rowCount ?? 0;

    await client.query("COMMIT");

    return {
      ok: true,
      data: {
        site_id: siteId,
        site_name: siteName,
        deleted_by_table: deletedByTable,
      },
    };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* connection may already be dead; nothing to do */
    }
    logger.error("sites.purgeSite.failed", {
      site_id: siteId,
      failing_table: failingTable,
      failing_constraint: failingConstraint,
      depth_at_failure: depthAtFailure,
      err: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      error: {
        code: "PURGE_FAILED",
        message: "Could not delete site. Contact engineering.",
        details: {
          site_id: siteId,
          failing_table: failingTable,
          failing_constraint: failingConstraint,
          depth_at_failure: depthAtFailure,
        },
      },
    };
  } finally {
    try {
      await client.end();
    } catch {
      /* ignore */
    }
  }
}

type DependencyEntry = {
  table: string;
  constraint: string;
  /** Depth from the sites table; 0 = direct FK, 1 = via a depth-0 table. */
  depth: number;
  /**
   * SQL fragment to delete every row in this table that links back to
   * `$SITE_ID_PARAM$` (replaced with `$1` at exec time). Built once
   * from the FK chain so the delete loop is parameterless except for
   * the site UUID.
   */
  deleteSql: string;
};

/**
 * Walks information_schema.referential_constraints transitively to
 * discover every table that chains back to `sites.id`. Returns a list
 * ordered DEEPEST FIRST so the delete loop can safely cascade leaves
 * up to the root.
 */
async function buildSiteDependencyOrder(
  client: PgClient,
): Promise<DependencyEntry[]> {
  // Map: schema-qualified target table → array of FK rows pointing at it.
  type FkRow = {
    table_schema: string;
    table_name: string;
    constraint_name: string;
    column_name: string;
    foreign_table_schema: string;
    foreign_table_name: string;
    foreign_column_name: string;
  };

  const fkRes = await client.query<FkRow>(`
    SELECT
      tc.table_schema,
      tc.table_name,
      tc.constraint_name,
      kcu.column_name,
      ccu.table_schema AS foreign_table_schema,
      ccu.table_name   AS foreign_table_name,
      ccu.column_name  AS foreign_column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
     AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
  `);

  // Build adjacency: parent (referenced) table → list of children referencing it.
  const childrenByParent = new Map<string, FkRow[]>();
  for (const fk of fkRes.rows) {
    const parentKey = `${fk.foreign_table_schema}.${fk.foreign_table_name}`;
    const arr = childrenByParent.get(parentKey) ?? [];
    arr.push(fk);
    childrenByParent.set(parentKey, arr);
  }

  // BFS from sites; track the FK chain that reaches each table so we
  // can build a delete SQL that walks back to the site_id.
  type WalkNode = {
    table: string;
    schema: string;
    constraint: string;
    column: string;
    depth: number;
    parentKey: string;
    parentColumn: string;
  };

  const visited = new Set<string>(); // schema.table strings already scheduled
  visited.add("public.sites"); // never re-add the root
  const entries: Array<
    DependencyEntry & { schema: string; schemaTable: string }
  > = [];

  // Cache of raw walk nodes per visited table so deeper descendants can
  // build their full join chain back to sites.
  const walkChain = new Map<string, WalkNode[]>(); // key=schema.table → ordered chain root-most-first

  const queue: WalkNode[] = [];
  // Seed: direct children of sites.
  const siteChildren = childrenByParent.get("public.sites") ?? [];
  for (const fk of siteChildren) {
    const node: WalkNode = {
      table: fk.table_name,
      schema: fk.table_schema,
      constraint: fk.constraint_name,
      column: fk.column_name,
      depth: 0,
      parentKey: "public.sites",
      parentColumn: "id",
    };
    queue.push(node);
  }

  while (queue.length > 0) {
    const node = queue.shift()!;
    const key = `${node.schema}.${node.table}`;
    if (visited.has(key)) continue;
    visited.add(key);

    const parentChain = walkChain.get(node.parentKey) ?? [];
    const myChain = [...parentChain, node];
    walkChain.set(key, myChain);

    entries.push({
      table: node.table,
      schema: node.schema,
      schemaTable: key,
      constraint: node.constraint,
      depth: node.depth,
      deleteSql: buildCascadeDeleteSql(myChain),
    });

    // Enqueue this table's own children.
    const myChildren = childrenByParent.get(key) ?? [];
    for (const fk of myChildren) {
      const childKey = `${fk.table_schema}.${fk.table_name}`;
      if (visited.has(childKey)) continue;
      queue.push({
        table: fk.table_name,
        schema: fk.table_schema,
        constraint: fk.constraint_name,
        column: fk.column_name,
        depth: node.depth + 1,
        parentKey: key,
        parentColumn: fk.foreign_column_name,
      });
    }
  }

  // Sort deepest first; ties broken by table name for deterministic order.
  entries.sort((a, b) => {
    if (b.depth !== a.depth) return b.depth - a.depth;
    return a.table.localeCompare(b.table);
  });

  return entries.map(({ schema, schemaTable, ...rest }) => {
    void schema;
    void schemaTable;
    return rest;
  });
}

/**
 * Build a DELETE statement that walks a FK chain back to the sites
 * table and only removes rows whose ultimate ancestor is the target
 * site. The chain `[c0, c1, c2]` (root-most first; c0 is a direct
 * child of sites; c2 is the leaf) becomes:
 *
 *   DELETE FROM "public"."<c2>"
 *    WHERE "<c2.column>" IN (
 *      SELECT "<c1.parentColumn>" FROM "public"."<c1>"
 *       WHERE "<c1.column>" IN (
 *         SELECT "<c0.parentColumn>" FROM "public"."<c0>"
 *          WHERE "<c0.column>" IN (
 *            SELECT id FROM "public"."sites" WHERE id = $SITE_ID_PARAM$
 *          )
 *       )
 *    )
 *
 * Parameter substitution happens at exec time — the only $1 binding
 * is the site UUID. parentColumn on the second-from-root link is the
 * referenced column on c0 (typically c0.id) — read from
 * information_schema.constraint_column_usage at walk time, so this
 * survives non-`id` PKs if any tables ship with one.
 */
function buildCascadeDeleteSql(chain: {
  schema: string;
  table: string;
  column: string;
  parentColumn: string;
  parentKey: string;
}[]): string {
  if (chain.length === 0) {
    throw new Error("buildCascadeDeleteSql called with empty chain");
  }
  const leaf = chain[chain.length - 1];

  // Inner-most subquery is always the site filter. We then wrap it
  // outward, each link selecting the `parentColumn` of the NEXT outer
  // link's `column`. The link at index i has `column` referencing the
  // link at i-1's `parentColumn` (or sites.id for i=0).
  let inner = `SELECT id FROM "public"."sites" WHERE id = $SITE_ID_PARAM$`;
  // We need each non-leaf link's `parentColumn`-of-its-child as the
  // SELECT projection. Equivalent: when wrapping link `c_i`, we project
  // the column that the next link's `column` references — which is
  // `chain[i+1].parentColumn`.
  for (let i = 0; i < chain.length - 1; i++) {
    const link = chain[i];
    const projection = chain[i + 1].parentColumn; // typically "id"
    inner = `SELECT ${quoteIdent(projection)} FROM ${quoteQualified(link.schema, link.table)} WHERE ${quoteIdent(link.column)} IN (${inner})`;
  }

  return `DELETE FROM ${quoteQualified(leaf.schema, leaf.table)} WHERE ${quoteIdent(leaf.column)} IN (${inner})`;
}

function quoteIdent(s: string): string {
  // Postgres identifier quoting: double-quote and escape embedded quotes.
  return `"${s.replace(/"/g, '""')}"`;
}

function quoteQualified(schema: string, table: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(table)}`;
}
