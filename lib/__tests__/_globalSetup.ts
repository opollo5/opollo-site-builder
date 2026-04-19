import { execSync } from "node:child_process";

// Vitest globalSetup. Runs once per test invocation, before workers fork.
//
// Responsibilities:
//   1. Ensure a local Supabase stack is running. If `supabase status` succeeds
//      we assume it's already up (common dev loop). Otherwise `supabase start`
//      boots it (CI cold start).
//   2. Emit the API URL + service-role key into process.env so the lib code's
//      getServiceRoleClient() finds them at first-call time in workers.
//
// Between-test TRUNCATEs are handled per-worker in _setup.ts — they don't
// need the Supabase CLI, only a direct Postgres connection on port 54322
// (default for `supabase start`).
//
// Prerequisites (see CONTRIBUTING.md):
//   - Docker daemon running
//   - Supabase CLI installed (`brew install supabase/tap/supabase` or equivalent)

type SupabaseStatus = {
  API_URL?: string;
  DB_URL?: string;
  SERVICE_ROLE_KEY?: string;
  ANON_KEY?: string;
};

function runCmd(cmd: string, opts?: { allowFailure?: boolean }): string {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    if (opts?.allowFailure) return "";
    throw err;
  }
}

function parseStatus(): SupabaseStatus | null {
  const raw = runCmd("supabase status --output json", { allowFailure: true });
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SupabaseStatus;
  } catch {
    return null;
  }
}

export async function setup() {
  let status = parseStatus();

  if (!status || !status.API_URL || !status.SERVICE_ROLE_KEY) {
    // eslint-disable-next-line no-console
    console.log(
      "[vitest] Supabase stack not running — calling `supabase start` (may take 15–30s)...",
    );
    runCmd("supabase start");
    status = parseStatus();
  }

  if (!status || !status.API_URL || !status.SERVICE_ROLE_KEY) {
    throw new Error(
      "Unable to fetch Supabase stack credentials after `supabase start`. " +
        "Check `supabase status` manually and ensure Docker is running.",
    );
  }

  process.env.SUPABASE_URL = status.API_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = status.SERVICE_ROLE_KEY;
  if (status.ANON_KEY) process.env.SUPABASE_ANON_KEY = status.ANON_KEY;
  if (status.DB_URL) process.env.SUPABASE_DB_URL = status.DB_URL;
}

export async function teardown() {
  // Leave the stack running — dev loop keeps it warm between invocations.
  // CI runners are short-lived, so nothing to clean up there either.
}
