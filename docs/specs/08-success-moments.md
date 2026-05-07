# Spec 08 — Success Moments

**Status:** shipped  
**Branch:** `feat/spec08-success-moments-v2`

---

## Problem

Long-running tasks (brief runs, batch jobs) complete silently. The operator refreshes, sees the terminal state, and has no moment of acknowledgement. There's no celebration on the first completion, and no clear call-to-action pointing them to what to do next.

---

## Goals

1. Primitive `SuccessMoment` block — reusable, above-the-fold success card rendered after a long-running task finishes.
2. First-time detection — first completion of a specific task gets a subtle confetti animation; subsequent visits see the static success card.
3. Reduced-motion safe — `prefers-reduced-motion: reduce` suppresses confetti entirely.
4. SSR safe — all browser APIs guarded by `typeof window !== "undefined"`.
5. Tier 1 adoption — brief run `succeeded` state in `BriefRunClient`.

---

## Locked decisions

### Confetti library: `canvas-confetti` (^1.9.4)

- Tiny bundle (~5 KB gzipped), no deps.
- `startVelocity: 25`, `particleCount: 30`, `spread: 40` — subtle, not carnival.
- Brand palette: `#00e5a0` (Opollo green), `#FF03A5` (Opollo pink), `#FFFFFF`.

### First-time key format

`opollo:first-time:<key>` in `localStorage`. Value is `"1"` once seen. Best-effort: `localStorage` errors (private browsing, quota) are swallowed — at worst the operator sees confetti twice on that device, which is harmless.

### Tier 1 surface: brief run succeeded

`BriefRunClient` shows `SuccessMoment` when `activeRun.status === "succeeded"`. First-time key: `brief-run:${brief.id}` — so the celebration fires once per brief, not per page-load.

CTAs on run completion:
- Primary: "View site pages" → `/admin/sites/${siteId}/pages`

---

## Files

| File | Purpose |
|------|---------|
| `components/ui/success-moment.tsx` | `SuccessMoment` primitive |
| `lib/celebrate.ts` | `celebrate()` confetti utility |
| `lib/hooks/use-first-time.ts` | `useFirstTime()` localStorage-backed first-visit hook |
| `lib/toast-success.ts` | `toastSuccess()` Tier-2 acknowledgement utility |
| `lib/__tests__/spec08-success-moment.test.ts` | Unit tests |

---

## Risks identified and mitigated

- **localStorage unavailable** — caught + swallowed in `useFirstTime`. Falls back to `isFirstTime = false` so no confetti runs in those environments (conservative).
- **SSR on server** — `typeof window === "undefined"` guard in both `celebrate()` and `useFirstTime()`. Hook returns `hydrated = false` until the effect runs client-side; `SuccessMoment` gates celebration on `hydrated = true`.
- **Accessibility** — `prefers-reduced-motion: reduce` suppresses confetti completely. The `SuccessMoment` block itself is always visible (it's not confetti-only feedback).
- **Re-render loop** — `markSeen` is wrapped in `useCallback(key)` so its reference is stable; `useEffect` depends on `isCelebrating`, not `markSeen`, to avoid the loop.

---

## Non-goals

- Tier 2 surfaces (batch job completion, WP publish) — follow-up after Tier 1 validates the pattern.
- Server-side first-time tracking — localStorage per-device is intentional; cross-device sync is over-engineered for an animation gate.
