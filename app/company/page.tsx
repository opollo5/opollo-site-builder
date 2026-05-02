import { redirect } from "next/navigation";

// /company — landing redirect to /company/users (the only V1 customer
// surface). Future: /company/settings, /company/social, etc. Each will
// have its own gate.

export const dynamic = "force-dynamic";

export default function CompanyLandingPage(): never {
  redirect("/company/users");
}
