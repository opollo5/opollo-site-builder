import { diagnosticDump, readSupabaseCreds, runCmd } from "./_supabase-status";

// Vitest globalSetup. Runs once per test invocation, before workers fork.
//
// Responsibilities:
//   1. Ensure a local Supabase stack is running. If credential extraction
//      from a live stack succeeds we skip `supabase start`. Otherwise the
//      CI cold-start path boots one.
//   2. Emit the API URL + service-role key into process.env so the lib
//      code's getServiceRoleClient() finds them at first-call time in
//      workers.
//
// Credential reading goes through _supabase-status.ts which handles
// JSON schema drift across CLI versions + falls back to plain-text
// output when JSON doesn't parse. The CI environment runs a different
// CLI version than any dev machine will, so defensive parsing is worth
// the ~100 lines.
//
// Between-test TRUNCATEs are handled per-worker in _setup.ts — they don't
// need the Supabase CLI, only a direct Postgres connection on port 54322
// (default for `supabase start`).
//
// Prerequisites (see CONTRIBUTING.md):
//   - Docker daemon running
//   - Supabase CLI installed

export async function setup() {
  let creds = readSupabaseCreds();

  if (!creds) {
    // eslint-disable-next-line no-console
    console.log(
      "[vitest] Supabase stack not running — calling `supabase start` (may take 15–30s)...",
    );
    runCmd("supabase start");
    creds = readSupabaseCreds();
  }

  if (!creds) {
    throw new Error(
      "Unable to fetch Supabase stack credentials after `supabase start`.\n" +
        "Raw CLI output follows — expected an API URL and a service-role key " +
        "from either JSON (`--output json`) or plain-text `supabase status`, " +
        "neither parse returned one.\n\n" +
        diagnosticDump(),
    );
  }

  process.env.SUPABASE_URL = creds.apiUrl;
  process.env.SUPABASE_SERVICE_ROLE_KEY = creds.serviceRoleKey;
  if (creds.anonKey) process.env.SUPABASE_ANON_KEY = creds.anonKey;
  if (creds.dbUrl) process.env.SUPABASE_DB_URL = creds.dbUrl;
}

export async function teardown() {
  // Leave the stack running — dev loop keeps it warm between invocations.
  // CI runners are short-lived, so nothing to clean up there either.
}
