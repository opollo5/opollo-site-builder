# Architecture Guardrails

These are the rules Claude Code follows when deciding **how** to structure code — not what to build (that's in the workstream briefs) and not where (that's in `composer/COMPONENT_MAP.md`). This file answers questions like "should I extract this into a hook?" and "should I add a Context?"

Read this file in addition to `CLAUDE_CODE_INSTRUCTIONS.md`. The rules apply to both workstreams.

If a rule below conflicts with a specific instruction elsewhere in the brief, the specific instruction wins. These rules are defaults to apply when nothing else dictates.

---

## 1. Composition over inheritance

There is no `Base*` component pattern in this codebase. There are no abstract classes, no inherited React components, no `extends` chains.

- ✅ `<Dialog size="lg"><CustomBody /></Dialog>`
- ❌ `<MyCustomDialog extends BaseDialog>`

If two components share 60%+ of their structure, extract a third primitive they both compose. Do not extract a base they both inherit from.

---

## 2. No "Base*" or "Abstract*" templates

The 16 named templates in `framework/TEMPLATES.md` are the canonical surface. Do not create:

- `BaseTemplate.tsx`
- `AbstractDetailPage.tsx`
- `TemplateShell.tsx` (other than `AppShell` which already exists)

Each template is its own concrete component. Internal helper components are fine; shared abstractions exposed as templates are not.

---

## 3. Server components by default

Every new component starts as a server component. Only mark `'use client'` when at least one of these is true:

- Component uses `useState`, `useReducer`, `useEffect`, `useRef`, `useContext`, or any other hook
- Component attaches event handlers (`onClick`, `onChange`, etc.) that need to run in the browser
- Component reads from browser APIs (`window`, `document`, `localStorage`)
- Component renders inside a parent already marked `'use client'`

The composer is highly interactive and will be largely `'use client'`. The dashboard's calendar grid can be a server component with a `'use client'` calendar shell nested inside. Templates in the framework are server components with `'use client'` content slots.

When in doubt: keep it on the server. Promote to client only when forced.

---

## 4. State management ladder

Reach for these in order. Stop at the first one that fits.

1. **URL params** — for state that should survive refresh (filter, sort, selected day, active tab on dashboard)
2. **React `useState`** in the component that owns the state — for ephemeral UI state (open/closed, hover, focus)
3. **`useState` lifted to the nearest common parent** — for state shared between siblings (composer editor ↔ preview)
4. **Custom hook in `hooks/`** — for stateful logic reused across 2+ components (e.g. `useComposerState`)
5. **Server state via SWR or React Query** — for data fetched from `/api/*` (existing repo convention)
6. **React Context** — for state shared across 3+ branches of the tree where prop-drilling would exceed 2 levels
7. **Zustand or external store** — only if a Context-based solution becomes unmanageably large

Do not skip steps. Do not reach for Zustand because "it's cleaner." Cleaner now = harder to debug later.

---

## 5. No prop-drilling beyond 2 layers

If a prop is being passed through more than 2 intermediate components that don't use it, that's a smell. Resolve via:

- Lift state to the layer that actually uses both endpoints, OR
- Context (only if the consumers are genuinely in 3+ branches), OR
- Composition (pass the consuming component as a slot)

Do NOT resolve by adding a global store.

---

## 6. Hooks are extracted, not invented

Custom hooks are extracted from existing code that has already been written twice. Do not write a custom hook on speculation that it'll be reused. Write the inline code; when you write it a second time, extract.

Exception: hooks that wrap an external concern (data fetching, animation libraries, RRULE parsing) can be written before the second use, because the wrapper IS the concern.

---

## 7. Colocate feature logic

For the composer:

```
components/social/composer/
  ComposerEditor.tsx           # the component
  ComposerEditor.test.tsx      # its tests, right next to it
  use-composer-editor.ts       # its hook, if extracted
```

Do not put composer tests in a sibling `__tests__/` folder. Do not put composer hooks in the global `hooks/` folder unless they're genuinely shared with code outside `components/social/composer/`.

For the framework templates, colocate the template + its internal helpers but NOT its consumers:

```
templates/
  T-LIST-STANDARD.tsx
  T-LIST-STANDARD.test.tsx
  _t-list-standard-filter-bar.tsx       # internal helper, leading underscore
```

---

## 8. Templates stay dumb

A template is a layout shell. It takes data via props and renders. It does NOT:

- Fetch data
- Mutate data
- Hold business logic
- Decide what to render based on user role (the consumer does that)

A template knows about layout, spacing, slots, and shells. Everything else is the consumer's problem.

If you find yourself adding `if (user.role === 'admin')` to a template, stop. That logic belongs in the consuming page.

---

## 9. No premature extraction

Three rules:

1. **The rule of three.** Code that appears twice can stay duplicated. Code that appears three times gets extracted.
2. **The rule of cohesion.** Two pieces of code that look similar but represent different concepts should NOT be extracted into a shared primitive. Different concepts that happen to render similarly will diverge later.
3. **The rule of friction.** If extracting requires more than 4 props or a `variant` prop with 5+ values, the abstraction is wrong. Either the use cases aren't actually the same, or the primitive is too generic.

---

## 10. Anti-patterns explicitly forbidden

The following patterns are forbidden in this codebase. The audit:static script will eventually catch them.

| Anti-pattern | Why forbidden | What to do instead |
|---|---|---|
| `<button className="...">` | We have a Button primitive. | `<Button variant="..." size="...">` |
| `<div className="rounded-lg border p-6">` | We have a Card primitive. | `<Card><CardContent>...</CardContent></Card>` |
| Raw `<table>` for tabular data | We have a DataTable primitive. | `<DataTable columns={} rows={}>` |
| `bg-emerald-*`, `text-emerald-*`, `bg-gray-*`, etc. | Hardcoded brand colours bypass the token system. | Semantic tokens: `bg-success`, `text-muted-foreground`. |
| `font-medium`, `font-semibold`, `font-bold` (outside primitives) | Bypasses typography tokens. | Use existing typography classes: `text-section-title`, `text-body-strong`. |
| Inline `<div className="min-h-[50vh] ... border-dashed ...">` | Bespoke empty-state. | `<EmptyState icon title body? cta? />` |
| `<div role="alert">` or `<div className="bg-red-50 ...">` | Bespoke alert. | `<Alert variant="destructive">` |
| `animate-pulse` outside the Skeleton primitive | Bypasses the loading-state contract. | `<Skeleton className="..." />` |
| `useState` to mirror server state | Causes drift; cache-invalidation bugs. | SWR / React Query owns server state. |
| `useEffect` to trigger fetch on mount | Race conditions; double-fetch in StrictMode. | SWR / React Query. |
| Global event listeners attached in client components | Memory leaks. | Use the existing `useEventListener` hook if it exists; otherwise add one in `hooks/`. |
| `setTimeout` for polling | Hard to test; flakey. | Client-side `useInterval` or SWR's `refreshInterval`. |
| Component file >500 lines | Hard to review; usually means multiple concerns. | Split. Internal helpers with leading underscore. |
| `as` prop for component polymorphism | Breaks TypeScript inference; rarely needed. | Render different components in different places. |
| Inline styles (`style={{ ... }}`) for static styling | Bypasses Tailwind/tokens. | Tailwind classes. Inline styles only for dynamic values (animation, computed position). |

---

## 11. When to extract a primitive vs when to inline

Extract a primitive when:

- The same visual + interaction pattern appears in 3+ places, AND
- Those places conceptually share the pattern (not coincidentally render similarly), AND
- The primitive's API can be expressed in ≤4 props (excluding `children` and `className`)

Inline (don't extract) when:

- The pattern appears 1–2 times
- The shared "pattern" is actually different concepts that happen to look alike
- The would-be primitive needs a `variant` prop with 5+ values

Borderline call: ask in `DECISION_TRAIL` instead of guessing. Steven reviews.

---

## 12. TypeScript discipline

- **No `any`.** Use `unknown` for genuinely unknown shapes; narrow with type guards.
- **No `@ts-ignore` or `@ts-expect-error`** without an attached comment explaining what's expected and a TODO with an issue number.
- **No type assertions (`as Foo`)** to bypass mismatches. If the types don't line up, fix the types.
- **Zod is the schema source of truth.** TypeScript types are derived via `z.infer<typeof schema>`, not hand-written.
- **`unknown` parameter shapes get parsed.** API handlers receive `unknown` request bodies and parse with Zod before using.

---

## 13. Server/client boundary

The boundary lives at the smallest possible scope. Examples:

```tsx
// app/(platform)/social/poster/page.tsx — SERVER component
import { CalendarShell } from 'components/social/dashboard/CalendarShell';
import { getPostsForCompany } from 'lib/social/queries';

export default async function Page() {
  const posts = await getPostsForCompany();
  return <CalendarShell initialPosts={posts} />;       // ← passes server data into client component
}
```

```tsx
// components/social/dashboard/CalendarShell.tsx — CLIENT component
'use client';
import { useState } from 'react';
// interactive calendar code here
```

NOT:

```tsx
// app/(platform)/social/poster/page.tsx — CLIENT component (BAD)
'use client';
import { useEffect, useState } from 'react';
export default function Page() {
  const [posts, setPosts] = useState([]);
  useEffect(() => { fetch('/api/...').then(setPosts) }, []);   // ❌ should be server-side
  return ...
}
```

The second pattern loses streaming, loses SSR caching, and introduces a fetch waterfall. Don't do it.

---

## 14. Error handling

- Every async function that can fail returns a typed result or throws a typed error. No silent failures.
- API handlers wrap their logic in try/catch and return the universal error shape from `API_CONTRACTS.md` §8.
- Client components surface errors via toast or inline Alert, never via `alert()` or `console.error()` alone.
- Never swallow an error in a `.catch(() => null)` unless you're explicitly defaulting to a fallback and the fallback is documented in a comment.

---

## 15. Logging

- Server-side: use the existing logger (find with `git grep -l 'logger\.info\|pino\|winston'`). Do NOT use `console.log` in server code.
- Client-side: only log in development. Wrap with `if (process.env.NODE_ENV === 'development')` if it must exist in production code paths.
- Sensitive data (auth tokens, draft content, user emails) is never logged.

---

## 16. When in doubt

Run `git log --oneline -- <path-near-where-youre-working>` and look at the last 10 commits in the same area. Match the convention. If the convention is itself inconsistent, match the most recent commit by Steven or another director.

If the area has no precedent, follow this file and add a `CLAUDE-ASSUMPTION:` comment.

These guardrails reduce entropy. Future maintenance gets cheaper every time you follow them.
