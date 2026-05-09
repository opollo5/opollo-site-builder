import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { Toaster } from "@/components/ui/toaster";
import { getCurrentPlatformSession } from "@/lib/platform/auth";

export default async function CompanyLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await getCurrentPlatformSession();
  if (!session) {
    redirect(`/login?next=${encodeURIComponent("/company")}`);
  }

  return (
    <>
      {children}
      <Toaster />
    </>
  );
}
