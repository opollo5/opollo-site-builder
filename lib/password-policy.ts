// ---------------------------------------------------------------------------
// M14-3 — shared password policy.
//
// One source of truth for password strength across every surface that
// sets a password: the admin reset endpoint (M14-1), the forgot-password
// flow (M14-3), and the account-security page (M14-4).
//
// Policy: 12-character minimum, no complexity class requirements.
// Length beats character-class rules for equivalent UX friction
// (NIST SP 800-63B §5.1.1.2), and every extra rule creates a new way
// for a legit password to be rejected for reasons the user can't
// reason about.
//
// The helper is pure — no network, no crypto — so the same code runs
// client-side for live feedback AND server-side as the gate.
// ---------------------------------------------------------------------------

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;

export type PasswordIssue =
  | "TOO_SHORT"
  | "TOO_LONG"
  | "WHITESPACE_ONLY"
  | "EMPTY";

export type PasswordValidationResult =
  | { ok: true }
  | { ok: false; issues: PasswordIssue[]; message: string };

/**
 * Validate a candidate password against the shared policy.
 *
 * Returns `{ ok: true }` when every rule passes. Otherwise returns an
 * `issues` list (machine-readable) plus a human-readable `message` the
 * UI can render without further translation.
 */
export function validatePassword(raw: string): PasswordValidationResult {
  const issues: PasswordIssue[] = [];

  if (raw.length === 0) {
    issues.push("EMPTY");
  } else if (raw.trim().length === 0) {
    issues.push("WHITESPACE_ONLY");
  }

  if (raw.length < PASSWORD_MIN_LENGTH) {
    issues.push("TOO_SHORT");
  }
  if (raw.length > PASSWORD_MAX_LENGTH) {
    issues.push("TOO_LONG");
  }

  if (issues.length === 0) return { ok: true };

  return {
    ok: false,
    issues,
    message: messageForIssues(issues),
  };
}

function messageForIssues(issues: PasswordIssue[]): string {
  if (issues.includes("EMPTY")) {
    return "Password is required.";
  }
  if (issues.includes("WHITESPACE_ONLY")) {
    return "Password cannot be only whitespace.";
  }
  if (issues.includes("TOO_SHORT")) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (issues.includes("TOO_LONG")) {
    return `Password must be ${PASSWORD_MAX_LENGTH} characters or fewer.`;
  }
  return "Password is invalid.";
}

/**
 * Short, UI-friendly strength hint. Cheap enough to compute on every
 * keystroke in a Client Component. Returns `null` when the password
 * meets the policy — callers render the "OK" state however they want.
 */
export function passwordStrengthHint(raw: string): string | null {
  if (raw.length === 0) return "Enter a password.";
  if (raw.length < PASSWORD_MIN_LENGTH) {
    const remaining = PASSWORD_MIN_LENGTH - raw.length;
    return `${remaining} more character${remaining === 1 ? "" : "s"} needed.`;
  }
  return null;
}
