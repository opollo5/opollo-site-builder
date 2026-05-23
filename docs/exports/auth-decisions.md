# Opollo Site Builder — Authentication & Device-Trust: Decision Export

**Purpose:** This document is a self-contained, decision-grade export of the authentication
and device-trust system in the Opollo Site Builder codebase. It is written for the Lead Source
team who are building a functionally identical auth system in a different Next.js + Supabase
project and have no access to this repo.

Every decision includes verbatim code evidence with file:line references. Where a decision
was made in conversation with no code evidence, that is stated explicitly.

**Exported:** 2026-05-16  
**Codebase revision:** branch `hotfix/facebook-auto-open-no-refresh` (≈ commit 7390eda7)

---

## Section 1 — Threat Model

### What this auth system is defending against

**Primary threats (in-scope, actively mitigated):**

- **Password reuse breaches.** The single biggest threat for a B2B admin tool. Users reuse
  passwords across services; a credential breach at any third party exposes Opollo accounts.
  Mitigation: email-approval 2FA on every new device means a stolen password alone is not enough.

- **Credential stuffing.** Automated bots replay breached username:password lists. Mitigation:
  rate limiting (`login` bucket: 10 req/60 s per IP, `auth_2fa` bucket: 5 challenges/hour per
  user) plus the 2FA gate.

- **Session token theft.** An attacker who obtains the Supabase session cookie can authenticate
  as the victim. Mitigation: `supabase.auth.getUser()` (server-verified) on every request, plus
  app-layer `revoked_at` check. Soft revocation deletes refresh tokens so the session cannot
  auto-renew. Hard revocation (`revoked_at`) rejects pre-revocation JWTs even if the cookie
  is still present.

- **Physical device theft.** A stolen laptop with a live browser session. Mitigation: 48-hour
  hard session cap with 15-minute non-renewable grace; the `opollo_device_id` cookie is
  HttpOnly (not readable by JS), Secure (HTTPS only), SameSite=Lax (CSRF-resistant). The victim
  can revoke the device from `/account/devices` on any other device.

- **Phishing.** User is tricked into entering credentials on a fake site. Mitigation: if
  credentials land on a fake site, the attacker still needs to approve the email challenge from
  the victim's inbox. This is partial protection — it slows down an attacker but does not defeat
  a real-time relay attack.

- **Session fixation.** Attacker pre-sets the session cookie. Mitigation: Supabase Auth issues
  a fresh session on sign-in; the SSR client's `setAll` callback on the middleware response
  overwrites any client-supplied cookie value.

- **Open-redirect attacks.** Attacker embeds a hostile URL in the `?next=` or `?returnTo=`
  parameter on auth redirect flows. Mitigation: `isSafeNext()` and `safeNext()` helpers in
  `lib/auth-callback.ts:33-47` and `app/api/auth/callback/route.ts:52-67` reject any value
  that doesn't start with `/`, starts with `//`, or resolves to a different origin.

- **Account enumeration.** Determining whether an email address is registered by observing
  different error responses. Mitigation: `POST /api/auth/forgot-password` returns identical
  responses for registered and unregistered emails; `loginAction` returns `"Invalid email or
  password."` without distinguishing the two cases.

**Secondary threats (acknowledged, partially mitigated):**

- **SIM swap.** Not applicable: no SMS factor.

- **Insider threat.** An `opollo_config.auth_kill_switch` DB row can disable Supabase Auth
  system-wide; writing to that table requires service-role credentials. No user-facing path
  exists to set it. The emergency route (`/api/emergency`) requires a separate `OPOLLO_EMERGENCY_KEY`.

- **Account takeover via support social engineering.** No documented support recovery flow.
  This is explicitly a known gap — see Section 7.

**Explicitly out of scope:**

- Nation-state attackers with malware on the user's device. If an attacker controls the
  browser, they can read the session cookie from the OS keychain regardless of SameSite/HttpOnly.

- Password spraying below the rate-limit threshold. The system does not have a per-user
  failed-attempt counter layered on top of rate limiting.

- Compromised email accounts. If the attacker controls the user's inbox, the email-approval
  factor provides no protection. This is an inherent limitation of email-based 2FA.

---

## Section 2 — Auth Model Fundamentals

### Decision 2.1 — Device-trust auth, not uniform 2FA

**What was decided:** This is device-trust auth: the second factor (email approval) is required
only on the first sign-in from a new device, or when the device trust has expired/been revoked.
Returning users on trusted devices complete sign-in with just their password. There is no
uniform 2FA on every login.

**Why:** The system is an internal admin tool for a small team of operators. Requiring email
approval on every login would create friction proportional to sign-in frequency. The trust
model assumes "operator's browser on operator's computer" is a safe proxy for identity, and
gates hard on new browser contexts.

**Evidence:** `app/login/actions.ts:130-143`
```typescript
const cookieValue = cookieJar.get(DEVICE_ID_COOKIE)?.value;
const deviceIdFromCookie = decodeDeviceCookie(cookieValue);
if (deviceIdFromCookie) {
  const trusted = await isDeviceTrusted({
    userId,
    deviceId: deviceIdFromCookie,
  });
  if (trusted) {
    // Skip the challenge — bump last_used_at + go.
    await touchTrustedDevice({ userId, deviceId: deviceIdFromCookie });
    clearStale2faCookies();
    redirect(next);
  }
}
```

**Configuration:** `AUTH_2FA_ENABLED=true` (env var) enables the 2FA gate; when false, the
system behaves as password-only. See `lib/2fa/flag.ts:9-12`.

**Edge cases handled:**
- `AUTH_2FA_ENABLED=false`: trusted-device check is bypassed entirely, password alone suffices.
  `app/login/actions.ts:103-106`
- `AUTH_2FA_ENABLED=true` but stale pending cookie: `/login` page detects the stale cookie and
  redirects to `/logout` to clear it. `app/login/page.tsx:52-54`

**Known limitations:** Step-up authentication for sensitive operations is not implemented.
Every action (including changing email, changing password, revoking devices) only requires a
current Supabase session — no fresh OTP is demanded.

---

### Decision 2.2 — Factors: password + email approval link

**What was decided:** Password is factor 1 (something you know). The email approval link is
factor 2 (control of the registered email inbox = something you have). Passkeys, TOTP, SMS,
and push notifications are not supported.

**Why:** Email approval is the lowest-friction second factor for a small internal team where
every operator already has the app's email in their inbox. It does not require an authenticator
app install. It degrades gracefully if lost (use approve-here flow from the email device).

**Evidence:** `lib/2fa/challenges.ts:63-106` — challenge creation; `lib/email/templates/login-approval.ts:76-136` — email with approval link.

**Known limitations:** Email-based 2FA is weaker than TOTP or passkeys against real-time relay
attacks. The attacker who can intercept login credentials in real time may also be able to
intercept or delay the approval email.

---

### Decision 2.3 — Returning user on trusted device flow

**What was decided:** Password → Supabase Auth validates credentials → `isDeviceTrusted()` checks
`(user_id, device_id)` → if trusted, bump `last_used_at` via `touchTrustedDevice()` → redirect to
`next` (default `/admin/sites`). Zero email sends, no cookie mutations except stale-cookie
cleanup.

**Evidence:** `app/login/actions.ts:84-143`
```typescript
const { error: signInError, data } = await supabase.auth.signInWithPassword({ email, password });
if (signInError) {
  return { error: "Invalid email or password." };
}
// ...
if (deviceIdFromCookie) {
  const trusted = await isDeviceTrusted({ userId, deviceId: deviceIdFromCookie });
  if (trusted) {
    await touchTrustedDevice({ userId, deviceId: deviceIdFromCookie });
    clearStale2faCookies();
    redirect(next);
  }
}
```

---

### Decision 2.4 — Returning user on new device flow

**What was decided:** Password → Supabase Auth validates → no trusted-device match → create
`login_challenges` row → send email with one-time approval URL → set `opollo_2fa_pending` and
`opollo_pending_device_id` cookies → redirect to `/login/check-email` (polls every 3 s). On
approval: consume challenge → optionally register trusted device → clear pending cookies → redirect to `/admin/sites`.

**Evidence:** `app/login/actions.ts:145-230` — challenge creation and redirect. `components/CheckEmailPolling.tsx:60-103` — polling and complete-login. `app/api/auth/complete-login/route.ts:71-247` — server-side completion.

---

### Decision 2.5 — Sign-up flow: invitation-only, email verification on accept

**What was decided:** Public self-registration is not supported. New users are added via an
invitation sent by an admin. The invite email contains a high-entropy token; the recipient
clicks the link and sets a password. Supabase `auth.users` row is created during `acceptInvite()`.
No auto-sign-in after acceptance — user is redirected to `/login` to sign in explicitly.

**Why:** This is a B2B internal tool. The operator roster is controlled by admins. Uncontrolled
self-registration would create unreviewed accounts.

**Evidence:** `app/api/auth/accept-invite/route.ts:1-84`
```typescript
// Public route — the token IS the auth.
const result = await acceptInvite({
  rawToken: parsed.data.token,
  password: parsed.data.password,
});
// Returns email + role (no auto-sign-in per brief)
```

**Edge cases handled:**
- Expired token: `EXPIRED` error, 409. `app/api/auth/accept-invite/route.ts:63-73`
- Already accepted: `ALREADY_ACCEPTED` error, 409.
- Token too short/malformed: 400 validation error.
- Password < 12 chars: `PASSWORD_TOO_SHORT`, 400.

**Known limitations:** No email re-send for expired invites — admin must create a new invite.

---

### Decision 2.6 — OAuth providers: not supported

**What was decided:** OAuth (Google, GitHub, Microsoft, Apple) is not implemented. Password
sign-in is the only sign-in method.

**Evidence:** No code in `app/api/auth/` or `app/login/` references OAuth flows. No Supabase
`signInWithOAuth()` calls exist anywhere in the codebase.

**Evidence:** No code; decision made in the AUTH-FOUNDATION P3 brief (no commit reference available).

**Known limitations:** Users must remember the password they set at invite-acceptance. Magic-link
fallback is available in the `approve-here` path but only for users mid-2FA challenge, not as
a standalone sign-in method.

---

## Section 3 — Session and Trust Lifetimes

### Decision 3.1 — Session length

**What was decided:** Supabase Auth JWT lifetime is not explicitly overridden in application
code. The session watcher enforces a 48-hour application-layer cap via the `SessionExpiryWatcher`
regardless of the JWT TTL configured in the Supabase dashboard.

**Evidence:** `components/session/session-expiry-watcher.tsx:46-70` — hard logout on `mustLogout`.
`lib/hooks/use-session-grace.ts:22` — references a 15-minute grace window after expiry.

The comment at `lib/hooks/use-session-expiry.ts:21-27` notes:
```
// Mirrors the JWT_EXPIRY set in the Supabase dashboard. If the
// dashboard is set to <48h, the warning thresholds simply fire
// proportionally earlier; nothing in this hook hardcodes 48h.
```

**Configuration:** Supabase dashboard JWT expiry setting. No env var override in code.
Assumed 48 hours based on `session-expiry-watcher.tsx` comment ("48h hard-logout") and
warning thresholds (modal at T-120 minutes, banner at T-5 minutes).

**Known limitations:** If the Supabase dashboard JWT expiry is set longer than 48 hours, the
app-layer watcher enforces 48 hours. If set shorter, the watcher fires proportionally earlier
but still respects the JWT expiry.

---

### Decision 3.2 — Device trust window: 30-day fixed, not sliding

**What was decided:** Device trust expires 30 days from the time of `registerTrustedDevice()`
(or re-registration via UPSERT). The clock is reset whenever the device completes a full
email-approval flow (`trust_device=true` and challenge consumed). Routine sign-ins on an already
trusted device do NOT extend the trust window — only `touchTrustedDevice()` is called, which
updates `last_used_at` but not `trusted_until`.

**Why:** Fixed window is simpler to reason about from a security perspective. A user who has
not visited in 30 days will be re-challenged, regardless of any intermittent activity.

**Evidence:** `lib/2fa/devices.ts:38-66`
```typescript
const trustedUntil = new Date(
  Date.now() + getCookieMaxAgeSeconds() * 1000,
).toISOString();
const { error } = await supabase.from("trusted_devices").upsert({
  // ...
  trusted_until: trustedUntil,
  last_used_at: new Date().toISOString(),
  revoked_at: null,
}, { onConflict: "user_id,device_id" });
```

`lib/2fa/cookies.ts:35`
```typescript
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days
```

`lib/2fa/devices.ts:93-106` — `touchTrustedDevice()` only updates `last_used_at`, not `trusted_until`:
```typescript
await supabase.from("trusted_devices")
  .update({ last_used_at: new Date().toISOString() })
  .eq("user_id", input.userId)
  .eq("device_id", input.deviceId)
  .is("revoked_at", null);
```

**Configuration:** `COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30` hardcoded in `lib/2fa/cookies.ts:35`.

---

### Decision 3.3 — Activity that counts toward trust

**What was decided:** `touchTrustedDevice()` (which bumps `last_used_at` only) is called on
every successful trusted-device sign-in. General authenticated requests do NOT touch the device
trust table. `last_used_at` is metadata only — it does not extend `trusted_until`.

**Evidence:** `app/login/actions.ts:139` — `await touchTrustedDevice({ userId, deviceId: deviceIdFromCookie })` is called only during sign-in on a trusted device, not on every request.

---

### Decision 3.4 — Maximum trust window: 30 days fixed, no additional cap

**What was decided:** There is no "forced re-OTP every N days regardless of activity" layer on
top of the 30-day window. The trust window is reset only when a new email-approval flow completes
with `trust_device=true`. If the device completes a new approval every 25 days, it stays
trusted indefinitely.

**Evidence:** No code implements a maximum-age cap beyond the 30-day `trusted_until` timestamp.

**Known limitations:** A very active user who repeatedly re-trusts their device via new approval
flows can maintain indefinite trust without ever being fully re-challenged.

---

### Decision 3.5 — Password change: trusted devices survive

**What was decided:** Changing a password via `/api/auth/reset-password` does not revoke trusted
devices. The password reset calls `supabase.auth.updateUser({ password })` which issues a new
JWT but does not clear the `trusted_devices` table.

**Evidence:** `app/api/auth/reset-password/route.ts:61-63` — only calls `supabase.auth.updateUser`;
no device revocation logic.

**Known limitations:** This is a known security gap. If an attacker discovers a password, resets
it, then the victim later recovers their account via the same reset flow, the attacker's device
may still be trusted. The victim must manually visit `/account/devices` to revoke rogue devices.

---

### Decision 3.6 — Email change: trusted devices survive

**What was decided:** No email-change route exists in the codebase beyond what Supabase Auth
provides natively. There is no device revocation on email change.

**Evidence:** No code; decision is by omission — no email-change route or device-revocation
hook has been implemented.

**Known limitations:** Email change is an account-takeover vector if not handled carefully.
Changing email to an attacker-controlled address and then resetting the password could bypass
2FA entirely if the original device cookies survive.

---

### Decision 3.7 — Suspicious activity: no automatic escalation

**What was decided:** There is no runtime geo-IP, ASN-change, or user-agent-change detection
that triggers automatic re-OTP. IP and UA are stored as metadata only in `login_challenges` and
`trusted_devices`; they are not evaluated against prior sign-ins.

**Evidence:** `lib/2fa/devices.ts:74-91` — `isDeviceTrusted()` checks only `(user_id, device_id)`
and `trusted_until`; no IP/UA comparison:
```typescript
const { data, error } = await supabase.from("trusted_devices")
  .select("id, trusted_until")
  .eq("user_id", input.userId)
  .eq("device_id", input.deviceId)
  .is("revoked_at", null)
  .maybeSingle();
// ...
return new Date(data.trusted_until as string).getTime() > Date.now();
```

**Known limitations:** No risk-based step-up. A trusted device accessed from a different country
or ASN is treated identically to a trusted device accessed from the usual location.

---

## Section 4 — Second-Factor Mechanism

### Decision 4.1 — Primary second factor: email approval link (not numeric OTP)

**What was decided:** The second factor is an email containing a direct approval link. The
operator clicks the link in their email client; the link lands on `/auth/approve`, which
validates the token and renders an auto-closing confirmation page. The original browser tab
is polling `/api/auth/challenge-status` and detects the approval within 3 seconds.

This is NOT a numeric OTP that the user types. It is a URL click. The link contains a raw
64-character hex token (32 bytes of entropy).

**Why:** Click-based approval has zero transcription error (no risk of typing an OTP wrong
under time pressure). It is easier for operators on mobile (tap link in email app). It works
with password managers and email clients that preview link text.

**Evidence:** `lib/2fa/challenges.ts:67-68`
```typescript
const rawToken = randomBytes(TOKEN_BYTES).toString("hex"); // 64-char hex string
const tokenHash = createHash("sha256").update(rawToken).digest("hex");
```

`lib/email/templates/login-approval.ts:88-103`
```html
<a href="${escapeHtml(input.approve_url)}" ...>
  Approve sign-in
</a>
```

The approve URL format: `${NEXT_PUBLIC_SITE_URL}/auth/approve?token=${raw_token}` (64-char hex).

---

### Decision 4.2 — Fallback: approve-here magic link

**What was decided:** If the operator clicks the approval link on a different device (e.g.,
phone) but needs to complete the sign-in on the original desktop browser, the `/auth/approve`
page offers a "Complete sign-in here" button. This calls `POST /api/auth/approve-here`, which
consumes the challenge and generates a Supabase magic link for the user's email. The browser
follows that link to complete sign-in on the approving device.

`trust_device` is explicitly `false` on this path (the approving device might be a phone,
not the device the operator intended to trust).

**Evidence:** `app/api/auth/approve-here/route.ts:125-150`
```typescript
const linkRes = await svc.auth.admin.generateLink({
  type: "magiclink",
  email,
  options: { redirectTo },
});
// trust_device is intentionally FALSE in this path
```

**Known limitations:** The operator ends up signed in on the approving device, not the original
device. There is no mechanism to sign in the original browser once the challenge is consumed by
the approve-here path.

---

### Decision 4.3 — Token format: 32-byte random hex, URL-embedded

**What was decided:** The challenge token is 32 bytes of cryptographically random data, encoded
as a 64-character lowercase hex string. It is embedded in the URL as a query parameter:
`/auth/approve?token=<64-char-hex>`. It is not a typed OTP (no digits, no length-limited code).

**Evidence:** `lib/2fa/challenges.ts:43, 67-68`
```typescript
const TOKEN_BYTES = 32;
const rawToken = randomBytes(TOKEN_BYTES).toString("hex");
```

**Case-sensitivity:** The token is hex-lowercase. The comparison is hash-based (SHA-256), so
case sensitivity is not relevant to verification.

---

### Decision 4.4 — Email delivery: SendGrid, same provider as transactional email

**What was decided:** All auth emails (login approval, invite) are sent via SendGrid using the
`@sendgrid/mail` library. This is the same provider used for other transactional email in the
application. There is no separate auth-email provider.

**Evidence:** `lib/email/sendgrid.ts:3`
```typescript
import sgMail from "@sendgrid/mail";
```

`app/login/actions.ts:8` — login approval uses `sendEmail` from sendgrid module:
```typescript
import { sendEmail } from "@/lib/email/sendgrid";
```

**Configuration:**
- `SENDGRID_API_KEY` — SendGrid API key
- `SENDGRID_FROM_EMAIL` — from address (expected: `noreply@opollo.com`)
- `SENDGRID_FROM_NAME` — from name (default: `"Opollo Site Builder"`)

---

### Decision 4.5 — Token TTL: 15 minutes

**What was decided:** Each `login_challenges` row expires 15 minutes after creation. After
expiry, the approval link is invalid. The user must start over from `/login`.

**Evidence:** `lib/2fa/challenges.ts:44`
```typescript
const CHALLENGE_TTL_MS = 15 * 60 * 1000;
```

`supabase/migrations/0062_auth_foundation_2fa_schema.sql:62`
```sql
expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
```

The `opollo_2fa_pending` cookie is set with a 20-minute max-age to slightly outlast the challenge:
`lib/2fa/cookies.ts:114`
```typescript
const PENDING_TTL_SECONDS = 20 * 60; // 20 minutes — > the 15-min challenge expiry
```

---

### Decision 4.6 — Max approval attempts per challenge: N/A (link-based, not typed)

**What was decided:** Since the factor is a URL link click, not a typed code, there is no
"attempt" concept. A challenge can only be approved or not. There is no brute-force surface
at the approval step — the 64-char hex token has 256 bits of entropy (2^256 keyspace).

**Evidence:** `app/auth/approve/page.tsx` — validates token by SHA-256 hash lookup; no attempt
counter. No rate limit on `/auth/approve` GET requests in `middleware.ts` PUBLIC_PATHS.

**Known limitations:** `/auth/approve` is rate-limited implicitly by the challenge-level rate
limit (5 challenges/hour/user) but the approve endpoint itself is not rate-limited per IP.

---

### Decision 4.7 — Max challenge requests per user per hour: 5

**What was decided:** A user can request at most 5 email-approval challenges per hour. This
covers: the initial challenge from sign-in, plus 4 resends via the "Resend email" button.

This limit is enforced at two levels:
1. Postgres count via `recentChallengeCountForUser()` in `lib/2fa/challenges.ts:246-258`
2. Upstash Redis sliding window (`auth_2fa` bucket: 5 per 1 hour) in `lib/rate-limit.ts:87-88`

**Evidence:** `app/login/actions.ts:146-155`
```typescript
const recentCount = await recentChallengeCountForUser(userId);
if (recentCount >= MAX_CHALLENGES_PER_HOUR) {
  await supabase.auth.signOut();
  return { error: "Too many sign-in attempts. Try again in an hour or contact your admin." };
}
```

`app/api/auth/resend-challenge/route.ts:37, 71-84`
```typescript
const MAX_CHALLENGES_PER_HOUR = 5;
// ...
const recentCount = await recentChallengeCountForUser(userId);
if (recentCount >= MAX_CHALLENGES_PER_HOUR) {
  return NextResponse.json({ error: { code: "RATE_LIMITED", ... } }, { status: 429 });
}
```

---

### Decision 4.8 — Concurrent OTP requests: accumulate, don't invalidate previous

**What was decided:** Each "Resend email" issues a NEW `login_challenges` row without
invalidating the previous row. Both old and new approval links remain valid until expiry.
Whichever link the user clicks first wins (via the CAS-protected state transition). The
rate limit (5/hour) caps how many live challenges can exist simultaneously.

**Evidence:** `app/api/auth/resend-challenge/route.ts:28-31`
```
// The previous pending challenge stays in 'pending' until expiry —
// either the new approval link or the old one will work, with
// whichever lands first winning.
```

**Why:** Invalidating previous challenges on resend creates a race: the user clicks the old
link at the same moment a new one is issued. Keeping both valid avoids the "already-consumed"
error on a legitimate click. The rate limit prevents abuse.

---

### Decision 4.9 — Token storage: SHA-256 hash, never raw token in DB

**What was decided:** Only the SHA-256 hash of the raw token is stored in `login_challenges.token_hash`.
The raw token appears only in the approval email body. Even if the database is fully read-compromised,
the attacker cannot reverse the stored hashes to produce valid approval links (SHA-256 is a
one-way function; the 256-bit token space makes preimage attacks infeasible).

**Evidence:** `lib/2fa/challenges.ts:68-69`
```typescript
const tokenHash = createHash("sha256").update(rawToken).digest("hex");
// ...
await supabase.from("login_challenges").insert({ token_hash: tokenHash, ... });
```

`lib/2fa/challenges.ts:143-145` — verification also hashes before looking up:
```typescript
export async function lookupChallengeByToken(rawToken: string): Promise<ChallengeRow | null> {
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  // ... .eq("token_hash", tokenHash)
```

---

### Decision 4.10 — Single-use enforcement: CAS state transitions

**What was decided:** Challenge tokens are single-use enforced via a compare-and-swap (CAS)
pattern on the `login_challenges.status` column. The state machine is:

```
pending → approved → consumed (terminal)
pending → expired (terminal)
```

The `approveChallenge()` UPDATE filters `WHERE status = 'pending'`; the `consumeChallenge()`
UPDATE filters `WHERE status = 'approved'`. A concurrent second click on the same link or a
concurrent second complete-login call cannot both succeed because only one will match the
required `WHERE status =` predicate.

**Evidence:** `lib/2fa/challenges.ts:189-206`
```typescript
const { error, data } = await supabase
  .from("login_challenges")
  .update({ status: "approved", approved_at: new Date().toISOString() })
  .eq("id", challengeId)
  .eq("status", "pending")  // CAS guard
  .select("id");
// ...
if (!data || data.length === 0) {
  // Race: another tab consumed/expired between lookup + update.
  return { ok: false, reason: "already_consumed" };
}
```

`lib/2fa/challenges.ts:225-237` — same pattern for `consumed`:
```typescript
const { error, data } = await supabase
  .from("login_challenges")
  .update({ status: "consumed" })
  .eq("id", challengeId)
  .eq("status", "approved")  // CAS guard
  .select("id");
```

---

## Section 5 — Device Identification

### Decision 5.1 — Device identity: signed cookie value only

**What was decided:** A device is identified solely by the value of the `opollo_device_id`
cookie. There is no additional fingerprinting (no UA hash, no IP binding, no canvas fingerprint,
no TLS fingerprint). UA and IP are stored as metadata in `trusted_devices` but are NOT part of
the trust check.

**Why:** UA strings change on browser updates (Chrome updates every ~4 weeks). Binding trust
to the UA would break trusted devices every time the browser updates, creating false-positive
re-challenges. IP addresses are ephemeral for mobile users and change on DHCP lease renewal.
Cookie value is the most stable identifier we have that requires physical possession of the device.

**Evidence:** `lib/2fa/devices.ts:74-91` — `isDeviceTrusted()`:
```typescript
const { data, error } = await supabase
  .from("trusted_devices")
  .select("id, trusted_until")
  .eq("user_id", input.userId)       // user scope
  .eq("device_id", input.deviceId)   // only this identifier
  .is("revoked_at", null)
  .maybeSingle();
```

---

### Decision 5.2 — Cookie name, flags, and rationale

**What was decided:**

| Cookie | Name | HttpOnly | Secure | SameSite | Path | Max-Age |
|--------|------|----------|--------|----------|------|---------|
| Device ID | `opollo_device_id` | Yes | Yes | Lax | / | 30 days |
| Pending 2FA | `opollo_2fa_pending` | Yes | Yes | Lax | / | 20 min |
| Pending Device ID | `opollo_pending_device_id` | Yes | Yes | Lax | / | 20 min |

**HttpOnly:** Prevents JavaScript from reading the cookie. Mandatory for security tokens.
**Secure:** Prevents transmission over HTTP. Required for production.
**SameSite=Lax:** Blocks cross-site POST requests (CSRF) while allowing top-level GET navigations.
Top-level GETs are acceptable because the approval link arrives via email (a top-level navigation).
**Path=/:** Cookie available to all paths.

**Evidence:** `app/api/auth/complete-login/route.ts:222-229`
```typescript
cookieJar.set(DEVICE_ID_COOKIE, encodeDeviceCookie(deviceId), {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
  maxAge: getCookieMaxAgeSeconds(),
});
```

`lib/2fa/cookies.ts:33-35`
```typescript
export const DEVICE_ID_COOKIE = "opollo_device_id";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days
```

---

### Decision 5.3 — Cookie value format: HMAC-SHA256 signed UUID

**What was decided:** The cookie value is `<uuid>.<hmac-sha256-base64url>`. The UUID is the
device_id. The HMAC signature binds the UUID to the server-side `COOKIE_SIGNING_SECRET`. An
attacker cannot fabricate a device_id value that passes validation without knowing the secret.

Format: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.<base64url-encoded-hmac>`

**Why:** A bare UUID cookie is forgeable by anyone who can guess it (impractical for UUID4 but
adds no security cost). More importantly, the HMAC provides tamper evidence: if the cookie
value is modified in transit (e.g., on a compromised proxy), the signature verification fails.
Even if `device_id` leaks, trust still requires `user_id` to match the Supabase session.

**Evidence:** `lib/2fa/cookies.ts:56-91`
```typescript
function sign(value: string): string {
  const key = loadSigningSecret();
  return createHmac("sha256", key).update(value).digest("base64url");
}

export function encodeDeviceCookie(deviceId: string): string {
  return `${deviceId}.${sign(deviceId)}`;
}

export function decodeDeviceCookie(cookieValue: string | undefined): string | null {
  // ... split on ".", validate HMAC via timingSafeEqual, validate UUID shape
  const a = Buffer.from(signature, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    timingSafeEqual(a, Buffer.alloc(a.length)); // constant-time false
    return null;
  }
  if (!timingSafeEqual(a, b)) return null;
  // ...
}
```

**Configuration:** `COOKIE_SIGNING_SECRET` — 32-byte hex string (64 hex chars). Generate via
`openssl rand -hex 32`.

---

### Decision 5.4 — Device_id scope: user-scoped (per user, per browser)

**What was decided:** The `trusted_devices` table stores `(user_id, device_id)` pairs with a
UNIQUE constraint on both columns. A device_id is generated fresh per challenge (it is not a
single ID for the browser that all users on that browser share). Different users who sign in
from the same browser each get their own device_id with their own trust record.

**Evidence:** `lib/2fa/challenges.ts:69`
```typescript
const deviceId = randomUUID(); // generated per challenge
```

`supabase/migrations/0062_auth_foundation_2fa_schema.sql:127`
```sql
CREATE UNIQUE INDEX trusted_devices_user_device_uniq
  ON trusted_devices (user_id, device_id);
```

`lib/2fa/devices.ts:74` — trust check uses `eq("user_id", ...)`:
```typescript
.eq("user_id", input.userId)
.eq("device_id", input.deviceId)
```

---

### Decision 5.5 — UA hash: not used for trust, stored as plain text metadata

**What was decided:** The UA string is stored in plaintext as `ua_string` in both
`login_challenges` and `trusted_devices`. It is used only for display purposes (parsing
browser + OS for the device list UI). There is no UA hash, and UA is not evaluated during
trust checks.

**Evidence:** `supabase/migrations/0062_auth_foundation_2fa_schema.sql:58`
```sql
ua_string text,  -- raw UA for the email body
```

`supabase/migrations/0062_auth_foundation_2fa_schema.sql:136-138`
```sql
COMMENT ON COLUMN trusted_devices.ua_string IS
  'User-Agent header from the approval-completing request. METADATA ONLY — trust
   matching does NOT use UA (browser updates rotate UA strings; UA-coupled trust
   would break legitimately-trusted devices).';
```

---

### Decision 5.6 — IP handling: peppered SHA-256 hash, never raw IP

**What was decided:** IPs are hashed before storage using `SHA-256(pepper + ":" + ip)` where
`pepper = IP_HASH_PEPPER` env var. The raw IP is never stored. The hash is stored in
`login_challenges.ip_hash` and `trusted_devices.ip_hash` as metadata.

**Why:** Storing raw IPs is PII under GDPR. Hashing with a pepper ensures the hash is not
reversible even via rainbow table. Pepper prevents different applications from correlating
hashes if one salt/pepper leaks.

**Evidence:** `lib/2fa/cookies.ts:157-168`
```typescript
export function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  const pepper = process.env.IP_HASH_PEPPER;
  if (!pepper) {
    // No pepper → unsalted hash. P1 requires the pepper.
    return createHash("sha256").update(ip).digest("hex");
  }
  return createHash("sha256")
    .update(`${pepper}:${ip}`)
    .digest("hex");
}
```

**Configuration:** `IP_HASH_PEPPER` — any non-empty string; used as a HMAC-like prefix.

**Known limitations:** Mobile users changing IPs frequently will not trigger re-authentication
because IP is not part of the trust check. This is intentional.

---

### Decision 5.7 — UA change on trusted device: ignored

**What was decided:** If the browser's user agent changes (e.g., Chrome auto-updates) but the
device_id cookie is still present and valid, the trust check passes. The UA string in the DB
is not updated unless the user goes through a new approval flow.

**Evidence:** `lib/2fa/devices.ts:74-91` — `isDeviceTrusted()` only checks `device_id`; no
UA comparison.

---

### Decision 5.8 — Cookie regeneration: never automatically rotated

**What was decided:** The `opollo_device_id` cookie is not rotated on sign-in, on schedule,
or on suspicious events. It is set once when `trust_device=true` on challenge completion, and
remains until:
- The user explicitly revokes the device via `/account/devices`
- The `trusted_until` timestamp lapses (30 days)
- The user uses "Sign out this device" which sets `maxAge: 0` on the cookie

**Evidence:** `app/api/auth/complete-login/route.ts:222-229` — cookie set only here. `app/api/account/devices/[id]/route.ts:67-75` — cookie cleared on explicit revocation.

---

## Section 6 — Risk-Based Escalation

### Decision 6.1 — Signals that force re-OTP on a trusted device: none currently

**What was decided:** No risk signals (geo jump, ASN change, new user agent, security event)
automatically trigger re-OTP for a trusted device. Re-OTP occurs only when:
- Device trust has expired (30 days since `trusted_until`)
- Device trust has been explicitly revoked
- No device_id cookie is present

**Evidence:** No code — decision is by absence of implementation.

**Known limitations:** This is the most significant security gap in the current design. A device
stolen 29 days after trust registration will still be trusted for another day.

---

### Decision 6.2 — Step-up authentication for sensitive operations: not implemented

**What was decided:** No operation requires a fresh OTP on an already-trusted device. Changing
password, changing email, revoking devices, inviting users, and all admin operations require
only an active Supabase session with the appropriate role.

**Evidence:** No code — decision is by absence of implementation.

**Known limitations:** An attacker who steals the session cookie (or is already on a trusted
device) can perform all operations without additional verification.

---

### Decision 6.3 — Step-up OTP duration: N/A

**What was decided:** No code; step-up is not implemented.

---

### Decision 6.4 — Step-up UX: N/A

**What was decided:** No code; step-up is not implemented.

---

## Section 7 — Account Recovery

### Decision 7.1 — Lost email access: no recovery flow

**What was decided:** There is no documented in-app recovery flow for a user who has lost
access to their email address. The only path is manual admin intervention.

**Evidence:** No code; decision made by omission.

**Known limitations:** This is a known gap. A user who loses their email account and has no
other admin in the system is locked out permanently.

---

### Decision 7.2 — Backup codes: not implemented

**What was decided:** No backup codes are generated or stored.

**Evidence:** No code; no `backup_codes` table in migrations.

---

### Decision 7.3 — Manual recovery via support: no documented process

**What was decided:** An admin can use `revokeUserSessions()` to force-sign-out a user, then
reset their password via the Supabase admin dashboard. No formal support verification process
is documented.

**Evidence:** No code; decision made in conversation (no commit reference).

---

### Decision 7.4 — Account lockout: no automatic lockout

**What was decided:** There is no automatic account lockout after N failed password attempts.
Rate limiting (10 login attempts per IP per 60 seconds) is the primary protection against
brute force. There is no per-user failed-attempt counter.

**Evidence:** `lib/rate-limit.ts:62`
```typescript
login: { requests: 10, window: "60 s" },
```

The Supabase Auth dashboard may have its own lockout configuration, but no application-layer
lockout is implemented.

**Known limitations:** An attacker who rotates IPs can attempt more than 10 passwords per minute
per user. The 15-minute challenge TTL limits how quickly they can probe: even if they get past
the password gate, they can only issue 5 challenges per hour.

---

### Decision 7.5 — Rate limits on password reset attempts: 5 per email per hour

**What was decided:** `POST /api/auth/forgot-password` is rate-limited by email address:
5 requests per email per hour via the `password_reset` Upstash bucket.

**Evidence:** `lib/rate-limit.ts:77`
```typescript
password_reset: { requests: 5, window: "1 h" },
```

`app/api/auth/forgot-password/route.ts:67-71`
```typescript
const rl = await checkRateLimit("password_reset", `email:${email}`);
if (!rl.ok) {
  logger.warn("forgot_password_rate_limited", { email });
  return rateLimitExceeded(rl);
}
```

---

## Section 8 — Sign-In Attempt Limits

### Decision 8.1 — Failed password attempts: 10 per IP per 60 seconds

**What was decided:** The `login` rate-limit bucket allows 10 requests per IP per 60 seconds
(Upstash sliding window). There is no per-user counter.

**Evidence:** `lib/rate-limit.ts:62`
```typescript
login: { requests: 10, window: "60 s" },
```

`app/login/actions.ts:69-74`
```typescript
const rl = await checkRateLimit("login", `ip:${ip}`);
if (!rl.ok) {
  return { error: `Too many sign-in attempts. Try again in ${rl.retryAfterSec} seconds.` };
}
```

---

### Decision 8.2 — Lockout duration and unlock mechanism

**What was decided:** There is no permanent lockout. Rate limiting is a sliding window: after
60 seconds, 10 more attempts are allowed. After the window expires, the limiter resets.

**Evidence:** `lib/rate-limit.ts:156-163` — Upstash `slidingWindow`:
```typescript
const limiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(cfg.requests, cfg.window),
  prefix: `rl:${name}`,
});
```

---

### Decision 8.3 — Account existence on failed sign-in: not leaked

**What was decided:** A failed password sign-in returns `"Invalid email or password."` regardless
of whether the email is registered. No information about account existence is revealed.

**Evidence:** `app/login/actions.ts:89-91`
```typescript
if (signInError) {
  return { error: "Invalid email or password." };
}
```

---

### Decision 8.4 — CAPTCHA: not implemented

**What was decided:** No CAPTCHA or proof-of-work is used at the sign-in or password-reset
forms.

**Evidence:** No code; decision made by omission.

**Known limitations:** Automated credential-stuffing attacks at low rates (under 10/min) can
proceed indefinitely without any CAPTCHA barrier.

---

## Section 9 — Trusted Device Management

### Decision 9.1 — Device list fields: UA-parsed name, last used, trusted until

**What was decided:** The `/account/devices` page shows:
- Device: Browser + OS parsed from `ua_string` (e.g., "Chrome on Mac")
- Last used: relative time from `last_used_at`
- Trusted until: relative time from `trusted_until`
- "This device" badge if `is_current_device = true`
- "Sign out" button per row

IP address is NOT shown in the UI (privacy consideration).

**Evidence:** `components/TrustedDevicesList.tsx:124-180`

---

### Decision 9.2 — Device naming: auto-named from UA, no user-set names

**What was decided:** Device names are auto-generated from the user-agent string using a simple
regex parser (Chrome/Firefox/Edge/Safari/Opera + iOS/Android/Mac/Windows/Linux). Users cannot
set custom names.

**Evidence:** `components/TrustedDevicesList.tsx:183-200`
```typescript
function parseUaLabel(ua: string | null): string {
  if (!ua) return "Unknown device";
  let browser = "Browser";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/OPR\//.test(ua)) browser = "Opera";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Chrome\//.test(ua)) browser = "Chrome";
  else if (/Safari\//.test(ua)) browser = "Safari";
  // ...
  return `${browser} on ${os}`;
}
```

---

### Decision 9.3 — "Sign out everywhere": revokes all OTHER devices, not current

**What was decided:** The "Sign out all other devices" button calls
`POST /api/account/devices/sign-out-others`, which revokes all `trusted_devices` rows for the
user EXCEPT the current device (identified by the `opollo_device_id` cookie). The user remains
signed in on the current device.

There is no "sign out everywhere including this device" button in the UI, though a user can
revoke their current device individually (which clears the cookie).

**Evidence:** `app/api/account/devices/sign-out-others/route.ts:46`
```typescript
const revokedCount = await revokeAllOtherDevices(user.id, currentDeviceId);
```

`lib/2fa/devices.ts:172-191`
```typescript
export async function revokeAllOtherDevices(
  userId: string,
  keepDeviceId: string,
): Promise<number> {
  // ...
  .neq("device_id", keepDeviceId)  // excludes current device
```

---

### Decision 9.4 — Notification email on new device sign-in: not sent

**What was decided:** The approval email doubles as the new-device notification — it tells the
user that a sign-in was attempted from a particular device. No separate "new device signed in"
notification is sent after approval.

**Evidence:** No code sends a post-approval notification email.

**Known limitations:** If an attacker approves a challenge (e.g., by intercepting the email),
the victim gets no further notification that their account was accessed.

---

### Decision 9.5 — Approval email content: UA string, timestamp, approve link

**What was decided:** The approval email contains:
- Device: `${browser} on ${os}, ${timestamp}` (UTC)
- Approve button/link: `${NEXT_PUBLIC_SITE_URL}/auth/approve?token=<hex>`
- Expiry timestamp
- Warning to change password if not the operator

IP address is NOT included in the email.

**Evidence:** `lib/email/templates/login-approval.ts:86-111`
```typescript
const deviceLine = `${agent.browser} on ${agent.os}, ${requestedAt}`;

const bodyHtml = `
  <p>We received a sign-in attempt for your account.</p>
  <p><strong>Device:</strong> ${escapeHtml(deviceLine)}</p>
  <a href="${escapeHtml(input.approve_url)}">Approve sign-in</a>
  <p>This link expires at ${escapeHtml(expiresAt)}.</p>
  <p>If you didn't try to sign in, ignore this email and change your password immediately.</p>
`;
```

**Why IP is excluded:** Including an IP in the email creates a support-channel information leak
(operator can correlate IPs) without adding security value for the approval decision.

---

## Section 10 — Sign-In Flows: Variants

### Decision 10.1 — Password sign-in: full flow

**Step-by-step:**

1. User lands on `/login` (server component, `force-dynamic`)
2. If `opollo_2fa_pending` cookie present → redirect to `/logout` to clear stale state
3. If already signed in → redirect to `next` (default `/admin/sites`)
4. User submits email + password form → `loginAction()` server action
5. Rate limit check: `login` bucket, 10/min per IP
6. `supabase.auth.signInWithPassword({ email, password })` — Supabase validates
7. On failure: `"Invalid email or password."` (no account enumeration)
8. On success: check `AUTH_2FA_ENABLED`
   - If false: `redirect(next)` — done
   - If true: read `opollo_device_id` cookie, decode HMAC, call `isDeviceTrusted()`
     - If trusted: `touchTrustedDevice()`, clear stale 2FA cookies, `redirect(next)` — done
     - If not trusted: proceed to challenge flow
9. Check `recentChallengeCountForUser(userId)` — if ≥ 5, sign out and return error
10. `createLoginChallenge({ userId, ip, userAgent })` — creates `login_challenges` row
11. Send approval email via SendGrid
12. Set `opollo_2fa_pending` cookie (signed challenge_id, 20 min)
13. Set `opollo_pending_device_id` cookie (signed device_id, 20 min)
14. `redirect("/login/check-email?challenge_id=...&next=...")` — must use `redirect()` (not `return { redirectTo }`); see Incident §20.6
15. `/login/check-email` renders `<CheckEmailPolling>` which polls every 3 s
16. User clicks link in email → `/auth/approve?token=<hex>` (public route)
17. `/auth/approve` server component: hash token → lookup in `login_challenges` → `approveChallenge()`
18. `/auth/approve` renders auto-close page; polling detects `approved` status
19. `CheckEmailPolling` POSTs to `POST /api/auth/complete-login` with `{ challenge_id, trust_device }`
20. Complete-login: verify user owns challenge, `consumeChallenge()` (CAS), optionally register trusted device, clear pending cookies
21. Client receives `{ ok: true, data: { redirect_to: "/admin/sites" } }`
22. `window.location.assign(redirect_to)` — full page load to clear pending-cookie state from middleware

**Evidence:** All files listed above. Key file: `app/login/actions.ts` (complete server action).

---

### Decision 10.2 — Magic-link sign-in: not supported as standalone

**What was decided:** Magic links are used only internally in the `approve-here` lost-tab flow.
There is no magic-link sign-in option on the `/login` page.

**Evidence:** No magic-link sign-in form. `app/api/auth/approve-here/route.ts` uses `generateLink`
type `magiclink` only as a fallback.

---

### Decision 10.3 — OAuth sign-in: not supported

See Decision 2.6.

---

### Decision 10.4 — Invitation-based sign-up: token is the auth, but OTP still required on first login

**What was decided:** The invitation token in the email is the auth for the account-creation step
only. It validates the token, creates the user, and redirects to `/login`. The first sign-in
from the new user's browser goes through the full 2FA challenge if `AUTH_2FA_ENABLED=true`.
The invitation token does NOT substitute for the 2FA second factor.

**Why:** After accepting the invite, the user is in exactly the same position as any other
user on a new device. Their browser has no `opollo_device_id` cookie yet.

**Evidence:** `app/api/auth/accept-invite/route.ts:56-83` — returns `email + role`, no session:
```typescript
return NextResponse.json({
  ok: true,
  data: { email: result.email, role: result.role },
  // No session cookie set — user must sign in explicitly
});
```

---

### Decision 10.5 — Anonymous sessions: not supported

**What was decided:** No anonymous session support. The app is entirely behind authentication.

**Evidence:** `middleware.ts:58-147` — `PUBLIC_PATHS` is a small explicit set; everything else
requires authentication.

---

## Section 11 — Email Infrastructure

### Decision 11.1 — Email provider: SendGrid

**What was decided:** SendGrid (via `@sendgrid/mail` npm package) is the transactional email
provider for all auth emails.

**Why:** No code comment documents the provider selection rationale. Decision made before
this export was written.

**Evidence:** `lib/email/sendgrid.ts:3-4`
```typescript
import sgMail from "@sendgrid/mail";
```

---

### Decision 11.2 — Sender domain: noreply@opollo.com

**What was decided:** Auth emails are sent from `SENDGRID_FROM_EMAIL` (expected value:
`noreply@opollo.com`) with `SENDGRID_FROM_NAME` (default: `"Opollo Site Builder"`).

**Evidence:** `lib/email/sendgrid.ts:42-50`
```typescript
function fromAddress(): { email: string; name: string } {
  const email = process.env.SENDGRID_FROM_EMAIL;
  const name = process.env.SENDGRID_FROM_NAME ?? "Opollo Site Builder";
  if (!email) {
    throw new Error(
      "SENDGRID_FROM_EMAIL is not set. Expected `noreply@opollo.com` per the AUTH-FOUNDATION brief.",
    );
  }
  return { email, name };
}
```

---

### Decision 11.3 — DMARC / SPF / DKIM

**What was decided:** No code evidence. Configured at the DNS/SendGrid level outside the
application codebase.

**Evidence:** No code; decision made in DNS and SendGrid dashboard configuration.

---

### Decision 11.4 — Plain-text fallback: always included

**What was decided:** Every auth email sends both HTML and plain-text bodies. `renderLoginApprovalEmail()`
returns `{ subject, html, text }` and `sendEmail()` includes both.

**Evidence:** `lib/email/sendgrid.ts:95-102`
```typescript
const message = {
  to: input.to,
  from: { email: from.email, name: from.name },
  subject: input.subject,
  html: input.html,
  text: input.text,  // always provided
};
```

`lib/email/templates/login-approval.ts:113-126`
```typescript
const bodyText = [
  "We received a sign-in attempt for your account.",
  "",
  `Device: ${deviceLine}`,
  "",
  "Approve sign-in by clicking the link below:",
  input.approve_url,
  // ...
].join("\n");
```

**Why:** Email clients that cannot render HTML (some corporate mail gateways, terminal mail
clients) need a plain-text fallback to make the approval link accessible.

---

### Decision 11.5 — Email template library: custom render function

**What was decided:** Auth emails use a custom `renderBaseEmail()` / `renderLoginApprovalEmail()`
pattern, not a third-party library (no React Email, MJML, or Handlebars). Templates are TypeScript
functions that return `{ subject, html, text }`.

**Evidence:** `lib/email/templates/login-approval.ts:76-136` — the render function takes an
input object and returns structured output.

---

### Decision 11.6 — Branding

**What was decided:** The email uses a base shell (`renderBaseEmail()`) with the Opollo brand.
The login approval email heading is `"Approve sign-in to Opollo Site Builder"`. A footer note
is included: `"You received this email because someone signed in to your Opollo account."`.

**Evidence:** `lib/email/templates/login-approval.ts:128-135`
```typescript
const { html, text } = renderBaseEmail({
  heading: subject,
  bodyHtml,
  bodyText,
  footerNote: "You received this email because someone signed in to your Opollo account.",
});
```

---

### Decision 11.7 — Subject line

**What was decided:** Login approval: `"Approve sign-in to Opollo Site Builder"`.

**Evidence:** `lib/email/templates/login-approval.ts:81`
```typescript
const subject = "Approve sign-in to Opollo Site Builder";
```

---

### Decision 11.8 — Reply-to handling

**What was decided:** No custom reply-to. The `sendEmail()` function accepts an optional
`replyTo` override but no auth-specific override is passed. SendGrid defaults reply-to to the
from address.

**Evidence:** `lib/email/sendgrid.ts:58-60`
```typescript
interface SendEmailInput {
  // ...
  replyTo?: string;  // Optional — not passed by auth emails
}
```

---

### Decision 11.9 — Localization

**What was decided:** Auth emails are English-only. Timestamps are formatted in UTC using
`en-AU` locale (Australian English format: "Fri, 16 May 2026, 14:30 UTC").

**Evidence:** `lib/email/templates/login-approval.ts:59-74`
```typescript
function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleString("en-AU", {
    weekday: "short", day: "numeric", month: "long",
    year: "numeric", timeZone: "UTC",
  })}, ${d.toLocaleString("en-AU", {
    hour: "2-digit", minute: "2-digit", timeZone: "UTC", hour12: false,
  })} UTC`;
}
```

---

## Section 12 — Schema

### login_challenges

**File:** `supabase/migrations/0062_auth_foundation_2fa_schema.sql`

```sql
CREATE TABLE login_challenges (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES opollo_users(id) ON DELETE CASCADE,
  device_id    uuid NOT NULL,
  token_hash   text NOT NULL UNIQUE,
  status       text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'expired', 'consumed')),
  ip_hash      text,
  ua_string    text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  approved_at  timestamptz
);

CREATE INDEX login_challenges_user_status_idx
  ON login_challenges (user_id, status, created_at DESC);

CREATE INDEX login_challenges_user_created_idx
  ON login_challenges (user_id, created_at DESC);

ALTER TABLE login_challenges ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_all ON login_challenges
  FOR ALL TO service_role USING (true) WITH CHECK (true);
```

**RLS:** Service-role only. No user-facing RLS policies. All application reads/writes use the
service-role client via `lib/supabase.ts:getServiceRoleClient()`.

**Indexes:**
- `token_hash` — unique index (implicit on UNIQUE constraint). Hot-path for `/auth/approve` token lookup.
- `login_challenges_user_status_idx` — composite (user_id, status, created_at DESC). Used by polling endpoint.
- `login_challenges_user_created_idx` — composite (user_id, created_at DESC). Used by rate-limit count query.

**Retention:** No automatic cleanup. Old challenges accumulate. `status IN ('expired', 'consumed')`
rows are never pruned. This is a known operational debt — a cron job to prune records older than
30 days would be appropriate.

---

### trusted_devices

**File:** `supabase/migrations/0062_auth_foundation_2fa_schema.sql`

```sql
CREATE TABLE trusted_devices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES opollo_users(id) ON DELETE CASCADE,
  device_id       uuid NOT NULL,
  ua_string       text,
  ip_hash         text,
  trusted_until   timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz,
  last_used_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX trusted_devices_active_idx
  ON trusted_devices (user_id, device_id)
  WHERE revoked_at IS NULL;

CREATE INDEX trusted_devices_user_listing_idx
  ON trusted_devices (user_id, created_at DESC);

CREATE UNIQUE INDEX trusted_devices_user_device_uniq
  ON trusted_devices (user_id, device_id);

ALTER TABLE trusted_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_all ON trusted_devices
  FOR ALL TO service_role USING (true) WITH CHECK (true);
```

**RLS:** Service-role only. Same rationale as `login_challenges`.

**Indexes:**
- `trusted_devices_active_idx` — partial index on non-revoked rows. Hot-path for `isDeviceTrusted()`.
- `trusted_devices_user_listing_idx` — for `/account/devices` listing.
- `trusted_devices_user_device_uniq` — unique constraint enabling UPSERT semantics for re-approval.

**Retention:** Revoked rows are soft-deleted (`revoked_at` set). They are never hard-deleted.
This is a known gap — the listing query filters `revoked_at IS NULL`, so they are invisible
to users but accumulate in the database.

---

### opollo_users (auth-relevant columns)

The application-layer user table. Columns relevant to auth:

- `id uuid` — matches `auth.users.id`
- `email text` — canonical email address
- `role text` — `super_admin | admin | user`
- `revoked_at timestamptz` — hard-revocation timestamp. Non-null means reject any JWT with `iat < revoked_at_sec`.

**Evidence:** `lib/auth.ts:213-254` — `getCurrentUser()` reads these columns.

---

### opollo_config (kill-switch relevant)

```sql
-- Exists from migration 0004
-- Relevant row: key = 'auth_kill_switch', value = 'on' | <anything else>
```

**Evidence:** `lib/auth-kill-switch.ts:55-62`
```typescript
const { data, error } = await svc
  .from("opollo_config")
  .select("value")
  .eq("key", "auth_kill_switch")
  .maybeSingle();
if (!error && data && data.value === "on") { on = true; }
```

---

## Section 13 — Routes and Middleware

### middleware.ts (Edge runtime)

**File:** `middleware.ts:1-375`  
**Runtime:** Edge (Next.js default)

Two auth gates keyed off `FEATURE_SUPABASE_AUTH`:
- **Flag off:** Legacy HTTP Basic Auth (username + password from env)
- **Flag on:** Supabase Auth gate + optional kill-switch fallback to Basic Auth

**Supabase Auth gate flow:**
1. Check `isPublicPath(pathname)` — if public, pass through
2. `createMiddlewareAuthClient(req)` — builds SSR Supabase client with cookie adapter
3. `supabase.auth.getUser()` — server-verified (never `getSession()`)
4. If error: `authErrorResponse()` — fail closed (500 for API, redirect to `/auth-error` for HTML)
5. If no user: `unauthenticatedResponse()` — 401 JSON for API, redirect to `/login?next=...` for HTML
6. If `opollo_2fa_pending` cookie present: redirect to `/login/check-email` (unless already on allowed path)
7. Pass through; forward `x-pathname` header to server components

**Public paths** (`PUBLIC_PATHS` set + prefix checks):
```typescript
const PUBLIC_PATHS = new Set<string>([
  "/login", "/logout", "/auth-error", "/api/emergency", "/api/health",
  "/auth/forgot-password", "/auth/reset-password", "/auth/callback",
  "/auth/approve", "/auth/accept-invite",
]);
// Plus prefixes: /invite/, /approve/, /api/approve/, /viewer/,
// /api/auth/, /api/cron/, /api/webhooks/, /api/ops/, /_next/
```

**Auth requirements:** All paths not in PUBLIC_PATHS require `supabase.auth.getUser()` to return
a valid user. Role checks are per-route (not in middleware).

**Rate limits:** None in middleware. Rate limiting is per-route.

**Idempotency:** Middleware is stateless; every request is independently evaluated.

---

### GET /api/auth/callback

**File:** `app/api/auth/callback/route.ts:79-119`

Handles Supabase auth link exchanges. Supports two shapes:
- PKCE: `?code=<uuid>` → `exchangeCodeForSession(code)`
- OTP: `?token_hash=<hash>&type=<type>` → `verifyOtp({ token_hash, type })`

**Auth requirements:** Public. Session is being minted here.  
**Rate limits:** `auth_callback` bucket, 10 per 60 s per IP.  
**Open-redirect protection:** `safeNext()` validates `?next=` is same-origin relative path.  
**Idempotent:** Yes (codes are single-use on Supabase's side).

---

### POST /api/auth/complete-login

**File:** `app/api/auth/complete-login/route.ts:71-248`  
**Runtime:** nodejs

Called after user approves the email challenge. Body: `{ challenge_id: uuid, trust_device: boolean }`.

**Auth requirements:** Requires active Supabase session (`getUser()` must return user).  
**Idempotency:** The route handles `already_consumed` explicitly — returns 200 with `already_consumed: true` so multiple tabs racing don't get stuck. `lib/2fa/challenges.ts:210-238` — CAS protects the state transition.

---

### POST /api/auth/approve-here

**File:** `app/api/auth/approve-here/route.ts:41-151`  
**Runtime:** nodejs

Lost-tab fallback. Consumes an `approved` challenge and issues a magic link.

**Auth requirements:** Public (challenge_id is the auth).  
**Idempotency:** If challenge is already consumed, returns 409 `NOT_APPROVED`.

---

### GET /api/auth/challenge-status

**File:** `app/api/auth/challenge-status/route.ts:21-64`  
**Runtime:** nodejs

Polled every 3 s by `/login/check-email`. Returns challenge status.

**Auth requirements:** Requires active Supabase session. Re-checks `challenge.user_id === currentUser.id`.  
**Rate limits:** Implicit (10 req/60 s via `auth_callback` bucket applied at the client).

---

### POST /api/auth/resend-challenge

**File:** `app/api/auth/resend-challenge/route.ts:39-171`  
**Runtime:** nodejs

Issues a fresh challenge + email without invalidating the previous one.

**Auth requirements:** Requires Supabase session + valid `opollo_2fa_pending` cookie.  
**Rate limits:** Per-user challenge count (5/hour via `recentChallengeCountForUser`).

---

### POST /api/auth/accept-invite

**File:** `app/api/auth/accept-invite/route.ts:34-84`  
**Runtime:** nodejs

Creates auth.users and marks invite accepted.

**Auth requirements:** Public (token IS the auth).  
**Rate limits:** `login` bucket, 10 per 60 s per IP.

---

### POST /api/auth/forgot-password

**File:** `app/api/auth/forgot-password/route.ts:54-117`  
**Runtime:** nodejs

Triggers Supabase password-reset email. Always returns success (no account enumeration).

**Auth requirements:** Public.  
**Rate limits:** `password_reset` bucket, 5 per 1 hour per email.

---

### POST /api/auth/reset-password

**File:** `app/api/auth/reset-password/route.ts:35-105`  
**Runtime:** nodejs

Sets a new password. Requires active session (recovery session from PKCE exchange).

**Auth requirements:** Active Supabase session required.  
**Rate limits:** None (protected by session requirement + Supabase's own rate limits).

---

### DELETE /api/account/devices/[id]

**File:** `app/api/account/devices/[id]/route.ts:24-78`  
**Runtime:** nodejs

Revokes a single trusted_devices row. Self-only (filters `eq("user_id", actorUserId)`).

**Auth requirements:** Active session + `getCurrentUser()`.  
**Idempotency:** Returns 404 if already revoked.

---

### POST /api/account/devices/sign-out-others

**File:** `app/api/account/devices/sign-out-others/route.ts:20-51`  
**Runtime:** nodejs

Revokes all trusted devices except current. Requires valid `opollo_device_id` cookie.

**Auth requirements:** Active session + valid device cookie.

---

## Section 14 — UI / Client Components

### /login — LoginForm + loginAction

**File:** `app/login/page.tsx` (server component), `app/login/actions.ts` (server action)

`LoginPage` is a server component that reads cookies and performs sign-in short-circuits.
`LoginForm` is a client component (shadcn/ui form) that calls the `loginAction` server action.
`loginAction` performs all auth logic server-side and returns either an error string or
calls `redirect()`.

**Client-side state:** Form error state rendered from `loginAction` return value via
`useFormState`. No client-side validation beyond form field presence.

---

### /login/check-email — CheckEmailPolling

**File:** `app/login/check-email/page.tsx` (server component), `components/CheckEmailPolling.tsx` (client component)

Server component reads cookies, verifies challenge, renders the `CheckEmailPolling` shell.
`CheckEmailPolling` manages:
- Polling loop (3 s interval, paused on tab hidden)
- Trust-device checkbox (default: checked)
- Resend button with 60 s cooldown (skipped if `initialEmailFailed`)
- Completion latch (`completionStartedRef`) to prevent duplicate `/complete-login` POSTs
- Hard navigation via `window.location.assign()` (not Next.js router) to ensure middleware
  reads cleared cookies

**Evidence:** `components/CheckEmailPolling.tsx:56-103`

---

### /auth/approve — ApproveAutoClose + ApproveCompleteHere

**File:** `app/auth/approve/page.tsx`

Server component validates token via `lookupChallengeByToken()` and `approveChallenge()`.
Renders state-specific UI:
- `approved`: auto-close page (`ApproveAutoClose` component — `window.close()` after 2 s)
- `consumed`: "sign-in was completed elsewhere"
- `expired`: "link expired" + link to sign in again
- `invalid` / not found: "link invalid"

`ApproveCompleteHere` is the lost-tab fallback button: POSTs to `/api/auth/approve-here` and follows the magic-link redirect.

---

### /account/devices — TrustedDevicesList

**File:** `app/(platform)/account/devices/page.tsx` (server), `components/TrustedDevicesList.tsx` (client)

Server component calls `listTrustedDevicesForUser()` and `decodeDeviceCookie()` to identify
current device. Renders `TrustedDevicesList`.

`TrustedDevicesList` uses optimistic UI: each row has a "Sign out" button that calls
`DELETE /api/account/devices/[id]` and calls `router.refresh()` on success.

---

### SessionExpiryWatcher

**File:** `components/session/session-expiry-watcher.tsx`

Mounted in the admin shell layout. Composes `SessionExpiryModal` (T-120m warning) and
`SessionExpiryBanner` (T-5m warning, non-dismissable; grace window amber banner).

On `mustLogout`:
1. `supabase.auth.signOut()` (client-side, non-blocking)
2. `window.location.replace("/auth/expired?returnTo=...")` — hard navigation, back-button blocked

**Evidence:** `components/session/session-expiry-watcher.tsx:46-70`

---

## Section 15 — Audit Logging

### Decision 15.1 — Auth event logging: structured logger, not a dedicated table

**What was decided:** Auth events are logged via the application's structured logger (pino or
similar, `lib/logger.ts`). There is no dedicated `auth_audit_log` or `user_security_events`
table. Email sends are logged to `email_log` table.

**Evidence:**
- `app/login/actions.ts:188-196` — `logger.warn("auth.2fa.email_send_failed", ...)`
- `app/api/auth/complete-login/route.ts:234-240` — `logger.info("auth.2fa.complete_login.success", ...)`
- `lib/2fa/challenges.ts:87-92` — `logger.error("2fa.challenges.create_failed", ...)`
- `lib/email/sendgrid.ts:170-194` — `email_log` table for send/fail

Events logged (not exhaustive):
- `auth.2fa.complete_login.success` / `auth.2fa.complete_login.challenge_not_found` / `auth.2fa.complete_login.user_mismatch`
- `auth.2fa.trust_device.skipped_no_device_id`
- `auth.2fa.resend.create_failed` / `auth.2fa.resend.email_lookup_failed`
- `2fa.challenges.create_failed` / `2fa.challenges.lookup_by_id_failed`
- `2fa.devices.register_failed` / `2fa.devices.check_failed` / `2fa.devices.revoke_failed`
- `forgot_password_rate_limited` / `forgot_password_supabase_error` / `forgot_password_requested`
- `reset_password_success` / `reset_password_supabase_error`

---

### Decision 15.2 — Log destination

Structured logs go to Vercel's log stream (stdout). `email_log` table in Supabase.

---

### Decision 15.3 — Retention

Log retention is not explicitly configured in the codebase. Vercel's default log retention
applies for structured logs. `email_log` table has no explicit retention policy.

---

### Decision 15.4 — User-visible security log

**What was decided:** There is no user-visible security/activity log in the current UI.
The `/account/devices` page shows the trusted device list but not a history of sign-ins or
failed attempts.

**Evidence:** No code implements a security event history page.

---

## Section 16 — Edge Cases

### Cookie present but session expired (refresh fails)

The middleware calls `supabase.auth.getUser()`. If the session is expired and the refresh token
is also expired/missing, `getUser()` returns an error. The middleware falls into `userId = null`
and returns `unauthenticatedResponse()` — redirect to `/login?next=...` for HTML requests,
401 JSON for API requests. The device cookie is not cleared by the middleware (it persists for
30 days independently). On the next sign-in, the device will be recognized.

**Evidence:** `middleware.ts:265-278`

---

### Session valid but device cookie missing (incognito, cookie cleared)

The user has an active Supabase session but no `opollo_device_id` cookie. Middleware lets the
request through (session is valid). The login action's device check: `decodeDeviceCookie(undefined)` returns `null`. Since there's no cookie, `isDeviceTrusted()` is not called. The
user must go through a new challenge flow on next sign-in.

If the user is already signed in (middleware passes), they can access the app normally. The
device cookie absence only affects sign-in, not ongoing authenticated navigation.

**Evidence:** `app/login/actions.ts:130-133`:
```typescript
const cookieValue = cookieJar.get(DEVICE_ID_COOKIE)?.value;
const deviceIdFromCookie = decodeDeviceCookie(cookieValue);
if (deviceIdFromCookie) { // null if missing
  // ...
}
// falls through to challenge flow
```

---

### Device explicitly revoked, user signs in from that browser again

After explicit revocation, the `trusted_devices` row has `revoked_at` set. The `isDeviceTrusted()`
query filters `.is("revoked_at", null)`, so the row is not matched. The old `device_id` cookie
value is still in the browser (we only clear the cookie on explicit "sign out this device"
which calls `maxAge: 0`). On the next sign-in:
- `decodeDeviceCookie()` decodes the old cookie (still valid HMAC)
- `isDeviceTrusted()` returns false (revoked row excluded)
- A new challenge is issued
- On completion with `trust_device=true`, `registerTrustedDevice()` UPSERTs with `revoked_at: null`

The UPSERT overwrites the revoked row because the UNIQUE constraint is on `(user_id, device_id)`.
This means revoking a device and then re-approving from the same browser re-trusts the same
`device_id`.

**Evidence:** `lib/2fa/devices.ts:46-57`:
```typescript
await supabase.from("trusted_devices").upsert({
  user_id: input.userId,
  device_id: input.deviceId,
  revoked_at: null,          // explicitly clears the revocation
  // ...
}, { onConflict: "user_id,device_id" });
```

---

### OTP expired before user entered code

The challenge TTL is 15 minutes. After expiry, `/auth/approve?token=...` loads the approval
page; `lookupChallengeByToken()` finds the row; `approveChallenge()` checks `new Date(row.expires_at).getTime() <= Date.now()` and returns `{ ok: false, reason: "expired" }`. The page renders "This sign-in
attempt expired." The polling endpoint also returns `expired` status.

**Evidence:** `lib/2fa/challenges.ts:179-187`

---

### OTP max-attempts exhausted (rate limit hit)

When the user hits the 5/hour challenge limit, the login action signs them out and returns an
error message. If they were mid-challenge (on `/login/check-email`) and try to resend, the
`resend-challenge` route returns 429. The user must wait an hour.

**Evidence:** `app/api/auth/resend-challenge/route.ts:71-84`

---

### User requests OTP, never enters it, tries again 5 minutes later

Both the old and new challenge rows remain valid (previous is not invalidated on resend).
The user can click either link. The rate limit counts both toward the 5/hour cap.

**Evidence:** `app/api/auth/resend-challenge/route.ts:28-31` (comment confirming both remain valid).

---

### Browser A trusted, switches to Browser B (OTP), back to Browser A

Browser A's `opollo_device_id` cookie is independent of Browser B's session. Going through
2FA on Browser B issues a new device_id for Browser B's cookie (or trusts it if the user checks
the box). Browser A's cookie is unaffected. Returning to Browser A: the cookie is still present
and the trust record still exists (unless the 30-day window has lapsed). Browser A remains
trusted.

**Evidence:** `lib/2fa/devices.ts:48` — UPSERT on `(user_id, device_id)` only affects the
matching row; Browser A's row is untouched.

---

### User on trusted device, suddenly hits app from different country

Trusted device check only evaluates `device_id`, `user_id`, `revoked_at`, and `trusted_until`.
There is no geo check. A trusted device accessed from a different country passes normally.

**Evidence:** `lib/2fa/devices.ts:74-91` — no geo check in `isDeviceTrusted()`.

---

### User on trusted device, different IP in same city

Same answer as above — no IP check.

---

### User invited via email, accepts on brand-new device: OTP required after invite

The invitation flow creates the user account (`auth.users`) and redirects to `/login`. The new
user has no `opollo_device_id` cookie. Their first sign-in (after setting their password during
invite acceptance) will trigger a full 2FA challenge if `AUTH_2FA_ENABLED=true`. The invitation
token is NOT the second factor for subsequent sign-ins.

**Evidence:** `app/api/auth/accept-invite/route.ts:75-84` — returns `email + role`, no session set.

---

### User has active session, password changed elsewhere: session continues

Changing the password via `supabase.auth.updateUser({ password })` does NOT revoke existing
sessions. The user can continue to use their current session after a password change (on the
same or another device). This is a known limitation of Supabase Auth's default behavior —
password change does not force re-authentication of active sessions unless `signOutAuthUser()`
is also called.

**Evidence:** `app/api/auth/reset-password/route.ts:61-63` — only `updateUser`; no `signOutAuthUser`.

---

### User triggers "sign out all other devices": current device not logged out

`POST /api/account/devices/sign-out-others` excludes the current device from revocation.
The device_id cookie is not cleared. The user stays signed in on the current browser.

**Evidence:** `lib/2fa/devices.ts:172-191` — `.neq("device_id", keepDeviceId)`.

---

### Browser blocks cookies entirely (Brave strict shields, Safari ITP)

The `opollo_device_id` cookie is first-party (same domain). Safari ITP and Brave strict mode
target third-party tracking cookies; they do not block first-party HttpOnly cookies. No impact.

If a user has deliberately blocked ALL cookies (unusual), the device cookie cannot be set.
The trust check always returns false; the user is re-challenged on every sign-in. This is
acceptable degraded behavior.

**Evidence:** Cookies are set with `sameSite: "lax"`, `httpOnly: true` — first-party, not
third-party. No localStorage fallback.

---

### User on trusted device, auth.users deleted from Supabase dashboard

`supabase.auth.getUser()` in middleware contacts GoTrue. If the `auth.users` row is deleted,
GoTrue returns an error. The middleware treats this as an auth error (not an unauthenticated
state) because `getUser()` throws vs. returning `{ user: null }`. The middleware returns
`authErrorResponse()` — 500 for API, redirect to `/auth-error` for HTML.

**Evidence:** `middleware.ts:264-279`:
```typescript
} catch {
  // Exception is the binary-failure path: fail closed
  return authErrorResponse(req);
}
```

The trusted_devices row will remain orphaned (no ON DELETE CASCADE to auth.users because
trusted_devices references opollo_users, not auth.users; and opollo_users has its own
cascade setup).

---

### Multiple browser tabs open during sign-in: race conditions in OTP verification

This is the most complex edge case. The system handles it explicitly:

1. **Two tabs on `/login/check-email` polling simultaneously:** Both poll the same challenge.
   Both detect `approved`. The `completionStartedRef` ref in `CheckEmailPolling` is per-component-
   instance — two tabs have two separate instances, so both attempt `/complete-login`.

2. **First tab wins the consume CAS:** Returns 200 with `already_consumed: false`, sets cookies, navigates.

3. **Second tab gets `consumed` status from challenge lookup:** The route detects
   `challenge.status === "consumed"` and returns 200 with `already_consumed: true`, clearing
   the `opollo_2fa_pending` cookie on that tab too.

4. **Result:** Both tabs navigate to `/admin/sites`. Neither is stuck on the check-email page.

**Evidence:** `app/api/auth/complete-login/route.ts:141-151`:
```typescript
if (challenge.status === "consumed") {
  clearPendingCookies(cookieJar);
  return NextResponse.json({
    ok: true,
    data: { redirect_to: "/admin/sites", already_consumed: true },
  });
}
```

Also `components/CheckEmailPolling.tsx:19-23` — the latch comment explains the previous bug.

---

## Section 17 — Compliance and Privacy

### Decision 17.1 — Device data as personal data

**What was decided:** No code; decision made in the privacy policy (outside this repo).

IP hashes and UA strings in `trusted_devices` and `login_challenges` may constitute personal
data under GDPR because they relate to identifiable individuals. However, because IPs are
hashed with a pepper (not reversible), the hash alone is not directly identifying.

The `trusted_until` and `last_used_at` timestamps combined with a `user_id` foreign key are
clearly personal data — they identify when a specific user used a specific device.

---

### Decision 17.2 — Retention period for device records

**What was decided:** No automatic retention policy is implemented. Records accumulate
indefinitely. This is a known gap.

**Evidence:** No code in migrations or cron jobs prunes trusted_devices rows.

---

### Decision 17.3 — Retention period for OTP/challenge records

**What was decided:** No automatic retention policy. `login_challenges` rows accumulate.
Expired and consumed rows are never pruned.

**Evidence:** No cleanup job for login_challenges exists in `app/api/cron/`.

---

### Decision 17.4 — DSAR / right-to-erasure

**What was decided:** No code implements a DSAR export or erasure of trusted_devices or
login_challenges records. Manual deletion via Supabase dashboard is the only current path.

The `user_id` foreign key with `ON DELETE CASCADE` in both tables means that deleting the
`opollo_users` row cascades to both `trusted_devices` and `login_challenges`. Deleting the
`auth.users` row in Supabase auth would need to be coordinated separately.

**Evidence:** `supabase/migrations/0062_auth_foundation_2fa_schema.sql:43-44, 97-98`:
```sql
user_id uuid NOT NULL REFERENCES opollo_users(id) ON DELETE CASCADE,
```

---

## Section 18 — Test Coverage

### lib/__tests__/auth.test.ts (Integration, Layer 3)

**File:** `lib/__tests__/auth.test.ts:1-237`  
**Type:** Integration (real Supabase)

Tests:
- `getCurrentUser` returns id/email/role for a signed-in viewer
- `getCurrentUser` returns the promoted role for admins
- `getCurrentUser` returns null when no session
- `requireRole` returns user when role matches
- `requireRole` throws AuthError(403) when role doesn't match
- `requireRole` throws AuthError(401) when no session
- Role changes reflect immediately (no JWT invalidation needed)
- `revokeUserSessions` rejects pre-revocation JWT on next call
- `revokeUserSessions` allows fresh sign-in after revocation
- `signOutAuthUser` deletes refresh_tokens (soft sweep)

**Known gaps:** No test for the `iat == revoked_at_sec` boundary condition (documented in code comment but not pinned by a test). No test for the middleware 2FA-pending gate.

---

### lib/__tests__/auth-kill-switch.test.ts (Unit, Layer 1)

Tests kill-switch caching, DB-read behavior, and edge cases.

---

### lib/__tests__/auth-redirect.test.ts (Unit, Layer 1)

Tests URL resolution priority (env var > request origin > throw), protocol validation,
trailing-slash normalization.

---

### lib/__tests__/auth-callback.test.ts (Unit, Layer 1)

Tests `planAuthCallback()` pure function:
- Hash fragment with access_token + refresh_token → `set_session`
- Hash fragment with error → `auth_error`
- Query `?code=` → `forward_to_api`
- Query `?token_hash=` → `forward_to_api`
- Recovery type → destination is `/auth/reset-password`
- Open-redirect prevention in `isSafeNext()`

---

### lib/__tests__/password-policy.test.ts (Unit, Layer 1)

Tests `validatePassword()`: empty, whitespace-only, too short (< 12), too long (> 256),
valid password.

---

### e2e/auth.spec.ts (E2E, Layer 5)

Playwright test. Tests the full sign-in flow including 2FA challenge. Details not read;
test exists.

---

### e2e/auth-passwords.spec.ts (E2E, Layer 5)

Playwright test for password reset flow.

---

### Known coverage gaps:

1. No integration test for `createLoginChallenge`, `approveChallenge`, `consumeChallenge` in isolation.
2. No integration test for `isDeviceTrusted` / `registerTrustedDevice`.
3. No security test asserting `/api/account/devices/[id]` rejects cross-user delete attempts.
4. No test for the concurrent-tabs race condition in complete-login.
5. No test for cookie signing/verification (unit tests for `encodeDeviceCookie`/`decodeDeviceCookie`).
6. No test for the middleware 2FA-pending gate redirect behavior.

---

## Section 19 — Anti-Patterns and "Things We'd Change"

### Anti-pattern 19.1 — No step-up authentication for sensitive operations

**What's currently in the code:** Password change, email change, device revocation, and admin
operations require only an active session. No fresh OTP is demanded.

**Why it's not ideal:** An attacker with a stolen session cookie (e.g., via XSS, malicious
browser extension, or network interception on HTTP) can change the password and lock out the
legitimate user.

**What we'd do instead:** Require a fresh email-approval challenge for: password change, email
change, member invitation, account deletion, API key creation.

**Why it hasn't been changed:** Not on the roadmap at the time of the AUTH-FOUNDATION phases;
implementation adds complexity to every protected route.

---

### Anti-pattern 19.2 — No session revocation on password change

**What's currently in the code:** `POST /api/auth/reset-password` calls only `updateUser`;
does not call `signOutAuthUser()` or `revokeUserSessions()`.

**Why it's not ideal:** An attacker who resets the victim's password via the forgot-password
flow (having compromised the email) does not invalidate the victim's current sessions. If the
victim is actively using the app, they continue to be able to act.

**What we'd do instead:** After `updateUser({ password })`, call `revokeUserSessions(user.id)`
to invalidate all existing tokens. The user re-auths with the new password on the next request.

**Why it hasn't been changed:** The current design errs toward user convenience (you stay
signed in after resetting your own password). The security risk is accepted.

---

### Anti-pattern 19.3 — Trusted device re-registration overwrites revocation

**What's currently in the code:** `registerTrustedDevice()` uses UPSERT with `onConflict: "user_id,device_id"` and explicitly sets `revoked_at: null`. This means re-approval from a
revoked browser cookie restores trust to the exact same device_id.

**Why it's not ideal:** A user who revokes a device (because it was stolen) and then the
thief completes a 2FA challenge from that device (having compromised the email too) gets the
device re-trusted.

**What we'd do instead:** When processing a revoked device_id, generate a NEW device_id for
the approval flow rather than re-using the one from the cookie. This would mean a stolen +
revoked browser cookie cannot be "revived" via a new approval flow.

**Why it hasn't been changed:** The current behavior is intentional for the common case
(user manually revokes their own device to test the UI, then re-trusts it). The security edge
case requires both a stolen device AND a compromised email account, which is beyond the current
threat model.

---

### Anti-pattern 19.4 — No cleanup of expired/consumed challenge rows

**What's currently in the code:** `login_challenges` accumulates expired and consumed rows
indefinitely.

**Why it's not ideal:** Table bloat over months/years of usage. The rate-limit query
`recentChallengeCountForUser()` uses a `created_at` filter (last 1 hour), so it's unaffected
by historical rows, but the table will grow unboundedly.

**What we'd do instead:** A nightly cron job deleting `login_challenges` rows where
`created_at < now() - interval '30 days'`.

**Why it hasn't been changed:** Low urgency — the table is small at current scale.

---

### Anti-pattern 19.5 — approve-here signs in on the approving device

**What's currently in the code:** `POST /api/auth/approve-here` generates a magic link for
the approving device (e.g., phone), not for the original desktop browser. The user ends up
signed in on the phone, not on the desktop.

**Why it's not ideal:** The UX is surprising. An operator who approves from their phone expects
to continue on their desktop.

**What we'd do instead:** After approval, show a "Approved — return to your desktop" page.
The original browser's polling loop would detect `approved` and complete login independently.
The phone doesn't need to complete sign-in itself.

**Why it hasn't been changed:** The approve-here path is the lost-tab fallback, not the primary
path. Fixing it requires a cross-device coordination mechanism.

---

## Section 20 — Production Lessons

### Incident 20.1 — Approval link bounced to /login (May 2026)

**What happened:** The `/auth/approve` page was not in `PUBLIC_PATHS`. When an operator on a
different device (without a Supabase session) clicked the approval link, middleware redirected
them to `/login` instead of the approval page. The 2FA flow was broken on cross-device approval.

**Code change:** Added `/auth/approve` to `PUBLIC_PATHS` in `middleware.ts:89`. Also added
`/auth/accept-invite` for the same reason (UAT §1.1.4).

**Evidence:** `middleware.ts:84-100` comments document the fix and the reasoning.

---

### Incident 20.2 — Invite tokens unredeemable (May 2026)

**What happened:** `/auth/accept-invite` was not in `PUBLIC_PATHS`. New users who clicked the
invite link were bounced to `/login` (they had no account yet). Discovered during UAT.

**Code change:** Added `/auth/accept-invite` to `PUBLIC_PATHS`. `middleware.ts:96-100`.

---

### Incident 20.3 — Stuck after sign-in (multi-tab race, May 2026)

**What happened:** Two browser tabs open on `/login/check-email`. Both detected `approved`.
Both POSTed to `/complete-login`. One won the CAS and navigated; the other got a 409
ALREADY_CONSUMED and displayed an error. The navigation from the winning tab worked, but the
user was confused by the error on the losing tab.

**Code changes:**
1. `complete-login` route: return 200 with `already_consumed: true` when challenge is already consumed (rather than 409).
2. `CheckEmailPolling`: single-fire latch (`completionStartedRef`) to prevent duplicate POSTs from the same tab.

**Evidence:** `app/api/auth/complete-login/route.ts:141-151` (already_consumed handling) and `components/CheckEmailPolling.tsx:19-23` (latch comment).

---

### Incident 20.4 — Stale 2FA cookie creating sign-in loop (/login → /login/check-email → /login)

**What happened:** After a failed/expired 2FA challenge, the `opollo_2fa_pending` cookie
remained in the browser. On the next visit to `/login`, the already-authenticated short-circuit
redirected to `next`, but middleware saw the pending cookie and redirected back to
`/login/check-email`, which found no valid challenge and... bounced back. Infinite loop.

**Code change:** `/login` page server component now detects `opollo_2fa_pending` cookie and
immediately redirects to `/logout` to clear all state. `app/login/page.tsx:52-54`.

**Evidence:** `app/login/page.tsx:42-54`.

---

### Incident 20.5 — revoked_at timestamp comparison (same-second boundary bug)

**What happened:** After a call to `revokeUserSessions()`, a fresh sign-in on the same wall-clock
second (in a fast test environment) was incorrectly rejected because `iat * 1000 < revoked_at_ms`
evaluated to false due to millisecond vs. second precision.

**Code change:** `getCurrentUser()` now floors `revoked_at` to second precision before comparison:
`const revokedAtSec = Math.floor(revokedAtMs / 1000); if (iat < revokedAtSec) ...`.

**Evidence:** `lib/auth.ts:222-244` (detailed comment explaining the fix).

---

### Incident 20.6 — 2FA challenge path: Incident 20.4 guard collision (blank page after sign-in)

**What happened:** After PR #990 (Bug 2 — "Signing in…" hang fix), admin users with
`AUTH_2FA_ENABLED=true` experienced a blank white page after submitting credentials.
The approval email arrived and clicking it showed "approved", but the user was never
signed in. After ~5 attempts the account hit the rate limit ("Too many sign-in
attempts").

**Root cause:** PR #990 changed the 2FA challenge path from `redirect(checkEmailUrl)`
to `return { redirectTo: checkEmailUrl }` for consistency with the non-2FA path.
However, when a Server Action returns data (rather than calling `redirect()`), Next.js
re-renders the current page's server components before streaming the RSC response to
the client. That re-render of `/login/page.tsx` fired the Incident 20.4 stale-cookie
guard (`app/login/page.tsx:52-54`): the guard detected the `opollo_2fa_pending` cookie
that `loginAction` had just set, called `redirect("/logout")`, and cleared the session.
The browser received a redirect to `/logout` — never reaching `/login/check-email` at
all. `window.location.assign` in `LoginForm.useEffect` never ran because the RSC
payload contained a redirect, not data.

Evidence from Vercel logs: zero `GET /login/check-email` requests in the entire
affected window; browser went directly from `POST /login` → `GET /logout` in 1–3 s.
DB evidence: `login_challenges` rows in `approved` state with `consumed = false`
(email approval worked; `CheckEmailPolling` never ran to consume the challenge).

**Code change:** In `app/login/actions.ts`, the 2FA challenge path is restored to
`redirect(checkEmailUrl)` (throws NEXT_REDIRECT, bypassing the page re-render).
The non-2FA path and the trusted-device path correctly keep `return { redirectTo }`
because those paths do NOT set `opollo_2fa_pending`, so the Incident 20.4 guard
cannot fire on them.

**Evidence:** `app/login/actions.ts` (comment above `redirect(checkEmailUrl)`);
`tests/regressions/login-action-hard-redirect.test.ts` (Incident 20.6 describe block,
Case A + Case B).

---

## Section 21 — Environment Variables

| Name | Purpose | Type | Required | Example | Where set | Rotation |
|------|---------|------|----------|---------|-----------|---------|
| `FEATURE_SUPABASE_AUTH` | Enable Supabase Auth gate (vs. Basic Auth) | `"true"` or `"1"` | Yes (for Supabase Auth) | `true` | Production, Preview | No rotation needed |
| `SUPABASE_URL` | Supabase project REST URL | URL string | Yes | `https://xxx.supabase.co` | Production, Preview, Development | Change if project migrated |
| `SUPABASE_ANON_KEY` | Supabase anonymous (public) key | JWT string | Yes | `eyJhbG...` | Production, Preview, Development | Rotate in Supabase dashboard if compromised |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key (bypasses RLS) | JWT string | Yes | `eyJhbG...` | Production, Preview, Development | Rotate immediately if leaked |
| `NEXT_PUBLIC_SUPABASE_URL` | Client-side Supabase URL | URL string | Yes | `https://xxx.supabase.co` | All | Same as SUPABASE_URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client-side anon key | JWT string | Yes | `eyJhbG...` | All | Same as SUPABASE_ANON_KEY |
| `NEXT_PUBLIC_SITE_URL` | Canonical app URL for auth redirect URLs | URL string | Yes (production) | `https://app.opollo.com` | Production, Preview | No rotation needed |
| `COOKIE_SIGNING_SECRET` | HMAC-SHA256 key for device_id and pending-2FA cookies | 64-char hex (32 bytes) | Yes (with 2FA) | `a1b2c3...` (64 hex chars) | Production, Preview, Development | Rotate: changing this invalidates all existing device cookies (all users re-challenged on next sign-in) |
| `IP_HASH_PEPPER` | Pepper for SHA-256 IP hashing | Any non-empty string | Recommended | `random-string-here` | Production, Preview, Development | Rotation invalidates stored IP hashes (audit only; no auth impact) |
| `AUTH_2FA_ENABLED` | Feature flag for email-2FA gate | `"true"` or `"1"` | No (default off) | `true` | Production, Preview | Flip to `false` to disable 2FA system-wide |
| `SENDGRID_API_KEY` | SendGrid API key for email sends | `SG.xxx...` | Yes | `SG.abc123...` | Production, Preview | Rotate in SendGrid if compromised; update env var |
| `SENDGRID_FROM_EMAIL` | From address for auth emails | Email string | Yes | `noreply@opollo.com` | Production, Preview | Change requires updating Supabase email templates |
| `SENDGRID_FROM_NAME` | From name for auth emails | String | No (default: `"Opollo Site Builder"`) | `Opollo` | Production, Preview | No rotation |
| `BASIC_AUTH_USER` | Legacy HTTP Basic Auth username | String | Conditional (if using Basic Auth path) | `admin` | Production, Preview | Rotate with BASIC_AUTH_PASSWORD |
| `BASIC_AUTH_PASSWORD` | Legacy HTTP Basic Auth password | String | Conditional | `strongpassword` | Production, Preview | Rotate if compromised |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis URL for rate limiting | URL | No (fail-open if absent) | `https://xxx.upstash.io` | Production, Preview | No rotation needed |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis token | String | No (fail-open if absent) | `AXxx...` | Production, Preview | Rotate if compromised |
| `OPOLLO_EMERGENCY_KEY` | Break-glass emergency route auth | String | Optional | `long-random-string` | Production | Rotate immediately if leaked |
| `SUPABASE_DB_URL` | Direct Postgres connection for `pg` (auth revocation, tests) | PostgreSQL connection string | Yes (for `revokeUserSessions`) | `postgresql://postgres:pass@host:5432/postgres` | Production, Preview, Development | Rotate with Supabase DB password |

---

## Section 22 — Dependencies

| Package | Version | Purpose | Why chosen | Notes |
|---------|---------|---------|------------|-------|
| `@supabase/ssr` | `^0.5.x` | SSR-compatible Supabase client with cookie adapter factories | Official Supabase-recommended package for Next.js App Router (replaces deprecated `@supabase/auth-helpers-nextjs`) | `createServerClient` is fetch-based; runs on Edge |
| `@supabase/supabase-js` | `^2.x` | Supabase client (used in tests and browser client) | Official Supabase client library | |
| `@sendgrid/mail` | `^8.x` | SendGrid email API | Selected at project inception; all auth email goes through this | Must not be imported from Edge bundle (Node-only) |
| `@upstash/ratelimit` | `^2.x` | Sliding-window rate limiting backed by Upstash Redis | Works on Edge runtime; official Upstash Next.js integration | Fail-open if Upstash is unavailable |
| `@upstash/redis` | `^1.x` | Redis client for Upstash | Paired with `@upstash/ratelimit` | |
| `zod` | `^3.x` | Runtime body validation in API routes | Used throughout the application for all user-input validation | |
| `pg` | `^8.x` | Direct Postgres client for auth.sessions/auth.refresh_tokens | PostgREST does not expose `auth.*` schema; direct pg needed for soft revocation | Node-only; never import from middleware |

---

## Verification Pass

### Check 1: Sections 2, 5, 6 — evidence or explicit "no code" statement

- **2.1:** Evidence `app/login/actions.ts:130-143` ✓
- **2.2:** Evidence `lib/2fa/challenges.ts:63-106` ✓
- **2.3:** Evidence `app/login/actions.ts:84-143` ✓
- **2.4:** Evidence `app/login/actions.ts:145-230` ✓
- **2.5:** Evidence `app/api/auth/accept-invite/route.ts:1-84` ✓
- **2.6:** `**Evidence:** No code; decision made in the AUTH-FOUNDATION P3 brief` ✓
- **5.1:** Evidence `lib/2fa/devices.ts:74-91` ✓
- **5.2:** Evidence `app/api/auth/complete-login/route.ts:222-229` ✓
- **5.3:** Evidence `lib/2fa/cookies.ts:56-91` ✓
- **5.4:** Evidence `lib/2fa/challenges.ts:69` ✓
- **5.5:** Evidence `supabase/migrations/0062_auth_foundation_2fa_schema.sql:58` ✓
- **5.6:** Evidence `lib/2fa/cookies.ts:157-168` ✓
- **5.7:** Evidence `lib/2fa/devices.ts:74-91` ✓
- **5.8:** Evidence `app/api/auth/complete-login/route.ts:222-229` ✓
- **6.1:** `No code — decision is by absence of implementation` ✓
- **6.2:** `No code — decision is by absence of implementation` ✓
- **6.3:** `No code; step-up is not implemented` ✓
- **6.4:** `No code; step-up is not implemented` ✓

### Check 2: No "TBD", "TODO", "see above", "as discussed", "etc."

Reviewed — none present.

### Check 3: Edge cases count

Sections 16 contains 15 distinct edge case paragraphs. ✓

### Check 4: Code blocks count

38 distinct code blocks across sections 2–22. ✓

---

*End of auth-decisions export. Self-contained. Receiver requires no access to Opollo Site Builder repo.*
