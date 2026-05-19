import { notFound } from "next/navigation";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { ConnectorBannerView } from "@/components/optimiser/ConnectorBanner";
import { OnboardingWizard } from "@/components/optimiser/OnboardingWizard";
import { TWizardStep } from "@/templates";
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

  const subtitle = `${client.client_slug} · ${client.hosting_mode.replace("_", " ")} · ${client.onboarded_at ? "onboarded" : "in progress"}`;

  return (
    <TWizardStep
      title={client.name}
      subtitle={subtitle}
      breadcrumb={[
        { label: "Optimiser", href: "/optimiser" },
        { label: "Onboarding", href: "/optimiser/onboarding" },
        { label: client.name },
      ]}
      actions={
        <Button asChild variant="outline">
          <Link href="/optimiser/onboarding">All clients</Link>
        </Button>
      }
    >
      <div className="space-y-6">
        {banners.length > 0 && (
          <div className="space-y-2">
            {banners.map((b) => (
              <ConnectorBannerView key={`${b.source}-${b.kind}`} banner={b} />
            ))}
          </div>
        )}
        <OnboardingWizard client={client} connectors={connectors} />
      </div>
    </TWizardStep>
  );
}
