# Pattern — New API route

## When to use it

Adding a new endpoint under `app/api/`. Covers both admin-only mutations (PATCH / DELETE / POST) and authenticated reads.

Don't use for: break-glass endpoints with pre-shared-key auth (`/api/emergency` is the only one; if you need another, read that route first). Cron-invoked workers follow a different shape — see [`new-batch-worker-stage.md`](./new-batch-worker-stage.md).

## Required files

| File | Role |
| --- | --- |
| `app/api/<path>/route.ts` | Handler(s) — `GET` / `POST` / `PATCH` / `DELETE`. |
| `lib/<resource>.ts` | Service-role helper called by the route. Route stays thin. |
| `lib/__tests__/<resource>-*.test.ts` | Unit tests hitting the lib helper + route. |
| `lib/tool-schemas.ts` | Shared type / error-code definitions (extend, don't duplicate). |

## Scaffolding

### Route handler shape

Model on `app/api/admin/batch/[id]/cancel/route.ts`. Minimal skeleton:

```ts
import { NextResponse } from "next/server";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { logger } from "@/lib/logger";
import {
  parseBodyWith,
  readJsonBody,
  respond,
  validateUuidParam,
} from "@/lib/http";
import { <Operation>Schema } from "@/lib/tool-schemas";
import { <operation> } from "@/lib/<resource>";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi();
  if (gate.kind === "deny") return gate.response;

  const idCheck = validateUuidParam(params.id, "id");
  if (!idCheck.ok) return idCheck.response;

  const body = await readJsonBody(req);
  const parsed = parseBodyWith(<Operation>Schema, body);
  if (!parsed.ok) return parsed.response;

  const result = await <operation>(idCheck.value, parsed.data);
  if (!result.ok) {
    logger.warn("<operation>.failed", { id: idCheck.value, code: result.error.code });
  }
  return respond(result);
}
```

Key invariants:

- **First line:** the auth gate. `requireAdminForApi()` for admin-only; override `{ roles: ["admin", "operator"] }` when operators can reach the route. No route skips the gate — even read-only list endpoints under `/api/admin/*`.
- **Route-level Zod.** Parse every `params` + body with `parseBodyWith` / `validateUuidParam`. Internal code trusts the parsed types; no runtime defensive `typeof` checks beyond the boundary.
- **Thin handler, fat lib.** Business logic lives in `lib/<resource>.ts`. The route handler wires gate → parse → call → respond. If the handler grows past 80 lines, extract the logic.
- **Standard response envelope.** `respond(result)` turns `ApiResponse<T>` into `NextResponse` at the right HTTP status. Don't hand-build `NextResponse.json`.
- **Structured logging.** `logger.warn` on known error codes, `logger.error` on unexpected throws caught in a try/catch. Never `console.log`. Request-ID is attached automatically by middleware.
- **`runtime = "nodejs"` + `dynamic = "force-dynamic"`** unless you have a specific reason to run on Edge. `requireAdminForApi` reads cookies and needs the full runtime.

### Error codes

Use codes from `lib/tool-schemas.ts`. Common ones:

| Code | HTTP | Meaning |
| --- | --- | --- |
| `VALIDATION_FAILED` | 400 | Zod or hand-authored input validation. |
| `UNAUTHORIZED` | 401 | No session. |
| `FORBIDDEN` | 403 | Session but wrong role. |
| `NOT_FOUND` | 404 | Resource with that id doesn't exist (or is soft-deleted). |
| `ALREADY_EXISTS` | 409 | UNIQUE constraint collision. |
| `VERSION_CONFLICT` | 409 | Optimistic-concurrency `version_lock` mismatch. |
| `CANNOT_MODIFY_SELF` | 409 | Admin tried to revoke / demote themselves. |
| `LAST_ADMIN` | 409 | Demoting / revoking the only active admin. |
| `IDEMPOTENCY_KEY_CONFLICT` | 422 | Same idempotency key + different body. |
| `FK_VIOLATION` | 422 | Foreign-key parent doesn't exist. |
| `INTERNAL_ERROR` | 500 | Uncategorised server error. Log the details, return a generic message. |

If a route introduces a new code, add it to `lib/tool-schemas.ts`'s `errorCodeToStatus` map + document it here.

### Lib helper shape

Model on `lib/sites.ts`:

```ts
export async function <operation>(
  id: string,
  patch: <Operation>Patch,
): Promise<ApiResponse<<Resource>>> {
  const svc = getServiceRoleClient();

  const { data, error } = await svc
    .from("<table>")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .neq("status", "removed") // soft-delete guard
    .select("id, name, status, updated_at")
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      error: { code: "INTERNAL_ERROR", message: error.message, retryable: false },
      timestamp: new Date().toISOString(),
    };
  }
  if (!data) {
    return {
      ok: false,
      error: { code: "NOT_FOUND", message: "No <resource> with that id.", retryable: false },
      timestamp: new Date().toISOString(),
    };
  }
  return { ok: true, data, timestamp: new Date().toISOString() };
}
```

- **Service-role for mutations in admin paths.** Bypasses RLS; the gate already authorised. Use the anon client only for user-scoped reads where RLS is the enforcement layer.
- **`.maybeSingle()` over `.single()`** when filters can return zero rows.
- **`.neq("status", "removed")`** (or equivalent) to exclude soft-deleted rows from reads + preserve idempotency on double-archive.
- **Explicit `updated_at`.** Don't rely on a trigger. App sets it.

### Revalidation

Every mutation route that changes data a server-rendered page reads MUST call `revalidatePath("/admin/<resource>")` (and the detail path when applicable) before returning. Without it, Next's static-shell cache serves stale data until a hard reload.

```ts
import { revalidatePath } from "next/cache";
// ...
revalidatePath("/admin/sites");
revalidatePath(`/admin/sites/${id}`);
return respond(result);
```

## Required tests

Minimum:

1. **Auth gate** — 401 when flag on + no session, 403 when wrong role, 200 / 2xx on the allowed role. Copy the pattern from `lib/__tests__/admin-api-gate.test.ts`.
2. **Validation** — 400 on missing required field, 400 on wrong type, 400 on malformed JSON body. One test per Zod assertion worth pinning.
3. **Guardrails** — one test per business-logic error (NOT_FOUND, CANNOT_MODIFY_SELF, LAST_ADMIN, VERSION_CONFLICT, etc.).
4. **Success** — the happy path, asserting both the response envelope and the DB side effect.
5. **Idempotency** (when applicable) — same key + same body returns the original; same key + different body returns `IDEMPOTENCY_KEY_CONFLICT`.
6. **Concurrency** (when applicable) — two simultaneous calls produce the documented outcome (unique-violation, `SKIP LOCKED`, advisory lock, etc.).

Copy test scaffolding from an adjacent `*.test.ts` in `lib/__tests__/`. Every test file uses `beforeEach` from `_setup.ts` which TRUNCATEs the DB.

## Standard PR structure

Follow [`ship-sub-slice.md`](./ship-sub-slice.md). Title shape:

`feat(api/<resource>): <one-line verb phrase>` or scoped to the parent milestone: `feat(m3-8): <…>`.

Describe the write-safety hotspots the route addresses: any external calls, any concurrent-writer races, any UNIQUE / FK dependencies.

## Known pitfalls

- **Skipping the auth gate on a list / read endpoint.** Even read-only list endpoints under `/api/admin/*` use `requireAdminForApi`. The gate's the difference between "RLS would have stopped this" and "the RLS wasn't tight enough" — defence in depth.
- **Returning raw `error.message`** from supabase / pg. Leaks schema detail. Keep the Postgres message in logs, return a sanitised one in the envelope.
- **Missing `revalidatePath`** — stale UI. See "Revalidation" above.
- **Hand-building `NextResponse.json`** instead of `respond(result)`. Routes drift on status-code conventions. `respond` is the single source of truth.
- **Defensive `typeof` checks post-Zod.** If Zod parsed the body, the types are right. Extra `typeof x === "string"` guards inside the lib are noise.
- **Using `.single()` with filters that can return zero rows.** PGRST116 is thrown; NOT_FOUND branch becomes unreachable.
- **Forgetting `runtime = "nodejs"` / `dynamic = "force-dynamic"`.** Routes that read cookies or hit Supabase need the nodejs runtime. App Router's default static inference silently breaks them.
- **SAVEPOINT missing on unique-violation recovery.** When a route wraps multiple statements in an explicit transaction, a UNIQUE failure aborts the whole transaction (SQLSTATE 25P02). Wrap the insert in `SAVEPOINT` so `ROLLBACK TO SAVEPOINT` on 23505 lets the outer tx continue. PR #35 burned on this.
- **`revokeUserSessions` sync** — some endpoints need to invalidate Supabase sessions on state change (role demote, revoke). Don't rely on the JWT expiring naturally.

## Pointers

- Shipped examples: `app/api/admin/batch/[id]/cancel/route.ts`, `app/api/sites/[id]/route.ts`, `app/api/admin/users/*/route.ts`, `app/api/tools/create_page/route.ts`.
- Related: [`new-admin-page.md`](./new-admin-page.md) (the UI that drives mutations), [`new-migration.md`](./new-migration.md) (when the route needs new schema).
