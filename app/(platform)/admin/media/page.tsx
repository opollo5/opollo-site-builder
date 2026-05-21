import { AdminMediaClient } from "@/components/AdminMediaClient";
import { TListWide } from "@/templates";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// /admin/media — C1
//
// Admin view of all social_media_assets across companies.
// Staff can promote any company-scoped asset to global scope so it appears
// in every company's composer media library tab.
//
// Auth is handled by app/(platform)/admin/layout.tsx (checkAdminAccess).
// Lists newest-first, up to 100 rows. No pagination needed for admin use.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

type AdminMediaAsset = {
  id: string;
  company_id: string;
  source_url: string | null;
  mime_type: string;
  bytes: number;
  scope: "company" | "global";
  created_at: string;
};

export default async function AdminMediaPage() {
  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("social_media_assets")
    .select("id, company_id, source_url, mime_type, bytes, scope, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return (
      <TListWide
        title="Social media assets"
        subtitle="Promote assets to global scope to make them available in every company's composer library."
      >
        <div
          className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
          role="alert"
        >
          Failed to load assets: {error.message}
        </div>
      </TListWide>
    );
  }

  const assets: AdminMediaAsset[] = (data ?? []).map((r) => ({
    id: r.id as string,
    company_id: r.company_id as string,
    source_url: (r.source_url as string | null) ?? null,
    mime_type: r.mime_type as string,
    bytes: Number(r.bytes ?? 0),
    scope: ((r.scope as string) === "global" ? "global" : "company") as "company" | "global",
    created_at: r.created_at as string,
  }));

  return (
    <TListWide
      title="Social media assets"
      subtitle="Promote assets to global scope to make them available in every company's composer library."
    >
      <AdminMediaClient initialAssets={assets} />
    </TListWide>
  );
}
