"use client";

import { useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

// AUTH-FOUNDATION P4.3 — "Complete sign-in here" fallback button.
//
// Posts to /api/auth/approve-here. The server consumes the challenge,
// generates a Supabase magic link for the user, and returns the
// action_link as `redirect_to` for the browser to follow.
//
// trust_device defaults to FALSE here per the brief — the approving
// device may be a different machine (phone) than the one that
// originally signed in, so we don't auto-trust it.

export function ApproveCompleteHere({ challengeId }: { challengeId: string }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/approve-here", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challenge_id: challengeId }),
      });
      const payload = (await res.json().catch(() => null)) as
        | { ok: true; data: { redirect_to: string } }
        | { ok: false; error: { code: string; message: string } }
        | null;
      if (!res.ok || !payload?.ok) {
        setError(
          payload?.ok === false
            ? payload.error.message
            : `Couldn't complete sign-in (HTTP ${res.status}).`,
        );
        setSubmitting(false);
        return;
      }
      // Hand the browser to the magic link, which sets the session
      // cookie + redirects to /admin/sites.
      window.location.assign(payload.data.redirect_to);
    } catch (err) {
      setError(`Network error: ${err instanceof Error ? err.message : String(err)}`);
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      <Button
        type="button"
        onClick={() => void onClick()}
        disabled={submitting}
        className="w-full"
        data-testid="approve-complete-here"
      >
        {submitting ? "Signing you in…" : "Complete sign-in here"}
      </Button>
      <p className="text-sm text-muted-foreground">
        Use this if you can&apos;t get back to your original tab. This
        device won&apos;t be trusted automatically — you&apos;ll be
        challenged again next time.
      </p>
      {error && (
        <Alert variant="destructive" data-testid="approve-here-error">
          {error}
        </Alert>
      )}
    </div>
  );
}
