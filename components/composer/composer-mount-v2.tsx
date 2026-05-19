"use client";

import { Suspense } from "react";
import { useSearchParams, usePathname, useRouter } from "next/navigation";
import { ComposerOverlay } from "@/components/social/composer/ComposerOverlay";
import type { Connection } from "@/lib/social/types";

// ---------------------------------------------------------------------------
// ComposerMountV2 — replaces ComposerMount in the /company/social/* layout.
//
// Reads ?compose=new (or ?compose=<id> to edit) from the URL and renders
// ComposerOverlay when the param is present. On close removes the param so
// the overlay unmounts cleanly.
//
// Connections are pre-fetched server-side in the layout and passed in so
// ComposerOverlay renders the profile selector without a client-side round
// trip on open.
// ---------------------------------------------------------------------------

interface ComposerMountV2Props {
  companyId: string;
  availableConnections: Connection[];
}

function ComposerMountV2Inner({ companyId, availableConnections }: ComposerMountV2Props) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const compose = searchParams.get("compose");

  if (!compose) return null;

  const initialDraftId = compose === "new" ? undefined : compose;

  function handleClose() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("compose");
    const search = params.toString();
    router.replace(pathname + (search ? `?${search}` : ""), { scroll: false });
  }

  return (
    <ComposerOverlay
      open={true}
      onClose={handleClose}
      companyId={companyId}
      availableConnections={availableConnections}
      initialDraft={initialDraftId ? { id: initialDraftId, content: "", media_urls: [], target_profile_ids: [], platform_variants: {}, approval_required: false } : undefined}
    />
  );
}

export function ComposerMountV2({ companyId, availableConnections }: ComposerMountV2Props) {
  return (
    <Suspense fallback={null}>
      <ComposerMountV2Inner companyId={companyId} availableConnections={availableConnections} />
    </Suspense>
  );
}
