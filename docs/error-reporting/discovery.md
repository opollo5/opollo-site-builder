# Error Reporting — Phase 1 Discovery

_Generated: 2026-05-10_

---

## 1. Frontend Stack

| Dimension | Detail |
|---|---|
| Framework | Next.js 14.2.15 (App Router, TypeScript) |
| React | 18.3.1 |
| TypeScript | 5.6.2, `strict: true`, `noEmit: true`, `isolatedModules: true` |
| State management | Context API only (`components/design-system-context.tsx`). No Redux, Zustand, Jotai, Recoil. |
| Styling | Tailwind CSS 3.4.13 + class-variance-authority (CVA) + shadcn/ui primitives |
| Notifications | Sonner 2.0.7 (`components/ui/toaster.tsx`) |
| Router | Next.js App Router — `useRouter()`, `usePathname()`, `useSearchParams()` from `"next/navigation"` |
| Build tooling | Next.js webpack pipeline; `npm run analyze` enables bundle analyzer (`ANALYZE=true`) |
| TS target | ES2022 |

---

## 2. Every Error Surface in the UI

### 2a. Toasts — Sonner (`toast.error()`, `toast.warning()`)

**Mount point:** `app/(platform)/layout.tsx:81` renders `<Toaster />`.  
**Component:** `components/ui/toaster.tsx` — wraps `<SonnerToaster position="top-right" richColors closeButton duration={4000} />`.

Sonner is imported in these files:

| File | Error-toast call sites |
|---|---|
| `components/MoodBoardClient.tsx` | `toast.error(...)` |
| `components/BulkUploadButton.tsx` | `toast.error(...)`, `toast.warning(...)` |
| `components/admin/internal/ExampleTablesClient.tsx` | `toast.error(...)` |
| `components/UserStatusActionCell.tsx` | `toast.error(...)` |
| `components/UserActionsMenu.tsx` | `toast.error(...)` |
| `components/UserRoleActionCell.tsx` | `toast.error(...)` |
| `components/ToneOfVoiceInputs.tsx` | `toast.error(...)` |
| `components/TrustedDevicesList.tsx` | `toast.error(...)` |
| `components/SiteActionsMenu.tsx` | `toast.error(...)` |
| `components/PendingInvitesTable.tsx` | `toast.error(...)` |
| `components/DesignSystemSettingsClient.tsx` | `toast.error(...)` |
| `components/ConceptRefinementView.tsx` | `toast.error(...)` |
| `lib/toast-success.ts` | (success helper only; re-exported) |
| `components/ChangeUserRoleModal.tsx` | `toast.error(...)` |
| `components/SetupWizard.tsx` | `toast.error(...)` |
| `components/DesignDirectionInputs.tsx` | `toast.error(...)` |
| `components/SessionExpiryWarning.tsx` | `toast.error(...)` |

> Total: 17 files emit error/warning toasts directly. This is the **primary transient error surface**.

### 2b. `<Alert variant="destructive">` — Persistent banners

**Component:** `components/ui/alert.tsx` — CVA-driven, `role="alert"` for destructive variant.

Used in:

| File | `data-testid` |
|---|---|
| `components/AcceptInviteForm.tsx` | `accept-invite-error` |
| `components/LoginForm.tsx` | — |
| `components/SiteCreateForm.tsx` | `site-create-error` |
| `components/EmailTestForm.tsx` | `email-test-error` |
| `components/CheckEmailPolling.tsx` | — (×2) |
| `components/ApproveCompleteHere.tsx` | `approve-here-error` |
| `components/BlogPostComposer.tsx` | `post-form-error-banner` |
| `components/BriefReviewClient.tsx` | — |
| `components/BriefRunClient.tsx` | — |
| `components/AppearancePanelClient.tsx` | — |
| `components/PostDetailClient.tsx` | — |
| `components/PlatformAcceptInviteForm.tsx` | `platform-accept-invite-error` |

### 2c. `<ErrorFallback>` — Full-bleed error cards

**Component:** `components/ErrorFallback.tsx` — bordered card with warning icon, title, description, action button, "Contact support" link. `role="alert"`, `data-testid="error-fallback"`.

Used in:
- `components/AppearancePanelClient.tsx`

This is the **most prominent persistent error surface** — takes up substantial layout space and is meant to replace raw error codes in the UI.

### 2d. Inline `text-destructive` / `role="alert"` messages

Approximately **89 component files** render inline destructive messages. Highest-traffic instances:

| File | Pattern |
|---|---|
| `components/composer/post-composer-modal.tsx` | `<span className="text-xs text-destructive">Save failed — retrying</span>` |
| `components/composer/image-upload-zone.tsx` | 3× `<p className="text-destructive">` |
| `components/composer/ai-assistant-panel.tsx` | `<p className="mt-3 text-xs text-destructive">{errorMessage}</p>` |
| `components/composer/profile-selector.tsx` | `<p className="text-xs text-destructive">{error}</p>` |
| `components/AiPrefillModal.tsx` | `<p className="text-sm text-destructive" role="alert" data-testid="ai-prefill-error">` |
| `components/admin/ImageMetadataJobTrigger.tsx` | `<p className="text-xs text-destructive">{error}</p>` |

### 2e. `app/error.tsx` — Global React error boundary

`app/error.tsx` — `"use client"` boundary that Next.js activates on any unhandled React render error. Renders a centered "Something went wrong" page with a "Try again" button. Contains a `useEffect(,[error])` that is deliberately empty ("Errors are already captured by Sentry via instrumentation.ts").  
**No "Report this issue" affordance today.**

### 2f. Status pills — Job/brief failure states

`components/ui/status-pill.tsx` — renders `brief_failed_parse`, `run_failed`, `page_failed`, `site_removed` states (destructive color tokens).

---

## 3. Where Errors Originate

### 3a. API routes — standardised HTTP error helpers

All 205 route handlers (`app/api/**`) use helpers from `lib/http.ts`:

```ts
validationError()  → 400 VALIDATION_FAILED
forbidden()        → 403 FORBIDDEN
notFound()         → 404 NOT_FOUND
conflict()         → 409 domain-specific codes
internalError()    → 500 INTERNAL_ERROR
routeError()       → code→status mapping
```

Every catch block calls `logger.error()` or `logger.warn()` before returning the error response.

### 3b. No global client-side error bus

There is no `window.onerror` handler, no `unhandledrejection` listener, and no global client-side fetch wrapper. Error state is **local to each component** — each component has its own `useState<string | null>("error")` pattern, catches fetch failures inline, and calls `toast.error()` or sets state for `<Alert>` / `<ErrorFallback>`.

This is the key architectural observation: **there is no central point where all errors flow through.** The report button will need to meet errors at the surface rather than intercept them upstream.

### 3c. Next.js `app/error.tsx`

Catches unhandled React render exceptions. Does not emit to any custom channel — relies on Sentry via `instrumentation.ts`.

### 3d. Middleware (`middleware.ts`)

Edge runtime. Unauthenticated → `unauthenticatedResponse()` (401 JSON / redirect to `/login`). Auth error → `authErrorResponse()` (500 JSON / redirect to `/auth-error`). Both logged to Sentry automatically.

---

## 4. Existing Telemetry

### Sentry (active, partial configuration)

| Item | Value |
|---|---|
| Package | `@sentry/nextjs` 10.51.0 |
| Init | `sentry.server.config.ts` (Node), `sentry.edge.config.ts` (Edge), gated on `SENTRY_DSN` |
| Source map upload | `hideSourceMaps: true` in `next.config.mjs`; uploaded to Sentry when `SENTRY_AUTH_TOKEN` is set |
| Trace sample rate | 0.1 (10%) |
| Release tagging | `VERCEL_GIT_COMMIT_SHA` |
| Environment | `VERCEL_ENV ?? NODE_ENV` |
| Explicit capture | `app/api/ops/self-probe/route.ts` calls `Sentry.captureException()` |

Sentry is the **canonical exception store** for unhandled render errors and API errors that throw to the framework level. It is **not** used for handled errors surfaced as toasts (those are swallowed in catch blocks).

### Axiom (optional, structured log shipping)

| Item | Value |
|---|---|
| Package | `@axiomhq/js` |
| Integration | `lib/logger.ts` — fire-and-forget `ax.ingest()` alongside stdout JSON |
| Env vars | `AXIOM_TOKEN`, `AXIOM_DATASET` (both required; no-op if either missing) |
| Content | Every `logger.info/warn/error()` call — includes `request_id`, `job_id`, `slot_id`, `user_id` from AsyncLocalStorage |

Axiom provides **long-retention queryable logs** correlated by `request_id`. This is the best available server-side log lookup surface for the Phase 6 server enrichment step.

### Langfuse (optional, AI observability)

`langfuse` 3.38.20 — observability for Anthropic calls. Not relevant to error reporting.

---

## 5. Backend Stack & Mail Setup

### Backend

Next.js API routes (App Router, Node.js runtime). No standalone server. Supabase for DB + Auth. QStash for async jobs. Upstash Redis for rate limiting.

### Mail provider: SendGrid (fully wired)

| Item | Value |
|---|---|
| Package | `@sendgrid/mail` 8.1.6 |
| Wrapper | `lib/email/sendgrid.ts` (`server-only`) |
| Interface | `sendEmail({ to, subject, html, text, replyTo? }): Promise<SendEmailResult>` |
| Retry | One retry on 5xx with 250ms backoff; 4xx surfaces immediately |
| Audit | Every call (success and failure) written to `email_log` table before returning |
| Key | `SENDGRID_API_KEY` (throws `SENDGRID_UNCONFIGURED` if unset) |
| From | `SENDGRID_FROM_EMAIL`, `SENDGRID_FROM_NAME` (defaults to "Opollo Site Builder") |

**The mailer is production-ready.** No new mail dependency is needed — Phase 6 can call `sendEmail()` directly.

### Existing API route groups (abbreviated)

`/api/account`, `/api/admin`, `/api/approve`, `/api/auth`, `/api/briefs`, `/api/chat`, `/api/cron`, `/api/design-systems`, `/api/emergency`, `/api/health`, `/api/images`, `/api/ops`, `/api/optimiser`, `/api/platform`, `/api/sites`, `/api/tools`, `/api/webhooks`

---

## 6. User / Session Model

### Session user type (`lib/auth.ts`)

```ts
export type Role = "super_admin" | "admin" | "user";

export type SessionUser = {
  id: string;
  email: string;
  role: Role;
};
```

### How the current user is read

**Server-side (route handlers, server components):**  
`lib/auth.ts` → `getCurrentUser(supabase)` calls `supabase.auth.getUser()` (server-verified against GoTrue, never `getSession()` which would only decode the cookie locally).

**Client-side:**  
No dedicated `useUser()` hook. Components either receive user as a prop from a server parent, or make an API call. No global client-side auth context exposed.

### Organisation / workspace

`platform_companies` table. A user can belong to one company. Company id is available via DB join on `opollo_users`, not directly in the JWT.

### Session ID

No explicit session table. The Supabase JWT (`sb-*-auth-token` cookie) is the session. The **request id** (`x-request-id` header, UUID injected by `middleware.ts`) is the per-request correlation handle, not a per-session one. There is no persistent session UUID available on the client.

---

## 7. Routing Model

### Reading the current route

- **Client components:** `usePathname()` from `"next/navigation"` (stable, renders current pathname)
- **Server components:** `headers().get("x-pathname")` (set by middleware)

### Navigation history

**No history tracking exists today.** `useRouter()` from `"next/navigation"` provides `router.push()` / `router.replace()` / `router.back()` / `router.forward()` but does not expose a history array. The browser's native History API holds the stack, but it is not observable from React.

The breadcrumb buffer (Phase 4) will need to instrument `usePathname()` changes (via a `useEffect` watching pathname) to build the route history list from scratch.

---

## 8. Source Maps

| Item | Detail |
|---|---|
| Public exposure | `hideSourceMaps: true` in `next.config.mjs` — maps are **not publicly served** |
| Upload | `withSentryConfig()` in `next.config.mjs` uploads to Sentry when `SENTRY_AUTH_TOKEN` is set during build |
| Sentry env vars | `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` |
| Client-side availability | None — source maps cannot be resolved in the browser |
| Backend access | Maps are accessible **to Sentry** but not directly to a custom API route. The backend cannot call Sentry's source-map API at runtime without a separate integration. |

**Implication for Phase 6:** The raw stack trace should be sent in the report. Two options for server-side resolution:
1. **Sentry lookup:** Use the Sentry API to look up the pre-uploaded mapped frames by release + stack frame (requires `SENTRY_AUTH_TOKEN` and Sentry API integration).
2. **Local map files:** The build artifacts on Vercel are not accessible post-deploy for custom code to parse.

**Recommended path (for Phase 2 design):** Send the raw stack in the email body, note the Sentry release tag (`VERCEL_GIT_COMMIT_SHA`) alongside it, and provide a direct Sentry link to the event if `SENTRY_DSN` is set. Full source-map resolution is out of scope for Phase 6 unless Sentry lookup is included in the design.

---

## 9. Server-Side Error / Log Capture

### Request ID propagation

`middleware.ts` calls `ensureRequestId(req)` on every request, injecting a UUID as `x-request-id`. The `runWithContext({ request_id })` call from `lib/request-context.ts` stores it in AsyncLocalStorage. Every `logger.*()` call within that context automatically includes `request_id` in the JSON line.

**This is the primary correlation handle between a client-side error and its server-side log trail.**

### Structured logger (`lib/logger.ts`)

```ts
export const logger = { debug, info, warn, error };
// Record shape: { timestamp, level, msg, request_id?, job_id?, slot_id?, user_id?, ...fields }
```

Outputs JSON-per-line to stdout/stderr. Additionally fires `axiomClient().ingest()` async when `AXIOM_TOKEN` + `AXIOM_DATASET` are set.

### Axiom query (for Phase 6 server enrichment)

If `AXIOM_TOKEN` + `AXIOM_DATASET` are set, the backend can query Axiom's API for recent log lines filtered by `request_id` or `user_id`. This is the recommended path for server-side log lookup in Phase 6.

Fallback: query Vercel's log drain API if configured (not confirmed in scope).

### DB error capture

Every Supabase operation checks `.error` and calls `logger.error()`. The DB error message and Postgres SQLSTATE code are included in the log line's `supabase_error` field. There is no separate `db_errors` table — DB errors are captured in structured logs only.

---

## 10. Feature Flag Pattern

The codebase has a well-documented feature flag pattern (`docs/patterns/feature-flagged-rollout.md`):

- **Env-var flag** — `process.env.FEATURE_<NAME>` (or `process.env.OPOLLO_<NAME>`)
- **Reader helper** — single function, single `=== "true" || === "1"` check
- **Kill switch** — DB-backed `opollo_config` row for break-glass without redeploy

The `OPOLLO_ERROR_REPORTING_ENABLED` flag should follow this pattern:

```ts
// lib/error-reporting-flag.ts
export function isErrorReportingEnabled(): boolean {
  const v = process.env.OPOLLO_ERROR_REPORTING_ENABLED;
  return v === "true" || v === "1";
}
```

No kill switch needed (the feature has no catastrophic failure mode that requires redeploy-free disabling).

---

## Summary of Findings

| Area | Finding |
|---|---|
| **Error surfaces** | 4 distinct types: toast (Sonner), Alert banner, ErrorFallback card, app/error.tsx boundary. ~89 components render inline destructive text. No single central channel. |
| **Error origin** | No global client-side error bus. Each component catches and surfaces errors independently. |
| **Telemetry** | Sentry for unhandled exceptions; Axiom for structured log shipping; no client-side breadcrumb tracking today. |
| **Mail** | SendGrid fully wired (`lib/email/sendgrid.ts`). Ready to use — no new dependency needed. |
| **User model** | `SessionUser { id, email, role }`. Company id requires a DB join. No client-side auth context hook. |
| **Session ID** | No persistent session ID. Request ID (`x-request-id`) is the per-request correlation handle. |
| **Route history** | Not tracked. Must be built fresh in the breadcrumb buffer using `usePathname()`. |
| **Source maps** | Hidden from public; uploaded to Sentry. Backend cannot resolve maps at runtime without Sentry API integration. Recommended: send raw stack + Sentry release tag. |
| **Feature flags** | Well-established pattern in `docs/patterns/feature-flagged-rollout.md`. Use `OPOLLO_ERROR_REPORTING_ENABLED`. |
| **Request tracing** | `x-request-id` propagated end-to-end. Axiom queryable by `request_id` if configured. |
