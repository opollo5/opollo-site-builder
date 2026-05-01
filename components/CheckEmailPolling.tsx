"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

// AUTH-FOUNDATION P4.2 — /login/check-email polling shell.
//
// Polls GET /api/auth/challenge-status?challenge_id=... every 3s.
// Pauses when the tab goes hidden (visibilitychange API), resumes
// on focus. When the server reports status='approved' OR 'consumed',
// POSTs to /api/auth/complete-login (now idempotent for the consumed
// case — see the route's docstring for why) and follows the redirect.
//
// Single-fire contract: completion runs at most once per page mount.
// A ref-based latch (completionStartedRef) prevents the duplicate
// invocations that earlier shipped — the useEffect deps included
// `status`, so every status transition rescheduled the poll loop AND
// re-evaluated completeLogin's closure, racing two concurrent
// /complete-login POSTs and stranding the user when the second tab
// won the CAS but the first tab's network response never resolved
// the navigation.

const POLL_INTERVAL_MS = 3000;
const RESEND_COOLDOWN_MS = 60_000;

type Status = "pending" | "approved" | "expired" | "consumed" | "error";

type CompletionPhase =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "navigating"; to: string }
  | { kind: "failed"; message: string };

export function CheckEmailPolling({
  challengeId,
  next,
  initialEmailFailed,
}: {
  challengeId: string;
  next: string;
  initialEmailFailed: boolean;
}) {
  const [status, setStatus] = useState<Status>("pending");
  const [pollErrorMsg, setPollErrorMsg] = useState<string | null>(null);
  const [trustDevice, setTrustDevice] = useState(true);
  const [completion, setCompletion] = useState<CompletionPhase>({ kind: "idle" });
  const [resendBlocked, setResendBlocked] = useState<number>(
    initialEmailFailed ? 0 : Date.now() + RESEND_COOLDOWN_MS,
  );
  const [resending, setResending] = useState(false);
  const [_now, setNowTick] = useState(Date.now()); // re-render ticker for the resend countdown

  const visibilityRef = useRef(true);
  const completionStartedRef = useRef(false);
  const trustDeviceRef = useRef(trustDevice);
  trustDeviceRef.current = trustDevice;

  const completeLogin = useCallback(
    async (opts?: { force?: boolean }) => {
      if (!opts?.force && completionStartedRef.current) return;
      completionStartedRef.current = true;
      setCompletion({ kind: "running" });
      try {
        const res = await fetch("/api/auth/complete-login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            challenge_id: challengeId,
            trust_device: trustDeviceRef.current,
          }),
        });
        const payload = (await res.json().catch(() => null)) as
          | { ok: true; data: { redirect_to?: string; already_consumed?: boolean } }
          | { ok: false; error: { code: string; message: string } }
          | null;
        if (!res.ok || !payload?.ok) {
          const message =
            payload && payload.ok === false
              ? payload.error.message
              : `Couldn't complete sign-in (HTTP ${res.status}).`;
          // Allow retry: failed attempts release the latch.
          completionStartedRef.current = false;
          setCompletion({ kind: "failed", message });
          return;
        }
        const dest = payload.data.redirect_to ?? next;
        setCompletion({ kind: "navigating", to: dest });
        // window.location.assign forces a full document load. router.push
        // keeps the SPA cache warm but the browser doesn't always re-read
        // the Set-Cookie clears made by the server in the same response;
        // a hard navigation guarantees middleware sees the cleared cookies
        // before /admin/sites renders.
        window.location.assign(dest);
      } catch (err) {
        const message = `Network error: ${err instanceof Error ? err.message : String(err)}`;
        completionStartedRef.current = false;
        setCompletion({ kind: "failed", message });
      }
    },
    [challengeId, next],
  );

  // Poll loop. Crucially, `status` is NOT in the deps — including it
  // would cancel + restart the loop on every status change, which
  // is what made the previous version race two concurrent
  // /complete-login calls. The loop self-terminates when it observes
  // a terminal status.
  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    function schedule(delay: number) {
      timeoutId = setTimeout(() => void poll(), delay);
    }

    async function poll() {
      if (cancelled) return;
      if (!visibilityRef.current) return; // resume on visibility change
      try {
        const res = await fetch(
          `/api/auth/challenge-status?challenge_id=${encodeURIComponent(challengeId)}`,
          { cache: "no-store" },
        );
        const payload = (await res.json().catch(() => null)) as
          | { ok: true; data: { status: Status } }
          | { ok: false; error: { code: string; message: string } }
          | null;
        if (cancelled) return;
        if (!res.ok || !payload?.ok) {
          setStatus("error");
          setPollErrorMsg(
            payload && payload.ok === false
              ? payload.error.message
              : `Status check failed (HTTP ${res.status}).`,
          );
          return;
        }
        const observed = payload.data.status;
        setStatus(observed);
        if (observed === "approved" || observed === "consumed") {
          // Both states require us to call complete-login from THIS
          // browser to clear the local opollo_2fa_pending cookie.
          // complete-login is idempotent for `consumed`.
          await completeLogin();
          return;
        }
        if (observed === "expired") {
          return;
        }
        schedule(POLL_INTERVAL_MS);
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setPollErrorMsg(err instanceof Error ? err.message : String(err));
      }
    }

    function onVisibility() {
      visibilityRef.current = document.visibilityState === "visible";
      if (visibilityRef.current && !cancelled) {
        schedule(0);
      }
    }
    document.addEventListener("visibilitychange", onVisibility);

    schedule(0);

    return () => {
      cancelled = true;
      if (timeoutId !== null) clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [challengeId, completeLogin]);

  // Re-render every 1s while resend is on cooldown so the button label
  // updates.
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const cooldownRemaining = Math.max(
    0,
    Math.ceil((resendBlocked - Date.now()) / 1000),
  );

  async function onResend() {
    if (resending || cooldownRemaining > 0) return;
    setResending(true);
    setPollErrorMsg(null);
    try {
      const res = await fetch("/api/auth/resend-challenge", { method: "POST" });
      const payload = (await res.json().catch(() => null)) as
        | { ok: true }
        | { ok: false; error: { code: string; message: string } }
        | null;
      if (!res.ok || !payload?.ok) {
        setPollErrorMsg(
          payload && payload.ok === false
            ? payload.error.message
            : `Resend failed (HTTP ${res.status}).`,
        );
      } else {
        setResendBlocked(Date.now() + RESEND_COOLDOWN_MS);
      }
    } finally {
      setResending(false);
    }
  }

  // Terminal: expired challenge.
  if (status === "expired") {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          This sign-in attempt expired (15-minute window). The approval
          email is no longer valid.
        </Alert>
        <a
          href="/login"
          className="inline-block text-sm font-medium underline underline-offset-4"
        >
          Start over
        </a>
      </div>
    );
  }

  // Completion failed — show error + retry + start-over.
  if (completion.kind === "failed") {
    return (
      <div className="space-y-4">
        <Alert variant="destructive" data-testid="check-email-error">
          {completion.message}
        </Alert>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            onClick={() => void completeLogin({ force: true })}
            data-testid="complete-login-retry"
          >
            Try again
          </Button>
          <a
            href="/login"
            className="text-sm font-medium underline underline-offset-4"
          >
            Start over
          </a>
        </div>
      </div>
    );
  }

  // In flight — completing or about to navigate.
  if (completion.kind === "running" || completion.kind === "navigating") {
    return (
      <div className="space-y-4">
        <div
          className="rounded-md border bg-muted/30 px-3 py-2 text-sm"
          data-testid="check-email-status"
        >
          {completion.kind === "running"
            ? "Approved — completing sign-in…"
            : "Signed in. Redirecting…"}
        </div>
      </div>
    );
  }

  // Pending — waiting for the operator to click the email link.
  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
        <span data-testid="check-email-status" className="text-muted-foreground">
          {status === "error"
            ? "Connection issue — retrying."
            : "Waiting for you to click the approval link in the email…"}
        </span>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={trustDevice}
          onChange={(e) => setTrustDevice(e.target.checked)}
          className="mt-1"
          data-testid="trust-device-checkbox"
        />
        <span>
          <strong>Trust this device for 30 days.</strong>{" "}
          <span className="text-xs text-muted-foreground">
            Future sign-ins from this browser skip the email-approval
            step. Uncheck on a shared computer.
          </span>
        </span>
      </label>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          Lost the email? You can retry below.
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => void onResend()}
          disabled={resending || cooldownRemaining > 0}
          data-testid="resend-button"
        >
          {resending
            ? "Sending…"
            : cooldownRemaining > 0
              ? `Resend in ${cooldownRemaining}s`
              : "Resend email"}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Wrong email?{" "}
        <a href="/logout" className="underline">
          Sign in again
        </a>{" "}
        with a different account.
      </p>

      {pollErrorMsg && (
        <Alert variant="destructive" data-testid="check-email-error">
          {pollErrorMsg}
        </Alert>
      )}
    </div>
  );
}
