# M2 — Auth + Admin UI (retroactive)

## Status

Shipped, completed in M14. Backfilled during M11-6 (audit close-out 2026-04-22); retrospective note added 2026-04-24 after M14.

M2 shipped the foundation — Supabase-backed sessions, role matrix, admin gate, kill switch, invite flow — but it did NOT ship self-service recovery. Specifically, M2 left these gaps, all of which became painful when `hi@opollo.com` locked out:

- **No "Forgot password?" path.** A user who forgot their password had no way to recover it — the login form's only feedback on a bad password was a generic error.
- **No `/account/security` page.** A signed-in user had no way to rotate their own password.
- **No permanent operator recovery tool.** If Supabase's email flow was misconfigured or unreachable, a locked-out admin had no path back in short of a one-off database edit.
- **Supabase dashboard redirect URLs never documented.** The production dashboard's Site URL had drifted to `localhost:3000`, so every auth email (if any were ever sent) would have landed at the wrong host.

M14 closed all four. M2 is still the correct foundation — the role matrix, admin gate, emergency kill switch, and invite flow are all in use unchanged. The "auth is shipped" framing in this plan's original wording predated self-service recovery being a requirement; the door was held by admin-only invite flow until M14 added the self-service paths. See `docs/AUTH.md` for the post-M14 flow diagram.

## What it is

Supabase-backed auth with a role matrix, server-action login/logout, an admin gate that guards every `/admin/**` route, a kill-switch that flips the whole app read-only from a signed emergency endpoint, and a user-revoke flow. First admin UI surfaces — `/admin/sites`, `/admin/users` — landed here.

## Scope (shipped in M2)

- **Migration 0004** `0004_m2a_auth_link.sql` — trigger copies `auth.users` INSERTs into `opollo_users` with default role `viewer`. `opollo_users` is the app-side user table keyed on the `auth.users.id`.
- **Migration 0005** `0005_m2b_rls_policies.sql` — role-matrix RLS policies across every table: `viewer` = read, `operator` = read + write to own-scope data, `admin` = full access.
- **Migration 0006** `0006_m2c_revoked_at.sql` — adds `opollo_users.revoked_at`; middleware rejects requests whose session token belongs to a revoked user.
- **Libs** `lib/auth.ts` (sign-in / sign-out server actions), `lib/admin-gate.ts` (server-component gate for `/admin/**` pages), `lib/admin-api-gate.ts` (API route equivalent), `lib/auth-kill-switch.ts` (reads `opollo_config.kill_switch_state`), `lib/auth-revoke.ts`, `middleware.ts` (session check + kill-switch short-circuit + revoke check on every request).
- **API** `/api/emergency` — POST with `OPOLLO_EMERGENCY_KEY` header to `kill_switch_on`, `kill_switch_off`, or `revoke_user`. Constant-time header compare.
- **Admin UI** `/admin/sites` (list + AddSiteModal + inline edit + archive), `/admin/users` (list + invite + role change + revoke). Every action server-rendered; mutations behind server actions + API routes with the admin-api-gate.
- **Login page** `/login` — server action posts to Supabase auth. Kill-switch mode renders an "app paused" notice on 503.

## Out of scope (later milestones)

- **Per-tenant cost budgets + admin UI.** M8.
- **Per-site design-system authoring UI.** M6-4 de-jargoned the forms; M2 shipped the forms themselves behind M1a's data layer.
- **Operator attribution on every write.** `updated_by` + `created_by` columns land incrementally in M4 onward; M1/M2 tables fold in on the next natural migration per the BACKLOG schema-hygiene entry.

## Env vars required

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` — already provisioned.
- `OPOLLO_EMERGENCY_KEY` — new in M2; 32-char minimum; absent value short-circuits `/api/emergency` to 503 so a partially-configured preview deployment can't be kill-switched from outside.

## Risks identified and mitigated

1. **auth.users INSERT without a matching opollo_users row.** → Migration 0004's trigger fires on INSERT and always creates the app-side row with `role='viewer'`. Test: `m2a-auth-link.test.ts` asserts the trigger fires on every code path (OAuth, email/password, magic link).

2. **Viewer accidentally gets write access via RLS mis-grant.** → M2b policies are explicit per role. `m2b-rls.test.ts` exhaustively covers the matrix: (admin × every table × SELECT/INSERT/UPDATE/DELETE), same for operator + viewer. Any unintended grant surfaces as a new green cell in a test that previously didn't exist or as a red one in the matrix.

3. **Revoked admin retains a valid session until token expiry.** → `opollo_users.revoked_at` is checked on every request by `middleware.ts` (via `lib/auth-revoke.ts`). Revocation is immediate; the next request is rejected. Test: `auth-revoke.ts` tests + `middleware.test.ts` exercise the 403 path.

4. **Kill switch bypass via a direct-to-Supabase write.** → The kill switch is enforced in `middleware.ts` at the Next.js edge. Anyone with service-role access can still write directly to Supabase — the kill switch is a user-facing freeze, not a hard seal. Documented in `docs/RUNBOOK.md`.

5. **Emergency endpoint vulnerable to timing attack on the key.** → `constantTimeEqual` wraps `timingSafeEqual` with a length-prefixed pre-hash so unequal-length comparisons take the same time. Tests: `emergency-route.test.ts` "returns 503 when OPOLLO_EMERGENCY_KEY is shorter than 32 chars" + auth-failure-path tests.

6. **Admin-gate bypass on nested routes.** → Every `/admin/**` page server-component calls `checkAdminAccess({ requiredRoles: [...] })` at the top. Every `/api/admin/**` route calls `requireAdminForApi()`. Pattern-enforced by review + `admin-gate.test.ts` + `admin-api-gate.test.ts`.

7. **Kill-switch state cached between requests.** → `opollo_config.kill_switch_state` is read fresh on every middleware invocation. No module-level caching. Test: `auth-kill-switch.test.ts` exercises the no-cache path.

8. **Login form leaks which input was wrong.** → Error message is the generic "Invalid email or password." Test: `e2e/auth.spec.ts` "wrong password shows the generic invalid message" pins the copy.

9. **Middleware SSR cookies hitting the wrong origin.** → `@supabase/ssr` `createServerClient` + `getServiceRoleClient` pattern; `middleware.ts` reads/writes auth cookies via the supported path.

10. **Self-demotion or self-revoke by an admin.** → Admin API routes reject `CANNOT_MODIFY_SELF` when the target matches the requesting user. Test: `admin-users-role.test.ts` + `admin-users-revoke.test.ts`.

## Shipped sub-slices

- **M2a** — auth link trigger (migration 0004)
- **M2b** — RLS policies (migration 0005)
- **M2c** — revoke column (migration 0006)
- **M2d** — UX cleanup pass (including scope_prefix auto-gen in AddSiteModal)

## E2E coverage

`e2e/auth.spec.ts` covers: unauthenticated redirect, sign-in + admin landing + sign-out, wrong-password generic message, admin reaches `/admin/users`. `e2e/sites.spec.ts` + `e2e/users.spec.ts` exercise the admin UIs.

## Relationship to later milestones

- M3's batch worker relies on admin-api-gate for enqueue + admin-gate for the /admin/batches surfaces.
- M8 adds per-tenant cost budgets which are admin-edited through the same PATCH-with-version_lock pattern M2 established.
- Every later admin route (`/admin/images`, `/admin/sites/[id]/pages`, `/admin/batches`) follows the M2 "admin-gate at the top" pattern.
