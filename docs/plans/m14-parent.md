# M14 — Auth Hardening (password reset + profile management)

## What it is

The admin-auth surface has gaps that became visible when `hi@opollo.com` got locked out with no recovery path. There is no "forgot password" flow, no logged-in "change password" surface, the Supabase auth redirect configuration points at `localhost:3000` in production email links, and there is no permanent operator tool to reset a password when Supabase's self-service email flow is unreachable or misconfigured. M14 closes those gaps.

M14-1 ships a single slice ahead of M12-2 / M13 / the rest of M14: a permanent, emergency-key-gated `/api/ops/reset-admin-password` endpoint that restores admin access when self-service recovery is not usable. M14-1 is the unblocker — it lets the locked-out admin regain access in ~30 seconds instead of waiting a week for the full reset flow. Every other M14 slice waits until M12 (briefs) and M13 (blog posts) land on main.

## Why a separate milestone

Auth-surface work is orthogonal to generation-engine work. It touches: `middleware.ts`, `lib/auth.ts`, `app/(auth)/*`, Supabase dashboard configuration, email templates, rate limiters on `login` / `auth_callback`. None of those files are touched by M12 or M13. Bundling an auth rewrite into either milestone would have mixed unrelated review concerns and forced an all-or-nothing merge on infra that already shipped a long time ago (M2) and is working for everyone who still remembers their password.

The milestone is also write-safety-critical on a different axis than M12: password writes, session revocation, and email-send rate limits are all places where a bug spills into an account-takeover or a denial-of-service. M14-1's scope is deliberately small — a single service-role write behind a constant-time-compared 32-char pre-shared key — precisely so the review surface matches the blast radius.

## Scope (shipped in M14)

- **M14-1 — permanent admin reset endpoint.** `POST /api/ops/reset-admin-password`, gated by `OPOLLO_EMERGENCY_KEY` (existing env var; same 32-char-minimum constant-time check as `/api/emergency`). Accepts `{ email, new_password }` in the JSON body. Uses `supabase.auth.admin.updateUserById` via the service-role client. Target user must exist in `opollo_users` with `role = 'admin'` — the endpoint refuses to reset operator/viewer passwords (emergency-key-compromise must not become full tenant takeover). Password strength minimum enforced: 12 characters. Every call — success or failure — is logged via the structured logger with `request_id`, `email`, `outcome`. Deliberately permanent, not a one-off script — the runbook treats it as an ops tool equivalent to `POST /api/emergency {"action":"revoke_user"}`. Rate limiting deferred (the constant-time key compare is the primary defense; add a `ops` limiter in a future slice if we see probe traffic).
- **M14-2 — Supabase auth redirect configuration.** Pinned by the current-production symptom: password-reset emails land with `localhost:3000` callback URLs instead of the production domain. Scope: (a) audit every Supabase auth client call in `lib/` (`resetPasswordForEmail`, `signInWithOtp`, `signUp`, `verifyOtp`) and ensure every `emailRedirectTo` / `redirectTo` reads from `NEXT_PUBLIC_SITE_URL` (or equivalent) rather than defaulting; (b) verify `NEXT_PUBLIC_SITE_URL` is set in the Vercel production environment (if missing, flag and halt); (c) output required Supabase dashboard settings as a runbook entry in `docs/RUNBOOK.md` — Site URL + Redirect URLs allowlist — with exact values and the dashboard navigation path. Dashboard changes cannot be applied via code, so the deliverable for the Supabase side is a runbook instruction + a verification checklist Steven runs through manually.
- **M14-3 — forgot password flow (end-user).** "Forgot password?" link on `/login` → `/auth/forgot-password` (email input, triggers `supabase.auth.resetPasswordForEmail` with the M14-2-fixed `redirectTo`, shows success copy with check-spam guidance) → reset-password email link → `/auth/reset-password` (handles Supabase recovery token, password + confirm form, calls `supabase.auth.updateUser`). Password strength requirements match M14-1's 12-char minimum, enforced client-side with live feedback. Expired / invalid token errors render as "Request a new link" CTA, not raw query-param error messages. Rate-limiter `login` bucket extended (or a sibling `password_reset` bucket added) — 5 requests per email per hour. Every reset event logged via structured logger.
- **M14-4 — account security page (logged-in password change).** `/account/security` accessible from the user menu (adds the menu entry if it doesn't exist). Current password + new password + confirm form. Flow: attempt a fresh `signInWithPassword` against the current password to verify; on success, call `supabase.auth.updateUser({ password: new_password })`; on mismatch, surface `INCORRECT_CURRENT_PASSWORD` cleanly. Same password strength rules as M14-1 / M14-3. Every successful change logged.
- **M14-5 — E2E + integration coverage.** Playwright specs for: (a) request reset → follow the email link (intercepted or via Supabase's test mode) → set new password → login with new password → assert the old password is rejected; (b) logged-in password change with incorrect current password → error, with correct current password → success, old password rejected after change; (c) expired-token and rate-limit-hit error surfaces. Uses the existing test-user pattern from `e2e/global-setup.ts` — no new harness. Do not skip because "auth is hard to test."
- **M14-6 — documentation.** `docs/AUTH.md` with a mermaid (or text) diagram showing every auth flow: signup (if applicable), login, forgot password, reset password, logged-in password change, admin emergency reset. Strike any outdated "auth complete" claims from `docs/BACKLOG.md` and the M2 parent plan. `docs/RUNBOOK.md` gains the M14-1 ops entry alongside the existing `/api/emergency` entries.

## Out of scope (tracked in BACKLOG.md)

- **Email verification on signup.** Signup is admin-invite-only today; no public signup path. Email verification belongs to the future public-signup milestone.
- **Multi-factor auth.** Not claimed anywhere today. Adding it requires TOTP UI + recovery codes + MFA-aware admin-gate logic. Its own milestone.
- **"Remember me" toggle.** Supabase's refresh-token rotation already persists sessions across browser closes; adding a "remember me" UI is purely cosmetic until we have a reason for short-lived sessions as the default.
- **Account deletion / GDPR-export.** No end-user surface yet; admin-invite-only + no end-user accounts means deletion is a back-office task. Ships when end-user accounts ship.
- **Session expiry UX.** When a session expires mid-workflow today, the middleware redirects to `/login` on the next request. A "your session expired — save your work" banner is a quality-of-life item, not a gap.
- **User invitation flow.** Invite flow exists (`app/api/admin/users/invite`) — not an M14 scope item; audit confirmed it already runs through the same Supabase auth primitives M14-2 will harden.

## Env vars required

None new. `OPOLLO_EMERGENCY_KEY` is already provisioned (documented in `.env.local.example`, used by `/api/emergency` and `/api/ops/self-probe`). M14-2 may surface `NEXT_PUBLIC_SITE_URL` as a missing-in-Vercel gap — if so, that is called out at M14-2 time and halts the slice until provisioned, per the CLAUDE.md "missing env var" rule.

## Sub-slice breakdown (6 PRs)

| Slice | Scope | Write-safety rating | Blocks on |
| --- | --- | --- | --- |
| **M14-1** | `POST /api/ops/reset-admin-password` endpoint + admin-role guard + 12-char password floor + structured logging + unit test with mocked supabase admin. Runbook entry. Ships ahead of M12-2 because `hi@opollo.com` is currently locked out. | Medium — single service-role write, emergency-key-gated, admin-only target. Constant-time key compare. Admin-role guard prevents scope creep on key compromise. | Nothing. |
| **M14-2** | Audit `emailRedirectTo` / `redirectTo` usage in `lib/` + every auth API route; wire everything to `NEXT_PUBLIC_SITE_URL`. Verify Vercel env. Document required Supabase dashboard Site URL + Redirect URLs allowlist values in runbook. | Low — pure configuration + docs. No new write paths. | M12 + M13 completion (per Steven's ordering call on 2026-04-23). |
| **M14-3** | `/auth/forgot-password` + `/auth/reset-password` pages. `supabase.auth.resetPasswordForEmail` + `supabase.auth.updateUser` wiring. Password strength enforcement. Rate-limiter bucket for password reset requests. Error-code → user-friendly message table. | Medium — triggers emails (side-effectful, externally billed by Supabase). Rate limiter prevents email flood. 12-char password minimum. | M14-2. |
| **M14-4** | `/account/security` page + user-menu entry. Current-password verification via fresh `signInWithPassword`. `supabase.auth.updateUser` for the new password. | Medium — password write. Current-password verification prevents CSRF-style password-change by a session hijacker. | M14-3 (shares password-strength component + error translations). |
| **M14-5** | Playwright E2E: forgot-password end-to-end, logged-in password change, expired-token + rate-limit error surfaces. | Low — E2E only. | M14-4. |
| **M14-6** | `docs/AUTH.md` with flow diagram. Backlog + M2-parent cleanup. Runbook consolidation. | Low — docs. | M14-5. |

**Execution order under the current ordering decision (2026-04-23):** M14-1 ships immediately, ahead of M12-2. M14-2 through M14-6 are parked until M12 (briefs, 5 remaining slices) and M13 (blog posts, 6 slices) land on main. When M13-6 merges, M14-2 picks up and the remaining slices run serial per the blocks-on table.

## Write-safety + audit contract

### Emergency-key endpoint concentration (M14-1)

`/api/ops/reset-admin-password` joins `/api/emergency` and `/api/ops/self-probe` as the third endpoint gated by `OPOLLO_EMERGENCY_KEY`. Concentration is deliberate — one secret, one rotation cadence, one audit surface. Every emergency-key endpoint uses the same `constantTimeEqual` helper, same 32-char minimum, same 503-when-unset shape; a future refactor promoting those into a shared `lib/emergency-auth.ts` is cheap once we have three callers with divergent behaviour. For M14-1 the helper is inlined (mirroring the self-probe pattern) to avoid a cross-slice refactor alongside a security-sensitive new endpoint.

### Admin-role target guard (M14-1)

The endpoint refuses to reset a user whose `opollo_users.role` is not `admin`. Why: emergency-key compromise with an open-target endpoint is "full tenant takeover" (attacker resets an operator's password, logs in as operator, creates batches, spends budget). Emergency-key compromise with the admin-only guard is "admin account takeover" — still bad, but it's the same blast radius as emergency-key compromise on `/api/emergency` (which can already kill-switch auth and revoke any user). The guard keeps the blast radius bounded to existing emergency-key scope. Test asserts a 403 when the target is `role='operator'` or `role='viewer'`.

### Password strength (M14-1 through M14-4)

12-character minimum, enforced identically across every password-setting surface (M14-1 server-side, M14-3 server + client, M14-4 server + client). A shared `lib/password-policy.ts` helper lands with M14-1 and is reused in every subsequent slice so the rule stays in one place. No complexity rules beyond length — length outperforms character-class rules at equivalent UX friction, and NIST SP 800-63B agrees.

### Structured logging (M14-1 through M14-4)

Every password-setting call logs via `logger.info` / `logger.warn` with `{ request_id, email, outcome }`. No logging of the password itself (not even a prefix). Failure cases log at `warn`, success at `info`. The `request_id` is already auto-populated by the observability middleware (`lib/request-context.ts`); callers don't thread it manually. This is the audit trail — M14-1 builds the habit that M14-3 / M14-4 reuse.

### Rate limiting (M14-1 skipped, M14-3 onwards)

M14-1 skips rate limiting because the endpoint's primary defense is a 32-char constant-time-compared key. A rate limiter on a key-gated endpoint is additive but not primary. M14-3 (forgot-password) does add rate limiting — its primary defense is the email address, which is cheap to brute — so it needs a sliding-window limiter keyed on `email`. 5 requests per email per hour matches the existing `login` / `auth_callback` cadence.

### Supabase dashboard drift (M14-2)

The Site URL + Redirect URLs allowlist live in the Supabase dashboard, not in code. They cannot be reviewed in a PR and cannot be covered by CI. M14-2's runbook entry is the only checkpoint — Steven applies the listed values manually and ticks the verification checklist. A future infra-as-code slice (Supabase CLI project config sync) would close this gap; not in M14 scope.

## Testing strategy

| Slice | Unit / integration | E2E |
| --- | --- | --- |
| M14-1 | Route handler test with mocked `supabase.auth.admin.updateUserById`. Asserts: 503 when key unset, 401 on wrong key, 400 on bad body (missing email, short password), 404 when target email not in `opollo_users`, 403 when target is non-admin, 200 on success, single admin-update call with expected args, structured log entries at info/warn. | Not required — no UI surface in M14-1. |
| M14-2 | Audit script asserts every `emailRedirectTo` call reads from a single helper (`lib/auth-redirect.ts`). Helper test asserts the helper returns `NEXT_PUBLIC_SITE_URL` when set and throws when unset. | Not required. |
| M14-3 | Route handler tests for forgot-password + reset-password with mocked Supabase. Password-policy helper test. Rate-limiter wiring test. | Forgot-password → email intercept → reset → login spec. |
| M14-4 | Route handler + current-password-verify test with mocked Supabase. | Logged-in password change spec. |
| M14-5 | — | Expired-token + rate-limited error surface specs. |
| M14-6 | — | — |

### Axe `auditA11y()`

Every new page M14-3 + M14-4 add goes through `auditA11y()` in its E2E spec per the CLAUDE.md E2E contract.

## Risks identified and mitigated

1. **Emergency-key compromise → reset any user's password.** → M14-1's admin-role guard bounds the target to `role='admin'` only. Blast radius identical to `/api/emergency`'s existing capability (kill-switch + revoke_user), not wider.

2. **Accidental `hi@opollo.com` password rewrite from a stale test.** → Unit tests mock `supabase.auth.admin.updateUserById`; no integration test writes to a real auth user. E2E for M14-5 uses the `e2e/global-setup.ts` test-user pattern, which is scoped to `test-admin-*@opollo.test` — never touches the production admin account.

3. **Password logged in plain text.** → Audit of every log call in the M14 surface confirms only `{ request_id, email, outcome }` are emitted. Unit test asserts no logger invocation receives the password field.

4. **Emergency key reused across environments.** → `.env.local.example` already documents `OPOLLO_EMERGENCY_KEY` with a 32-char minimum; Vercel production has a different value than local dev. M14-1 does not change that contract. Runbook entry reminds the operator to rotate the key after use.

5. **Email redirect still points to localhost after M14-2.** → M14-2's audit script fails CI if any auth call uses a hardcoded URL. The Supabase dashboard side is not covered by CI; runbook verification checklist is the checkpoint, with a note to Steven to tick it off after dashboard changes.

6. **Rate limiter bypassed by rotating email.** → M14-3's limiter is keyed on email, not IP, so rotating email is exactly the attack it doesn't stop — but Supabase's own abuse detection covers the per-sender-IP case. The limiter exists to stop a single-email flood (user mashing the button, or a single compromised account being used to email-bomb a specific user).

7. **Expired-token UX leaks raw Supabase error codes.** → M14-3's error table maps every Supabase auth error code to a user-friendly message. Unit test asserts no raw `supabase_*` string reaches the UI.

8. **Current-password check (M14-4) itself a DoS vector.** → `signInWithPassword` honours Supabase's built-in rate limits; a flood of bad current-password attempts from one session gets 429'd by Supabase before the Opollo limiter bites. M14-4 surfaces the 429 as the existing `RATE_LIMITED` envelope.

9. **Admin locked out again before M14-3 ships.** → M14-1 is the permanent safety net. Runbook entry in M14-1's PR establishes the recovery procedure independent of the rest of M14.

10. **Silent dashboard drift between environments.** → Deliberately deferred. M14-2's runbook entry + the per-env emergency key are the best we can do without an infra-as-code slice. Tracked in BACKLOG.

## Relationship to existing patterns

- **`/api/emergency` (M2c-3)** — the template for M14-1's auth shape (constant-time-compared pre-shared key, 503-when-unset, structured logging). M14-1 deliberately does NOT merge into `/api/emergency` as a new action: password reset is orthogonal to "Supabase Auth is down" (the reason `/api/emergency` exists), and conflating them makes the existing route's scope harder to reason about.
- **`/api/ops/self-probe` (M10)** — second consumer of `OPOLLO_EMERGENCY_KEY`. M14-1 is the third. Beyond three callers, `lib/emergency-auth.ts` becomes worth extracting.
- **`docs/patterns/assistive-operator-flow.md`** — M14-3 + M14-4 pick this up for translated errors + confirm-before-destructive (the "change password" surface is destructive for an attacker-controlled session).
- **`docs/patterns/new-api-route.md`** — M14-1 follows this for the route-handler shape (Zod validation, structured error envelope, `retryable` flag).

## Sub-slice status tracker

- [ ] M14-1 — admin reset endpoint (ships ahead of M12-2)
- [ ] M14-2 — Supabase redirect configuration (BLOCKED on M12 + M13 completion)
- [ ] M14-3 — forgot password flow (BLOCKED on M14-2)
- [ ] M14-4 — account security page (BLOCKED on M14-3)
- [ ] M14-5 — E2E coverage (BLOCKED on M14-4)
- [ ] M14-6 — docs + auth flow diagram (BLOCKED on M14-5)

On M14-1 merge, auto-continue halts. Steven uses the endpoint once via hoppscotch to restore `hi@opollo.com` access. Remaining M14 slices wait until M13-6 merges. Explicit pause-gate at M14-1 → M14-2 boundary per Steven's ordering call on 2026-04-23.
