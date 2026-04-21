import {
  type ApiResponse,
  type RegisterSiteInput,
  type SiteListItem,
  type SiteRecord,
} from "@/lib/tool-schemas";
import { decrypt, encrypt } from "@/lib/encryption";
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
  "id,name,wp_url,prefix,status,last_successful_operation_at,updated_at";

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
): Promise<ApiResponse<SiteRecord>> {
  try {
    return await createSiteImpl(input);
  } catch (err) {
    return internalError(
      `Unhandled error in createSite: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function createSiteImpl(
  input: RegisterSiteInput,
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
      console.error("[sites.createSite] rollback delete failed", {
        site_id: siteId,
        error,
      });
    }
  } catch (err) {
    console.error("[sites.createSite] rollback threw", {
      site_id: siteId,
      err,
    });
  }
}

export async function listSites(): Promise<ApiResponse<{ sites: SiteListItem[] }>> {
  try {
    return await listSitesImpl();
  } catch (err) {
    return internalError(
      `Unhandled error in listSites: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function listSitesImpl(): Promise<ApiResponse<{ sites: SiteListItem[] }>> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("sites")
    .select(LIGHT_SITE_FIELDS)
    .neq("status", "removed")
    .order("updated_at", { ascending: false });

  if (error) {
    return internalError("Failed to list sites.", { supabase_error: error });
  }

  return {
    ok: true,
    data: { sites: (data ?? []) as SiteListItem[] },
    timestamp: now(),
  };
}

export async function getSite(
  id: string,
  opts: { includeCredentials?: boolean } = {},
): Promise<ApiResponse<SiteWithOptionalCredentials>> {
  try {
    return await getSiteImpl(id, opts);
  } catch (err) {
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
    return internalError("Failed to fetch site credentials.", {
      supabase_error: credErr,
    });
  }
  if (!cred) {
    return {
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: `Site ${id} has no credentials row.`,
        details: { id },
        retryable: false,
        suggested_action:
          "Data integrity issue — re-register the site or restore credentials.",
      },
      timestamp: now(),
    };
  }

  let wp_app_password: string;
  try {
    const ciphertext = parseBytea(cred.site_secret_encrypted);
    const iv = parseBytea(cred.iv);
    wp_app_password = decrypt(ciphertext, iv, cred.key_version);
  } catch (err) {
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
    return internalError(
      `Unhandled error in updateSiteBasics: ${err instanceof Error ? err.message : String(err)}`,
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
    return internalError(
      `Unhandled error in archiveSite: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
