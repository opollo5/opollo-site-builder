"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// ---------------------------------------------------------------------------
// BriefCommitWaiter — eliminates the commit→/run race for the operator.
//
// The /run server component reads the brief via PostgREST. Even after the
// commit POST returns success, Vercel may route the /run render to a
// different serverless instance / pool that hasn't yet observed the
// COMMIT. Until 2026-05-03 the operator saw an "isn't committed yet"
// panel for several seconds — confusing because they JUST clicked
// Commit and got a success.
//
// This component renders a spinner + reassuring copy and polls the
// snapshot endpoint every 500ms (up to 30s) waiting for status='committed'
// to become visible. The moment it does, router.refresh() re-fetches the
// /run server component which then sees the committed state and renders
// the run UI for real.
//
// Capped at 30s — beyond that we fall through to a real error CTA so
// the operator isn't stranded on a forever-spinner if something genuinely
// went wrong upstream.
// ---------------------------------------------------------------------------

export function BriefCommitWaiter({
  briefId,
  reviewUrl,
}: {
  briefId: string;
  reviewUrl: string;
}) {
  const router = useRouter();
  const [elapsedMs, setElapsedMs] = useState(0);
  const [exhausted, setExhausted] = useState(false);

  useEffect(() => {
    const start = Date.now();
    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      if (!cancelled) setExhausted(true);
    }, 30_000);

    async function poll() {
      if (cancelled) return;
      try {
        const res = await fetch(`/api/briefs/${briefId}/run/snapshot`, {
          cache: "no-store",
        });
        if (res.ok) {
          const json = (await res.json()) as {
            ok?: boolean;
            data?: { brief?: { status?: string } };
          };
          if (json?.ok && json.data?.brief?.status === "committed") {
            window.clearTimeout(timeoutId);
            router.refresh();
            return;
          }
        }
      } catch {
        // ignore — keep polling
      }
      setElapsedMs(Date.now() - start);
      if (!cancelled) {
        window.setTimeout(poll, 500);
      }
    }
    void poll();

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [briefId, router]);

  if (exhausted) {
    return (
      <div
        role="alert"
        className="mt-6 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
      >
        <p className="font-medium">Couldn&apos;t verify the commit.</p>
        <p className="mt-1">
          The commit went through, but we couldn&apos;t confirm visibility
          within 30 seconds. Refresh this page in a few moments — if it
          still shows this message, head back to{" "}
          <a className="underline hover:no-underline" href={reviewUrl}>
            review and re-commit
          </a>
          .
        </p>
      </div>
    );
  }

  const seconds = Math.floor(elapsedMs / 1000);
  return (
    <div
      role="status"
      aria-live="polite"
      className="mt-6 flex items-center gap-3 rounded-md border bg-muted/40 p-4"
    >
      <span
        aria-hidden
        className="h-3 w-3 animate-pulse rounded-full bg-emerald-500"
      />
      <div className="text-sm">
        <p className="font-medium">Finishing your commit…</p>
        <p className="text-muted-foreground">
          Waiting for the run surface to come online (
          {seconds > 0 ? `${seconds}s elapsed` : "this usually takes a second"}
          ).
        </p>
      </div>
    </div>
  );
}
