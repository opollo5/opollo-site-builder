import { notFound } from "next/navigation";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { ConnectorBannerView } from "@/components/optimiser/ConnectorBanner";
import { OnboardingWizard } from "@/components/optimiser/OnboardingWizard";
import { getClient } from "@/lib/optimiser/clients";
import {
  bannerForConnector,
  getConnectorStatus,
} from "@/lib/optimiser/connector-status";

export const dynamic = "force-dynamic";

export default async function OptimiserOnboardingClientPage({
  params,
}: {
  params: { id: string };
}) {
  const client = await getClient(params.id);
  if (!client) notFound();
  const connectors = await getConnectorStatus(params.id);
  const banners = connectors
    .map((c) => bannerForConnector(c, params.id))
    .filter((b): b is NonNullable<typeof b> => Boolean(b));

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{client.name}</h1>
          <p className="text-sm text-muted-foreground">
            <code className="font-mono">{client.client_slug}</code> ·{" "}
            {client.hosting_mode.replace("_", " ")} ·{" "}
            {client.onboarded_at ? "onboarded" : "in progress"}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/optimiser/onboarding">All clients</Link>
        </Button>
      </header>

      {banners.length > 0 && (
        <div className="space-y-2">
          {banners.map((b) => (
            <ConnectorBannerView key={`${b.source}-${b.kind}`} banner={b} />
          ))}
        </div>
      )}

      <OnboardingWizard client={client} connectors={connectors} />
    </div>
  );
}
