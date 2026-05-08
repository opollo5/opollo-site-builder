"use client";

import { useCallback, useState } from "react";

import { Input } from "@/components/ui/input";
import { RichTextEditor } from "@/components/RichTextEditor";
import { useAutoSave } from "@/lib/hooks/use-auto-save";

// ---------------------------------------------------------------------------
// PostDraftEditor — Spec 14 PR B follow-up.
//
// Inline draft-edit surface mounted by PostDetailClient when the post
// has status === 'draft'. First real consumer of:
//   • lib/hooks/use-auto-save.ts (PR B / #772)
//   • lib/hooks/use-tab-leader.ts (PR B / #772)
//   • lib/hooks/use-session-grace.ts (PR B / #772)
//   • POST /api/sites/[id]/posts/[post_id]/autosave (#783)
//
// What this surface does:
//   - Operator edits title + body inline on the post detail page.
//   - useAutoSave fires server-side flushes on the standard cadence
//     (60s normal / 30s during warning / 15s during grace; doubled
//     when document.hidden). Dirty-state guard skips ticks when
//     nothing has changed; leader election ensures only one tab
//     flushes per cadence tick.
//   - Save status is rendered via a tiny "Saved Ns ago" indicator
//     below the editor.
//
// What this surface deliberately does NOT do:
//   - SEO panel, slug editing, taxonomy, scheduling, featured image —
//     those live in BlogPostComposer for new posts; surfacing them on
//     the inline edit flow is a separate UX slice.
//   - Optimistic concurrency (version_lock CAS) — the autosave route
//     is last-write-wins by design (Spec 14 PR B). Operators
//     coordinating across tabs are protected by the leader-election
//     gate in useAutoSave; the server route refuses autosave on
//     already-published posts so autosave cannot bypass the
//     publish/unpublish CAS routes.
//
// Failure modes:
//   - Server returns 404 (post deleted, or someone else published it
//     while we were editing) → status flips to 'error'; the operator's
//     local state remains intact and can be copied out manually.
//   - Server returns 409 UNIQUE_VIOLATION (slug collision) — only
//     possible if a future revision adds slug editing to this surface.
//     Today this surface does NOT touch slug.
// ---------------------------------------------------------------------------

interface Props {
  siteId: string;
  postId: string;
  initialTitle: string;
  initialHtml: string;
}

export function PostDraftEditor({
  siteId,
  postId,
  initialTitle,
  initialHtml,
}: Props) {
  const [title, setTitle] = useState(initialTitle);
  const [html, setHtml] = useState(initialHtml);
  const [serverError, setServerError] = useState<string | null>(null);

  // useAutoSave's getValue runs on every cadence tick, so keep it cheap.
  const getValue = useCallback(
    () => ({ title, generated_html: html }),
    [title, html],
  );

  const save = useCallback(
    async (value: { title: string; generated_html: string }) => {
      const res = await fetch(
        `/api/sites/${siteId}/posts/${postId}/autosave`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(value),
        },
      );
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        const code =
          payload && typeof payload === "object" && "error" in payload
            ? (payload as { error?: { code?: string } }).error?.code
            : undefined;
        throw new Error(
          code ? `Autosave failed: ${code} (HTTP ${res.status})` : `Autosave failed (HTTP ${res.status})`,
        );
      }
    },
    [siteId, postId],
  );

  const onError = useCallback((err: Error) => {
    setServerError(err.message);
  }, []);

  const onSuccess = useCallback(() => {
    setServerError(null);
  }, []);

  const { status, lastSavedAt } = useAutoSave({
    key: `post-draft:${postId}`,
    getValue,
    save,
    onSuccess,
    onError,
  });

  return (
    <section
      aria-label="Draft editor"
      className="space-y-4 rounded-lg border bg-background p-4"
    >
      <div>
        <label htmlFor="draft-title" className="block text-sm font-medium">
          Title
        </label>
        <Input
          id="draft-title"
          className="mt-1 text-xl font-semibold"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
        />
      </div>

      <div>
        <label className="block text-sm font-medium">Body</label>
        <RichTextEditor
          value={html}
          onChange={setHtml}
          placeholder="Write your post body…"
          className="mt-1"
        />
      </div>

      <SaveStatus
        status={status}
        lastSavedAt={lastSavedAt}
        serverError={serverError}
      />
    </section>
  );
}

function SaveStatus({
  status,
  lastSavedAt,
  serverError,
}: {
  status: ReturnType<typeof useAutoSave>["status"];
  lastSavedAt: number | null;
  serverError: string | null;
}) {
  if (serverError) {
    return (
      <p className="text-xs text-destructive" data-testid="post-autosave-status">
        {serverError}
      </p>
    );
  }
  if (status === "saving") {
    return (
      <p className="text-xs text-muted-foreground" data-testid="post-autosave-status">
        Saving…
      </p>
    );
  }
  if (status === "follower") {
    return (
      <p className="text-xs text-muted-foreground" data-testid="post-autosave-status">
        Another tab is the autosave leader.
      </p>
    );
  }
  if (status === "saved" && lastSavedAt !== null) {
    const seconds = Math.max(0, Math.floor((Date.now() - lastSavedAt) / 1000));
    return (
      <p className="text-xs text-muted-foreground" data-testid="post-autosave-status">
        Saved {seconds === 0 ? "just now" : `${seconds}s ago`}
      </p>
    );
  }
  if (status === "dirty") {
    return (
      <p className="text-xs text-muted-foreground" data-testid="post-autosave-status">
        Unsaved changes…
      </p>
    );
  }
  return null;
}
