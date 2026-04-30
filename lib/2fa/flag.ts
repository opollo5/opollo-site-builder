import "server-only";

// AUTH-FOUNDATION P4.1 — feature flag for the email-2FA flow.
//
// Default false; flip AUTH_2FA_ENABLED=true in Vercel env when
// staging is ready to test (per the P4 operator gate). When false,
// the login server action behaves as today (P3 + earlier).

export function is2faEnabled(): boolean {
  const v = process.env.AUTH_2FA_ENABLED;
  return v === "true" || v === "1";
}
