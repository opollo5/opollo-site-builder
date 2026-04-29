import Link from "next/link";

import { Button } from "@/components/ui/button";
import { ConnectorBannerView } from "@/components/optimiser/ConnectorBanner";
import { PageBrowser } from "@/components/optimiser/PageBrowser";
import { listClients } from "@/lib/optimiser/clients";
import {
  bannerForConnector,
  getConnectorStatus,
} from "@/lib/optimiser/connector-status";
import { listLandingPagesForClient } from "@/lib/optimiser/landing-pages";
import { rollupForPage } from "@/lib/optimiser/metrics-aggregation";
import { getServiceRoleClient } from "@/lib/supabase";

export const metadata = { title: "Optimiser" };
export const dynamic = "force-dynamic";

export default async function OptimiserHomePage({
  searchParams,
}: {
  searchParams?: { client?: string };
}) {
  const clients = await listClients();
  const onboarded = clients.filter((c) => c.onboarded_at);

  if (onboarded.length === 0) {
    return (
      <EmptyState clientsExist={clients.length > 0} />
    );
  }

  const selectedId = searchParams?.client ?? onboarded[0].id;
  const selected = onboarded.find((c) => c.id === selectedId) ?? onboarded[0];

  const [pages, connectors] = await Promise.all([
    listLandingPagesForClient(selected.id),
    getConnectorStatus(selected.id),
  ]);

  // Hydrate per-page rollups + alignment scores in parallel.
  const supabase = getServiceRoleClient();
  const enriched = await Promise.all(
    pages.map(async (page) => {
      const rollup = await rollupForPage(page.id, { window_days: 30 });
      const { data: scoreRow } = await supabase
        .from("opt_alignment_scores")
        .select("score")
        .eq("landing_page_id", page.id)
        .order("computed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return {
        ...page,
        latest_alignment_score: (scoreRow?.score as number | null) ?? null,
        conversion_rate: rollup.conversion_rate,
        bounce_rate: rollup.bounce_rate,
        avg_scroll_depth: rollup.avg_scroll_depth,
        sessions_window: rollup.sessions,
      };
    }),
  );

  const banners = connectors
    .map((c) => bannerForConnector(c, selected.id))
    .filter((b): b is NonNullable<typeof b> => Boolean(b));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Page browser</h1>
          <p className="text-sm text-muted-foreground">
            All managed landing pages, with state, data reliability, and key metrics.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onboarded.length > 1 && (
            <ClientSwitcher clients={onboarded} selectedId={selected.id} />
          )}
          <Button asChild variant="outline">
            <Link href="/optimiser/onboarding">Onboarding</Link>
          </Button>
        </div>
      </header>

      {banners.length > 0 && (
        <div className="space-y-2">
          {banners.map((b) => (
            <ConnectorBannerView key={`${b.source}-${b.kind}`} banner={b} />
          ))}
        </div>
      )}

      <PageBrowser client={selected} pages={enriched} />
    </div>
  );
}

function EmptyState({ clientsExist }: { clientsExist: boolean }) {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Optimiser</h1>
        <p className="text-sm text-muted-foreground">
          Autonomous Landing Page Optimisation Engine — Phase 1.
        </p>
      </header>
      <section className="rounded-lg border border-dashed border-border bg-card p-8 text-center">
        <h2 className="text-lg font-medium">No onboarded clients yet</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {clientsExist
            ? "Continue an in-progress onboarding to see the page browser."
            : "Start by adding a client through the onboarding wizard."}
        </p>
        <div className="mt-4">
          <Button asChild>
            <Link href="/optimiser/onboarding">
              {clientsExist ? "Continue onboarding" : "Add a client"}
            </Link>
          </Button>
        </div>
      </section>
    </div>
  );
}

function ClientSwitcher({
  clients,
  selectedId,
}: {
  clients: Array<{ id: string; name: string }>;
  selectedId: string;
}) {
  return (
    <form method="get" action="/optimiser" className="flex items-center gap-1">
      <label htmlFor="client" className="sr-only">
        Client
      </label>
      <select
        id="client"
        name="client"
        defaultValue={selectedId}
        className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
      >
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <Button size="sm" type="submit" variant="outline">
        Switch
      </Button>
    </form>
  );
}
