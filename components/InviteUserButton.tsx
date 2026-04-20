"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { InviteUserModal } from "@/components/InviteUserModal";

// Lightweight client wrapper so the server-rendered /admin/users page
// stays mostly server — only the button + modal need client state.

export function InviteUserButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Invite user</Button>
      <InviteUserModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
