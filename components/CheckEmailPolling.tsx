"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

// AUTH-FOUNDATION P4.2 — /login/check-email polling shell.
//
// Polls GET /api/auth/challenge-status?challenge_id=... every 3s.
// Pauses when the tab goes hidden (visibilitychange API), resumes
// on focus. When the server reports status='approved', POSTs to
// /api/auth/complete-login with the trust-device checkbox state and
// redirects to `next` on success.

const POLL_INTERVAL_MS = 3000;
const RESEND_COOLDOWN_MS = 60_000;

type Status = "pending" | "approved" | "expired" | "consumed" | "error";

export function CheckEmailPolling({
  challengeId,
  next,
  initialEmailFailed,
}: {
  challengeId: string;
  next: string;
  initialEmailFailed: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("pending");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [trustDevice, setTrustDevice] = useState(true);
  const [completing, setCompleting] = useState(false);
  const [resendBlocked, setResendBlocked] = useState<number>(
    initialEmailFailed ? 0 : Date.now() + RESEND_COOLDOWN_MS,
  );
  const [resending, setResending] = useState(false);
  const [_now, setNowTick] = useState(Date.now()); // re-render ticker for the resend countdown
  const visibilityRef = useRef(true);

  // Trust-device checkbox value at the moment of completion.
  const trustDeviceRef = useRef(trustDevice);
  trustDeviceRef.current = trustDevice;

  const completeLogin = useCallback(async () => {
    if (completing) return;
    setCompleting(true);
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
        | { ok: true; data: { redirect_to?: string } }
        | { ok: false; error: { code: string; message: string } }
        | null;
      if (!res.ok || !payload?.ok) {
        setErrorMsg(
          payload?.ok === false
            ? payload.error.message
            : `Couldn't complete sign-in (HTTP ${res.status}).`,
        );
        setCompleting(false);
        return;
      }
      const dest = payload.data.redirect_to ?? next;
      router.push(dest);
    } catch (err) {
      setErrorMsg(`Network error: ${err instanceof Error ? err.message : String(err)}`);
      setCompleting(false);
    }
  }, [challengeId, completing, next, router]);

  // Poll loop.
  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    function schedule(delay: number) {
      timeoutId = setTimeout(() => void poll(), delay);
    }

    async function poll() {
      if (cancelled) return;
      if (!visibilityRef.current) {
        // Tab hidden — back off; resume on visibility change.
        return;
      }
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
          setErrorMsg(
            payload?.ok === false
              ? payload.error.message
              : `Status check failed (HTTP ${res.status}).`,
          );
          return;
        }
        const next = payload.data.status;
        setStatus(next);
        if (next === "approved") {
          await completeLogin();
          return;
        }
        if (next === "expired" || next === "consumed") {
          // Terminal — let the user retry via /login.
          return;
        }
        schedule(POLL_INTERVAL_MS);
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setErrorMsg(err instanceof Error ? err.message : String(err));
      }
    }

    function onVisibility() {
      visibilityRef.current = document.visibilityState === "visible";
      if (visibilityRef.current && status === "pending" && !cancelled) {
        // Resume immediately on focus.
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
  }, [challengeId, completeLogin, status]);

  // Re-render every 1s while resend is on cooldown so the button
  // label updates.
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const cooldownRemaining = Math.max(0, Math.ceil((resendBlocked - Date.now()) / 1000));

  async function onResend() {
    if (resending || cooldownRemaining > 0) return;
    setResending(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/auth/resend-challenge", { method: "POST" });
      const payload = (await res.json().catch(() => null)) as
        | { ok: true }
        | { ok: false; error: { code: string; message: string } }
        | null;
      if (!res.ok || !payload?.ok) {
        setErrorMsg(
          payload?.ok === false
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

  if (status === "expired") {
    return (
      <Alert variant="destructive">
        This sign-in attempt expired. Return to{" "}
        <a href="/login" className="font-medium underline">
          /login
        </a>{" "}
        to start over.
      </Alert>
    );
  }
  if (status === "consumed") {
    return (
      <Alert>
        This sign-in has been completed in another tab. Refresh, or{" "}
        <a href="/admin/sites" className="font-medium underline">
          continue to the admin
        </a>
        .
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
        <span data-testid="check-email-status" className="text-muted-foreground">
          {status === "pending"
            ? "Waiting for you to click the approval link in the email…"
            : status === "approved"
              ? "Approved — completing sign-in…"
              : "Connection issue — retrying."}
        </span>
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={trustDevice}
          onChange={(e) => setTrustDevice(e.target.checked)}
          disabled={completing}
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

      {errorMsg && (
        <Alert variant="destructive" data-testid="check-email-error">
          {errorMsg}
        </Alert>
      )}
    </div>
  );
}
