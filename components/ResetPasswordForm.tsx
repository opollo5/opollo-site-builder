"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  PASSWORD_MIN_LENGTH,
  passwordStrengthHint,
  validatePassword,
} from "@/lib/password-policy";

// ---------------------------------------------------------------------------
// M14-3 — /auth/reset-password form.
//
// Rendered only when a session is present (page.tsx gates the "expired
// link" state). Client-side password policy feedback is live on every
// keystroke via passwordStrengthHint(); the server-side validator in
// lib/password-policy.ts is the authoritative check and runs again in
// /api/auth/reset-password before the updateUser call.
//
// After success: router.replace("/admin/sites") — the user is already
// authenticated (the recovery callback set the session), so sending
// them directly to the admin surface is the obvious landing.
// ---------------------------------------------------------------------------

type FormState = "idle" | "submitting" | "success" | "error";

export function ResetPasswordForm({ userEmail }: { userEmail: string | null }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [state, setState] = useState<FormState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const hint = useMemo(() => passwordStrengthHint(password), [password]);
  const mismatch = confirm.length > 0 && confirm !== password;
  const canSubmit =
    state === "idle" &&
    password.length >= PASSWORD_MIN_LENGTH &&
    confirm === password;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state === "submitting") return;

    // Client-side belt + braces. Server re-validates.
    const policy = validatePassword(password);
    if (!policy.ok) {
      setErrorMessage(policy.message);
      setState("error");
      return;
    }
    if (password !== confirm) {
      setErrorMessage("The two passwords don't match.");
      setState("error");
      return;
    }

    setState("submitting");
    setErrorMessage(null);

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ new_password: password }),
      });
      const payload = (await res.json().catch(() => null)) as
        | { ok: true }
        | { ok: false; error: { code: string; message: string } }
        | null;

      if (res.ok && payload?.ok) {
        setState("success");
        // Refresh the router so the admin layout re-fetches with the
        // session — then push to the landing.
        router.refresh();
        router.replace("/admin/sites");
        return;
      }

      const code =
        payload?.ok === false ? payload.error.code : "INTERNAL_ERROR";
      const fallback =
        payload?.ok === false
          ? payload.error.message
          : `Request failed (HTTP ${res.status}).`;
      const translated =
        code === "UNAUTHORIZED"
          ? "Your reset link has expired. Request a new one."
          : code === "SAME_PASSWORD"
            ? "New password must be different from your current password."
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
    <form onSubmit={handleSubmit} className="flex w-full flex-col gap-4">
      {userEmail && (
        <p className="text-xs text-muted-foreground">
          Signed in as <span className="font-mono">{userEmail}</span>
        </p>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor="reset-password" className="text-sm font-medium">
          New password
        </label>
        <Input
          id="reset-password"
          name="new_password"
          type="password"
          required
          autoComplete="new-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          suppressHydrationWarning
        />
        {hint && (
          <p className="text-xs text-muted-foreground">{hint}</p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="reset-password-confirm" className="text-sm font-medium">
          Confirm new password
        </label>
        <Input
          id="reset-password-confirm"
          name="confirm"
          type="password"
          required
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          suppressHydrationWarning
        />
        {mismatch && (
          <p className="text-xs text-destructive">Passwords don&apos;t match.</p>
        )}
      </div>

      {errorMessage && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage}
        </p>
      )}

      <Button type="submit" disabled={!canSubmit}>
        {state === "submitting" ? "Updating…" : "Update password"}
      </Button>
    </form>
  );
}
