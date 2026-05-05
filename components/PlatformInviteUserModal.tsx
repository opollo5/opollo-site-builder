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

type Role = "admin" | "approver" | "editor" | "viewer";

const ERROR_MESSAGES: Record<string, string> = {
  PENDING_INVITE_EXISTS:
    "An active invitation already exists for this email. Revoke it first, then re-invite.",
  ACTIVE_MEMBERSHIP_EXISTS:
    "This email is already a member of a company on the platform.",
  EMAIL_DELIVERY_FAILED:
    "Invitation created but the email failed to send. The user will receive a reminder in 3 days, or you can revoke and resend.",
  VALIDATION_FAILED: "Please check the email address and try again.",
  COMPANY_NOT_FOUND: "Company not found. Refresh the page and try again.",
  FORBIDDEN: "You don't have permission to invite users to this company.",
};

function friendlyError(code: string | undefined, fallback: string): string {
  return (code && ERROR_MESSAGES[code]) ?? fallback;
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

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
        friendlyError(
          json?.error?.code,
          json?.error?.message ?? `Request failed (${response.status}).`,
        ),
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
                disabled={submitting || !isValidEmail(email)}
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
