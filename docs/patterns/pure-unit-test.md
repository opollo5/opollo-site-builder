# Pattern — Pure utility unit tests

## When to use it

Testing a `lib/` module that has **no Supabase dependency at test time**. This
covers pure functions, singleton wrappers, and thin conditional dispatchers whose
logic can be verified by mocking their dependencies with `vi.mock()`.

Examples where this pattern applies:

| Module | Complexity |
|---|---|
| `lib/utils.ts` — `cn()`, `formatRelativeTime()` | Pure functions |
| `lib/html-size.ts` — `checkHtmlSize()`, `estimateHtmlBytes()` | Pure functions |
| `lib/leadsource-fonts.ts` — constant string | Constant |
| `lib/http.ts` — `validationError()`, `respond()`, etc. | Pure wrappers over `NextResponse` |
| `lib/redis.ts` — `getRedisClient()` singleton | SDK wrapper, env-gated |
| `lib/current-user.ts` — `resolveCurrentUser()` | Thin conditional, mocked deps |
| `lib/design-system-errors.ts` — `mapPgError()`, `guardImpl()` | Pure mapping + try/catch |

Do **not** use for: lib code that actually calls `getServiceRoleClient()`,
writes to Postgres, or touches Supabase Auth at test execution time. Those
tests belong in the same `lib/__tests__/` directory but exercise a real
(seeded) Supabase stack via the `_setup.ts` per-test truncates.

## File location

Tests live at `lib/__tests__/<module-name>.test.ts` — the same directory as
the Supabase-dependent tests. The global Supabase setup (`_globalSetup.ts`)
runs before any test file executes, but pure tests are unaffected if Supabase
doesn't start: they make zero DB calls and vitest executes them in a Node.js
worker that has no live connection anyway.

In CI, Supabase is always available, so the setup cost is shared across the
whole suite. Locally, if Docker is unavailable, only the tests that actually
call `getServiceRoleClient()` fail — pure tests would also fail at the
_globalSetup.ts step, but this is a pre-existing constraint and not unique to
pure tests.

## Test file shape

```ts
import { describe, expect, it } from "vitest";

import { myHelper } from "@/lib/my-module";

// Optionally add a comment block explaining what branches the tests cover
// and why this module needed dedicated coverage (e.g. "replaced N local
// helpers after M15-4 errorJson refactor").

describe("myHelper", () => {
  it("returns X for input Y", () => {
    expect(myHelper("Y")).toBe("X");
  });
});
```

## Mocking env vars

Use `beforeEach` / `afterEach` to save and restore `process.env`. Changing env
mid-test is safe only within a single file because vitest files run serially
(`fileParallelism: false` in `vitest.config.ts`).

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ORIGINAL = process.env.MY_VAR;

beforeEach(() => {
  delete process.env.MY_VAR;
});

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env.MY_VAR;
  } else {
    process.env.MY_VAR = ORIGINAL;
  }
});
```

## Mocking module dependencies (`vi.mock` + `vi.hoisted`)

For modules that import a third-party SDK or another lib module:

```ts
// Must be hoisted so the factory runs before module resolution.
const mockConstructor = vi.hoisted(() => vi.fn());

vi.mock("@upstash/redis", () => ({
  Redis: mockConstructor,
}));

// Import AFTER vi.mock — vitest hoists vi.mock to the top of the file,
// but the import itself must come after to get the mocked version.
import { getRedisClient, __resetRedisClientForTests } from "@/lib/redis";
```

For modules that re-export real implementations alongside mocked ones:

```ts
vi.mock("@/lib/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    getCurrentUser: async () => mockCurrentUser.user,
  };
});
```

Use `vi.hoisted()` for shared state that must be mutated per-test:

```ts
// The factory runs before any import — so the object reference is stable.
const mockState = vi.hoisted(() => ({ value: false, throws: false }));
```

## Mocking time

For functions that call `Date.now()` or `new Date()`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const FIXED_NOW = new Date("2026-01-15T12:00:00.000Z").getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});
```

## Async helpers in `lib/http.ts`

`NextResponse` implements the Fetch API `Response` interface in Node 18+, so
`.json()` resolves normally without a mock:

```ts
async function json(res: Response): Promise<unknown> {
  return res.json();
}

it("returns 400 with VALIDATION_FAILED", async () => {
  const res = validationError("Name is required.");
  expect(res.status).toBe(400);
  const body = (await json(res)) as { error: { code: string } };
  expect(body.error.code).toBe("VALIDATION_FAILED");
});
```

## Checklist before opening a PR

- [ ] Tests cover every exported function (or document why one is excluded)
- [ ] Each branch of conditional logic is hit by at least one test
- [ ] Env-var save/restore uses `afterEach`, not `after` (runs even on failure)
- [ ] `vi.mock()` calls placed at the top level of the file (vitest hoists them)
- [ ] `vi.mock()` with `vi.hoisted()` state resets in `beforeEach` so tests are independent
- [ ] Import of the module under test comes **after** `vi.mock()` declarations
- [ ] No `supabase` / `getServiceRoleClient()` calls — if you added one, move to an integration test
- [ ] `npm run lint` and `npm run typecheck` pass locally
- [ ] PR description notes the M15-6 gap number being closed (or the specific refactor that made the test worth adding)

## Known pitfalls

**`import type` vs value import from a barrel that re-exports `server-only`.**
If a barrel (`@/lib/auth`) re-exports both types and values from `server-only`
modules, a `"use client"` file importing from it with a combined import
(`{ type X, value }`) breaks the production build. Use `import type` for the
barrel and sub-path imports for values. See the `server-only-barrel-leak`
feedback memory for the incident.

**`vi.mock` is file-scoped.** Mocks declared in one test file never bleed into
another. Each file gets a fresh module registry.

**`beforeEach` reset is mandatory for shared mock state.** If you use
`vi.hoisted()` to create mutable test state, always reset every field in
`beforeEach`. Tests that run after a failure leave the state dirty otherwise.

**`async` test helpers must be awaited.** `json(res)` returns a Promise;
forgetting `await` gives you a truthy Promise, not the parsed object.
