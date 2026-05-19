"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, usePathname, useRouter } from "next/navigation";
import { ComposerOverlay } from "@/components/social/composer/ComposerOverlay";
import type { Connection, Draft } from "@/lib/social/types";

// ---------------------------------------------------------------------------
// ComposerMountV2 — replaces ComposerMount in the /company/social/* layout.
//
// Reads ?compose=new (or ?compose=<id> to edit) from the URL and renders
// ComposerOverlay when the param is present. On close removes the param so
// the overlay unmounts cleanly.
//
// When ?compose=<id>, fetches the existing draft from
// GET /api/platform/social/drafts/<id> and maps the V1 draft_data shape to
// the V2 Draft props so pushed CAP drafts and any server-side-created drafts
// open with their content pre-filled.
//
// Connections are pre-fetched server-side in the layout and passed in so
// ComposerOverlay renders the profile selector without a client-side round
// trip on open.
// ---------------------------------------------------------------------------

// V1 social_post_drafts shape from GET /api/platform/social/drafts/[id].
interface V1DraftApiResponse {
  ok: boolean;
  data?: {
    id: string;
    draft_data: {
      master_text: string;
      media_refs: Array<{ url: string }>;
      target_connection_ids: string[];
      approval_required: boolean;
    };
  };
}

function mapV1ToV2Draft(d: NonNullable<V1DraftApiResponse["data"]>): Draft {
  return {
    id: d.id,
    content: d.draft_data.master_text,
    media_urls: d.draft_data.media_refs.map((r) => r.url),
    target_profile_ids: d.draft_data.target_connection_ids,
    platform_variants: {},
    approval_required: d.draft_data.approval_required,
  };
}

interface ComposerMountV2Props {
  companyId: string;
  availableConnections: Connection[];
}

function ComposerMountV2Inner({ companyId, availableConnections }: ComposerMountV2Props) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const compose = searchParams.get("compose");
  const initialDraftId = compose && compose !== "new" ? compose : undefined;

  const [loadedDraft, setLoadedDraft] = useState<Draft | null>(null);
  // fetchComplete: false until we've attempted + resolved the draft fetch.
  const [fetchComplete, setFetchComplete] = useState(false);

  useEffect(() => {
    if (!initialDraftId) {
      setLoadedDraft(null);
      setFetchComplete(false);
      return;
    }
    setFetchComplete(false);
    setLoadedDraft(null);
    void fetch(`/api/platform/social/drafts/${initialDraftId}`)
      .then((r) => r.json() as Promise<V1DraftApiResponse>)
      .then((json) => {
        if (json.ok && json.data) {
          setLoadedDraft(mapV1ToV2Draft(json.data));
        }
      })
      .catch(() => {
        // Graceful degradation: composer opens with empty draft if fetch fails.
      })
      .finally(() => {
        setFetchComplete(true);
      });
  }, [initialDraftId]);

  if (!compose) return null;
  // Hold rendering until the existing draft is loaded from the API.
  if (initialDraftId && !fetchComplete) return null;

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
      initialDraft={loadedDraft ?? undefined}
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
