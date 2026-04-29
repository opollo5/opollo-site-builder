import Link from "next/link";

import { listClients } from "@/lib/optimiser/clients";
import { Button } from "@/components/ui/button";
import { NewClientForm } from "@/components/optimiser/NewClientForm";

export const metadata = { title: "Optimiser · Onboarding" };
export const dynamic = "force-dynamic";

export default async function OptimiserOnboardingHome() {
  const clients = await listClients();
  const onboarding = clients.filter((c) => !c.onboarded_at);
  const onboarded = clients.filter((c) => c.onboarded_at);

  return (
    <div className="space-y-8">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Onboarding</h1>
          <p className="text-sm text-muted-foreground">
            Five-step gated checklist per spec §7.1. Steps unlock as each verification passes.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/optimiser">Back to optimiser</Link>
        </Button>
      </header>

      <section className="space-y-3 rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-medium">Add a client</h2>
        <NewClientForm />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">In progress</h2>
        {onboarding.length === 0 ? (
          <p className="text-sm text-muted-foreground">None.</p>
        ) : (
          <ul className="space-y-2">
            {onboarding.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between rounded-md border border-border bg-card px-4 py-3"
              >
                <div>
                  <p className="font-medium">{c.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.client_slug} · created {new Date(c.created_at).toLocaleDateString()}
                  </p>
                </div>
                <Button asChild>
                  <Link href={`/optimiser/onboarding/${c.id}`}>Continue</Link>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Onboarded</h2>
        {onboarded.length === 0 ? (
          <p className="text-sm text-muted-foreground">None yet.</p>
        ) : (
          <ul className="space-y-2">
            {onboarded.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between rounded-md border border-border bg-card px-4 py-3"
              >
                <div>
                  <p className="font-medium">{c.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.client_slug} ·{" "}
                    {c.onboarded_at
                      ? `onboarded ${new Date(c.onboarded_at).toLocaleDateString()}`
                      : ""}
                  </p>
                </div>
                <Button asChild variant="outline">
                  <Link href={`/optimiser/onboarding/${c.id}`}>Settings</Link>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
