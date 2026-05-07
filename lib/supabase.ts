import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { type Database } from "@/types/supabase";

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`${key} is not set.`);
  }
  return value;
}

let serviceRoleClient: SupabaseClient<Database> | null = null;

/**
 * Service-role client. Bypasses RLS. Use only in trusted server-side code
 * (API routes, background jobs). Never expose the service role key to clients.
 *
 * Typed as `SupabaseClient<Database>` so TypeScript will catch column-name drift
 * once `types/supabase.ts` is bootstrapped (see RUNBOOK § "Supabase schema types
 * bootstrap"). Until bootstrap, `Database = any` and behaviour is unchanged.
 */
export function getServiceRoleClient(): SupabaseClient<Database> {
  if (serviceRoleClient) return serviceRoleClient;
  const url = requireEnv("SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  serviceRoleClient = createClient<Database>(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      // Opt all service-role fetches out of Next.js's Data Cache so
      // server components always see live DB state on every request.
      fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }),
    },
  });
  return serviceRoleClient;
}
