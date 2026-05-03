import Link from "next/link";
import { redirect } from "next/navigation";

import { MoodBoardClient } from "@/components/MoodBoardClient";
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
      <main className="mx-auto max-w-3xl p-6 text-sm">
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4">
          <p className="font-medium">Account not provisioned to a company.</p>
          <p className="mt-1 text-muted-foreground">
            Your account isn&apos;t a member of any company on the platform
            yet. Ask an admin to invite you, or contact Opollo support.
          </p>
        </div>
      </main>
    );
  }

  const companyId = session.company.companyId;

  const [canCreate, brand] = await Promise.all([
    canDo(companyId, "create_post"),
    getActiveBrandProfile(companyId),
  ]);

  if (!canCreate) {
    return (
      <main className="mx-auto max-w-3xl p-6 text-sm">
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4">
          <p className="font-medium">Permission denied.</p>
          <p className="mt-1 text-muted-foreground">
            Editor or admin permissions are required to generate images.
          </p>
        </div>
      </main>
    );
  }

  const allowedStyles = getAllowedStyles(brand);

  return (
    <main className="mx-auto max-w-5xl p-6">
      <div className="mb-4 text-sm">
        <Link
          href="/company"
          className="text-muted-foreground hover:text-foreground"
        >
          ← Dashboard
        </Link>
      </div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Mood board generator</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Generate background images for your social posts. Click an image to
          select it and copy its URL.
        </p>
      </header>
      <MoodBoardClient
        companyId={companyId}
        allowedStyles={allowedStyles}
        primaryColour={brand?.primary_colour ?? null}
      />
    </main>
  );
}
