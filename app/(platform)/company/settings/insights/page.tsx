import { redirect } from "next/navigation";

import { TSettingsFlat } from "@/templates";
import { getCurrentPlatformSession } from "@/lib/platform/auth";
import { getServiceRoleClient } from "@/lib/supabase";
import { InsightsConsentClient } from "@/components/insights/InsightsConsentClient";

export const dynamic = "force-dynamic";

const BREADCRUMB = [
  { label: "Company", href: "/company" },
  { label: "Settings", href: "/company/settings" },
  { label: "Insights" },
];

export default async function InsightsSettingsPage() {
  const session = await getCurrentPlatformSession();
  if (!session) {
    redirect(`/login?next=${encodeURIComponent("/company/settings/insights")}`);
  }

  if (!session.company) {
    return (
      <TSettingsFlat
        title="Insights settings"
        breadcrumb={BREADCRUMB}
        sections={[]}
      />
    );
  }

  const isAdmin = session.isOpolloStaff || session.company.role === "admin";
  if (!isAdmin) {
    return (
      <TSettingsFlat
        title="Insights settings"
        breadcrumb={BREADCRUMB}
        sections={[
          {
            title: "Access restricted",
            content: (
              <p className="text-sm text-[var(--tx-secondary)]">
                Only company admins can manage insights consent settings.
              </p>
            ),
          },
        ]}
      />
    );
  }

  const companyId = session.company.companyId;
  const svc = getServiceRoleClient();

  // Fetch consent state
  const { data: consentRow } = await svc
    .from("ins_consent")
    .select(
      "cross_client_learning_consent, competitor_tracking_consent, consented_at, msa_version",
    )
    .eq("company_id", companyId)
    .maybeSingle();

  // Fetch suppressed recommendations
  const { data: suppressed } = await svc
    .from("ins_recommendations")
    .select("id, recommendation_type, headline, platform, generated_at")
    .eq("company_id", companyId)
    .eq("suppressed", true)
    .order("generated_at", { ascending: false })
    .limit(50);

  return (
    <TSettingsFlat
      title="Insights settings"
      breadcrumb={BREADCRUMB}
      subtitle="Control how Opollo uses your data to improve recommendations."
      sections={[
        {
          title: "Data sharing",
          content: (
            <InsightsConsentClient
              companyId={companyId}
              crossClientLearningConsent={
                consentRow?.cross_client_learning_consent ?? false
              }
              competitorTrackingConsent={
                consentRow?.competitor_tracking_consent ?? false
              }
              consentedAt={consentRow?.consented_at ?? null}
              msaVersion={consentRow?.msa_version ?? null}
              suppressedRecommendations={suppressed ?? []}
            />
          ),
        },
      ]}
    />
  );
}
