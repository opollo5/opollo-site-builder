import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// M2c-1 — break-glass auth kill switch.
//
// When `opollo_config.auth_kill_switch = 'on'`, middleware skips the
// Supabase Auth path and falls back to the legacy BASIC_AUTH_*
// mechanism, even if FEATURE_SUPABASE_AUTH=true. The emergency route
// in M2c-3 is the only intended writer. Scope: recovering from a
// Supabase-Auth outage without redeploying.
//
// Why DB-backed and not a second env var: env vars require a deploy
// cycle to flip. The whole point of a break glass is immediate effect
// without touching the auth path that might itself be broken.
// opollo_config is service-role-only (per migration 0004), so only the
// emergency route (which authenticates with OPOLLO_EMERGENCY_KEY, not
// with Supabase Auth) can write it.
//
// Why a 5-second cache: middleware runs on every request, including
// every page load and every /api call. A PostgREST round-trip per
// request would add perceptible latency on the chat route. 5s is
// short enough that flipping the switch during an outage is perceived
// as immediate, long enough that steady-state traffic isn't bottlenecked
// on opollo_config reads. Cache is per-serverless-instance (module-level
// state) — the effective global propagation bound is 5s + warm-pool
// turnover.
//
// TODO(M7 fleet infra): revisit. Candidates: edge KV / Supabase realtime
// broadcast for immediate invalidation; or a signed cookie the emergency
// route issues that middleware trusts for the kill-switch window.
// ---------------------------------------------------------------------------

const TTL_MS = 5_000;

type CacheEntry = {
  on: boolean;
  readAt: number;
};

let cache: CacheEntry | null = null;

/**
 * Return true when `opollo_config.auth_kill_switch = 'on'`. Caches the
 * result for TTL_MS to avoid a round-trip per request. On read error
 * (Postgres down, network blip), returns `false` — i.e. we assume the
 * switch is OFF when we can't check. Rationale: the switch is a
 * deliberate flip, not a default state; failing closed here would
 * accidentally trip the break-glass on any transient DB error.
 */
export async function isAuthKillSwitchOn(): Promise<boolean> {
  const now = Date.now();
  if (cache && now - cache.readAt < TTL_MS) {
    return cache.on;
  }

  let on = false;
  try {
    const svc = getServiceRoleClient();
    const { data, error } = await svc
      .from("opollo_config")
      .select("value")
      .eq("key", "auth_kill_switch")
      .maybeSingle();
    if (!error && data && data.value === "on") {
      on = true;
    }
  } catch {
    on = false;
  }

  cache = { on, readAt: now };
  return on;
}

/**
 * Test-only: reset the cache so the next call re-reads the DB. Not
 * used in production code.
 */
export function __resetAuthKillSwitchCacheForTests(): void {
  cache = null;
}
