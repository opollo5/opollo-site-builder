# Error Reporting — Phase 2 Design

_Generated: 2026-05-10_

---

## Integration architecture

Three options were considered:

### Option A — Wrap each call site individually
Modify every `toast.error()`, `<Alert>`, and `<ErrorFallback>` call site to pass an `ErrorContext` object and include the report button.

- Pros: maximally explicit; no surprise coupling.
- Cons: 17+ toast sites, 12+ Alert sites, 89 inline-text sites = ~120 touch-points. High noise, high merge conflict risk.

### Option B — Global error event bus (publish/subscribe)
All error surfaces publish to a singleton bus; the bus renders a floating "Report" button for the most recent error.

- Pros: one capture point.
- Cons: requires refactoring every error surface to publish through it (the same 120 touch-points, now restructured). Does not naturally associate the button with its error visually. Invasive.

### Option C — Surface-type wrappers (recommended)

There are only **4 distinct error surface types** (toast, Alert, ErrorFallback, app/error.tsx). Each type is wrapped once at the component level. Call sites that want reporting opt in by supplying a `reportContext` prop. Inline `text-destructive` field-validation messages are excluded — those are expected validation feedback, not reportable bugs.

- **Toast** — Sonner supports an `action` prop on each toast. A thin `reportableToast` helper wraps `toast.error()` and adds the "Report to admin" action when the flag is on and a `reportContext` is provided.
- **`<Alert variant="destructive">`** — augmented with an optional `reportContext?: ErrorContext` prop; when present, renders `<ErrorReportButton>` beneath the alert body.
- **`<ErrorFallback>`** — same `reportContext` prop pattern.
- **`app/error.tsx`** — direct inclusion of `<ErrorReportButton>` with the error and component stack.

Touch-point count: **4 component-level changes** + opt-in wiring at the call site. Phase 3 wires every existing call site that carries a non-validation error.

**Inline `text-destructive` (field-level validation)** — excluded. These are user-correctable form validation states, not application bugs. Adding report buttons to field errors would be UX noise and collect useless reports.

---

## `ErrorReportButton` component

```ts
interface ErrorReportButtonProps {
  context: ErrorContext;      // the error + optional state slice
  user?: { id: string; email: string; role: string } | null;
  className?: string;
}
```

- Small, outlined, secondary styling: `variant="outline" size="sm"`.
- Label: **"Report to admin"** with `NavIcon name="bug"`.
- Only renders when `isErrorReportingEnabled()` returns true.
- On click → opens `ErrorReportModal`.

---

## `useErrorContext()` / context assembly

No hook needed. Context is assembled at click time (not continuously) by `assembleErrorReport(context, userDescription)` in `lib/error-reporting/context-collector.ts`. This avoids the overhead of continuously tracking context in a React context — the report is assembled once when the user clicks Send.

---

## Breadcrumb buffer

Singleton module: `components/error-reporting/breadcrumb-buffer.ts`

- **Lifecycle:** initialized by `<BreadcrumbProvider>` on first mount; cleared on logout (the `SessionExpiryWarning` component already fires on session expiry; the buffer exports `clearBreadcrumbs()` which `BreadcrumbProvider` calls on unmount).
- **Storage:** module-level array (in-memory, single tab, no cross-tab sync).
- **Ring buffer:** max 200 entries; oldest evicted when full.
- **Time window:** entries older than 5 minutes are filtered out at read time.
- **Instrumentation:** `BreadcrumbProvider` wires four listeners:
  - `document` click → element selector + text label (never values)
  - pathname change (`usePathname()` effect) → route entry
  - `window.fetch` proxy → method, URL, status, duration (no bodies)
  - `document` submit → form element selector + field names (never values)
  - `console.error` / `console.warn` monkey-patch → message string (truncated 500 chars)

---

## Backend endpoint shape

```
POST /api/internal/error-reports
Auth: any authenticated user (super_admin | admin | user)
Rate: 5 requests per user per 5 minutes (new "error_report" limiter bucket)
Body: { payload: ErrorReport }
Response: { ok: true, data: { report_id: string } } | { ok: false, error: {...} }
```

---

## `error_reports` table schema

```sql
CREATE TABLE error_reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  payload      jsonb NOT NULL,
  mail_status  text NOT NULL DEFAULT 'pending'
                    CHECK (mail_status IN ('pending', 'sent', 'failed')),
  mail_error   text,
  mail_sent_at timestamptz
);
```

RLS:
- INSERT: authenticated users can insert rows where `user_id = auth.uid()`.
- SELECT: `super_admin` role only (via `opollo_users` join).
- No UPDATE/DELETE from client.

---

## Mail provider

SendGrid — already wired via `lib/email/sendgrid.ts`. No new dependency. Recipient from `ERROR_REPORT_RECIPIENT` env var.

---

## New dependencies

| Dependency | Purpose | Status |
|---|---|---|
| `source-map` | Server-side stack frame resolution | Not added — see §Source maps below |
| Luhn validator | Credit card scrubbing | Implemented inline (15 lines, no package) |

**Source maps decision:** Source maps are uploaded to Sentry (not publicly accessible). The backend cannot access Sentry's source-map resolution API without a separate integration that is out of scope. The email will include the raw stack trace plus the Sentry release tag (`VERCEL_GIT_COMMIT_SHA`) so the developer can look up the Sentry event directly. This is noted in the "Brief for the next engineer" email section.
