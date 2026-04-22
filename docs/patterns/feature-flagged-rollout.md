# Pattern — Feature-flagged rollout

## When to use it

Shipping a behaviour change that needs to coexist with the legacy path during rollout, or that must be reversible in production without a redeploy. Canonical instances:

- `FEATURE_SUPABASE_AUTH` — middleware routes through Supabase Auth when on; HTTP Basic Auth otherwise.
- `FEATURE_DESIGN_SYSTEM_V2` — system prompt reads the structured registry when on; legacy HTML blob otherwise.
- `opollo_config.auth_kill_switch` — DB-backed kill switch that overrides the env flag at runtime without redeploy.

Use whenever:

- The behaviour change is binary (on / off), not a percentage rollout.
- Production needs a reversible switch during early rollout.
- Tests need to exercise both branches.

Don't use for: multi-variant experiments (that's the Tier 2 feature-flag vendor job in `BACKLOG.md`), per-tenant flags (same), forever flags (a flag that's been on for months with no plan to remove is tech debt — remove it and delete the legacy branch).

## Two tiers

**Env-var flag** — `process.env.FEATURE_<NAME>`. Provisioned in Vercel, flipped by a redeploy. Fast enough for normal rollout; no DB dependency.

**DB-backed kill switch** — a row in `opollo_config` that middleware reads on every request (cached 5s). Flippable without a redeploy via `/api/emergency`. Use for break-glass: the scenario where the env flag on produces binary failure and you need to revert without waiting for Vercel to promote a new build. Always paired with an env flag; the kill switch only overrides when set to the break-glass value.

## Required files

| File | Role |
| --- | --- |
| Reader helper (`lib/<feature>-flag.ts` or inline) | `isXOn(): boolean`. Single function, single env check. Never call `process.env.FEATURE_X` from three places. |
| The conditional call site(s) | Branches on the reader. Legacy and new paths both reachable. |
| Kill-switch helper (if applicable) | `lib/<feature>-kill-switch.ts` — reads `opollo_config`, caches, returns boolean. |
| `.env.local.example` entry | Documents default + when to flip. |
| Tests — both branches | Flag off: legacy; flag on: new; flag on + kill switch: legacy; etc. |

## Scaffolding

### Env reader

One function, one file-level source of truth:

```ts
// lib/<feature>.ts (top of file, above the feature code)

function isFeatureOn(): boolean {
  const v = process.env.FEATURE_<NAME>;
  return v === "true" || v === "1";
}
```

`"true"` or `"1"` — case-sensitive. Anything else (unset, `"false"`, `"FALSE"`, `"yes"`, `""`) is off. Copy the literal check from `middleware.ts`'s `isFeatureOn`.

Why the strict parse: a typo'd value (`"True"`, `"on"`) silently stays off, which is the safer default. Loose parsing turns every typo into a production incident.

### Conditional call site

Model on `middleware.ts`:

```ts
export async function middleware(req: NextRequest) {
  if (!isFeatureOn()) {
    return basicAuthGate(req); // legacy
  }
  let killSwitch = false;
  try {
    killSwitch = await isAuthKillSwitchOn();
  } catch {
    killSwitch = false;
  }
  if (killSwitch) {
    return basicAuthGate(req); // break-glass
  }
  return supabaseAuthGate(req); // new
}
```

Key invariants:

- **Legacy path remains fully functional.** No temporary "coming soon" stub. The flag is off for a reason (gradual rollout, production validation) and the legacy code has to work while off.
- **Kill switch read is wrapped in try/catch with fallback to legacy.** If the DB is down and the kill switch read throws, don't proceed with the new path — fall back to the safer legacy.
- **Branches must test cleanly in isolation.** Each branch is unit-testable without stubbing the flag reader — set the env var in `beforeEach`.

### DB-backed kill switch

Model on `lib/auth-kill-switch.ts`. Shape:

```ts
let cached: { value: boolean; expiresAt: number } | null = null;
const CACHE_TTL_MS = 5_000;

export async function isAuthKillSwitchOn(): Promise<boolean> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;

  const svc = getServiceRoleClient();
  const { data } = await svc
    .from("opollo_config")
    .select("value")
    .eq("key", "auth_kill_switch")
    .maybeSingle();

  const value = data?.value === "on";
  cached = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
}

// Exported for tests — lets a beforeEach reset the cache.
export function __resetAuthKillSwitchCacheForTests(): void {
  cached = null;
}
```

Cache is **module-level**, **per-instance**. The 5s TTL is the tradeoff between read cost and break-glass response time. In a Vercel serverless fleet, each lambda carries its own cache — a break-glass flip propagates within 5s to every warm lambda, immediately to cold ones.

The flip is via a route (`/api/emergency`) that uses a pre-shared key. See the `break-glass endpoint` section in `docs/RUNBOOK.md`.

### Env var documentation

Every feature flag gets an `.env.local.example` entry:

```
# Supabase Auth kill switch (M2c+). When "true" or "1", middleware routes
# requests through the Supabase Auth path (signed-in session required for
# non-public routes). When unset/"false"/"0", middleware uses the legacy
# HTTP-Basic path — byte-identical to pre-M2c behaviour. Binary: under the
# flag-on mode, auth-service failures fail closed (500 / /auth-error), they
# do not silently fall back to Basic Auth. A DB-backed runtime override
# (opollo_config.auth_kill_switch = 'on', set via the emergency route in
# M2c-3) lets operators break-glass to the Basic Auth path without a
# redeploy.
FEATURE_SUPABASE_AUTH=
```

Document: what `"true"` does, what `""` does, how the kill switch interacts, what failure mode the flag-on path has.

## Required tests

Minimum:

1. **Flag off** — legacy path is exercised. Happy path + its error codes.
2. **Flag on, no kill switch** — new path is exercised. Happy path + its error codes.
3. **Flag on + kill switch on** — legacy path is exercised. Asserts the kill switch overrides.
4. **Flag on, kill switch read throws** — legacy-fallback path fires. Asserts try/catch works.
5. **Malformed env values** — `"True"`, `"yes"`, `"1 "` (trailing space) all treated as off. Pins the strict-parse contract.
6. **Cache behaviour** — consecutive calls within the TTL hit the cache; after TTL, a fresh read fires. Use `__resetAuthKillSwitchCacheForTests()` in `beforeEach` to isolate tests.

Copy from `lib/__tests__/middleware.test.ts` + `lib/__tests__/auth-kill-switch.test.ts`.

## Standard PR structure

Follow [`ship-sub-slice.md`](./ship-sub-slice.md). Title shape: `feat(<milestone>): <feature> behind FEATURE_<NAME>`.

The description calls out:

- **What the flag gates.** One sentence.
- **Default behaviour.** Off until explicitly enabled in Vercel env.
- **How to enable in production.** "Set `FEATURE_X=true` in Vercel env, redeploy."
- **Kill-switch interaction** (if applicable). "If the new path misbehaves, POST to `/api/emergency` with `{\"action\":\"<switch>_on\"}` — middleware falls back to legacy within 5s."
- **Removal plan.** "When N weeks of flag-on traffic are clean, delete `FEATURE_X` + the legacy branch in sub-PR <slug>." Don't ship a flag without planning its removal.

## Known pitfalls

- **Flag-off code paths atrophy.** A flag that's been on for 6 weeks has a legacy path nobody tests. Either delete the legacy path (flag removal slice) or keep exercising it in CI. Don't let the "off" branch rot in place.
- **Loose env parsing.** `"true".toLowerCase() === "true"` matches `"TRUE"` — a production typo suddenly flips the flag. Strict-parse `=== "true" || === "1"`.
- **Flag read in three places.** Inline `process.env.FEATURE_X === "true"` across three files drifts — someone adds a truthy case in one and not the others. Single helper function.
- **Kill switch without an env flag.** A DB-backed runtime override with no compile-time flag means the code path exists in every deploy, potentially a live surface when the switch is on. Always pair kill switch with env flag; kill switch only overrides.
- **Kill switch that throws uncaught**: middleware crashes on every request. Wrap in try/catch; fall back to the safer branch.
- **Forgetting the cache in the kill-switch helper**: every middleware invocation hits the DB. Vercel's lambda warm path becomes a DB DoS. 5s cache is the floor.
- **Kill-switch cache outliving hot-path tests**: tests shouldn't see stale cache state. Export `__resetForTests` and call it in `beforeEach`.
- **Not documenting the removal plan.** Flags go stale in `BACKLOG.md` without a trigger. Every flag ships with its removal date (or condition — "after 2 weeks of clean traffic").

## Pointers

- Canonical instances:
  - `FEATURE_SUPABASE_AUTH` — `middleware.ts`, `lib/auth.ts`, `lib/auth-kill-switch.ts`.
  - `FEATURE_DESIGN_SYSTEM_V2` — `lib/system-prompt.ts` → `buildSystemPromptForSite`.
- Tests: `lib/__tests__/middleware.test.ts`, `lib/__tests__/auth-kill-switch.test.ts`, `lib/__tests__/system-prompt.test.ts`.
- Related: `docs/RUNBOOK.md` (break-glass flip), [`ship-sub-slice.md`](./ship-sub-slice.md).
