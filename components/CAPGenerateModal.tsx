"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  PLATFORM_LABEL,
  SUPPORTED_PLATFORMS,
  type SocialPlatform,
} from "@/lib/platform/social/variants/types";
import type { PostMasterListItem } from "@/lib/platform/social/posts";

// ---------------------------------------------------------------------------
// D3 — modal for POST /api/platform/social/cap/generate.
//
// Lets editors specify optional topics, which platforms to target, and
// how many posts to generate (1–5). Calls the CAP generate endpoint and
// returns the created draft posts to the parent via onSuccess.
// ---------------------------------------------------------------------------

type Props = {
  open: boolean;
  companyId: string;
  onClose: () => void;
  onSuccess: (posts: PostMasterListItem[]) => void;
};

export function CAPGenerateModal({ open, companyId, onClose, onSuccess }: Props) {
  const [topics, setTopics] = useState("");
  const [platforms, setPlatforms] = useState<SocialPlatform[]>([...SUPPORTED_PLATFORMS]);
  const [count, setCount] = useState(3);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function togglePlatform(p: SocialPlatform) {
    setPlatforms((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p],
    );
  }

  function reset() {
    setTopics("");
    setPlatforms([...SUPPORTED_PLATFORMS]);
    setCount(3);
    setSubmitting(false);
    setError(null);
  }

  function handleClose() {
    if (submitting) return;
    reset();
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (platforms.length === 0) {
      setError("Select at least one platform.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/platform/social/cap/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_id: companyId,
          topics: topics.trim() ? topics.split("\n").map((t) => t.trim()).filter(Boolean) : undefined,
          platforms,
          count,
        }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        data?: { posts: PostMasterListItem[]; count: number };
        error?: { code: string; message: string };
      };
      if (!json.ok || !json.data) {
        const msg = json.error?.code === "RATE_LIMITED"
          ? "Generation limit reached (10 per day). Try again tomorrow."
          : (json.error?.message ?? "Generation failed.");
        setError(msg);
        return;
      }
      toast.success(`${json.data.count} draft ${json.data.count === 1 ? "post" : "posts"} generated.`);
      onSuccess(json.data.posts);
      reset();
      onClose();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Generate posts with AI</DialogTitle>
          <DialogDescription>
            Claude will write drafts using your brand voice. You can review and
            edit before publishing.
          </DialogDescription>
        </DialogHeader>

        <form id="cap-generate-form" onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="cap-topics" className="text-sm font-medium">Topics (optional)</label>
            <Textarea
              id="cap-topics"
              placeholder={"One topic per line, e.g.\nProduct launch\nCustomer success story"}
              value={topics}
              onChange={(e) => setTopics(e.target.value)}
              rows={3}
              disabled={submitting}
            />
            <p className="text-xs text-muted-foreground">
              Leave blank to let Claude choose from your brand focus topics.
            </p>
          </div>

          <div className="space-y-1.5">
            <p className="text-sm font-medium">Platforms</p>
            <div className="flex flex-wrap gap-2">
              {SUPPORTED_PLATFORMS.map((p) => (
                <button
                  key={p}
                  type="button"
                  disabled={submitting}
                  onClick={() => togglePlatform(p)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    platforms.includes(p)
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {PLATFORM_LABEL[p]}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="cap-count" className="text-sm font-medium">Number of posts</label>
            <div className="flex items-center gap-3">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  disabled={submitting}
                  onClick={() => setCount(n)}
                  className={`h-8 w-8 rounded-full border text-sm font-medium transition-colors ${
                    count === n
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {error ? (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" form="cap-generate-form" disabled={submitting || platforms.length === 0}>
            {submitting ? "Generating…" : `Generate ${count} ${count === 1 ? "post" : "posts"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
