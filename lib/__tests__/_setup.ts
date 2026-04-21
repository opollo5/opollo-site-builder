import { afterAll, beforeEach } from "vitest";
import { Client } from "pg";
import { readSupabaseCreds } from "./_supabase-status";
import { cleanupTrackedAuthUsers } from "./_auth-helpers";

// Per-worker setup. Runs before every test file in this worker.
//
// Responsibilities:
//   1. Ensure process.env is populated (globalSetup already did this for
//      the main process, but some CI configurations fork fresh env —
//      re-read if missing).
//   2. Open a direct Postgres connection for TRUNCATE between tests.
//
// beforeEach truncates every M1 table plus `sites` (tests create their own
// sites to have something to point FKs at). RESTART IDENTITY is a no-op
// here since every PK is uuid-generated, but it's harmless.

function readStatusIfNeeded(): void {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  const creds = readSupabaseCreds();
  if (!creds) {
    throw new Error(
      "Cannot reach Supabase CLI in worker. Run `supabase start` before `npm test`.",
    );
  }
  process.env.SUPABASE_URL = creds.apiUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = creds.serviceRoleKey;
  if (creds.anonKey) process.env.SUPABASE_ANON_KEY = creds.anonKey;
  if (creds.dbUrl) process.env.SUPABASE_DB_URL = creds.dbUrl;
}

readStatusIfNeeded();

// Tests that exercise the full createSite path (M2d UX cleanup) need
// an OPOLLO_MASTER_KEY for credential encryption. Use a deterministic
// 32-byte zero-filled key so CI and local share semantics without
// relying on a secret. Production must supply a real key via env.
if (!process.env.OPOLLO_MASTER_KEY) {
  process.env.OPOLLO_MASTER_KEY = Buffer.alloc(32).toString("base64");
}

const DB_URL =
  process.env.SUPABASE_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

let pgClient: Client | null = null;

async function getPg(): Promise<Client> {
  if (pgClient) return pgClient;
  pgClient = new Client({ connectionString: DB_URL });
  await pgClient.connect();
  return pgClient;
}

export async function truncateAll(): Promise<void> {
  // M2a+: we can't TRUNCATE auth.users CASCADE from the test role — the
  // CASCADE sweeps auth.refresh_tokens and its id sequence, which the
  // test role doesn't own (Postgres error 42501: must be owner of
  // sequence refresh_tokens_id_seq).
  //
  // Instead, we delete every auth user this test file created via the
  // service-role admin API — it has the right privileges and cleans up
  // downstream auth state (sessions, refresh_tokens, identities) for
  // free. Users that a test forgot to track (e.g. created via raw SQL)
  // would leak; every test path should go through seedAuthUser().
  await cleanupTrackedAuthUsers();

  const pg = await getPg();
  // Order matters when referential actions other than CASCADE apply. We
  // use CASCADE to sidestep FK ordering between sites / design_systems.
  // Scoped to public-schema tables only.
  await pg.query(`
    TRUNCATE TABLE
      tenant_cost_budgets,
      regeneration_events,
      regeneration_jobs,
      transfer_events,
      transfer_job_items,
      transfer_jobs,
      image_usage,
      image_metadata,
      image_library,
      pages,
      design_templates,
      design_components,
      design_systems,
      opollo_users,
      opollo_config,
      sites
    RESTART IDENTITY CASCADE;
  `);
}

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  // Sweep this file's tracked auth users before the worker process
  // dies. Without this, the LAST test's seeded user leaks into the
  // shared Supabase stack because cleanupTrackedAuthUsers only runs
  // in beforeEach — there's no more beforeEach after the last test,
  // so it never fires. The next test file (in its own worker process
  // with a fresh emailCounter starting at 0) then collides on
  // `test-user-1@opollo.test`. Caught by PR #17 CI: both
  // auth.test.ts and m2a-auth-link.test.ts failed their first
  // `seedAuthUser()` call with "already registered" when those files
  // happened to follow another file that also seeded a user-1.
  await cleanupTrackedAuthUsers();

  if (pgClient) {
    await pgClient.end();
    pgClient = null;
  }
});
