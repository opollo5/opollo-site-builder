"use client";

import { useState } from "react";

// ---------------------------------------------------------------------------
// /proof/request — self-serve magic link re-request page (B0 §1).
//
// The reviewer enters their email; we find all open proofs for that email
// and send fresh magic link emails for each. Returns "Check your email"
// regardless of whether any proofs were found (prevents enumeration).
// ---------------------------------------------------------------------------

export default function ProofRequestPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setState("loading");

    try {
      const res = await fetch("/api/platform/proofing/link-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!res.ok) {
        setState("error");
        return;
      }
      setState("done");
    } catch {
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <main className="mx-auto max-w-xl p-6">
        <h1 className="text-page-title text-foreground">Check your email</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          If there are any reviews waiting for you, fresh links have been sent
          to <strong>{email}</strong>. Check your inbox (and spam folder).
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-page-title text-foreground">Get a fresh review link</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Enter your email address and we{"'"}ll send you a fresh link for any
        reviews currently awaiting your decision.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-foreground"
          >
            Email address
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="mt-1 block w-full rounded-md border bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
            disabled={state === "loading"}
          />
        </div>

        {state === "error" ? (
          <p className="text-sm text-destructive">
            Something went wrong. Please try again.
          </p>
        ) : null}

        <button
          type="submit"
          disabled={state === "loading" || !email.trim()}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {state === "loading" ? "Sending…" : "Send fresh link"}
        </button>
      </form>
    </main>
  );
}
