import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { checkAdminAccess } from "@/lib/admin-gate";
import { Toaster } from "@/components/ui/toaster";

export default async function OptimiserLayout({
  children,
}: {
  children: ReactNode;
}) {
  const access = await checkAdminAccess();
  if (access.kind === "redirect") redirect(access.to);

  return (
    <>
      {children}
      <Toaster />
    </>
  );
}
