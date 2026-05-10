import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { getCurrentPlatformSession } from "@/lib/platform/auth";

// /company/internal/* -- Opollo staff only.
// Internal tooling routes (labs, diagnostics, debugging aids).
// Customer users are redirected to /company.

export default async function InternalLayout({ children }: { children: ReactNode }) {
  const session = await getCurrentPlatformSession();
  if (!session) {
    redirect("/login");
  }
  if (!session.isOpolloStaff) {
    redirect("/company");
  }
  return <>{children}</>;
}
