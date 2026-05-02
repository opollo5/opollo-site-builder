// ---------------------------------------------------------------------------
// S1-6 — magic-link landing page (stub).
//
// V1 of the recipient-add flow puts a real token on the email but the
// reviewer-side viewer + approve/reject UI lands in a follow-up slice.
// For now this page just acknowledges the link arrived; the next slice
// will swap in the snapshot reader + decision form.
//
// Public route: NO auth gate, the token IS the auth (validated server-
// side once the viewer slice lands; this stub doesn't touch the DB).
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

export default async function ApproveLandingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  await params; // Reserved for the viewer slice.
  return (
    <main className="mx-auto max-w-xl p-6 text-sm">
      <h1 className="text-xl font-semibold">Approval link received</h1>
      <p className="mt-3 text-muted-foreground">
        Thanks for clicking through. The review experience is coming
        online soon — we&apos;ll email you again when the post is ready
        for your decision. If you weren&apos;t expecting this email,
        you can safely ignore it.
      </p>
    </main>
  );
}
