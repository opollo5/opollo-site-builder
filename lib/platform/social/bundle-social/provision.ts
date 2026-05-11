import "server-only";

import { Client } from "pg";

import { getBundlesocialClient } from "@/lib/bundlesocial";
import { requireDbConfig } from "@/lib/db-direct";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// BSP-2-REDO — race-safe per-company bundle.social team provisioning with
// cross-process protection via Postgres advisory locks.
//
// Two layers of race protection:
//
//   1. In-process Promise dedup (module-level Map) — concurrent calls within
//      the same Vercel function instance share a single Promise. This is the
//      fast path for the common case.
//
//   2. pg_advisory_xact_lock — acquired inside a single pg transaction that
//      covers the entire read → teamCreate → UPDATE sequence. Any cross-process
//      race (two Vercel instances, cron + webhook racing) blocks at the lock
//      until the first writer commits, then reads the already-stored team id
//      and returns without calling teamCreateTeam again.
//
// The SQL function provision_company_lock_key(uuid) (migration 0117) hashes a
// UUID to a stable bigint, guaranteeing the same company always maps to the
// same lock slot.
// ---------------------------------------------------------------------------

const inflight = new Map<string, Promise<string>>();

export async function getOrCreateBundleSocialTeam(
  companyId: string,
): Promise<string> {
  const existing = inflight.get(companyId);
  if (existing) return existing;

  const promise = provisionWithAdvisoryLock(companyId).finally(() => {
    inflight.delete(companyId);
  });
  inflight.set(companyId, promise);
  return promise;
}

async function provisionWithAdvisoryLock(companyId: string): Promise<string> {
  const pg = new Client(requireDbConfig());
  await pg.connect();
  try {
    await pg.query("BEGIN");
    // Acquire xact-scoped advisory lock — auto-released on COMMIT or ROLLBACK.
    await pg.query(
      "SELECT pg_advisory_xact_lock(provision_company_lock_key($1::uuid))",
      [companyId],
    );

    const { rows } = await pg.query<{
      bundle_social_team_id: string | null;
      name: string | null;
    }>(
      "SELECT bundle_social_team_id, name FROM platform_companies WHERE id = $1",
      [companyId],
    );
    if (rows.length === 0) throw new Error(`Company ${companyId} not found.`);
    const row = rows[0];

    if (row.bundle_social_team_id) {
      await pg.query("COMMIT");
      return row.bundle_social_team_id;
    }

    const client = getBundlesocialClient();
    if (!client) {
      throw new Error(
        "BUNDLE_SOCIAL_API is not configured — cannot provision a bundle.social team.",
      );
    }

    const teamName = row.name ?? `company-${companyId.slice(0, 8)}`;

    let newTeamId: string;
    try {
      const team = await client.team.teamCreateTeam({
        requestBody: { name: teamName },
      });
      newTeamId = team.id;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("bundlesocial.provision.create_team_failed", {
        company_id: companyId,
        err: msg,
      });
      throw new Error(`bundle.social team creation failed: ${msg}`);
    }

    await pg.query(
      "UPDATE platform_companies SET bundle_social_team_id = $1 WHERE id = $2 AND bundle_social_team_id IS NULL",
      [newTeamId, companyId],
    );
    await pg.query("COMMIT");

    logger.info("bundlesocial.provision.team_provisioned", {
      company_id: companyId,
      team_id: newTeamId,
    });

    return newTeamId;
  } catch (err) {
    await pg.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    await pg.end().catch(() => {});
  }
}

export function __resetInflightForTesting(): void {
  inflight.clear();
}

// Bypasses the in-process Map so integration tests can exercise the advisory
// lock directly, simulating cross-process concurrent provision attempts.
export function __provisionWithoutInflightForTesting(
  companyId: string,
): Promise<string> {
  return provisionWithAdvisoryLock(companyId);
}
