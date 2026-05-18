import * as React from "react";
import { jwtVerify } from "jose";
import { getServiceRoleClient } from "@/lib/supabase";
import { ReviewDecisionForm } from "@/components/social/review/ReviewDecisionForm";

// ---------------------------------------------------------------------------
// /review/[token] — public magic-link review page for composer V2 approval.
//
// Token is a JWT signed with NEXTAUTH_SECRET / AUTH_SECRET.
// Claims: { sub: draftId, purpose: 'review', exp: now+14d }
//
// No Supabase session required — the token IS the auth.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

interface TokenClaims {
  sub?: string;
  purpose?: string;
  exp?: number;
}

async function verifyToken(token: string): Promise<{ ok: true; draftId: string } | { ok: false }> {
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;
  if (!secret) return { ok: false };

  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    const claims = payload as TokenClaims;
    if (claims.purpose !== "review" || !claims.sub) return { ok: false };
    return { ok: true, draftId: claims.sub };
  } catch {
    return { ok: false };
  }
}

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const verified = await verifyToken(token);
  if (!verified.ok) {
    return <InvalidLink />;
  }

  const svc = getServiceRoleClient();
  const { data: draft } = await svc
    .from("social_post_drafts")
    .select("id, state, content, media_urls, target_profiles, platform_variants, created_at")
    .eq("id", verified.draftId)
    .maybeSingle();

  if (!draft) {
    return <InvalidLink />;
  }

  const state = draft.state as string;
  const alreadyDecided = state !== "pending_approval";

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold text-foreground">Post review</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Review the post below and approve or reject it.
        </p>
      </header>

      {alreadyDecided && (
        <div className="mb-6 rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
          This post has already been{" "}
          {state === "rejected" ? "rejected" : state === "scheduled" ? "approved" : state}.
        </div>
      )}

      {/* Post content */}
      <article className="mb-8 rounded-lg border border-border bg-card p-5">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Post content
        </h2>
        <p className="whitespace-pre-wrap text-base text-foreground">
          {(draft.content as string | null) ?? (
            <span className="text-muted-foreground">— No content —</span>
          )}
        </p>

        {Array.isArray(draft.media_urls) && (draft.media_urls as string[]).length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {(draft.media_urls as string[]).map((url, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={url}
                alt={`Attached media ${i + 1}`}
                className="h-24 w-24 rounded-md object-cover"
              />
            ))}
          </div>
        )}
      </article>

      <ReviewDecisionForm draftId={verified.draftId} disabled={alreadyDecided} />
    </main>
  );
}

function InvalidLink() {
  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <h1 className="text-2xl font-semibold text-foreground">Review link not valid</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        This link is invalid or has expired. If you were expecting to review a post,
        ask the team for a fresh link.
      </p>
    </main>
  );
}
