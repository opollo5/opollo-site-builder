// ---------------------------------------------------------------------------
// Runtime environment detection — single source of truth.
//
// Precedence: APP_ENV (explicit override) → VERCEL_ENV → NODE_ENV
//
// APP_ENV allows a staging Vercel branch (VERCEL_ENV=preview) to be
// distinguished from regular PR previews. Set APP_ENV=staging in the
// Vercel "staging" branch's environment variable overrides.
//
// Consumers should import isProduction / isStaging / isPreview /
// isDevelopment rather than reading VERCEL_ENV directly, so staging
// behaviour can be toggled in one place.
// ---------------------------------------------------------------------------

export type RuntimeEnv = "production" | "staging" | "preview" | "development";

export function getRuntimeEnv(): RuntimeEnv {
  const explicit = process.env.APP_ENV as RuntimeEnv | undefined;
  if (explicit && ["production", "staging", "preview", "development"].includes(explicit)) {
    return explicit;
  }

  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv === "production") return "production";
  if (vercelEnv === "preview") return "preview";

  return "development";
}

export const isProduction = (): boolean => getRuntimeEnv() === "production";
export const isStaging = (): boolean => getRuntimeEnv() === "staging";
export const isPreview = (): boolean => getRuntimeEnv() === "preview";
export const isDevelopment = (): boolean => getRuntimeEnv() === "development";

/**
 * Returns true when running in an environment that should NOT trigger
 * real external side-effects (emails, billing calls, AI generation).
 *
 * In staging: guard unless STAGING_SIDE_EFFECTS_ENABLED=1 explicitly
 * unlocks them. This prevents a staging branch from accidentally spamming
 * clients or consuming AI quota.
 */
export function sideEffectsGuarded(): boolean {
  if (isStaging() && process.env.STAGING_SIDE_EFFECTS_ENABLED !== "1") return true;
  return false;
}

/**
 * For staging environments, returns the override recipient for all
 * transactional emails. Prevents real emails going to clients during
 * staging tests. Returns null if not in staging or override not set.
 */
export function stagingEmailRecipient(): string | null {
  if (!isStaging()) return null;
  return process.env.STAGING_EMAIL_RECIPIENT ?? null;
}
