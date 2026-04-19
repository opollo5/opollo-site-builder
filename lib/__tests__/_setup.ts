import { execSync } from "node:child_process";
import { afterAll, beforeEach } from "vitest";
import { Client } from "pg";

// Per-worker setup. Runs before every test file in this worker.
//
// Responsibilities:
//   1. Ensure process.env is populated (globalSetup already did this for the
//      main process, but some CI configurations fork fresh env — re-read if
//      missing).
//   2. Open a direct Postgres connection for TRUNCATE between tests.
//
// beforeEach truncates every M1 table plus `sites` (tests create their own
// sites to have something to point FKs at). RESTART IDENTITY is a no-op here
// since every PK is uuid-generated, but it's harmless.

type SupabaseStatus = {
  API_URL?: string;
  DB_URL?: string;
  SERVICE_ROLE_KEY?: string;
  ANON_KEY?: string;
};

function readStatusIfNeeded() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    const raw = execSync("supabase status --output json", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const s = JSON.parse(raw) as SupabaseStatus;
    if (s.API_URL) process.env.SUPABASE_URL = s.API_URL;
    if (s.SERVICE_ROLE_KEY) process.env.SUPABASE_SERVICE_ROLE_KEY = s.SERVICE_ROLE_KEY;
    if (s.ANON_KEY) process.env.SUPABASE_ANON_KEY = s.ANON_KEY;
    if (s.DB_URL) process.env.SUPABASE_DB_URL = s.DB_URL;
  } catch (err) {
    throw new Error(
      `Cannot reach Supabase CLI in worker. Run \`supabase start\` before \`npm test\`. (${err instanceof Error ? err.message : String(err)})`,
    );
  }
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
  await pg.query(`
    TRUNCATE TABLE
      pages,
      design_templates,
      design_components,
      design_systems,
      opollo_users,
      sites
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
