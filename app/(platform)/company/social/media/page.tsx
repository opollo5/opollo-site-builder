import { redirect } from "next/navigation";

import { MediaLibraryClient } from "@/components/MediaLibraryClient";
import { Alert } from "@/components/ui/alert";
import { TGrid } from "@/templates";
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
      <TGrid
        title="Media library"
        subtitle="Reusable images and video for your social posts. Add an asset here, then attach by id when scheduling."
        inlineAlert={
          <Alert variant="destructive" title="Account not provisioned">
            Your account isn&apos;t a member of any company on the platform yet. Ask an admin to
            invite you, or contact Opollo support.
          </Alert>
        }
      >
        <></>
      </TGrid>
    );
  }

  const companyId = session.company.companyId;
  const [listResult, canEdit] = await Promise.all([
    listMediaAssets({ companyId }),
    canDo(companyId, "edit_post"),
  ]);

  return (
    <TGrid
      title="Media library"
      subtitle="Reusable images and video for your social posts. Add an asset here, then attach by id when scheduling."
      inlineAlert={
        listResult.ok ? undefined : (
          <Alert variant="destructive" title="Failed to load media">
            {listResult.error.message}
          </Alert>
        )
      }
    >
      {listResult.ok && (
        <MediaLibraryClient
          companyId={companyId}
          initialAssets={listResult.data.assets}
          initialNextCursor={listResult.data.nextCursor}
          canEdit={canEdit}
        />
      )}
    </TGrid>
  );
}
