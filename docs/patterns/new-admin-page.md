# Pattern — New admin page

## When to use it

Adding a new admin-only surface: list page + optional detail page + create/edit modal. Examples shipped: `/admin/sites`, `/admin/sites/[id]`, `/admin/users`, `/admin/batches`, `/admin/batches/[id]`.

Don't use for: marketing / public pages (no auth gate), one-off error pages (no list + modal shape), or modal-in-isolation additions to an existing page (follow the existing file's structure directly).

## Required files

A full new-admin-page PR touches:

| File | Role |
| --- | --- |
| `app/admin/<resource>/page.tsx` | Server component list page. Reads data server-side, passes to a client shell. |
| `app/admin/<resource>/[id]/page.tsx` | Server component detail page (if the resource has detail). |
| `components/<Resource>ListClient.tsx` | Client shell for the list page. Owns modal open state. |
| `components/<Resource>Table.tsx` | Pure presentation of rows. Takes `items` + optional callbacks. |
| `components/Add<Resource>Modal.tsx` | Client modal for create flow. POSTs then `router.refresh()`. |
| `components/Edit<Resource>Modal.tsx` | Client modal for edit flow (if resource is editable). |
| `components/<Resource>ActionsMenu.tsx` | Per-row action dropdown (archive, duplicate, etc.) if applicable. |
| `app/api/<resource>/list/route.ts` | List endpoint (if UI needs client-side refresh beyond `router.refresh`). |
| `app/api/<resource>/[id]/route.ts` | Detail + PATCH + DELETE endpoints. |
| `lib/<resource>.ts` | Service-role helpers: `list<Resource>`, `get<Resource>`, `create<Resource>`, `update<Resource>Basics`, `archive<Resource>`. Pure data-layer. |
| `lib/__tests__/<resource>-*.test.ts` | Unit coverage for the lib helpers. |
| `e2e/<resource>.spec.ts` | Playwright happy-path (see below). |

## Scaffolding

### List page (server component)

Model on `app/admin/sites/page.tsx`:

```tsx
import { <Resource>ListClient } from "@/components/<Resource>ListClient";
import { list<Resource> } from "@/lib/<resource>";

export const dynamic = "force-dynamic"; // server reads per-request; no cache.

export default async function Manage<Resource>Page() {
  const result = await list<Resource>();
  if (!result.ok) {
    return (
      <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        Failed to load <resource>: {result.error.message}
      </div>
    );
  }
  return <<Resource>ListClient items={result.data.items} />;
}
```

Why server-render: under Next's default caching, a client-fetched list persists stale data across full reloads. Server-reading eliminates the cache layer.

### Client shell

Model on `components/SitesListClient.tsx`. Owns only: modal open state, the create button, and a surrounding `<main>` frame. Delegates row rendering to `<Resource>Table` so the table can be tested in isolation and used from other surfaces.

### Create modal

Model on `components/AddSiteModal.tsx`. Keys:

- `"use client"` at top.
- Local form state via `useState<FormState>`.
- Submit handler: POST → throw on `!ok` → close modal → `router.refresh()`. Server component re-reads the list.
- Accessibility: labelled inputs, focus trap handled by Radix Dialog if using shadcn's Dialog primitive.
- Scope prefix and any DB-column-name-style fields are **auto-generated server-side**, not surfaced. See `CLAUDE.md` "Backlog — UX debt" for the rule.

### Edit modal + archive

Model on `components/EditSiteModal.tsx` + `components/SiteActionsMenu.tsx`. Archive calls `DELETE /api/<resource>/[id]` which soft-deletes (`status='removed'` or `deleted_at = now()`). `router.refresh()` after.

### Lib helpers

Model on `lib/sites.ts`:

```ts
export async function list<Resource>(): Promise<ApiResponse<{ items: <Resource>[] }>> { ... }
export async function get<Resource>(id: string): Promise<ApiResponse<<Resource>>> { ... }
export async function create<Resource>(input: Create<Resource>Input): Promise<ApiResponse<<Resource>>> { ... }
export async function update<Resource>Basics(id: string, patch: Update<Resource>Patch): Promise<ApiResponse<<Resource>>> { ... }
export async function archive<Resource>(id: string): Promise<ApiResponse<{ archived: boolean }>> { ... }
```

Every function returns the standard `ApiResponse<T>` envelope (see `lib/tool-schemas.ts`). No direct throws; failures become `{ ok: false, error: { code, message, ... } }`.

**Use `.maybeSingle()` not `.single()`** when the row might not exist after filtering — `.single()` throws PGRST116 on zero rows and the `if (!data) return NOT_FOUND` branch becomes unreachable. PR #40 burned on this.

## Required tests

Minimum:

1. **`lib/__tests__/<resource>-*.test.ts`** — unit tests covering each lib helper. One test per error code (`VALIDATION_FAILED`, `NOT_FOUND`, `VERSION_CONFLICT`, `CANNOT_MODIFY_SELF`, `UNIQUE_VIOLATION` as applicable). Happy path for each function.
2. **E2E spec in `e2e/<resource>.spec.ts`** — at minimum:
   - List renders + shows a seeded row.
   - Row click lands on the detail page (if detail exists).
   - Create modal opens, submits, new row appears after refresh.
   - Actions menu opens, archive flow removes row from list.
   - `auditA11y(page, testInfo)` on every page the spec touches.
3. **API route tests** if the route has non-trivial branching (auth gate, Zod parsing, idempotency). List-only GET endpoints that just call the lib helper can skip — lib tests cover the logic.

## Standard PR structure

Follow [`ship-sub-slice.md`](./ship-sub-slice.md). Title shape:

`feat(admin/<resource>): <one-line verb phrase>`

E.g. `feat(admin/sites): site detail page + archive + auto-prefix`.

Description sections per the sub-slice pattern. E2E coverage rule is hard: state in the description if something is intentionally unit-only.

## Known pitfalls

- **Server-side rendering vs client fetch.** Client-fetched list pages survive stale across navigation. Always server-render for read-mostly admin surfaces. (PR #39.)
- **`.single()` vs `.maybeSingle()`.** `.single()` throws on zero rows, breaking NOT_FOUND branches. Use `.maybeSingle()` when filters can legitimately return nothing. (PR #40.)
- **Missing `revalidatePath`** on create / update / archive API routes. Without it, server-rendered lists stay stale until hard reload. Every mutation route hits `revalidatePath('/admin/<resource>')` + the detail path when applicable.
- **Browser `confirm()` in E2E specs.** Use `page.once("dialog", (dialog) => { void dialog.accept(); });` before clicking the button that triggers the confirm. See `e2e/sites.spec.ts` for the pattern.
- **Surfacing DB column names in labels.** `scope_prefix`, `version_lock`, `wp_page_id`, `created_by_uuid` — none of these belong in operator UX. Auto-generate server-side or expose through a human-friendly label. See `CLAUDE.md` "Backlog — UX debt."
- **Missing `"use client"`** on modal / interactive component — Server Components can't use `useState`. Error is loud but the compile message is misleading ("event handlers cannot be passed to Client Component props").
- **Forgetting the admin gate on the API route.** Every `/api/admin/*` route starts with `const gate = await requireAdminForApi(); if (gate.kind === "deny") return gate.response;`. See `new-api-route.md`.

## Pointers

- Shipped examples: `app/admin/sites/`, `app/admin/sites/[id]/`, `app/admin/users/`, `app/admin/batches/`, `app/admin/batches/[id]/`.
- Related: [`new-api-route.md`](./new-api-route.md) (the mutation endpoints), [`ship-sub-slice.md`](./ship-sub-slice.md) (PR hygiene).
