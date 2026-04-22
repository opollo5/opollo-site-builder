# M10 — Observability Activation (retroactive)

## Status

Shipped as a single PR (#85). Backfilled during M11-6 (audit close-out 2026-04-22) for pattern consistency. M11-1 extended the Langfuse coverage to the chat route (the only surface M10 missed).

## What it is

Wire four observability vendors (Sentry, Axiom, Langfuse, Upstash Redis) behind lazy singletons that no-op when their env vars are missing, so preview deployments without the full secret set still function. Add a self-probe route so on-call can verify every vendor is reachable in one curl. Add a runbook.

## Scope (shipped in M10)

- **Sentry.** `instrumentation.ts` / `instrumentation-client.ts` / `sentry.server.config.ts` / `sentry.edge.config.ts` + `withSentryConfig` wrap in `next.config.mjs`. Server + edge + client runtimes gated on `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`.
- **Axiom.** Additive transport in `lib/logger.ts`. stdout preserved; Axiom ingest is fire-and-forget with error swallow.
- **Langfuse.** `lib/langfuse.ts` singleton + `traceAnthropicCall()` span wrapper for non-streaming calls. `lib/anthropic-call.ts` (batch + regen workers + captioning) wraps every call; `span.fail()` on throw, `span.end()` with tokens on success. (M11-1 added `traceAnthropicStream()` for the chat route's streaming path.)
- **Upstash Redis.** `lib/redis.ts` singleton over `@upstash/redis`. Used by the self-probe for the round-trip check. Rate-limiting + prompt cache consumers are tracked as follow-ups.
- **Self-probe.** `POST /api/ops/self-probe` returns per-vendor `{ok, details|error}`. Auth: admin session OR constant-time-compared `OPOLLO_EMERGENCY_KEY`.
- **Runbook.** `docs/runbook/observability-verification.md` — curl command, expected green response, per-vendor troubleshooting, automation snippet.

## Out of scope (follow-ups)

- **Rate limiting on `/api/auth/*`, `/api/emergency`, `/login`.** Upstash is wired; the adapter in `lib/rate-limit.ts` is the next slice (tracked in BACKLOG).
- **Prompt versioning cutover.** `docs/PROMPT_VERSIONING.md` + `lib/prompts/vN/` structure; Langfuse trace-id threading into `generation_events.anthropic_response_received`.
- **Axiom saved searches + alerts.** Operator-facing dashboard work; code is ingest-ready.
- **Chat route span coverage** — M10 missed it because `client.messages.stream(...)` uses a different shape than `messages.create(...)`. M11-1 closed this gap with `traceAnthropicStream()`.

## Env vars required (all optional, no-op when missing)

`SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `NEXT_PUBLIC_SENTRY_DSN`, `AXIOM_TOKEN`, `AXIOM_DATASET`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_HOST`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `OPOLLO_EMERGENCY_KEY`.

Provisioned in Vercel on 2026-04-22.

## Risks identified and mitigated

1. **Vendor SDK throws during cold start and breaks every request.** → Every client is a lazy singleton constructed on first use inside a try/catch. If construction throws, the handle falls back to a no-op. Tests: `lib/__tests__/langfuse.test.ts` + `logger.test.ts` cover the no-op path.

2. **Vendor ingest is slow and regresses user-facing latency.** → Every write is fire-and-forget. The `ingest()` / `trace()` calls return promises we don't await. Errors on those promises are caught and never bubble up.

3. **Vendor envs partially configured in a preview deployment.** → Missing env → client returns null → wrapper returns a no-op handle. Caller code stays identical. Tests: `__resetClientForTests` helpers cover the un-configured path.

4. **`OPOLLO_EMERGENCY_KEY` brute force.** → Constant-time compare + 32-char length floor. Self-probe returns a generic 401 on mismatch.

5. **Axiom ingest spam from debug logs.** → `LOG_LEVEL` gating is early in `emit()`; below-threshold calls never build the record.

6. **Langfuse span leaks the Anthropic response body.** → `traceAnthropicCall` passes only token counts + cost + response_id. No message content goes to Langfuse by default (tokens-only mode). Chat-route `traceAnthropicStream` added in M11-1 follows the same discipline.

7. **Self-probe authz bypass.** → Two-path auth: admin session OR constant-time-compared emergency key. No third fallback.

8. **Sentry dedupe at the edge blows out the quota.** → Sentry config sets `tracesSampleRate` to a modest default; errors go through at 100% but traces are sampled.

9. **Logger's Axiom transport silently drops events.** → Transport errors log `axiom_ingest_failed` to stderr without recursing into the logger. If the sink is broken, the on-call sees it immediately.

10. **Vendor-SDK dep update breaks the build.** → Dependabot groups minor/patch updates; major bumps ship as separate PRs. CI catches breakage before merge.

## Shipped as a single PR

M10 was not sub-sliced because the vendors don't depend on each other and the self-probe is easier to review with all four vendors + the runbook in one place. Single PR #85.

## Tests

- `lib/__tests__/logger.test.ts` — JSON shape, sanitisation, level gating.
- `lib/__tests__/langfuse.test.ts` (added in M11-1) — no-op behaviour of both `traceAnthropicCall` and `traceAnthropicStream`.
- `logger.test.ts` covers stdout; the Axiom transport path is called out as a BACKLOG follow-up (lower priority than chat-route coverage).
- Self-probe route test is a BACKLOG follow-up per the audit ranking.

## Relationship to later milestones

- M11-1 extends Langfuse to the chat streaming path via `traceAnthropicStream`, closes the last coverage gap and corrects the BACKLOG "wraps every call" overstatement.
- M11-3 extends `/api/health` to flag stuck budget-reset cron rows, leaning on the same structured-logger + JSON-envelope discipline.
- Rate limiting, prompt versioning, and Axiom dashboard wiring are follow-ups on the M10 foundation.
