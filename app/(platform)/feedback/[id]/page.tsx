import { notFound, redirect } from "next/navigation";

import { getCurrentPlatformSession } from "@/lib/platform/auth";
import { isCompanyMember } from "@/lib/platform/auth";
import { createRouteAuthClient } from "@/lib/auth";
import { getTicket, listComments, listEvents, resolveActorNames } from "@/lib/feedback/tickets/queries";
import { resolveSignedUrl } from "@/lib/feedback/capture/screenshot";
import { FeedbackDetailClient } from "./FeedbackDetailClient";

// ---------------------------------------------------------------------------
// Customer ticket detail — /feedback/[id] (server component)
// Fetches data, resolves the screenshot signed URL, then delegates
// interactive elements to FeedbackDetailClient.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export default async function FeedbackDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const session = await getCurrentPlatformSession();
  if (!session) redirect("/login?next=/feedback");
  if (!session.company) redirect("/");

  const supabase = createRouteAuthClient();
  const [ticket, comments, events] = await Promise.all([
    getTicket(id),
    listComments(id),
    listEvents(id),
  ]);

  if (!ticket || ticket.deleted_at) notFound();

  // Enforce company boundary.
  const isMember = await isCompanyMember(ticket.company_id, supabase);
  const isStaff = session.isOpolloStaff;
  if (!isMember && !isStaff) notFound();

  // Resolve actor display names for the event timeline and comment thread.
  // Collect all user IDs: event actors + staff comment authors.
  const actorIds = [
    ...events.map((e) => e.actor_id),
    ...comments.filter((c) => c.is_staff).map((c) => c.author_id),
  ];
  const actorNames = await resolveActorNames(actorIds);

  const screenshotUrl = ticket.screenshot_path
    ? await resolveSignedUrl(ticket.screenshot_path)
    : null;

  return (
    <FeedbackDetailClient
      ticket={ticket}
      comments={comments}
      events={events}
      screenshotUrl={screenshotUrl}
      actorNames={Object.fromEntries(actorNames)}
    />
  );
}
