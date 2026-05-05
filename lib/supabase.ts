import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`${key} is not set.`);
  }
  return value;
}

let serviceRoleClient: SupabaseClient | null = null;

/**
 * Service-role client. Bypasses RLS. Use only in trusted server-side code
 * (API routes, background jobs). Never expose the service role key to clients.
 */
export function getServiceRoleClient(): SupabaseClient {
  if (serviceRoleClient) return serviceRoleClient;
  const url = requireEnv("SUPABASE_URL");
  const key = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  serviceRoleClient = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return serviceRoleClient;
}
