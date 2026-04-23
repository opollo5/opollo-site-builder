# M14 — Auth Hardening (password reset + profile management)

## What it is

The admin-auth surface has gaps that became visible when `hi@opollo.com` got locked out with no recovery path. There is no "forgot password" flow, no logged-in "change password" surface, the Supabase auth redirect configuration points at `localhost:3000` in production email links, and there is no permanent operator tool to reset a password when Supabase's self-service email flow is unreachable or misconfigured. M14 closes those gaps.

M14-1 ships a single slice ahead of M12-2 / M13 / the rest of M14: a permanent, emergency-key-gated `/api/ops/reset-admin-password` endpoint that restores admin access when self-service recovery is not usable. M14-1 is the unblocker — it lets the locked-out admin regain access in ~30 seconds instead of waiting for the full reset flow.

**Ordering (revised 2026-04-23, after e2e flake surfaced on main):** the full auth surface (M14-2 → M14-6) ships ahead of resuming M12-2, not after. Reasoning: without a working reset flow every lockout blocks Steven, which blocks UAT of M12/M13 work as it ships. Steven needs to be able to log in and recover access independently while testing M12 and M13 progress. M12-2 resumes after M14-6 merges AND Steven has end-to-end tested the reset flow.

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

## Auth-gap audit (2026-04-23) — candidates for additional M14 sub-slices

Steven requested a full audit of auth surfaces beyond password reset, to surface any additional gaps as candidates for extra M14 sub-slices. Findings below. **None of these are auto-added to M14 scope — each waits for Steven's explicit approval before becoming a sub-slice.** They live here as documented findings so the milestone can close cleanly when Steven confirms which stay in M14 and which move to BACKLOG.

### 1. Email verification on signup — N/A
No public signup path. Admin-invite-only. The invite flow bypasses `email_confirmed_at` because the Supabase-generated action URL's code exchange counts as confirmation. **Recommendation:** do not add to M14 — bring it in when a public signup path ships.

### 2. User invitation flow — gap, candidate M14-7?
Invite works end-to-end (`app/api/admin/users/invite` → Supabase `generateLink('invite')` → `/api/auth/callback` code exchange). Gaps: **invites are not expirable and not revocable.** No TTL on the magic link beyond Supabase's built-in, and no "cancel pending invite" admin action. For an admin-invite-only product, revocation is the bigger operational gap — you can't undo a mistaken invite. Candidate slice: invite TTL + revocation. Scope feels close to M14; operator-facing and auth-adjacent.

### 3. Logout flow — implemented
`/logout` (GET + POST) calls `supabase.auth.signOut()` → cookies cleared via the `@supabase/ssr` `setAll` callback → redirect to `/login`. No gap.

### 4. Session expiry handling — gap, candidate M14-8?
Middleware validates JWT; expired tokens redirect to `/login?next=...`. Fallback `/auth-error` page exists with a terse "we couldn't verify your session" message. **Gap:** no proactive expiry warning, no mid-workflow session-extend prompt, no "you're about to lose unsaved work" modal. Low-severity operationally today (admin UI is read-heavy; nothing in flight for more than a few minutes). Candidate slice: pre-expiry warning + session-extend UI. Feels more like an M14 polish slice than a hard requirement.

### 5. Multi-factor auth — not implemented, not claimed
Zero references to mfa / totp / 2fa in the codebase. Not surfaced in any UI or docs. **Recommendation:** keep out of M14. TOTP + recovery codes + MFA-aware admin gate is a milestone-sized scope, not a slice. BACKLOG entry.

### 6. "Remember me" behavior — not implemented, low impact
Login form has no remember-me checkbox. Supabase `@supabase/ssr` uses cookie-based sessions that persist per browser profile already, so the absence isn't functionally broken — just missing a UI affordance for short-lived sessions as an opt-out. **Recommendation:** out of M14; low value for an admin-only product.

### 7. Account deletion — not implemented, not claimed
No user-facing deletion. Admin-side uses revoke/reinstate (ban_duration) — data preserved. No hard-delete or right-to-erasure flow. **Recommendation:** out of M14 until a public-user surface ships. BACKLOG entry.

**Decision (2026-04-24):** neither candidate is in M14. Steven's call — product needs login + password reset to work, everything else is below the line. M14-7 (invite TTL + revocation) and M14-8 (session expiry pre-warning) move to `docs/BACKLOG.md` and get picked up when someone actually hits them. M14 stays at six slices: M14-1 (merged) → `fix(e2e)` → M14-2 → M14-3 → M14-4 → M14-5 → M14-6.

## Out of scope (tracked in BACKLOG.md)

- **Email verification on signup.** Signup is admin-invite-only today; no public signup path. Audit confirmed.
- **Multi-factor auth.** Not claimed anywhere today. Audit confirmed zero references in the codebase.
- **"Remember me" toggle.** Cookie-based sessions already persist; no UI affordance missed in practice.
- **Account deletion / GDPR-export.** No end-user surface yet.
- **User invitation flow expiry/revocation.** Decision 2026-04-24: out of M14, deferred to BACKLOG.
- **Session expiry pre-warning.** Decision 2026-04-24: out of M14, deferred to BACKLOG.

## Env vars required

None new. `OPOLLO_EMERGENCY_KEY` is already provisioned (documented in `.env.local.example`, used by `/api/emergency` and `/api/ops/self-probe`). M14-2 may surface `NEXT_PUBLIC_SITE_URL` as a missing-in-Vercel gap — if so, that is called out at M14-2 time and halts the slice until provisioned, per the CLAUDE.md "missing env var" rule.

## Sub-slice breakdown (6 PRs)

| Slice | Scope | Write-safety rating | Blocks on |
| --- | --- | --- | --- |
| **M14-1** | `POST /api/ops/reset-admin-password` endpoint + admin-role guard + 12-char password floor + structured logging + unit test with mocked supabase admin. Runbook entry. Ships ahead of M12-2 because `hi@opollo.com` is currently locked out. | Medium — single service-role write, emergency-key-gated, admin-only target. Constant-time key compare. Admin-role guard prevents scope creep on key compromise. | Nothing. |
| **M14-2** | Audit `emailRedirectTo` / `redirectTo` usage in `lib/` + every auth API route; wire everything to `NEXT_PUBLIC_SITE_URL` (or equivalent). Verify the env var is set in Vercel production. Document required Supabase dashboard settings — Site URL + Redirect URLs allowlist — as a runbook entry with exact values and where to find each setting in the dashboard UI. | Low — pure configuration + docs. No new write paths. | M14-1 + `fix(e2e)` briefs-review spec green. |
| **M14-3** | "Forgot password?" link on `/login` (below Sign In). `/auth/forgot-password` page → `supabase.auth.resetPasswordForEmail` with the M14-2-fixed `redirectTo` → success copy including "check your spam folder". `/auth/reset-password` page → handles Supabase recovery token → password + confirm form → `supabase.auth.updateUser`. Expired / invalid token surfaces a "Request a new link" CTA, not raw query-param error copy. Password strength floor = 12 chars, enforced client-side with live feedback. Upstash rate limiter keyed on email — 5 requests per email per hour. Every event logged via the structured logger (request, success, failure). | Medium — triggers Supabase-billed emails. Rate limiter prevents email flood. | M14-2. |
| **M14-4** | `/account/security` page accessible from the user menu (menu entry added if absent). Current password + new password + confirm form. Verify current password by attempting a fresh `signInWithPassword` before calling `supabase.auth.updateUser`; mismatch returns a translated error. Same password-strength rules as M14-3. Every successful change logged. | Medium — password write. Current-password verification prevents a session hijacker from silently changing creds. | M14-3. |
| **M14-5** | Playwright E2E covering: (a) request reset → mock the email callback → set new password → login with new → assert old password rejected; (b) logged-in password change — current-password-required, new-password-works, old-password-rejected-after-change; (c) error surfaces — expired token, invalid token, rate-limit hit. Uses the existing `e2e/global-setup.ts` test-user pattern. Do not skip E2E; auth is exactly where E2E matters most. | Low — E2E only. | M14-4. |
| **M14-6** | `docs/AUTH.md` with flow diagram (text or mermaid) showing: login path, forgot-password path, reset-password path, logged-in password change, admin reset endpoint usage. Update the M2 parent plan (or create if missing) to reflect that auth was incomplete until M14 — list the specific gaps that existed. `docs/BACKLOG.md` cleanup: strike any "auth complete" claims, note M14 as the completion milestone. Runbook consolidation — one canonical auth incident playbook, cross-linked. | Low — docs. | M14-5. |

**Execution order under the revised ordering decision (2026-04-23):** M14-1 is already merged (PR #113) and is the permanent break-glass tool. Next: `fix(e2e)` for the pre-existing briefs-review spec flake (keeps main green before piling on more slices), then M14-2 → M14-3 → M14-4 → M14-5 → M14-6 strictly serial. After M14-6 merges, auto-continue halts — Steven tests the full reset flow end-to-end and gives an explicit signal before M12-2 resumes. Silence is NOT a proceed signal at the M14-6 → M12-2 boundary.

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

- [x] M14-1 — admin reset endpoint (merged, PR #113)
- [ ] `fix(e2e)` briefs-review spec — pre-existing flake on main; ship before M14-2 so the suite is green
- [ ] M14-2 — Supabase redirect configuration
- [ ] M14-3 — forgot password flow (BLOCKED on M14-2)
- [ ] M14-4 — account security page (BLOCKED on M14-3)
- [ ] M14-5 — E2E coverage (BLOCKED on M14-4)
- [ ] M14-6 — docs + auth flow diagram (BLOCKED on M14-5)

**Auto-continue rule:** silence at sub-slice boundaries = proceed, per the CLAUDE.md "Auto-continue" rule. **Explicit halt at M14-6 → M12-2:** after M14-6 merges, auto-continue halts. Steven tests the full reset flow end-to-end — request reset, receive email, set new password, log in with new, verify old rejected, exercise the logged-in password-change flow — and posts an explicit "resume M12-2" signal. Only then does M12-2 pick up. Silence at the M14-6 → M12-2 boundary is NOT a proceed signal.
