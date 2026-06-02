import { PageHeader } from "@/components/ui/page-header";
import { getProofQueue } from "@/lib/platform/proofing";

// ---------------------------------------------------------------------------
// /proof/queue?token=<raw_token>
//
// Client review queue — the Gain-style front door. Shows all content proofs
// awaiting THIS reviewer's decision. Token IS the auth (same one from the
// magic link email). Session is consumed here (on first load).
//
// For the current token's review: "Review now" opens /approve/<token>.
// For other pending reviews (same email, different proofs): "Get a new link"
// triggers a re-request email via /proof/request.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

export default async function ProofQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token || !/^[0-9a-f]{64}$/i.test(token)) {
    return <InvalidToken />;
  }

  const { items, reviewerEmail } = await getProofQueue(token);

  if (!reviewerEmail) {
    return <InvalidToken />;
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <PageHeader>
        <PageHeader.Title>Your review queue</PageHeader.Title>
        <PageHeader.Subtitle>
          Items waiting for your decision, {reviewerEmail}.
        </PageHeader.Subtitle>
      </PageHeader>

      {items.length === 0 ? (
        <div className="mt-8 rounded-lg border bg-card p-8 text-center">
          <p className="text-muted-foreground">
            No reviews pending — all caught up.
          </p>
        </div>
      ) : (
        <ul className="mt-6 divide-y rounded-lg border bg-card">
          {items.map((item) => (
            <li key={item.approvalRequestId} className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-foreground truncate">
                    {item.companyName}
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {item.versionLabel}
                    {item.snapshot?.content
                      ? ` — ${item.snapshot.content.slice(0, 60)}${item.snapshot.content.length > 60 ? "…" : ""}`
                      : null}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Expires {new Date(item.expiresAt).toLocaleDateString("en-AU", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </p>
                </div>

                <div className="shrink-0">
                  {item.isCurrentToken ? (
                    <a
                      href={`/approve/${token}`}
                      className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
                    >
                      Review now
                    </a>
                  ) : (
                    <a
                      href="/proof/request"
                      className="rounded-md border px-4 py-2 text-sm font-semibold text-foreground hover:bg-muted"
                    >
                      Get a new link
                    </a>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function InvalidToken() {
  return (
    <main className="mx-auto max-w-xl p-6 text-sm">
      <h1 className="text-page-title text-foreground">Link not valid</h1>
      <p className="mt-3 text-muted-foreground">
        This review link is invalid or expired. Enter your email to get a
        fresh link.
      </p>
      <a
        href="/proof/request"
        className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
      >
        Request a new link
      </a>
    </main>
  );
}
