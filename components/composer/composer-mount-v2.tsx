"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, usePathname, useRouter } from "next/navigation";
import { ComposerOverlay } from "@/components/social/composer/ComposerOverlay";
import type { Connection, Draft, DraftState } from "@/lib/social/types";

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
//
// Two column layouts exist in production:
//   V1 rows: content in draft_data.master_text, media in draft_data.media_refs,
//            targets in draft_data.target_connection_ids.
//   V2 rows: content/media/targets in top-level columns; draft_data may be {}.
//
// Rows created before the draft_data mirroring patch (PR #993 V2 write-path)
// have draft_data: {} with populated top-level columns. The mapper handles both.
interface V1DraftApiResponse {
  ok: boolean;
  data?: {
    id: string;
    draft_version?: number;
    // V2 drafts store content at the top level; V1 drafts use draft_data.master_text
    content?: string | null;
    state?: string | null;
    // V2 drafts write scheduled_at at the top level; V1 drafts use draft_data.schedule
    scheduled_at?: string | null;
    last_publish_error?: { message?: string } | null;
    // Top-level V2 columns — present on rows where draft_data is empty
    media_urls?: string[] | null;
    target_profiles?: Array<{ profile_id: string }> | null;
    // draft_data fields are optional: V2 rows may have draft_data: {}
    draft_data: {
      master_text?: string;
      media_refs?: Array<{ url: string }>;
      target_connection_ids?: string[];
      approval_required?: boolean;
      schedule?: { date: string; times: string[] } | null;
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

export function mapV1ToV2Draft(d: NonNullable<V1DraftApiResponse["data"]>): Draft {
  // Prefer top-level scheduled_at (V2 path); fall back to draft_data.schedule (V1 path).
  let scheduled_at: string | null = d.scheduled_at ?? null;
  if (!scheduled_at && d.draft_data.schedule) {
    const s = d.draft_data.schedule;
    const time = s.times[0] ?? "09:00";
    // Best-effort: V1 schedule stores local wall-clock without timezone info.
    // This suffix is intentionally left as Z to satisfy ISO 8601; callers that
    // need accurate UTC must convert using the company timezone.
    scheduled_at = `${s.date}T${time}:00Z`;
  }

  // V2 rows created before the draft_data mirroring patch have draft_data: {} but
  // populated top-level columns. Fall back in order: V1 draft_data → V2 top-level → empty.
  const mediaUrls =
    d.draft_data.media_refs?.map((r) => r.url) ??
    d.media_urls ??
    [];
  const targetProfileIds =
    d.draft_data.target_connection_ids ??
    d.target_profiles?.map((p) => p.profile_id) ??
    [];

  return {
    id: d.id,
    draft_version: d.draft_version,
    // V2 drafts write to the top-level content column; fall back to V1 draft_data.master_text
    content: d.content ?? d.draft_data.master_text ?? "",
    media_urls: mediaUrls,
    target_profile_ids: targetProfileIds,
    platform_variants: {},
    approval_required: d.draft_data.approval_required ?? false,
    scheduled_at,
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
  companyTimezone?: string;
}

function ComposerMountV2Inner({ companyId, companyTimezone = "UTC" }: ComposerMountV2Props) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const compose = searchParams.get("compose");
  const initialDraftId = compose && compose !== "new" ? compose : undefined;

  const [loadedDraft, setLoadedDraft] = useState<Draft | null>(null);
  const [fetchComplete, setFetchComplete] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [editOriginalState, setEditOriginalState] = useState<DraftState | undefined>(undefined);
  const [failureReason, setFailureReason] = useState<string | undefined>(undefined);
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
    setFetchError(false);
    setLoadedDraft(null);
    setEditOriginalState(undefined);
    setFailureReason(undefined);
    void fetch(`/api/platform/social/drafts/${initialDraftId}`)
      .then((r) => r.json() as Promise<V1DraftApiResponse>)
      .then((json) => {
        if (json.ok && json.data) {
          setLoadedDraft(mapV1ToV2Draft(json.data));
          if (json.data.state) {
            setEditOriginalState(json.data.state as DraftState);
          }
          const errMsg = json.data.last_publish_error?.message;
          if (errMsg) setFailureReason(errMsg);
        } else {
          setFetchError(true);
        }
      })
      .catch(() => {
        setFetchError(true);
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

  function handleNavigateToPost(postId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("compose", postId);
    router.replace(pathname + "?" + params.toString(), { scroll: false });
  }

  if (fetchError) {
    return (
      <div
        className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background"
        role="dialog"
        aria-modal="true"
        aria-label="Error loading post"
        data-testid="composer-fetch-error"
      >
        <p className="text-sm font-medium text-foreground">Couldn&apos;t load this post.</p>
        <p className="text-sm text-muted-foreground">It may have been deleted, or the connection failed.</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              const params = new URLSearchParams(searchParams.toString());
              const id = params.get("compose");
              if (id) {
                setFetchComplete(false);
                setFetchError(false);
                setLoadedDraft(null);
                void fetch(`/api/platform/social/drafts/${id}`)
                  .then((r) => r.json() as Promise<V1DraftApiResponse>)
                  .then((json) => {
                    if (json.ok && json.data) {
                      setLoadedDraft(mapV1ToV2Draft(json.data));
                      if (json.data.state) setEditOriginalState(json.data.state as DraftState);
                      const errMsg = json.data.last_publish_error?.message;
                      if (errMsg) setFailureReason(errMsg);
                    } else {
                      setFetchError(true);
                    }
                  })
                  .catch(() => setFetchError(true))
                  .finally(() => setFetchComplete(true));
              }
            }}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Retry
          </button>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <ComposerOverlay
      open={true}
      onClose={handleClose}
      companyId={companyId}
      companyTimezone={companyTimezone}
      availableConnections={connections}
      initialDraft={loadedDraft ?? undefined}
      editOriginalState={editOriginalState}
      failureReason={failureReason}
      onNavigateToPost={handleNavigateToPost}
    />
  );
}

export function ComposerMountV2({ companyId, companyTimezone }: ComposerMountV2Props) {
  return (
    <Suspense fallback={null}>
      <ComposerMountV2Inner companyId={companyId} companyTimezone={companyTimezone} />
    </Suspense>
  );
}
