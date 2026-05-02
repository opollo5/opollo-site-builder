"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
// Import directly from `/types` (not the barrel) so this client
// component doesn't transitively pull list.ts / upsert.ts, both of
// which have `import "server-only"`.
import {
  PLATFORM_LABEL,
  type ResolvedVariant,
  type SocialPlatform,
} from "@/lib/platform/social/variants/types";

// ---------------------------------------------------------------------------
// S1-4 — per-platform variants section on the post detail page.
//
// Each platform row shows the effective text. Editor+ on a draft can
// override per platform via PUT /api/platform/social/posts/[id]/variants.
// Empty save clears the override (is_custom flips back to false).
// ---------------------------------------------------------------------------

type Props = {
  postId: string;
  companyId: string;
  initialResolved: ResolvedVariant[];
  masterText: string | null;
  canEdit: boolean;
};

export function PostVariantsSection({
  postId,
  companyId,
  initialResolved,
  masterText,
  canEdit,
}: Props) {
  const [resolved, setResolved] = useState(initialResolved);
  const [editingPlatform, setEditingPlatform] =
    useState<SocialPlatform | null>(null);
  const [draftText, setDraftText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEditing(r: ResolvedVariant) {
    setEditingPlatform(r.platform);
    // Seed editor with current override OR master text so the user can
    // tweak from where things stand.
    setDraftText(r.variant?.is_custom ? (r.variant.variant_text ?? "") : (masterText ?? ""));
    setError(null);
  }

  async function save(platform: SocialPlatform) {
    setSubmitting(true);
    setError(null);
    try {
      const trimmed = draftText.trim();
      const res = await fetch(
        `/api/platform/social/posts/${postId}/variants`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            company_id: companyId,
            platform,
            variant_text: trimmed.length === 0 ? null : trimmed,
          }),
        },
      );
      const json = (await res.json()) as
        | { ok: true; data: { variant: NonNullable<ResolvedVariant["variant"]> } }
        | { ok: false; error: { message: string } };
      if (!res.ok || !json.ok) {
        const msg = !json.ok
          ? json.error.message
          : "Failed to save variant.";
        setError(msg);
        return;
      }
      const v = json.data.variant;
      setResolved((prev) =>
        prev.map((r) =>
          r.platform === platform
            ? {
                platform,
                variant: v,
                effective_text: v.is_custom ? v.variant_text : masterText,
              }
            : r,
        ),
      );
      setEditingPlatform(null);
      setDraftText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mt-8" data-testid="post-variants-section">
      <h2 className="text-lg font-semibold">Per-platform variants</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Each platform falls back to the master copy unless you author an
        override. {canEdit ? "Click Edit to customise." : null}
      </p>

      {error ? (
        <p
          className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
          data-testid="variants-error"
        >
          {error}
        </p>
      ) : null}

      <ul className="mt-4 divide-y rounded-lg border bg-card">
        {resolved.map((r) => {
          const editing = editingPlatform === r.platform;
          const isCustom = r.variant?.is_custom === true;
          return (
            <li
              key={r.platform}
              className="p-4"
              data-testid={`variant-row-${r.platform}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">
                      {PLATFORM_LABEL[r.platform]}
                    </span>
                    {isCustom ? (
                      <span
                        className="rounded-full bg-primary/10 px-2 py-0.5 text-sm font-medium text-primary"
                        data-testid={`variant-custom-${r.platform}`}
                      >
                        Custom
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        Uses master copy
                      </span>
                    )}
                  </div>
                  {!editing ? (
                    <p
                      className="mt-2 whitespace-pre-wrap text-sm"
                      data-testid={`variant-text-${r.platform}`}
                    >
                      {r.effective_text ?? (
                        <span className="text-muted-foreground">
                          — No copy —
                        </span>
                      )}
                    </p>
                  ) : null}
                </div>
                {canEdit && !editing ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => startEditing(r)}
                    data-testid={`variant-edit-${r.platform}`}
                  >
                    Edit
                  </Button>
                ) : null}
              </div>

              {editing ? (
                <div className="mt-3">
                  <textarea
                    className="w-full rounded-md border bg-background p-2 text-sm"
                    rows={4}
                    value={draftText}
                    onChange={(e) => setDraftText(e.target.value)}
                    placeholder="Leave blank to clear the override and use the master copy."
                    data-testid={`variant-textarea-${r.platform}`}
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      onClick={() => save(r.platform)}
                      disabled={submitting}
                      data-testid={`variant-save-${r.platform}`}
                    >
                      {submitting ? "Saving…" : "Save"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditingPlatform(null);
                        setDraftText("");
                        setError(null);
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
