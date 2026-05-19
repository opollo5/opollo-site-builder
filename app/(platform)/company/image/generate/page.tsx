import { redirect } from "next/navigation";

import { MoodBoardClient } from "@/components/MoodBoardClient";
import { Alert } from "@/components/ui/alert";
import { TFullBleedEditor } from "@/templates";
import { getAllowedStyles } from "@/lib/image";
import { canDo, getCurrentPlatformSession } from "@/lib/platform/auth";
import { getActiveBrandProfile } from "@/lib/platform/brand";

// ---------------------------------------------------------------------------
// I4 — mood board generator at /company/image/generate.
//
// Generates 4–6 background images via Ideogram (through the mood board
// API at /api/platform/image/generate). Server component handles auth +
// brand profile read; MoodBoardClient owns the interactive UI.
//
// Gates:
//   1. IMAGE_FEATURE_MOOD_BOARD env flag → redirect /company if off.
//   2. Session required (platform_users).
//   3. create_post permission (editor+).
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

export default async function MoodBoardPage() {
  if (process.env.IMAGE_FEATURE_MOOD_BOARD !== "true") {
    redirect("/company");
  }

  const session = await getCurrentPlatformSession();
  if (!session) {
    redirect(`/login?next=${encodeURIComponent("/company/image/generate")}`);
  }

  if (!session.company) {
    return (
      <TFullBleedEditor
        title="Mood board generator"
        subtitle="Generate background images for your social posts. Click an image to select it and copy its URL."
        backHref="/company"
        backLabel="Dashboard"
      >
        <Alert variant="destructive" title="Account not provisioned">
          Your account isn&apos;t a member of any company on the platform yet. Ask an
          admin to invite you, or contact Opollo support.
        </Alert>
      </TFullBleedEditor>
    );
  }

  const companyId = session.company.companyId;

  const [canCreate, brand] = await Promise.all([
    canDo(companyId, "create_post"),
    getActiveBrandProfile(companyId),
  ]);

  if (!canCreate) {
    return (
      <TFullBleedEditor
        title="Mood board generator"
        subtitle="Generate background images for your social posts. Click an image to select it and copy its URL."
        backHref="/company"
        backLabel="Dashboard"
      >
        <Alert variant="destructive" title="Permission denied">
          Editor or admin permissions are required to generate images.
        </Alert>
      </TFullBleedEditor>
    );
  }

  const allowedStyles = getAllowedStyles(brand);

  return (
    <TFullBleedEditor
      title="Mood board generator"
      subtitle="Generate background images for your social posts. Click an image to select it and copy its URL."
      backHref="/company"
      backLabel="Dashboard"
    >
      <MoodBoardClient
        companyId={companyId}
        allowedStyles={allowedStyles}
        primaryColour={brand?.primary_colour ?? null}
      />
    </TFullBleedEditor>
  );
}
