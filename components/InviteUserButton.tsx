"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { InviteUserModal } from "@/components/InviteUserModal";

// Lightweight client wrapper so the server-rendered /admin/users page
// stays mostly server — only the button + modal need client state.
//
// AUTH-FOUNDATION P3.3: actorRole drives the role dropdown options
// inside the modal (super_admin → admin/user; admin → user only).
// Defence in depth — POST /api/admin/invites also gates per-actor.

export function InviteUserButton({
  actorRole,
}: {
  actorRole: "super_admin" | "admin" | "user";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)} data-testid="invite-user-button">
        Invite user
      </Button>
      <InviteUserModal
        open={open}
        onClose={() => setOpen(false)}
        actorRole={actorRole}
      />
    </>
  );
}
