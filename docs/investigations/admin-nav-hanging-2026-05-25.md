# Investigation — `networkidle` never settles on staging admin nav

**Date:** 2026-05-25
**Issue:** [#1049](https://github.com/opollo5/opollo-site-builder/issues/1049)
**Status:** Part B (spec migration in PR #1050) sufficient to unblock harness. Part A (root cause) documented here, fix deferred.

## What happened

After PR #1044 granted the UAT ghost user `opollo_users.role = 'admin'`, the admin nav rail rendered for the first time. The harness regressed from 22 → 13 passes. Every spec using `page.waitForLoadState('networkidle')` timed out at 45s.

## Evidence

### Playwright trace from the failing composer spec ([run #26378861696](https://github.com/opollo5/opollo-site-builder/actions/runs/26378861696))

Trace file: `test-results/uat/composer-P0-—-Social-compo-63cea-mposer-from-New-post-button-chromium/trace.zip`.

Parsed `0-trace.network`:
- **54 total requests captured**
- **0 pending requests** (all responded with completion times <650ms)
- Last captured event at **t=3058ms**
- Test ran for **45,000ms** (timeout)
- Gap of **~42 seconds** with zero captured HTTP traffic, yet `networkidle` never fired

Playwright's resource-snapshot trace events capture HTTP/XHR/fetch but **not WebSocket frames** (those are emitted as separate events that aren't in this trace's `.network` file).

### Bundled WebSocket clients in the deployed code

```
grep -rn "WebSocket\|new Pusher\|new Ably\|SSE\|EventSource" \
  --include="*.ts" --include="*.tsx" components/ app/ lib/
```

Returns **zero matches** in deployed code. So no first-party WebSocket clients are at fault.

### Third-party scripts loaded on every preview page

From the trace network log, all preview deployments load:
- `https://vercel.live/_next-live/feedback/feedback.js`
- `https://vercel.live/_next-live/feedback/feedback.html` (iframe; blocked by our CSP `frame-src 'none'`)
- `https://vercel.live/login/validate` (POST cross-origin → triggers an OPTIONS preflight to `/`)
- `https://opollo-site-builder-git-staging-opollo5.vercel.app/.well-known/vercel/jwe`

These complete in <600ms but Vercel Live's feedback widget is known to maintain a long-lived connection to `vercel.live` for live collaboration features. That connection appears to count against Playwright's `networkidle` heuristic.

### Vercel Live is preview-only

Vercel Live is automatically injected on **preview** deployments only. Production deployments do not load `vercel.live`. The UAT harness exclusively runs against the staging Preview deployment, so it always carries this widget.

## Why the issue surfaced only after admin role was granted

In the prior run (#26375514633, 22-pass), the UAT user had no admin role. The admin gate redirected `/admin/*` to `/login` before the page rendered. Composer/calendar specs were already exposed to the same Vercel Live widget but the spec count using `networkidle` was small enough that each individual test happened to settle within 45s.

After granting admin role:
- Admin nav surfaces 5+ additional `<Link prefetch>` targets (`/admin/users`, `/admin/sites`, `/admin/images`, etc.)
- Next.js prefetches all of them on page load (visible in trace at t=1886–2643ms — 9 RSC prefetches)
- The added prefetch volume coincidentally pushed the 500ms quiet-window probability past the failure threshold

In other words: granting admin didn't introduce the hanging connection — it surfaced the slack that always existed.

## Suspect ranking (final)

| Suspect | Status | Why |
|---|---|---|
| 1. Sentry session replay | **Ruled out** | `NEXT_PUBLIC_SENTRY_DSN` is unset in staging Vercel env; `instrumentation-client.ts:11` no-ops without it |
| 2. Supabase Realtime | **Ruled out** | `grep -rn "supabase.channel\|.realtime."` in deployed code = 0 matches |
| 3. Notification polling | **Ruled out** | `components/NotificationBell.tsx` uses `setInterval` (60s) but is exported and not imported anywhere — dead code |
| 4. Admin health streaming | **Ruled out** | `grep -rn "stream\|sse"` in `app/api/admin/` = 0 matches |
| 5. Bundle.social webhook status | **Ruled out** | No long-poll or WebSocket client in deployed code |
| 6. **Vercel Live (vercel.live)** | **Most likely** | Preview-only third-party script; trace shows the handshake fired and no other long-lived candidates exist |
| 7. Intercom / analytics widgets | **Ruled out** | No third-party scripts other than Vercel Live and Google Fonts in trace |

## Recommended fix (deferred to next session)

Two viable approaches — pick one:

### Option A: block `vercel.live` requests at the UAT Playwright config

```ts
// playwright.uat.config.ts
use: {
  // ...existing...
},
// Block Vercel Live preview tooling so it can't open hanging connections
// during automated runs. The widget is for human reviewers, not bots.
projects: [
  {
    name: "chromium",
    use: {
      ...devices["Desktop Chrome"],
      // Add per-test setup that blocks vercel.live
    },
  },
],
```

Implementation lives in a fixture / global-setup that calls `page.route('**/vercel.live/**', r => r.abort())`.

Pros: scoped to the UAT harness; doesn't change deployed bundle.
Cons: doesn't help if any real test relies on `waitForLoadState('load')` and the load-event observer also waits on Vercel Live.

### Option B: disable Vercel Toolbar on staging deployments

Vercel exposes `experimental.vercelToolbar: false` (Next.js) or a Vercel project setting "Disable Vercel Toolbar". This strips the feedback widget from preview deployments.

Pros: cleanest — removes the suspect entirely.
Cons: also removes the widget for human reviewers; team may rely on it.

## Why Part B alone was enough

The harness ships zero specs that rely on `waitForLoadState('networkidle')` (PR #1050 migrated all of them; Gate 9 in `button-migration-gates.yml` prevents re-introduction). The hanging WebSocket no longer matters to test outcomes.

Part A is therefore **good-to-have for hygiene** but **not required to unblock the harness**.

## Diagnostic spec for future regressions

`e2e/diagnostics/admin-nav-requests.spec.ts` captures every request, response, and WebSocket frame on `/admin/sites` for 20 seconds and writes the report to `test-results/diagnostics/admin-nav-requests.json`. Run with:

```
npx playwright test e2e/diagnostics/admin-nav-requests.spec.ts \
  --config playwright.uat.config.ts
```

Use this when investigating a future "networkidle never settles" or "page never reaches load" regression. The report identifies open WebSockets that Playwright's standard trace doesn't show.

## What the next session should decide

1. Run the diagnostic spec against staging — confirm whether Vercel Live opens a WebSocket.
2. If yes: pick Option A or Option B from Recommended fix.
3. If no (some other WebSocket source): the diagnostic report's `openWebsocketUrls` field tells you exactly what.

Until either happens, the harness is unblocked and the failing specs that remain (~12 of them) are real platform bugs (KF-1, KF-3, AI assist text-check, etc.).
