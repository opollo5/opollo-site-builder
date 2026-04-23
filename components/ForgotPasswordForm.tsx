"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// ---------------------------------------------------------------------------
// M14-3 — /auth/forgot-password form.
//
// Submits to POST /api/auth/forgot-password. The API route's contract
// is no-enumeration: the response shape is identical whether the email
// is registered or not. The form always renders the same success copy
// after a 200, directing the user to check their inbox (and spam).
// ---------------------------------------------------------------------------

type FormState = "idle" | "submitting" | "success" | "error";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<FormState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state === "submitting") return;
    setState("submitting");
    setErrorMessage(null);

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const payload = (await res.json().catch(() => null)) as
        | { ok: true }
        | { ok: false; error: { code: string; message: string } }
        | null;

      if (res.ok && payload?.ok) {
        setState("success");
        return;
      }

      const code = payload?.ok === false ? payload.error.code : "INTERNAL_ERROR";
      const fallback =
        payload?.ok === false
          ? payload.error.message
          : `Request failed (HTTP ${res.status}).`;
      const translated =
        code === "RATE_LIMITED"
          ? "Too many reset requests for this email. Try again in a bit."
          : code === "VALIDATION_FAILED"
            ? "Please enter a valid email address."
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

  if (state === "success") {
    return (
      <div
        role="status"
        className="w-full rounded-md border border-primary/40 bg-primary/5 p-4 text-sm"
      >
        <p className="font-medium">Check your email.</p>
        <p className="mt-1 text-muted-foreground">
          If an account exists for <span className="font-mono">{email}</span>,
          you&apos;ll receive a reset link shortly. The link expires in 60
          minutes, so act soon. Don&apos;t forget to check your spam folder.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="forgot-email" className="text-sm font-medium">
          Email
        </label>
        <Input
          id="forgot-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          suppressHydrationWarning
        />
      </div>

      {errorMessage && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage}
        </p>
      )}

      <Button type="submit" disabled={state === "submitting" || email.length === 0}>
        {state === "submitting" ? "Sending…" : "Send reset link"}
      </Button>
    </form>
  );
}
