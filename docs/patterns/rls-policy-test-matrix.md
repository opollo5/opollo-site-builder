# Pattern — RLS policy test matrix

## When to use it

Validating Postgres Row-Level Security policies across the full (role × table × operation) grid. The canonical instance is M2b: every authenticated role (admin / operator / viewer) × every user-facing table × each of SELECT / INSERT / UPDATE / DELETE produces exactly one positive assertion.

Use whenever:

- A migration adds or modifies RLS policies.
- A new table opts into RLS (i.e. every new table).
- A role is added, renamed, or has its permissions changed.

Don't use for: service-role flows (service role bypasses RLS by design — assertions there belong in the feature test, not the RLS matrix), tables intentionally open to authenticated reads (the matrix still runs; it just asserts the openness).

## The matrix shape

Rows: authenticated role (`admin`, `operator`, `viewer`, sometimes `authenticated-no-role` for boundary cases).
Columns: operation (`SELECT`, `INSERT`, `UPDATE`, `DELETE`).

Each cell has exactly one of:

- **Allow** — the op succeeds on matching rows.
- **Filter** — the op runs but returns zero matching rows (silent RLS filter, not an error).
- **Deny** — the op raises `42501 / "new row violates row-level security policy"` (only INSERT raises; SELECT/UPDATE/DELETE filter-to-zero).

Every cell has a test. No silent "the policy implies this" — each cell gets an explicit assertion.

## Expected outcomes by op (reference)

- **SELECT** — denied rows filter out. Response is `{ data: [], error: null }`.
- **INSERT** — denied rows raise `42501`. Response is `{ data: null, error: { code: "42501", ... } }`.
- **UPDATE** — denied rows don't match the USING predicate. Response is `{ data: [], error: null }` (zero rows matched).
- **DELETE** — same as UPDATE.

The asymmetry bites: a denied SELECT looks identical to an empty table. Tests that assert "zero rows" should seed a row the policy would filter and one the policy would allow, so the zero-count proves the filter, not the empty table.

## Required files

| File | Role |
| --- | --- |
| `lib/__tests__/<slug>-rls.test.ts` | The matrix. One file per coherent group of tables (M2b covers opollo_users + sites + design_systems + design_components + design_templates + pages + opollo_config in one file). |
| `lib/__tests__/_auth-helpers.ts` | `seedAuthUser`, `signInAs`, `cleanupTrackedAuthUsers`. Reused across all auth-touching tests. |
| `lib/__tests__/_setup.ts` | TRUNCATE + auth-user cleanup in `beforeEach`. |
| The migration introducing the RLS change | Covered by [`new-migration.md`](./new-migration.md); the test file verifies it. |

## Scaffolding

### Setup

Model on `lib/__tests__/m2b-rls.test.ts`:

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { seedAuthUser, type SeededAuthUser } from "./_auth-helpers";
import { getServiceRoleClient } from "@/lib/supabase";

function buildClient(accessToken: string): SupabaseClient {
  const url = process.env.SUPABASE_URL!;
  const anonKey = process.env.SUPABASE_ANON_KEY!;
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

describe("<migration-slug>: user-scoped RLS policies", () => {
  let admin: SeededAuthUser;
  let operator: SeededAuthUser;
  let viewer: SeededAuthUser;
  let adminClient: SupabaseClient;
  let operatorClient: SupabaseClient;
  let viewerClient: SupabaseClient;

  beforeAll(async () => {
    admin = await seedAuthUser({ email: "rls-admin@opollo.test", role: "admin", persistent: true });
    operator = await seedAuthUser({ email: "rls-operator@opollo.test", role: "operator", persistent: true });
    viewer = await seedAuthUser({ email: "rls-viewer@opollo.test", role: "viewer", persistent: true });
    adminClient = buildClient(admin.accessToken);
    operatorClient = buildClient(operator.accessToken);
    viewerClient = buildClient(viewer.accessToken);
  });

  beforeEach(async () => {
    // _setup.ts TRUNCATEs all tables (including opollo_users) between tests.
    // Re-insert the three role rows so policies evaluating public.auth_role()
    // resolve correctly.
    const svc = getServiceRoleClient();
    await svc.from("opollo_users").insert([
      { id: admin.userId,    email: admin.email,    role: "admin" },
      { id: operator.userId, email: operator.email, role: "operator" },
      { id: viewer.userId,   email: viewer.email,   role: "viewer" },
    ]);
  });

  // ... per-table describe blocks below
});
```

Key moves:

- **`persistent: true` on the auth users.** Cleanup (`cleanupTrackedAuthUsers`) skips them so `beforeAll`'s tokens stay valid across the whole file. Non-persistent users get swept between tests.
- **Role-scoped clients built once.** Tokens don't rotate within a 2-minute test run.
- **`beforeEach` re-inserts `opollo_users`** because `_setup.ts` TRUNCATEs them. Without this, `public.auth_role()` returns NULL and every policy evaluates weirdly.

### Per-table describe block

```ts
describe("sites", () => {
  let seedId: string;

  beforeEach(async () => {
    const svc = getServiceRoleClient();
    const { data } = await svc
      .from("sites")
      .insert({ name: "RLS Test Site", prefix: "rt", created_by: admin.userId })
      .select("id")
      .single();
    seedId = data!.id;
  });

  it("admin SELECT: can read", async () => {
    const { data, error } = await adminClient.from("sites").select("id").eq("id", seedId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("operator SELECT: can read", async () => { /* allow */ });
  it("viewer SELECT: can read", async () => { /* allow */ });

  it("admin INSERT: allowed", async () => { /* returns inserted row */ });
  it("operator INSERT: allowed", async () => { /* returns inserted row */ });
  it("viewer INSERT: denied via 42501", async () => {
    const { data, error } = await viewerClient
      .from("sites")
      .insert({ name: "Nope", prefix: "no" })
      .select();
    expect(data).toBeNull();
    expect(error?.code).toBe("42501");
  });

  it("admin UPDATE: allowed", async () => { /* matches + updates */ });
  it("operator UPDATE: allowed", async () => { /* matches + updates */ });
  it("viewer UPDATE: filtered — 0 rows", async () => {
    const { data, error } = await viewerClient
      .from("sites")
      .update({ name: "Rename" })
      .eq("id", seedId)
      .select();
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("admin DELETE: allowed", async () => { /* row goes */ });
  it("operator DELETE: allowed", async () => { /* row goes */ });
  it("viewer DELETE: filtered — 0 rows", async () => {
    const { data, error } = await viewerClient
      .from("sites")
      .delete()
      .eq("id", seedId)
      .select();
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });
});
```

**One `it` per cell**, title names the role + op + outcome. When a cell fails, the test name alone tells the reader what's broken.

## Required tests per migration

When an RLS migration lands:

1. **Every new table ships a full matrix.** (role × op) cells all explicit.
2. **Every policy change re-runs the affected rows of the matrix.** If the admin-update policy changed, rerun the `admin UPDATE` + `admin DELETE` cells.
3. **Positive + negative per role.** Viewer's INSERT rejected is the negative; viewer's SELECT succeeding is the positive. Don't test only the denies.
4. **RLS helper function coverage** — if the migration adds a SECURITY DEFINER helper like `public.auth_role()`, test: correct return for each signed-in role, NULL when no session, NULL when the JWT sub doesn't match any row.
5. **Cross-table consistency** — if two tables share a policy pattern (e.g. `authed_read_own`), exactly the same outcomes apply per role. Copy-paste + rename the describe block.

## Standard PR structure

Follow [`ship-sub-slice.md`](./ship-sub-slice.md) + [`new-migration.md`](./new-migration.md). The description explicitly states:

- **Which tables' matrices** the PR exercises.
- **Which cells changed.** "Admin UPDATE was previously filtered; now allowed. Test added."
- **Which policies use `public.auth_role()`** vs. other helpers. If a new helper is introduced, every table using it gets re-tested.

## Known pitfalls

- **Testing with service-role and calling it an RLS test.** Service-role bypasses RLS; its tests belong in the feature test file. RLS tests use role-scoped clients with anon key + user-scoped JWT.
- **Not re-inserting `opollo_users` in `beforeEach`.** `_setup.ts` TRUNCATEs; without the re-insert, `public.auth_role()` returns NULL and every policy evaluates against a non-existent role. All tests fail in confusing ways.
- **Collapsing INSERT denial + UPDATE denial into one test.** They surface differently (INSERT raises 42501, UPDATE returns zero rows). Two different tests.
- **Asserting `data.length === 0` without proving a row was there to filter.** Seed + query; "zero rows" with no seeded row proves nothing. `describe`'s `beforeEach` should always seed before the test runs.
- **Tokens expiring mid-run.** `seedAuthUser` mints a JWT with a multi-hour expiry — fine for 2-minute test runs, breaks if a test file runs longer (rare). If the test suite grows past 10 minutes, refresh tokens in a `beforeEach`.
- **`persistent: true` leaking across test FILES.** Each file's `persistent: true` users stay in `auth.users` forever unless explicitly cleaned. Use a file-scoped email prefix (`rls-admin@opollo.test` in `m2b-rls.test.ts`, different in `m3-rls.test.ts`) to avoid collision.
- **Forgetting `service_role_all`.** Without it, service-role writes fail. Every new table needs `FOR ALL TO service_role USING (true) WITH CHECK (true)` as the first policy.
- **Policy order confusion.** Postgres evaluates policies as OR'd `USING` clauses; adding a more-restrictive policy doesn't tighten, it loosens. Test the full matrix after any policy change.

## Pointers

- Canonical instance: `lib/__tests__/m2b-rls.test.ts`, supported by `supabase/migrations/0005_m2b_rls_policies.sql`.
- Related: [`new-migration.md`](./new-migration.md), `lib/__tests__/_auth-helpers.ts` (seeding pattern), `lib/__tests__/m2a-auth-link.test.ts` (`public.auth_role()` helper coverage).
