import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { AssistedApprovalToggle } from "@/components/optimiser/AssistedApprovalToggle";
import { checkAdminAccess } from "@/lib/admin-gate";
import { getClient } from "@/lib/optimiser/clients";
import {
  DEFAULT_CONVERSION_COMPONENTS,
  DEFAULT_SCORE_WEIGHTS,
  type ConversionComponentsPresent,
  type ScoreWeights,
} from "@/lib/optimiser/scoring/types";

// Client settings — addendum §6.2 Q1.6.4. Phase 1 surface is read-only;
// staff can see the weights + conversion components present + causal
// window. Phase 2 makes them editable once the calibration loop is
// landing.

export const metadata = { title: "Optimiser · Client settings" };
export const dynamic = "force-dynamic";

const WEIGHT_LABELS: Record<keyof ScoreWeights, string> = {
  alignment: "Alignment",
  behaviour: "Behaviour",
  conversion: "Conversion",
  technical: "Technical",
};

const WEIGHT_DESCRIPTIONS: Record<keyof ScoreWeights, string> = {
  alignment:
    "How well keywords + ads + landing-page copy match. Drives the message-mismatch / CTA-verb / offer-clarity playbooks.",
  behaviour:
    "Bounce rate, engagement time, scroll depth, CTA clicks per session. Normalised against this client's other active pages.",
  conversion:
    "Conversion rate (×0.50), cost per conversion (×0.30 inverse), revenue per visit (×0.20 if tracked). Where revenue isn't tracked, weight redistributes to CR (×0.65) and CPA (×0.35).",
  technical:
    "PageSpeed Insights mobile data: LCP / INP / CLS / mobile speed score. Mobile is dominant traffic for paid landing pages.",
};

export default async function ClientSettingsPage({
  params,
}: {
  params: { id: string };
}) {
  const client = await getClient(params.id);
  if (!client) notFound();
  // Phase 2 Slice 21 — only admins can toggle assisted approval; the
  // toggle component renders a read-only badge for non-admin viewers.
  // AUTH-FOUNDATION P3 — open to every authenticated role
  // (super_admin, admin, user); permission is gated below by isAdmin.
  const access = await checkAdminAccess({ requiredRoles: ["super_admin", "admin", "user"] });
  const isAdmin =
    access.kind === "allow" &&
    (access.user?.role === "super_admin" || access.user?.role === "admin");

  const weights = (client.score_weights as ScoreWeights) ?? DEFAULT_SCORE_WEIGHTS;
  const componentsPresent =
    (client.conversion_components_present as ConversionComponentsPresent) ??
    DEFAULT_CONVERSION_COMPONENTS;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs text-muted-foreground">
            <Link href="/optimiser" className="text-primary underline-offset-4 hover:underline">
              ← Page browser
            </Link>
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {client.name} — score settings
          </h1>
          <p className="text-sm text-muted-foreground">
            Phase 1 surface is read-only. Phase 2 wires the manual override
            via this page.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href={`/optimiser/onboarding/${client.id}`}>
            Connector settings
          </Link>
        </Button>
      </header>

      <section className="space-y-4 rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-medium">Composite score weights</h2>
        <p className="text-sm text-muted-foreground">
          The composite is{" "}
          <code className="font-mono text-xs">
            (alignment × {weights.alignment.toFixed(2)}) + (behaviour × {weights.behaviour.toFixed(2)}) + (conversion × {weights.conversion.toFixed(2)}) + (technical × {weights.technical.toFixed(2)})
          </code>
          . Defaults are{" "}
          <code className="font-mono text-xs">0.25 / 0.30 / 0.30 / 0.15</code>.
        </p>
        <ul className="space-y-3">
          {(Object.keys(weights) as Array<keyof ScoreWeights>).map((key) => (
            <li key={key} className="flex items-start gap-3">
              <span className="mt-1 inline-block w-16 font-mono text-sm tabular-nums">
                ×{weights[key].toFixed(2)}
              </span>
              <div className="flex-1">
                <p className="font-medium">{WEIGHT_LABELS[key]}</p>
                <p className="text-sm text-muted-foreground">
                  {WEIGHT_DESCRIPTIONS[key]}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3 rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-medium">Conversion components present</h2>
        <p className="text-sm text-muted-foreground">
          Drives the §2.3 redistribution: when revenue tracking is missing,
          its 0.20 weight folds into CR (×0.65) + CPA (×0.35).
        </p>
        <ul className="space-y-1 text-sm">
          <li>
            <span className="inline-block w-32 text-muted-foreground">Conversion rate</span>
            <strong>{componentsPresent.cr ? "tracked" : "not tracked"}</strong>
          </li>
          <li>
            <span className="inline-block w-32 text-muted-foreground">Cost per conversion</span>
            <strong>{componentsPresent.cpa ? "tracked" : "not tracked"}</strong>
          </li>
          <li>
            <span className="inline-block w-32 text-muted-foreground">Revenue per visit</span>
            <strong>{componentsPresent.revenue ? "tracked" : "not tracked"}</strong>
          </li>
        </ul>
      </section>

      <section className="space-y-3 rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-medium">Causal-delta measurement window</h2>
        <p className="text-sm">
          <span className="font-mono tabular-nums">{client.causal_eval_window_days}</span> days
        </p>
        <p className="text-sm text-muted-foreground">
          After a regenerated page has been live for this many days (or
          accumulated 300+ sessions on the new version, whichever is sooner),
          the engine evaluates its actual impact and writes a row to
          opt_causal_deltas. Lower-traffic B2B clients may extend this; default 14 days.
        </p>
      </section>

      <section className="space-y-3 rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-medium">Assisted approval (Phase 2)</h2>
        <AssistedApprovalToggle
          clientId={client.id}
          enabled={client.assisted_approval_enabled}
          isAdmin={isAdmin}
        />
      </section>
    </div>
  );
}
