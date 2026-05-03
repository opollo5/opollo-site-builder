import { redirect } from "next/navigation";

import { MediaLibraryClient } from "@/components/MediaLibraryClient";
import { H1, Lead } from "@/components/ui/typography";
import { canDo, getCurrentPlatformSession } from "@/lib/platform/auth";
import { listMediaAssets } from "@/lib/platform/social/media";

// ---------------------------------------------------------------------------
// S1-23 — customer media library at /company/social/media.
//
// Server-rendered. Same gating pattern as the rest of /company:
//   1. No session → /login.
//   2. No company membership → "Not provisioned" envelope.
//
// Read gate: viewer+ (canDo("view_calendar")). Add gate: editor+
// (canDo("edit_post")).
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

export default async function CompanySocialMediaPage() {
  const session = await getCurrentPlatformSession();
  if (!session) {
    redirect(`/login?next=${encodeURIComponent("/company/social/media")}`);
  }
  if (!session.company) {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm">
        <p className="font-medium">Account not provisioned to a company.</p>
        <p className="mt-1 text-muted-foreground">
          Your account isn&apos;t a member of any company on the platform
          yet. Ask an admin to invite you, or contact Opollo support.
        </p>
      </div>
    );
  }

  const companyId = session.company.companyId;
  const [listResult, canEdit] = await Promise.all([
    listMediaAssets({ companyId }),
    canDo(companyId, "edit_post"),
  ]);

  return (
    <main className="mx-auto max-w-6xl p-6">
      <header>
        <H1>Media library</H1>
        <Lead className="mt-0.5">
          Reusable images and video for your social posts. Add an asset
          here, then attach by id when scheduling.
        </Lead>
      </header>
      <div className="mt-6">
        {listResult.ok ? (
          <MediaLibraryClient
            companyId={companyId}
            initialAssets={listResult.data.assets}
            canEdit={canEdit}
          />
        ) : (
          <div
            className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
            role="alert"
          >
            Failed to load media: {listResult.error.message}
          </div>
        )}
      </div>
    </main>
  );
}
