"use client";

import { useState } from "react";

// ---------------------------------------------------------------------------
// PortalContactForm — B4 admin UI to set portal_contact_email/name.
// Rendered in the company Settings tab.
// ---------------------------------------------------------------------------

type Props = {
  companyId: string;
  initialEmail: string;
  initialName: string;
};

export function PortalContactForm({ companyId, initialEmail, initialName }: Props) {
  const [email, setEmail]   = useState(initialEmail);
  const [name,  setName]    = useState(initialName);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setStatus("saving");
    setErrorMsg(null);

    const res = await fetch(
      `/api/platform/companies/${companyId}/portal-contact`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          portal_contact_email: email.trim() || null,
          portal_contact_name:  name.trim()  || null,
        }),
      },
    );

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setErrorMsg(body?.error?.message ?? "Save failed.");
      setStatus("error");
      return;
    }

    setStatus("saved");
    setTimeout(() => setStatus("idle"), 2000);
  }

  return (
    <form onSubmit={handleSave} className="space-y-3 max-w-sm">
      <div>
        <label
          htmlFor="portal-contact-email"
          className="block text-xs font-medium text-muted-foreground mb-1"
        >
          Contact email
        </label>
        <input
          id="portal-contact-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="client@example.com"
          className="block w-full rounded-md border bg-background px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
          disabled={status === "saving"}
        />
      </div>

      <div>
        <label
          htmlFor="portal-contact-name"
          className="block text-xs font-medium text-muted-foreground mb-1"
        >
          Contact name <span className="font-normal">(optional)</span>
        </label>
        <input
          id="portal-contact-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Jane Smith"
          className="block w-full rounded-md border bg-background px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
          disabled={status === "saving"}
        />
      </div>

      {errorMsg && (
        <p className="text-xs text-destructive">{errorMsg}</p>
      )}

      <button
        type="submit"
        disabled={status === "saving"}
        className="rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {status === "saving" ? "Saving…" : status === "saved" ? "Saved ✓" : "Save"}
      </button>
    </form>
  );
}
