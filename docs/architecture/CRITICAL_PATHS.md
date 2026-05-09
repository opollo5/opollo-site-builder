# Critical paths — full enumeration

> Created 2026-05-09 as part of the harness restructure.
>
> Companion to `CLAUDE.md` §"Critical paths". CLAUDE.md has the
> 7-row category table that's load-bearing for "does this PR need
> smoke?". This file is the row-by-row enumeration: file paths,
> what each route does, last-modified context.

A "critical path" is any route or surface where a regression
directly impacts user trust, billing, security, or data integrity.
Production smoke (Layer 7) MUST pass for changes touching these.

CLAUDE.md §"Hard floors per change-shape" gates merge on these.

## Auth

| Route | Purpose | Smoke-coverage status |
|---|---|---|
| `app/api/auth/login/route.ts` | Email + password sign-in | smoke-todo |
| `app/api/auth/callback/route.ts` | Supabase auth callback (magic link, OAuth) | smoke-todo |
| `app/api/auth/logout/route.ts` | Sign-out + session clear | smoke-todo |
| `app/api/auth/accept-invite/route.ts` | Token-bound invite acceptance | smoke-todo |
| `app/api/auth/forgot-password/route.ts` | Reset-link mint | smoke-todo |
| `app/api/auth/reset-password/route.ts` | Reset-link redemption | smoke-todo |
| `app/api/auth/approve-here/route.ts` | Magic-link operator approval | smoke-todo |
| `app/api/auth/challenge-status/route.ts` | 2FA challenge state | smoke-todo |
| `app/api/auth/ping/route.ts` | Session health probe | smoke-todo |
| `app/api/account/change-password/route.ts` | Authenticated password change | smoke-todo |
| `app/api/account/devices/[id]/route.ts` | Device session reveal / revoke | smoke-todo |
| `app/api/account/devices/sign-out-others/route.ts` | Mass-revoke all sessions except current | smoke-todo |
| `middleware.ts` | Session enforcement on every request | smoke-todo |

## Social — connect / publish

| Route | Purpose | Smoke-coverage status |
|---|---|---|
| `app/api/platform/social/connections/connect/route.ts` | Initiate bundle.social portal flow | smoke-todo |
| `app/api/platform/social/connections/callback/route.ts` | bundle.social OAuth callback (queryparam-trust risk pinned) | smoke-todo |
| `app/api/platform/social/connections/reconnect/route.ts` | Re-attach existing account | smoke-todo |
| `app/api/platform/social/connections/sync/route.ts` | Force-sync from bundle.social | smoke-todo |
| `app/api/platform/social/posts/[id]/schedule/route.ts` | Add a schedule entry | smoke-todo |
| `app/api/platform/social/posts/[id]/submit/route.ts` | Submit for approval | smoke-todo |
| `app/api/platform/social/posts/[id]/approve/route.ts` | Approver decision | smoke-todo |
| `app/api/platform/social/posts/[id]/publish-attempts/route.ts` | List publish attempts | smoke-todo |
| `app/api/platform/social/posts/[id]/recipients/route.ts` | Approver recipient management | smoke-todo |
| `app/api/webhooks/bundlesocial/route.ts` | Inbound bundle.social events (HMAC-verified) | smoke-todo |
| `app/api/webhooks/qstash/social-publish/route.ts` | QStash callback when schedule fires | smoke-todo |

## Multi-tenant boundaries

Anything under these prefixes that gates on `canDo(companyId, action)`
or RLS-enforced by `company_id`:

- `app/api/platform/*` — every customer-facing route
- `app/api/admin/sites/[id]/*` — site-scoped operations
- `app/api/admin/companies/*` — company creation / invitation / role
- `app/api/admin/users/*` — invite, role, revoke, reinstate
- `app/api/optimiser/clients/[id]/*` — optimiser-scoped tenant boundary

The cross-tenant test pattern is `seedTwoCompanies()` from
`lib/__tests__/_security-helpers.ts`.

## Billing

(none today — slot reserved for future. When billing lands, this section
gets routes for: subscription create / update / cancel, payment-method
add / remove, webhook receivers from the payment processor.)

## Encryption

| Code path | Why critical |
|---|---|
| `lib/encryption.ts` | AES-256-GCM wrapper used by `site_credentials` + `opt_client_credentials` |
| `lib/sanitize-html-fragment.ts` | XSS sanitiser for AI-generated HTML rendered via `dangerouslySetInnerHTML` |
| `lib/bundlesocial.ts` `verifyBundlesocialSignature` | HMAC-SHA256 verification with timing-safe compare |
| `lib/qstash.ts` `verifyQstashSignature` | Upstash JWT signature wrapper |
| `lib/security-headers.ts` | Single source of truth for response security headers |
| `lib/ssrf-guard.ts` | URL-fetch boundary guard |

## Data migrations

| Path | Why critical |
|---|---|
| `supabase/migrations/*.sql` | Append-only forward migrations; UNIQUE on numeric prefix enforced by `.github/workflows/ci.yml` migration-versions job |
| `supabase/rollbacks/*.sql` | Manual rollback ladders for forward migrations |
| `supabase/data-migrations/*.sql` | Data-only migrations (re-runnable / idempotent) per `docs/architecture/DATA_CONVENTIONS.md` |

## Brief generation hot path

| Route | Cost / correctness concern |
|---|---|
| `app/api/cron/process-brief-runner/route.ts` | Per-tick generation; budget gates fire here |
| `app/api/cron/process-batch/route.ts` | Batch worker; concurrency-tested in M3 |
| `app/api/briefs/[brief_id]/run/route.ts` | Operator-triggered start |
| `app/api/briefs/[brief_id]/commit/route.ts` | Optimistic-lock commit to WordPress |
| `app/api/briefs/[brief_id]/cancel/route.ts` | Mid-flight cancel (state-transition gates) |

## Smoke coverage status legend

- `smoke-todo` — route is critical but no smoke spec yet covers it.
  Tracked in `docs/test-coverage-roadmap.md` for backfill.
- `smoke-covered` — `e2e/smoke/*.spec.ts` exercises this route.

When a smoke spec lands, flip the row.
