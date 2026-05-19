"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CapCampaign, CapCampaignPost, PostStatus } from "@/lib/cap/campaigns";

type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

interface Props {
  campaign: CapCampaign;
  initialPosts: CapCampaignPost[];
}

const ARC_PHASE_LABEL: Record<string, string> = {
  awareness: "Week 1 — Awareness",
  education: "Week 2 — Education",
  offer: "Week 3 — Offer",
  proof: "Week 4 — Proof",
};

const POST_STATUS_TONE: Record<PostStatus, "success" | "info" | "warning" | "error" | "neutral"> = {
  pending: "neutral",
  generated: "info",
  approved: "success",
  rejected: "error",
  pushed: "success",
  published: "success",
  failed: "error",
  approved_past_due: "warning",
};

export function CapCampaignDetail({ campaign, initialPosts }: Props) {
  const [posts, setPosts] = useState<CapCampaignPost[]>(initialPosts);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");

  async function handleApprove(postId: string) {
    setError(null);
    setBusy(postId);
    const res = await fetch(`/api/platform/cap/campaign-posts/${postId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "approved" }),
    });
    const json = (await res.json()) as ApiResponse<unknown>;
    setBusy(null);
    if (!res.ok || !json.ok) {
      setError(!json.ok ? json.error.message : "Failed to approve post.");
      return;
    }
    setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, status: "approved" as PostStatus } : p)));
  }

  async function handleReject(postId: string) {
    if (!rejectionReason.trim()) return;
    setError(null);
    setBusy(postId);
    const res = await fetch(`/api/platform/cap/campaign-posts/${postId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "rejected", rejection_reason: rejectionReason.trim() }),
    });
    const json = (await res.json()) as ApiResponse<unknown>;
    setBusy(null);
    if (!res.ok || !json.ok) {
      setError(!json.ok ? json.error.message : "Failed to reject post.");
      return;
    }
    setPosts((prev) =>
      prev.map((p) =>
        p.id === postId ? { ...p, status: "rejected" as PostStatus, rejection_reason: rejectionReason.trim() } : p,
      ),
    );
    setRejectingId(null);
    setRejectionReason("");
  }

  async function handleRegenerate(postId: string) {
    setError(null);
    setBusy(postId);
    const res = await fetch(`/api/platform/cap/campaign-posts/${postId}/regenerate`, {
      method: "POST",
    });
    const json = (await res.json()) as ApiResponse<{ content: string; hashtags: string[]; imageUrl: string }>;
    setBusy(null);
    if (!res.ok || !json.ok) {
      setError(!json.ok ? json.error.message : "Regeneration failed.");
      return;
    }
    setPosts((prev) =>
      prev.map((p) =>
        p.id === postId
          ? {
              ...p,
              generated_content: json.data.content,
              generated_hashtags: json.data.hashtags,
              generated_image_url: json.data.imageUrl,
              status: "generated" as PostStatus,
              regenerate_count: p.regenerate_count + 1,
            }
          : p,
      ),
    );
  }

  async function handlePush(postId: string) {
    setError(null);
    setBusy(postId);
    const res = await fetch(`/api/platform/cap/campaign-posts/${postId}/push`, {
      method: "POST",
    });
    const json = (await res.json()) as ApiResponse<{ draftId: string }>;
    setBusy(null);
    if (!res.ok || !json.ok) {
      setError(!json.ok ? json.error.message : "Push failed.");
      return;
    }
    setPosts((prev) =>
      prev.map((p) =>
        p.id === postId ? { ...p, status: "pushed" as PostStatus, social_draft_id: json.data.draftId } : p,
      ),
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
          {error}
        </div>
      )}

      {posts.length === 0 ? (
        <div className="rounded-md border border-border p-6 text-center text-sm text-muted-foreground">
          No posts generated yet. Click &ldquo;Generate content&rdquo; from the campaigns list to start.
        </div>
      ) : (
        posts.map((post) => (
          <Card key={post.id}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                <span>{ARC_PHASE_LABEL[post.arc_phase] ?? post.arc_phase}</span>
                <div className="flex items-center gap-2">
                  {post.regenerate_count > 0 && (
                    <span className="text-xs text-muted-foreground">×{post.regenerate_count} regen</span>
                  )}
                  <Badge tone={POST_STATUS_TONE[post.status]}>
                    {post.status.replace(/_/g, " ")}
                  </Badge>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {post.generated_content ? (
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="sm:col-span-2 space-y-2">
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{post.generated_content}</p>
                    {post.generated_hashtags.length > 0 && (
                      <p className="text-sm text-muted-foreground">{post.generated_hashtags.join(" ")}</p>
                    )}
                  </div>
                  {post.generated_image_url && (
                    <div className="rounded-md overflow-hidden border border-border">
                      <Image
                        src={post.generated_image_url}
                        alt="Generated campaign image"
                        width={400}
                        height={225}
                        className="w-full object-cover"
                        unoptimized
                      />
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground italic">
                  {post.status === "pending" ? "Waiting for generation…" : "No content generated."}
                </p>
              )}

              {post.rejection_reason && (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
                  <span className="font-medium text-destructive">Rejected: </span>
                  {post.rejection_reason}
                </div>
              )}

              {post.social_draft_id && (
                <p className="text-xs text-muted-foreground">
                  Pushed to composer —{" "}
                  <Link
                    href={`/company/social/posts?compose=${post.social_draft_id}`}
                    className="underline underline-offset-2 hover:text-foreground transition-colors"
                  >
                    Open in composer
                  </Link>
                </p>
              )}

              {/* Actions */}
              {(post.status === "generated" || post.status === "rejected") && (
                <div className="flex flex-wrap gap-2">
                  {post.status === "generated" && (
                    <>
                      <Button
                        size="sm"
                        disabled={busy === post.id}
                        onClick={() => void handleApprove(post.id)}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === post.id}
                        onClick={() => setRejectingId(post.id)}
                      >
                        Reject
                      </Button>
                    </>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy === post.id}
                    onClick={() => void handleRegenerate(post.id)}
                  >
                    {busy === post.id ? "Regenerating…" : "Regenerate"}
                  </Button>
                </div>
              )}

              {post.status === "approved" && !post.social_draft_id && (
                <Button
                  size="sm"
                  disabled={busy === post.id}
                  onClick={() => void handlePush(post.id)}
                >
                  {busy === post.id ? "Pushing…" : "Push to composer"}
                </Button>
              )}

              {rejectingId === post.id && (
                <div className="space-y-2">
                  <textarea
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
                    rows={2}
                    placeholder="Reason for rejection…"
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <Button size="sm" variant="destructive" onClick={() => void handleReject(post.id)}>
                      Confirm rejection
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { setRejectingId(null); setRejectionReason(""); }}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))
      )}

      {campaign.status === "generating" && (
        <div className="rounded-md border border-info/40 bg-info/10 p-4 text-sm text-info">
          Generation in progress — refresh in a moment to see results.
        </div>
      )}
    </div>
  );
}
