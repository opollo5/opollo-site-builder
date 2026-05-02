"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

// P3-4 — invite-user button + modal. Self-contained client component.
// Drops into the company detail header. Posts to POST /api/platform/invitations
// (which gates on requireCanDoForApi(companyId, "manage_invitations") via
// session cookie — operator opollo_users staff and customer admins both
// satisfy this on /admin/companies/[id]).
//
// On success: close the modal + router.refresh() so the new pending row
// appears in the detail page's pending-invitations table.

type Role = "admin" | "approver" | "editor" | "viewer";

const ROLE_OPTIONS: Array<{ value: Role; label: string; help: string }> = [
  {
    value: "admin",
    label: "Admin",
    help: "Manages users, settings, and connections.",
  },
  {
    value: "approver",
    label: "Approver",
    help: "Approves content for publishing.",
  },
  {
    value: "editor",
    label: "Editor",
    help: "Drafts and submits content.",
  },
  {
    value: "viewer",
    label: "Viewer",
    help: "Read-only calendar access.",
  },
];

function Label({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-medium">
      {children}
    </label>
  );
}

export function PlatformInviteUserModal({
  companyId,
}: {
  companyId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setEmail("");
    setRole("editor");
    setSubmitting(false);
    setError(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    const response = await fetch("/api/platform/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company_id: companyId,
        email: email.trim(),
        role,
      }),
    });
    const json = (await response.json().catch(() => null)) as {
      ok: boolean;
      error?: { code: string; message: string };
    } | null;

    if (!response.ok || !json?.ok) {
      setError(
        json?.error?.message ?? `Request failed (${response.status}).`,
      );
      setSubmitting(false);
      return;
    }

    setOpen(false);
    reset();
    router.refresh();
  }

  return (
    <>
      <Button
        type="button"
        data-testid="invite-user-button"
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        <Plus aria-hidden className="h-4 w-4" />
        Invite user
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!submitting) setOpen(next);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Invite a user</DialogTitle>
            <DialogDescription>
              They&apos;ll receive an email with a magic link to set their
              password. The invitation expires in 14 days.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                data-testid="invite-email"
                type="email"
                required
                maxLength={254}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError(null);
                }}
                disabled={submitting}
                placeholder="newhire@example.com"
              />
            </div>

            <fieldset className="space-y-2" disabled={submitting}>
              <legend className="text-sm font-medium">Role</legend>
              {ROLE_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className="flex cursor-pointer items-start gap-2 rounded border p-2 text-sm hover:bg-muted/30"
                >
                  <input
                    type="radio"
                    name="invite-role"
                    value={opt.value}
                    checked={role === opt.value}
                    onChange={() => setRole(opt.value)}
                    data-testid={`invite-role-${opt.value}`}
                    className="mt-0.5"
                  />
                  <span>
                    <strong>{opt.label}</strong>
                    <span className="block text-sm text-muted-foreground">
                      {opt.help}
                    </span>
                  </span>
                </label>
              ))}
            </fieldset>

            {error ? (
              <div
                role="alert"
                data-testid="invite-error"
                className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
              >
                {error}
              </div>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                data-testid="invite-submit"
                disabled={submitting || !email.trim()}
              >
                {submitting ? "Sending…" : "Send invitation"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
