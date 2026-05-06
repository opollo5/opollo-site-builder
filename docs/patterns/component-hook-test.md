# Pattern — Component and hook tests

## When to use it

Writing tests for React components or custom hooks that:
- Do NOT need a Supabase connection
- Render UI and check DOM state, user events, or accessibility
- Manage client-side state with `useState`/`useReducer`/`useCallback`
- Fire `fetch()` calls to internal API routes

Don't use for: server-side lib helpers (`lib/`) that talk to the DB directly — those go in `lib/__tests__/` under the standard Vitest config which runs with Supabase.

## Config

Component/hook tests run under a **separate Vitest config** (`vitest.components.config.ts`) so they never start the Supabase local stack:

```
npm run test:components          # run all component tests once
npm run test:components:watch    # interactive mode
```

The `test` job in `.github/workflows/ci.yml` starts Supabase; the `test-components` job does not. Both must pass on every PR.

## File location

```
components/__tests__/<ComponentName>.test.tsx    # component test
components/__tests__/<hookName>.test.tsx         # hook test
```

## Stubs available

The config automatically resolves the following without real implementations:

| Import path | Stub file |
|---|---|
| `server-only` | `lib/__tests__/_server-only-stub.ts` (no-op) |
| `next/navigation` | `components/__tests__/_next-navigation-stub.ts` |
| `next/font/google` | `components/__tests__/_next-font-stub.ts` |

For additional stubs, add them to `vitest.components.config.ts` → `resolve.alias`.

## Scaffolding

### Component test

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MyModal } from "@/components/MyModal";

describe("MyModal", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders nothing when open is false", () => {
    const { container } = render(<MyModal open={false} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("submits and calls onSuccess on API 200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ok: true, data: {} }),
    }));

    const onSuccess = vi.fn();
    render(<MyModal open={true} onClose={vi.fn()} onSuccess={onSuccess} />);
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
  });
});
```

### Hook test (`renderHook`)

```tsx
import { renderHook, act, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useMyHook } from "@/lib/use-my-hook";

describe("useMyHook", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("fetches on mount", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ value: 42 }),
    }));

    const { result } = renderHook(() => useMyHook("/api/test"));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(result.current.data).toEqual({ value: 42 });
  });
});
```

## Key rules

**Always call `vi.unstubAllGlobals()` in `afterEach`.** `vi.restoreAllMocks()` does NOT undo `vi.stubGlobal` — forgetting `unstubAllGlobals` leaks a `fetch` mock into the next test.

**Use `waitFor` for async state updates.** Testing Library's `waitFor` polls until the assertion passes; `await act(async () => {})` drains the micro-task queue for simpler cases.

**Don't use fake timers without understanding the hook's interval lifecycle.** Many hooks use `setInterval` for stale detection even when the primary interval is disabled. `vi.runAllTimersAsync()` can trigger infinite timer loops. Prefer real async timers (`intervalMs: 60_000`) combined with `waitFor`.

**Mock `fetch` with `vi.stubGlobal`, not `vi.spyOn(global, "fetch")`.** In jsdom, `fetch` is set on `globalThis` directly; `spyOn` doesn't work reliably.

## Reference implementations

- `components/__tests__/use-poll.test.tsx` — hook test: null-url guard, mount fetch, error state, `refresh()`, `enabled: false`.
- `components/__tests__/ConfirmActionModal.test.tsx` — component test: hidden/visible, Escape key, backdrop click, POST success/error, DELETE with searchParams, `extraContent` slot.
