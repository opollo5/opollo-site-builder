import Link from "next/link";

// Slice 1 placeholder. Slice 4 replaces this with the page browser.

export const metadata = {
  title: "Optimiser · Opollo",
};

export default function OptimiserHomePage() {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Optimiser</h1>
        <p className="text-sm text-muted-foreground">
          Autonomous Landing Page Optimisation Engine — Phase 1.
        </p>
      </header>

      <section className="rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-medium">Module scaffold</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page browser, proposal review, and onboarding flows land in
          subsequent slices. The schema, routes, and skills are in place.
        </p>
        <ul className="mt-4 space-y-1 text-sm">
          <li>
            <code className="font-mono text-xs">/api/optimiser/health</code>{" "}
            — module health probe
          </li>
          <li>
            <code className="font-mono text-xs">/skills/optimiser/</code> —
            engine skill library
          </li>
          <li>
            <code className="font-mono text-xs">/lib/optimiser/</code> —
            module-private helpers
          </li>
        </ul>
        <p className="mt-4 text-sm">
          <Link
            href="/admin"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Back to admin
          </Link>
        </p>
      </section>
    </div>
  );
}
