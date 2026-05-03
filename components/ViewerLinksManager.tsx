"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// S1-15 — admin manager for /viewer/[token] links.
//
// Renders the active links table + an inline create form. On create we
// surface the URL for one-time copy (the raw token never goes back to
// disk). Revoking soft-removes from the active list.
// ---------------------------------------------------------------------------

type Link = {
  id: string;
  recipient_email: string | null;
  recipient_name: string | null;
  expires_at: string;
  revoked_at: string | null;
  last_viewed_at: string | null;
  created_at: string;
};

type Props = {
  companyId: string;
  initialLinks: Link[];
};

export function ViewerLinksManager({ companyId, initialLinks }: Props) {
  const [links, setLinks] = useState(initialLinks);
  const [adding, setAdding] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [justCreatedUrl, setJustCreatedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setJustCreatedUrl(null);
    try {
      const res = await fetch("/api/platform/social/viewer-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_id: companyId,
          recipient_email: recipientEmail.trim() || null,
          recipient_name: recipientName.trim() || null,
        }),
      });
      const json = (await res.json()) as
        | { ok: true; data: { link: Link; url: string } }
        | { ok: false; error: { message: string } };
      if (!res.ok || !json.ok) {
        const msg = !json.ok ? json.error.message : "Failed to create link.";
        setError(msg);
        return;
      }
      setLinks((prev) => [json.data.link, ...prev]);
      setJustCreatedUrl(json.data.url);
      setRecipientEmail("");
      setRecipientName("");
      setAdding(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRevoke(id: string) {
    if (!confirm("Revoke this calendar link? Anyone using it will lose access immediately."))
      return;
    setRevokingId(id);
    setError(null);
    try {
      const url = `/api/platform/social/viewer-links/${id}?company_id=${encodeURIComponent(companyId)}`;
      const res = await fetch(url, { method: "DELETE" });
      const json = (await res.json()) as
        | { ok: true; data: { link: Link } }
        | { ok: false; error: { message: string } };
      if (!res.ok || !json.ok) {
        const msg = !json.ok ? json.error.message : "Failed to revoke.";
        setError(msg);
        return;
      }
      setLinks((prev) => prev.filter((l) => l.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRevokingId(null);
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* noop */
    }
  }

  return (
    <section data-testid="viewer-links-manager">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Calendar sharing</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            90-day read-only links to the content calendar. Recipients
            don&apos;t need an Opollo account.
          </p>
        </div>
        {!adding ? (
          <Button
            onClick={() => {
              setAdding(true);
              setError(null);
              setJustCreatedUrl(null);
            }}
            data-testid="viewer-links-add-button"
          >
            Create link
          </Button>
        ) : null}
      </div>

      {error ? (
        <p
          className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
          data-testid="viewer-links-error"
        >
          {error}
        </p>
      ) : null}

      {justCreatedUrl ? (
        <div
          className="mt-4 rounded-md border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900"
          data-testid="viewer-links-just-created"
        >
          <p className="font-medium">Link created. Copy it now — we won&apos;t show the URL again.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="break-all rounded bg-white px-2 py-1 text-sm">
              {justCreatedUrl}
            </code>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => copy(justCreatedUrl)}
              data-testid="viewer-links-copy"
            >
              Copy
            </Button>
          </div>
        </div>
      ) : null}

      {adding ? (
        <form
          onSubmit={handleCreate}
          className="mt-4 rounded-lg border bg-card p-4"
          data-testid="viewer-links-add-form"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium" htmlFor="vl_email">
                Recipient email (optional)
              </label>
              <input
                id="vl_email"
                type="email"
                className="mt-1 w-full rounded-md border bg-background p-2 text-sm"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                data-testid="viewer-links-add-email"
              />
            </div>
            <div>
              <label className="block text-sm font-medium" htmlFor="vl_name">
                Recipient name (optional)
              </label>
              <input
                id="vl_name"
                type="text"
                className="mt-1 w-full rounded-md border bg-background p-2 text-sm"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                data-testid="viewer-links-add-name"
              />
            </div>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Email + name are for your audit log only. The token is the
            auth, not the email — anyone with the URL can view.
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              type="submit"
              disabled={submitting}
              data-testid="viewer-links-add-submit"
            >
              {submitting ? "Creating…" : "Create link"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setAdding(false);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {links.length === 0 ? (
        <div
          className="mt-4 rounded-lg border bg-card p-6 text-sm text-muted-foreground"
          data-testid="viewer-links-empty"
        >
          No active calendar-sharing links. Create one to share the
          calendar with a client or stakeholder.
        </div>
      ) : (
        <ul
          className="mt-4 divide-y rounded-lg border bg-card"
          data-testid="viewer-links-list"
        >
          {links.map((l) => (
            <li
              key={l.id}
              className="flex flex-wrap items-center justify-between gap-3 p-4"
              data-testid={`viewer-link-row-${l.id}`}
            >
              <div>
                <div className="font-medium">
                  {l.recipient_name?.trim()
                    ? `${l.recipient_name} (${l.recipient_email ?? "—"})`
                    : (l.recipient_email ?? "Unnamed link")}
                </div>
                <div className="text-sm text-muted-foreground">
                  Expires{" "}
                  {new Date(l.expires_at).toLocaleDateString("en-AU", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                  {l.last_viewed_at
                    ? ` • Last viewed ${new Date(
                        l.last_viewed_at,
                      ).toLocaleString("en-AU", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}`
                    : " • Never viewed"}
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleRevoke(l.id)}
                disabled={revokingId === l.id}
                data-testid={`viewer-link-revoke-${l.id}`}
              >
                {revokingId === l.id ? "Revoking…" : "Revoke"}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
