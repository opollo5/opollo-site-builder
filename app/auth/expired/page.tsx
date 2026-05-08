import Link from "next/link";

import { NavIcon } from "@/components/ui/nav-icon";
import { H1, Lead } from "@/components/ui/typography";

// ---------------------------------------------------------------------------
// /auth/expired — Spec 14 PR C.
//
// Cybersecurity-explainer page for cap-driven logouts. Shown when:
//   • The 15-minute grace period after session expiry elapses (hardLogout
//     in use-session-expiry.ts redirects here).
//
// NOT shown for:
//   • User-initiated sign-out → /login
//   • Suspension / password change → /login (admin-forced revocation)
//
// The three-bullet rationale is required copy per the Spec 14 brief.
// It explains WHY the 48-hour cap exists so operators understand this is
// a deliberate security policy, not a bug or server error.
// ---------------------------------------------------------------------------

export const dynamic = "force-static";

const WHY_BULLETS = [
  {
    icon: "shield",
    heading: "Session-hijacking protection",
    body: "Short-lived sessions limit the window an attacker has to misuse a stolen or intercepted token.",
  },
  {
    icon: "key",
    heading: "Compliance with access-control standards",
    body: "Many frameworks (SOC 2, ISO 27001) require periodic re-authentication for systems that manage client data.",
  },
  {
    icon: "clock",
    heading: "Credential freshness",
    body: "Re-signing-in ensures your password or SSO credentials are still valid and haven't been revoked.",
  },
] as const;

export default function SessionExpiredPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-lg space-y-8">
        {/* Header */}
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-950">
            <NavIcon name="lock" size={24} className="text-amber-600 dark:text-amber-400" />
          </div>
          <H1>Your session has expired</H1>
          <Lead className="mt-2">
            Opollo signs you out automatically every 48 hours. Here&apos;s
            why this policy exists.
          </Lead>
        </div>

        {/* Why-bullets card */}
        <div className="rounded-lg border bg-background p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Why Opollo has a 48-hour session limit
          </h2>
          <ul className="space-y-5">
            {WHY_BULLETS.map(({ icon, heading, body }) => (
              <li key={heading} className="flex gap-3">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                  <NavIcon name={icon} size={14} className="text-muted-foreground" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{heading}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* CTA */}
        <div className="flex flex-col items-center gap-3">
          <Link
            href="/login"
            className="inline-flex w-full items-center justify-center rounded-md bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition-smooth hover:bg-primary/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Sign in again
          </Link>
          <p className="text-xs text-muted-foreground">
            Your work was auto-saved before sign-out.
          </p>
        </div>
      </div>
    </main>
  );
}
