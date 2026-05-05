"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  PASSWORD_MIN_LENGTH,
  passwordStrengthHint,
  validatePassword,
} from "@/lib/password-policy";

// ---------------------------------------------------------------------------
// M14-4 — /account/security change-password form.
//
// Requires the current password as the change gate. Client validates
// policy + confirmation match + current/new-differ; server re-validates
// everything AND verifies the current password against Supabase before
// the update.
//
// On success: shows an inline "Password updated" confirmation, clears
// the fields, and stays on the page. The session does NOT end — Supabase
// keeps the refresh token valid across a password change.
// ---------------------------------------------------------------------------

type FormState = "idle" | "submitting" | "success" | "error";

export function AccountSecurityForm({ userEmail }: { userEmail: string }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [state, setState] = useState<FormState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const hint = useMemo(() => passwordStrengthHint(next), [next]);
  const mismatch = confirm.length > 0 && confirm !== next;
  const sameAsCurrent = next.length > 0 && next === current;
  const canSubmit =
    state === "idle" &&
    current.length > 0 &&
    next.length >= PASSWORD_MIN_LENGTH &&
    next === confirm &&
    next !== current;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state === "submitting") return;

    const policy = validatePassword(next);
    if (!policy.ok) {
      setErrorMessage(policy.message);
      setState("error");
      return;
    }
    if (next !== confirm) {
      setErrorMessage("The two new-password fields don't match.");
      setState("error");
      return;
    }
    if (next === current) {
      setErrorMessage("New password must be different from your current password.");
      setState("error");
      return;
    }

    setState("submitting");
    setErrorMessage(null);

    try {
      const res = await fetch("/api/account/change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          current_password: current,
          new_password: next,
        }),
      });
      const payload = (await res.json().catch(() => null)) as
        | { ok: true }
        | { ok: false; error: { code: string; message: string } }
        | null;

      if (res.ok && payload?.ok) {
        setCurrent("");
        setNext("");
        setConfirm("");
        setState("success");
        return;
      }

      const code =
        payload?.ok === false ? payload.error.code : "INTERNAL_ERROR";
      const fallback =
        payload?.ok === false
          ? payload.error.message
          : `Request failed (HTTP ${res.status}).`;
      const translated =
        code === "INCORRECT_CURRENT_PASSWORD"
          ? "Your current password is incorrect."
          : code === "SAME_PASSWORD"
            ? "New password must be different from your current password."
            : code === "PASSWORD_WEAK"
              ? payload?.ok === false
                ? payload.error.message
                : fallback
              : code === "RATE_LIMITED"
                ? "Too many password-change attempts. Wait a bit and try again."
                : code === "UNAUTHORIZED"
                  ? "Your session expired. Sign in again."
                  : fallback;
      setErrorMessage(translated);
      setState("error");
    } catch (err) {
      setErrorMessage(
        `Network error: ${err instanceof Error ? err.message : String(err)}`,
      );
      setState("error");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full flex-col gap-5">
      <p className="text-sm text-muted-foreground">
        Signed in as <span className="font-mono">{userEmail}</span>
      </p>

      <div className="flex flex-col gap-1">
        <label htmlFor="current-password" className="text-sm font-medium">
          Current password
        </label>
        <Input
          id="current-password"
          name="current_password"
          type="password"
          required
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          suppressHydrationWarning
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="new-password" className="text-sm font-medium">
          New password
        </label>
        <Input
          id="new-password"
          name="new_password"
          type="password"
          required
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          suppressHydrationWarning
        />
        {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
        {sameAsCurrent && (
          <p className="text-sm text-destructive">
            New password must differ from the current one.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="confirm-password" className="text-sm font-medium">
          Confirm new password
        </label>
        <Input
          id="confirm-password"
          name="confirm"
          type="password"
          required
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          suppressHydrationWarning
        />
        {mismatch && (
          <p className="text-sm text-destructive">Passwords don&apos;t match.</p>
        )}
      </div>

      {errorMessage && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage}
        </p>
      )}

      {state === "success" && (
        <p
          role="status"
          className="rounded-md border border-primary/40 bg-primary/5 p-3 text-sm"
        >
          Password updated. Your session remains active on this device.
        </p>
      )}

      <Button type="submit" disabled={!canSubmit}>
        {state === "submitting" ? "Updating…" : "Update password"}
      </Button>
    </form>
  );
}
