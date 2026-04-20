import { HomePageClient } from "@/components/HomePageClient";
import { resolveCurrentUser } from "@/lib/current-user";

// Server shell for the chat builder. Resolves the current user so the
// header can render email + sign-out on non-admin surfaces too — the
// admin layout already carries that strip; this brings the root page
// to parity. Read is via the same flag / kill-switch walk used by the
// admin gate; under flag-off / kill-switch modes the strip hides
// itself because there's no Supabase identity to display.

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await resolveCurrentUser();
  return <HomePageClient userEmail={user?.email ?? null} />;
}
