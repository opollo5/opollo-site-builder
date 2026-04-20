import { afterAll, beforeEach } from "vitest";
import { Client } from "pg";
import { readSupabaseCreds } from "./_supabase-status";

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
  const pg = await getPg();
  // Order matters when referential actions other than CASCADE apply. We use
  // CASCADE to sidestep FK ordering between sites / design_systems etc.
  //
  // auth.users (M2a+) is TRUNCATEd too because opollo_users has a FK to it
  // — wiping opollo_users without also wiping auth.users leaves orphaned
  // auth rows that would re-trigger handle_new_auth_user's opollo_users
  // INSERT on the next test's createUser call (returning 'viewer' state
  // silently instead of the requested role). CASCADE sweeps auth.sessions
  // / auth.refresh_tokens / auth.identities at the same time.
  await pg.query(`
    TRUNCATE TABLE
      pages,
      design_templates,
      design_components,
      design_systems,
      opollo_users,
      opollo_config,
      sites,
      auth.users
    RESTART IDENTITY CASCADE;
  `);
}

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  if (pgClient) {
    await pgClient.end();
    pgClient = null;
  }
});
