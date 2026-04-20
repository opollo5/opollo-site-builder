"use client";

import { useFormState, useFormStatus } from "react-dom";

import { loginAction, type LoginState } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const INITIAL_STATE: LoginState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Signing in…" : "Sign in"}
    </Button>
  );
}

export function LoginForm({ next }: { next: string }) {
  // Server Action wiring: <form action={formAction}> becomes a real
  // URL-backed form in the rendered HTML, so submission works even if
  // client hydration never completes (browser extensions like
  // Grammarly are a known cause of silent hydration failure). useFormState
  // surfaces the returned error without a full page reload when JS is
  // available, and falls back to a normal server-rendered response
  // otherwise.
  //
  // suppressHydrationWarning on each input: Grammarly injects
  // data-gramm_* attributes between SSR output and hydration, which
  // React flags as a hydration mismatch. Suppressing the warning keeps
  // React's later updates clean — the form still works without this,
  // but the console stays readable.
  const [state, formAction] = useFormState(loginAction, INITIAL_STATE);

  return (
    <form action={formAction} className="flex w-full flex-col gap-4">
      <input type="hidden" name="next" value={next} />

      <div className="flex flex-col gap-1">
        <label htmlFor="login-email" className="text-sm font-medium">
          Email
        </label>
        <Input
          id="login-email"
          name="email"
          type="email"
          required
          autoComplete="email"
          autoFocus
          suppressHydrationWarning
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="login-password" className="text-sm font-medium">
          Password
        </label>
        <Input
          id="login-password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          suppressHydrationWarning
        />
      </div>

      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}

      <SubmitButton />
    </form>
  );
}
