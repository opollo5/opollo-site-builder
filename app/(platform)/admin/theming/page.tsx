import { redirect } from "next/navigation";

import { ThemingClient } from "@/components/admin/theming/ThemingClient";
import { TListWide } from "@/templates";
import { checkAdminAccess } from "@/lib/admin-gate";
import { getServiceRoleClient } from "@/lib/supabase";
import { getCompanyTheme } from "@/lib/platform/theming";

export const dynamic = "force-dynamic";

export default async function AdminThemingPage({
  searchParams,
}: {
  searchParams?: { company?: string };
}) {
  const access = await checkAdminAccess({ requiredRoles: ["super_admin"] });
  if (access.kind === "redirect") redirect(access.to);

  const svc = getServiceRoleClient();

  // Load all companies for the selector.
  const { data: companies } = await svc
    .from("platform_companies")
    .select("id, name")
    .order("name", { ascending: true });

  const allCompanies = (companies ?? []) as { id: string; name: string }[];

  // Resolve selected company from query param (default first).
  const params = await searchParams;
  const selectedId =
    params?.company && allCompanies.some((c) => c.id === params.company)
      ? params.company
      : (allCompanies[0]?.id ?? null);

  const themeRow = selectedId ? await getCompanyTheme(selectedId) : null;

  // Resolve "last updated by" email for display.
  let updatedByEmail: string | null = null;
  if (themeRow?.updated_by) {
    const { data: userRow } = await svc
      .from("opollo_users")
      .select("email")
      .eq("id", themeRow.updated_by)
      .maybeSingle();
    updatedByEmail = (userRow as { email: string } | null)?.email ?? null;
  }

  return (
    <TListWide
      title="Theming"
      breadcrumb={[
        { label: "Admin", href: "/admin/sites" },
        { label: "Theming" },
      ]}
      subtitle="Override CSS design tokens per company. Changes apply immediately to all users in that company."
    >
      <ThemingClient
        companies={allCompanies}
        selectedCompanyId={selectedId}
        initialOverrides={themeRow?.overrides ?? {}}
        updatedAt={themeRow?.updated_at ?? null}
        updatedByEmail={updatedByEmail}
      />
    </TListWide>
  );
}
