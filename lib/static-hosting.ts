import "server-only";

import { createHash } from "node:crypto";

import Client from "ssh2-sftp-client";

import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// OPTIMISER PHASE 1.5 SLICE 14 — Static-file write to SiteGround.
//
// Two paths:
//
//   1. Real write: SFTP using `ssh2-sftp-client` to OPOLLO_HOSTING_HOST
//      authenticated via OPOLLO_HOSTING_USER + OPOLLO_HOSTING_KEY (PEM
//      private key). Previous version is moved to /history/{client}/
//      with a timestamp suffix for instant rollback. Returns
//      { ok: true, path, archived_to } on success.
//
//   2. Dry-run write: when any of the three env vars are missing, the
//      "would-be" write is captured as a JSON payload and returned to
//      the caller for persistence into opt_change_log.dry_run_payload.
//      Returns { ok: true, dry_run: true, payload } so Phase 1.5 is
//      testable + previewable before hosting credentials are
//      provisioned. Real writes light up automatically once env is
//      complete — no code change required.
//
// SFTP connection lifecycle: connect → put → end on every call. The
// hosting target sees ~1 write per generation; pooling saves nothing
// and adds connection-leak risk on serverless cold-start.
//
// History rotation: SiteGround SFTP doesn't support atomic rename
// across directories on every config; we use a copy-then-delete
// fallback if rename fails. Existing-file detection uses `stat`
// before attempting the rotation (avoids leaving an empty history
// entry on first publish).
//
// Filesystem layout (matches the brief):
//   /var/www/ads-opollo/{client-slug}/{page-slug}.html
//   /var/www/ads-opollo/history/{client-slug}/{page-slug}-{ts}.html
// ---------------------------------------------------------------------------

const HOSTING_ROOT = "/var/www/ads-opollo";
const HISTORY_ROOT = "/var/www/ads-opollo/history";

export interface StaticWriteInput {
  /** Slug used as the filesystem subfolder. e.g. "planet6". */
  client_slug: string;
  /** Slug used as the file basename. e.g. "lawyer-marketing". */
  page_slug: string;
  /** The complete HTML document body. */
  html: string;
}

export type StaticWriteResult =
  | {
      ok: true;
      dry_run: false;
      path: string;
      archived_to: string | null;
    }
  | {
      ok: true;
      dry_run: true;
      payload: DryRunPayload;
    }
  | {
      ok: false;
      error: { code: string; message: string };
    };

export interface DryRunPayload {
  reason: "credentials_not_configured" | "credentials_invalid";
  missing_env_vars: string[];
  target_path: string;
  body_size: number;
  body_sha256: string;
  would_have_archived_to: string | null;
  captured_at: string;
}

interface HostingCredentials {
  host: string;
  user: string;
  key: string;
}

function readHostingCredentials():
  | { ok: true; creds: HostingCredentials }
  | { ok: false; missing: string[] } {
  const host = process.env.OPOLLO_HOSTING_HOST;
  const user = process.env.OPOLLO_HOSTING_USER;
  const key = process.env.OPOLLO_HOSTING_KEY;
  const missing: string[] = [];
  if (!host) missing.push("OPOLLO_HOSTING_HOST");
  if (!user) missing.push("OPOLLO_HOSTING_USER");
  if (!key) missing.push("OPOLLO_HOSTING_KEY");
  if (missing.length > 0) return { ok: false, missing };
  return { ok: true, creds: { host: host!, user: user!, key: key! } };
}

function targetPath(input: StaticWriteInput): string {
  return `${HOSTING_ROOT}/${input.client_slug}/${input.page_slug}.html`;
}

function historyPath(input: StaticWriteInput): string {
  const ts = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace(/-(?=\d{3}Z$)/, "");
  return `${HISTORY_ROOT}/${input.client_slug}/${input.page_slug}-${ts}.html`;
}

function buildDryRunPayload(
  input: StaticWriteInput,
  reason: DryRunPayload["reason"],
  missing: string[],
): DryRunPayload {
  return {
    reason,
    missing_env_vars: missing,
    target_path: targetPath(input),
    body_size: Buffer.byteLength(input.html, "utf8"),
    body_sha256: createHash("sha256").update(input.html).digest("hex"),
    would_have_archived_to: historyPath(input),
    captured_at: new Date().toISOString(),
  };
}

export async function writeStaticPage(
  input: StaticWriteInput,
): Promise<StaticWriteResult> {
  const creds = readHostingCredentials();
  if (!creds.ok) {
    logger.warn("static-hosting: dry-run mode (credentials missing)", {
      missing: creds.missing,
      target: targetPath(input),
    });
    return {
      ok: true,
      dry_run: true,
      payload: buildDryRunPayload(
        input,
        "credentials_not_configured",
        creds.missing,
      ),
    };
  }

  const target = targetPath(input);
  const archive = historyPath(input);
  const sftp = new Client();

  try {
    await sftp.connect({
      host: creds.creds.host,
      username: creds.creds.user,
      privateKey: creds.creds.key,
    });
  } catch (err) {
    // Treat credential failures (auth refused) as dry-run too, so a
    // misconfigured key doesn't block the rest of the pipeline.
    const message = err instanceof Error ? err.message : String(err);
    logger.error("static-hosting: SFTP connect failed", { err: message });
    return {
      ok: true,
      dry_run: true,
      payload: buildDryRunPayload(
        input,
        "credentials_invalid",
        ["OPOLLO_HOSTING_KEY (auth rejected)"],
      ),
    };
  }

  try {
    // Ensure parent directories exist. mkdir -p semantics.
    await ensureDir(sftp, dirname(target));
    await ensureDir(sftp, dirname(archive));

    // If a previous version exists, archive it first.
    let archivedTo: string | null = null;
    if (await fileExists(sftp, target)) {
      try {
        await sftp.rename(target, archive);
        archivedTo = archive;
      } catch (err) {
        // Some SFTP servers don't allow cross-directory rename. Fall
        // back to copy-then-delete via a download + re-upload.
        logger.warn("static-hosting: rename fallback", {
          err: err instanceof Error ? err.message : String(err),
          target,
          archive,
        });
        const buf = await sftp.get(target);
        await sftp.put(buf as Buffer, archive);
        await sftp.delete(target);
        archivedTo = archive;
      }
    }

    await sftp.put(Buffer.from(input.html, "utf8"), target);

    return {
      ok: true,
      dry_run: false,
      path: target,
      archived_to: archivedTo,
    };
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "WRITE_FAILED",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  } finally {
    try {
      await sftp.end();
    } catch (err) {
      logger.warn("static-hosting: SFTP end failed", {
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

function dirname(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx > 0 ? path.slice(0, idx) : "/";
}

async function ensureDir(sftp: Client, dir: string): Promise<void> {
  try {
    await sftp.mkdir(dir, true);
  } catch (err) {
    // mkdir on an existing dir throws on most servers — swallow
    // errors here and let put() surface the real problem.
    logger.debug("static-hosting: mkdir noop", {
      dir,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

async function fileExists(sftp: Client, path: string): Promise<boolean> {
  try {
    const stat = await sftp.stat(path);
    return Boolean(stat);
  } catch {
    return false;
  }
}
