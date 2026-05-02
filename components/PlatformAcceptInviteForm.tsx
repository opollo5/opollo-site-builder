"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Platform-layer accept-invite form.
//
// Posts to POST /api/platform/invitations/accept with the token, the
// invitation email (re-validated server-side), the chosen password, and
// the recipient's full name. Per BUILD.md the platform-layer minimum is
// 8 characters (Supabase Auth's default). Distinct from the operator-side
// AcceptInviteForm which uses a 12-char floor for Opollo internal users.

const MIN_LENGTH = 8;

export function PlatformAcceptInviteForm({
  token,
  email,
}: {
  token: string;
  email: string;
}) {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort = password.length > 0 && password.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && confirm !== password;
  const fullNameOk = fullName.trim().length > 0;
  const canSubmit =
    !submitting &&
    fullNameOk &&
    password.length >= MIN_LENGTH &&
    password === confirm;

  const strength = useMemo(() => scoreStrength(password), [password]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/platform/invitations/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token,
          email,
          password,
          full_name: fullName.trim(),
        }),
      });
      const payload = (await res.json().catch(() => null)) as
        | { ok: true; data: { user_id: string; company_id: string; role: string } }
        | { ok: false; error: { code: string; message: string } }
        | null;
      if (payload?.ok) {
        // The platform layer doesn't auto-sign-in. The recipient now has
        // an auth.users row + a platform_users + platform_company_users
        // membership, but they prove credentials by signing in fresh.
        const target = `/login?invite=accepted&email=${encodeURIComponent(email)}`;
        router.push(target);
        return;
      }
      setError(
        payload?.ok === false
          ? payload.error.message
          : `Couldn't accept invitation (HTTP ${res.status}).`,
      );
    } catch (err) {
      setError(`Network error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="invite-email" className="block text-sm font-medium">
          Email
        </label>
        <Input
          id="invite-email"
          value={email}
          readOnly
          disabled
          className="mt-1 bg-muted/40"
        />
      </div>

      <div>
        <label htmlFor="invite-full-name" className="block text-sm font-medium">
          Full name
        </label>
        <Input
          id="invite-full-name"
          required
          maxLength={254}
          autoComplete="name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          disabled={submitting}
          className="mt-1"
          data-testid="platform-accept-invite-full-name"
        />
      </div>

      <div>
        <label htmlFor="invite-password" className="block text-sm font-medium">
          Password
        </label>
        <Input
          id="invite-password"
          type="password"
          required
          minLength={MIN_LENGTH}
          maxLength={200}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={submitting}
          className="mt-1 font-mono text-sm"
          aria-invalid={tooShort}
          data-testid="platform-accept-invite-password"
        />
        <StrengthMeter score={strength} length={password.length} />
        {tooShort && (
          <p className="mt-1 text-sm text-destructive">
            At least {MIN_LENGTH} characters.
          </p>
        )}
      </div>

      <div>
        <label htmlFor="invite-confirm" className="block text-sm font-medium">
          Confirm password
        </label>
        <Input
          id="invite-confirm"
          type="password"
          required
          minLength={MIN_LENGTH}
          maxLength={200}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={submitting}
          className="mt-1 font-mono text-sm"
          aria-invalid={mismatch}
          data-testid="platform-accept-invite-confirm"
        />
        {mismatch && (
          <p className="mt-1 text-sm text-destructive">
            Passwords don&apos;t match.
          </p>
        )}
      </div>

      {error && (
        <Alert variant="destructive" data-testid="platform-accept-invite-error">
          {error}
        </Alert>
      )}

      <Button
        type="submit"
        disabled={!canSubmit}
        className="w-full"
        data-testid="platform-accept-invite-submit"
      >
        {submitting ? "Setting password…" : "Set password and continue"}
      </Button>
    </form>
  );
}

function scoreStrength(password: string): number {
  if (password.length < MIN_LENGTH) return 0;
  let bonus = 0;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) bonus += 1;
  if (/[0-9]/.test(password)) bonus += 1;
  if (/[^A-Za-z0-9]/.test(password)) bonus += 1;
  if (password.length >= 16) return Math.min(4, 1 + bonus + 1);
  return Math.min(4, 1 + bonus);
}

function StrengthMeter({ score, length }: { score: number; length: number }) {
  if (length === 0) return null;
  const labels = ["", "weak", "fair", "good", "strong"];
  const tone =
    score === 0
      ? "text-destructive"
      : score === 1
        ? "text-destructive"
        : score === 2
          ? "text-warning"
          : score === 3
            ? "text-success"
            : "text-success";
  return (
    <div
      className="mt-1 flex items-center gap-2"
      data-testid="platform-accept-invite-strength"
    >
      <div className="flex h-1.5 flex-1 gap-0.5" aria-hidden>
        {[1, 2, 3, 4].map((step) => (
          <div
            key={step}
            className={cn(
              "h-full flex-1 rounded-full transition-smooth",
              step <= score
                ? score >= 3
                  ? "bg-success"
                  : score === 2
                    ? "bg-warning"
                    : "bg-destructive"
                : "bg-muted",
            )}
          />
        ))}
      </div>
      <span className={cn("text-sm", tone)}>
        {score === 0 ? `${length}/${MIN_LENGTH}` : labels[score]}
      </span>
    </div>
  );
}
