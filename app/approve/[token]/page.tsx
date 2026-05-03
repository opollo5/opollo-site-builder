import { ApprovalDecisionForm } from "@/components/ApprovalDecisionForm";
import { resolveRecipientByToken } from "@/lib/platform/social/approvals";
import {
  PLATFORM_LABEL,
  type SocialPlatform,
} from "@/lib/platform/social/variants/types";

// ---------------------------------------------------------------------------
// S1-7 — magic-link viewer.
//
// Public route. Token IS the auth — we hash + look up; no Supabase
// session required (recipients may not be platform users at all).
//
// Page renders one of three states:
//   1. Token doesn't match anything / expired / revoked / parent
//      request finalised → friendly "this link is no longer valid"
//      panel.
//   2. Token resolves but the request is already finalised
//      (someone else approved/rejected) → "Thanks, this is already
//      resolved" panel.
//   3. Token resolves and the request is open → render the snapshot
//      read-only with the decision form.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

type Snapshot = {
  master_text?: string | null;
  link_url?: string | null;
  variants?: Array<{
    platform: string;
    variant_text: string | null;
    is_custom: boolean;
  }>;
  submitted_at?: string;
};

export default async function ApproveViewerPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Cheap regex pre-filter so an obviously-malformed token doesn't
  // hit Supabase. The lib does the same check + returns NOT_FOUND.
  if (!/^[0-9a-f]{64}$/i.test(token)) {
    return <InvalidLink />;
  }

  const resolved = await resolveRecipientByToken(token);
  if (!resolved.ok) {
    return <InvalidLink />;
  }

  const { recipient, request, company, postState } = resolved.data;

  if (recipient.revoked_at) {
    return <RevokedPanel />;
  }

  // Expired? expires_at is on the request, not the recipient.
  const expired = new Date(request.expires_at).getTime() < Date.now();
  if (expired) {
    return <ExpiredPanel companyName={company.name} />;
  }

  const finalised =
    request.revoked_at !== null ||
    request.final_approved_at !== null ||
    request.final_rejected_at !== null ||
    postState !== "pending_client_approval";

  const snapshot = (request.snapshot_payload ?? {}) as Snapshot;

  return (
    <main className="mx-auto max-w-2xl p-6">
      <header>
        <h1 className="text-2xl font-semibold">
          {company.name} — approval request
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {recipient.name?.trim() ? `Hi ${recipient.name},` : "Hi,"}{" "}
          {company.name} would like your decision on the social post
          below. {snapshot.submitted_at
            ? `Submitted ${formatTime(snapshot.submitted_at)}.`
            : null}
        </p>
      </header>

      <SnapshotReadOnly snapshot={snapshot} />

      <ApprovalDecisionForm
        token={token}
        alreadyDecided={finalised}
      />
    </main>
  );
}

function SnapshotReadOnly({ snapshot }: { snapshot: Snapshot }) {
  return (
    <article
      className="mt-6 rounded-lg border bg-card p-4"
      data-testid="approval-snapshot"
    >
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Master copy
      </h2>
      <p className="mt-2 whitespace-pre-wrap text-sm">
        {snapshot.master_text ?? (
          <span className="text-muted-foreground">— No copy —</span>
        )}
      </p>
      {snapshot.link_url ? (
        <p className="mt-3 text-sm">
          <span className="text-muted-foreground">Link: </span>
          <a
            href={snapshot.link_url}
            target="_blank"
            rel="noreferrer noopener"
            className="text-primary hover:underline"
          >
            {snapshot.link_url}
          </a>
        </p>
      ) : null}

      {snapshot.variants && snapshot.variants.length > 0 ? (
        <>
          <h2 className="mt-6 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Per-platform variants
          </h2>
          <ul className="mt-2 divide-y rounded-md border bg-background">
            {snapshot.variants.map((v) => (
              <li
                key={v.platform}
                className="p-3 text-sm"
                data-testid={`approval-variant-${v.platform}`}
              >
                <div className="font-medium">
                  {PLATFORM_LABEL[v.platform as SocialPlatform] ?? v.platform}
                  {v.is_custom ? (
                    <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-sm font-medium text-primary">
                      Custom
                    </span>
                  ) : (
                    <span className="ml-2 text-sm text-muted-foreground">
                      Uses master copy
                    </span>
                  )}
                </div>
                {v.is_custom && v.variant_text ? (
                  <p className="mt-1 whitespace-pre-wrap">{v.variant_text}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </article>
  );
}

function InvalidLink() {
  return (
    <main className="mx-auto max-w-xl p-6 text-sm">
      <h1 className="text-xl font-semibold">Approval link not valid</h1>
      <p className="mt-3 text-muted-foreground">
        This link is invalid or has expired. If you were expecting to
        review a post, ask the team for a fresh link.
      </p>
    </main>
  );
}

function RevokedPanel() {
  return (
    <main className="mx-auto max-w-xl p-6 text-sm">
      <h1 className="text-xl font-semibold">Approval link revoked</h1>
      <p className="mt-3 text-muted-foreground">
        This invitation has been revoked. If you still need to review
        the post, ask the team for a fresh link.
      </p>
    </main>
  );
}

function ExpiredPanel({ companyName }: { companyName: string }) {
  return (
    <main className="mx-auto max-w-xl p-6 text-sm">
      <h1 className="text-xl font-semibold">Approval window closed</h1>
      <p className="mt-3 text-muted-foreground">
        The approval window for this {companyName} post has expired.
        If you still need to review it, ask the team for a fresh link.
      </p>
    </main>
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
