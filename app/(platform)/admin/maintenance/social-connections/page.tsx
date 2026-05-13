import { AdminSocialConnectionsMaintenance } from "@/components/AdminSocialConnectionsMaintenance";
import { BundlesocialReconcileSection } from "@/components/BundlesocialReconcileSection";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { getServiceRoleClient } from "@/lib/supabase";

// Cross-tenant identity-leak defence — Layer 4 admin maintenance page.
// Staff-only via the (platform)/admin layout gate. Cross-company by
// design — lives at /admin/maintenance/social-connections.

export const dynamic = "force-dynamic";

type ConnectionRow = {
  id: string;
  company_id: string;
  profile_id: string | null;
  platform: string;
  display_name: string | null;
  bundle_social_account_id: string;
  status: string;
  external_account_id: string | null;
  external_user_id: string | null;
  external_identity_hash: string | null;
  connected_at: string;
  last_health_check_at: string;
};

type CompanyRow = {
  id: string;
  name: string;
  allow_cross_tenant_identity: boolean;
};

type ProfileRow = { id: string; company_id: string; name: string };

export default async function SocialConnectionsMaintenancePage() {
  const svc = getServiceRoleClient();

  const [connectionsRead, companiesRead, profilesRead] = await Promise.all([
    svc
      .from("social_connections")
      .select(
        "id, company_id, profile_id, platform, display_name, bundle_social_account_id, status, external_account_id, external_user_id, external_identity_hash, connected_at, last_health_check_at",
      ),
    svc
      .from("platform_companies")
      .select("id, name, allow_cross_tenant_identity"),
    svc.from("platform_social_profiles").select("id, company_id, name"),
  ]);

  if (connectionsRead.error || companiesRead.error || profilesRead.error) {
    return (
      <PageShell>
        <PageHeader>
          <PageHeader.Title>Social connections maintenance</PageHeader.Title>
        </PageHeader>
        <div
          className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
          role="alert"
        >
          Failed to load:{" "}
          {connectionsRead.error?.message ??
            companiesRead.error?.message ??
            profilesRead.error?.message ??
            "unknown"}
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader>
        <PageHeader.Breadcrumb
          segments={[
            { label: "Admin", href: "/admin/sites" },
            { label: "Maintenance" },
            { label: "Social connections" },
          ]}
        />
        <PageHeader.Title>Social connections maintenance</PageHeader.Title>
        <PageHeader.Subtitle>
          Cross-company view of every social_connections row. Identity
          columns surface cross-tenant collisions; per-row actions
          disconnect, refresh, or reattribute.
        </PageHeader.Subtitle>
      </PageHeader>
      <BundlesocialReconcileSection />
      <AdminSocialConnectionsMaintenance
        connections={(connectionsRead.data ?? []) as ConnectionRow[]}
        companies={(companiesRead.data ?? []) as CompanyRow[]}
        profiles={(profilesRead.data ?? []) as ProfileRow[]}
      />
    </PageShell>
  );
}
