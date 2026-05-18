"use client";

import { Suspense, useId } from "react";
import { useSearchParams } from "next/navigation";

import { PostComposerModal } from "./post-composer-modal";

// ---------------------------------------------------------------------------
// Spec 22 PR 1 — ComposerMount.
//
// Client component mounted in app/company/social/layout.tsx. Reads
// ?compose= from the URL and renders PostComposerModal when present.
//
// FEATURE_COMPOSER_V2 gate is checked server-side in the layout;
// ComposerMount only renders when the flag is on.
//
// Wrapped in Suspense per Next.js App Router requirement for
// useSearchParams() in non-page client components.
// ---------------------------------------------------------------------------

interface ComposerMountProps {
  companyId: string;
  userId: string;
}

function ComposerMountInner({ companyId, userId }: ComposerMountProps) {
  const searchParams = useSearchParams();
  const compose = searchParams.get("compose");
  const correlationId = useId().replace(/:/g, "");

  if (!compose) return null;

  const initialDraftId = compose === "new" ? null : compose;

  return (
    <PostComposerModal
      key={compose}
      companyId={companyId}
      userId={userId}
      initialDraftId={initialDraftId}
      correlationId={correlationId}
    />
  );
}

export function ComposerMount({ companyId, userId }: ComposerMountProps) {
  return (
    <Suspense fallback={null}>
      <ComposerMountInner companyId={companyId} userId={userId} />
    </Suspense>
  );
}
