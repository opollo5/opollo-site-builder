# Observability + security contract

> Moved from `CLAUDE.md` 2026-05-09 as part of the harness restructure.
> Source: pre-restructure CLAUDE.md §"Observability + security contract".

Every change has to honour the following invariants. They landed with the
security-observability-baseline sub-PR and fail-fast CI is how they stay true.

- **Request IDs:** every HTTP response carries `x-request-id`. Middleware
  propagates a well-formed incoming UUID; otherwise it mints a fresh UUIDv4.
  Don't log, print, or return "unknown" — the logger reads it from
  AsyncLocalStorage (`lib/request-context.ts`) automatically.
- **Structured logging:** use `import { logger } from "@/lib/logger"`.
  Never `console.log` in production paths. `logger.{debug,info,warn,error}`
  emits one JSON line per call, pulls context fields from
  AsyncLocalStorage, and sanitises Error / bigint / deep objects. When
  Axiom provisioning lands, the transport swap is one-file.
- **Health endpoint:** `/api/health` is the liveness/readiness contract.
  Add checks for any new hard dependency (e.g. Redis when rate limiting
  is wired). 200 = all green, 503 = degraded.
- **Security headers:** `lib/security-headers.ts` is the single source
  of truth. X-Frame-Options, X-Content-Type-Options, Referrer-Policy,
  Permissions-Policy, HSTS, and CSP (report-only) are applied to every
  response. If you need to relax a header for a single route, document
  *why* in a comment next to the override.
- **Supply-chain scans:** CodeQL, Dependabot, and gitleaks run on every
  push + PR. New dependencies must clear CodeQL; leaked-secret matches
  block merge. If a fixture legitimately matches a gitleaks rule, add
  it to `.gitleaks.toml` with a justification comment.
- **Env provisioning:** anything that reaches an external service must
  degrade gracefully when its secret is unset (Sentry no-op without DSN,
  in-memory logger without Axiom token, etc.). Hard-requiring an env
  var at cold-start is reserved for secrets that are operationally
  guaranteed (Supabase URL, service role key).
- **Transactional email** ships through `lib/email/sendgrid.ts` and
  `lib/email/templates/base.ts` only. Direct `@sendgrid/mail` imports
  outside those two files are a code-review block. Every send writes
  a row to `email_log` (success or failure). Required env vars:
  `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, `SENDGRID_FROM_NAME`.
  Smoke-test the wrapper from prod with
  `npx tsx scripts/send-test-email.ts <to-email>`.
