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
// Connections are fetched client-side from GET /api/platform/social/connections
// when compose is triggered — this allows Playwright route mocks to control
// which connections appear in the composer during e2e tests.
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

// Minimal V1 connection shape returned by the connections API.
interface V1Connection {
  id: string;
  platform: string;
  display_name: string | null;
  avatar_url: string | null;
  status: string;
}

interface V1ConnectionsApiResponse {
  ok: boolean;
  data?: { connections: V1Connection[] };
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

function mapV1Platform(p: string): Connection["platform"] {
  if (p === "linkedin_personal" || p === "linkedin_company") return "linkedin";
  if (p === "facebook_page") return "facebook";
  if (p === "instagram_business") return "instagram";
  if (p === "gbp") return "google_business_profile";
  return p as Connection["platform"];
}

function mapV1Connection(c: V1Connection): Connection {
  return {
    id: c.id,
    platform: mapV1Platform(c.platform),
    account_name: c.display_name ?? c.platform,
    account_avatar_url: c.avatar_url ?? "",
  };
}

interface ComposerMountV2Props {
  companyId: string;
}

function ComposerMountV2Inner({ companyId }: ComposerMountV2Props) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const compose = searchParams.get("compose");
  const initialDraftId = compose && compose !== "new" ? compose : undefined;

  const [loadedDraft, setLoadedDraft] = useState<Draft | null>(null);
  const [fetchComplete, setFetchComplete] = useState(false);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [connectionsReady, setConnectionsReady] = useState(false);

  // Fetch connections client-side so Playwright mocks can intercept.
  useEffect(() => {
    if (!compose) {
      setConnections([]);
      setConnectionsReady(false);
      return;
    }
    setConnectionsReady(false);
    void fetch(`/api/platform/social/connections?company_id=${encodeURIComponent(companyId)}`)
      .then((r) => r.json() as Promise<V1ConnectionsApiResponse>)
      .then((json) => {
        if (json.ok && json.data) {
          setConnections(
            json.data.connections
              .filter((c) => c.status !== "disconnected")
              .map(mapV1Connection),
          );
        }
      })
      .catch(() => {
        // Graceful degradation: composer opens with no connection chips if fetch fails.
      })
      .finally(() => {
        setConnectionsReady(true);
      });
  }, [compose, companyId]);

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
  if (!connectionsReady) return null;
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
      availableConnections={connections}
      initialDraft={loadedDraft ?? undefined}
    />
  );
}

export function ComposerMountV2({ companyId }: ComposerMountV2Props) {
  return (
    <Suspense fallback={null}>
      <ComposerMountV2Inner companyId={companyId} />
    </Suspense>
  );
}
