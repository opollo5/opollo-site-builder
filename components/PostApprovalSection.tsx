"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// S1-6 — recipients section on the post detail page.
//
// Renders the list of reviewers attached to the post's open
// approval_request (or an empty state when none yet) and an inline
// add form for editor+ on a pending_client_approval post. Revoke
// soft-deletes a single recipient.
// ---------------------------------------------------------------------------

type RecipientRow = {
  id: string;
  email: string;
  name: string | null;
  requires_otp: boolean;
  revoked_at: string | null;
  created_at: string;
};

type Props = {
  postId: string;
  companyId: string;
  initialRecipients: RecipientRow[];
  initialApprovalRequestId: string | null;
  // Editor+ on a pending_client_approval post can add or revoke.
  canManage: boolean;
};

export function PostApprovalSection({
  postId,
  companyId,
  initialRecipients,
  initialApprovalRequestId,
  canManage,
}: Props) {
  const [recipients, setRecipients] = useState(initialRecipients);
  const [approvalRequestId] = useState(initialApprovalRequestId);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/platform/social/posts/${postId}/recipients`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            company_id: companyId,
            email: email.trim().toLowerCase(),
            name: name.trim() || null,
          }),
        },
      );
      const json = (await res.json()) as
        | { ok: true; data: { recipient: RecipientRow } }
        | { ok: false; error: { message: string } };
      if (!res.ok || !json.ok) {
        const msg = !json.ok ? json.error.message : "Failed to add recipient.";
        setError(msg);
        return;
      }
      setRecipients((prev) => [...prev, json.data.recipient]);
      setEmail("");
      setName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  }

  async function handleRevoke(recipientId: string) {
    if (!confirm("Revoke this reviewer's magic link?")) return;
    setRevokingId(recipientId);
    setError(null);
    try {
      const url = `/api/platform/social/posts/${postId}/recipients/${recipientId}?company_id=${encodeURIComponent(companyId)}`;
      const res = await fetch(url, { method: "DELETE" });
      const json = (await res.json()) as
        | { ok: true; data: { recipient: RecipientRow } }
        | { ok: false; error: { message: string } };
      if (!res.ok || !json.ok) {
        const msg = !json.ok ? json.error.message : "Failed to revoke.";
        setError(msg);
        return;
      }
      setRecipients((prev) =>
        prev.map((r) =>
          r.id === recipientId
            ? { ...r, revoked_at: json.data.recipient.revoked_at }
            : r,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRevokingId(null);
    }
  }

  if (!approvalRequestId && recipients.length === 0) {
    return null;
  }

  return (
    <section className="mt-8" data-testid="post-approval-section">
      <h2 className="text-lg font-semibold">Approval reviewers</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Reviewers receive a magic link to view + respond to this post.
      </p>

      {error ? (
        <p
          className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
          data-testid="recipients-error"
        >
          {error}
        </p>
      ) : null}

      {recipients.length > 0 ? (
        <ul
          className="mt-4 divide-y rounded-lg border bg-card"
          data-testid="recipients-list"
        >
          {recipients.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-3 p-3"
              data-testid={`recipient-row-${r.id}`}
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">
                  {r.name?.trim() ? `${r.name} <${r.email}>` : r.email}
                </div>
                <div className="text-sm text-muted-foreground">
                  Added {new Date(r.created_at).toLocaleString("en-AU", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  {r.revoked_at ? " • Revoked" : null}
                  {r.requires_otp ? " • OTP required" : null}
                </div>
              </div>
              {canManage && !r.revoked_at ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleRevoke(r.id)}
                  disabled={revokingId === r.id}
                  data-testid={`recipient-revoke-${r.id}`}
                >
                  {revokingId === r.id ? "Revoking…" : "Revoke"}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {canManage && approvalRequestId ? (
        <form
          onSubmit={handleAdd}
          className="mt-4 rounded-lg border bg-card p-4"
          data-testid="add-recipient-form"
        >
          <h3 className="text-sm font-semibold">Add a reviewer</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label
                className="block text-sm font-medium"
                htmlFor="recipient_email"
              >
                Email
              </label>
              <input
                id="recipient_email"
                type="email"
                required
                className="mt-1 w-full rounded-md border bg-background p-2 text-sm"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                data-testid="add-recipient-email"
              />
            </div>
            <div>
              <label
                className="block text-sm font-medium"
                htmlFor="recipient_name"
              >
                Name (optional)
              </label>
              <input
                id="recipient_name"
                type="text"
                className="mt-1 w-full rounded-md border bg-background p-2 text-sm"
                value={name}
                onChange={(e) => setName(e.target.value)}
                data-testid="add-recipient-name"
              />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Button
              type="submit"
              disabled={adding}
              data-testid="add-recipient-submit"
            >
              {adding ? "Sending…" : "Send invite"}
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
