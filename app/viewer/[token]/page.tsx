import {
  PLATFORM_LABEL,
  type SocialPlatform,
} from "@/lib/platform/social/variants/types";
import { resolveViewerLink } from "@/lib/platform/social/viewer-links";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// S1-15 — public read-only calendar at /viewer/[token].
//
// Token IS the auth (SHA-256 hash → social_viewer_links row). Renders
// the company's posts that are approved / scheduled / published in a
// 90-day window centred on now (60 forward, 30 back). No interactive
// surface — the recipient can see what's coming and what's gone live,
// nothing else.
//
// Layout choice: list grouped by date rather than a calendar grid.
// V1 priority is "show me the schedule" not "drag-and-drop", and a
// list works at every viewport size without bespoke layout code.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

const FORWARD_DAYS = 60;
const BACK_DAYS = 30;

type SchedulePreview = {
  id: string;
  scheduled_at: string;
  platform: SocialPlatform;
  master_text: string | null;
  link_url: string | null;
};

export default async function ViewerLinkPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  if (!/^[0-9a-f]{64}$/i.test(token)) {
    return <InvalidLink />;
  }

  const resolved = await resolveViewerLink(token);
  if (!resolved.ok) {
    return <InvalidLink />;
  }

  const { company } = resolved.data;

  // Read scheduled entries for the company in the window. Three-step:
  //   1. variants for the company's posts
  //   2. schedule_entries (non-cancelled) joined to the variants
  //   3. enrich with platform + master_text/link_url for the renderer
  // Done with two queries; PostgREST embeds across multi-FK tables
  // are flaky (memory: feedback_postgrest_embed_ambiguous_fk).
  const svc = getServiceRoleClient();

  const now = Date.now();
  const fromIso = new Date(now - BACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const toIso = new Date(now + FORWARD_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Posts in viewer-relevant states.
  const posts = await svc
    .from("social_post_master")
    .select("id, master_text, link_url")
    .eq("company_id", company.id)
    .in("state", ["approved", "scheduled", "published"]);
  const postById = new Map<
    string,
    { master_text: string | null; link_url: string | null }
  >();
  for (const p of posts.data ?? []) {
    postById.set(p.id as string, {
      master_text: (p.master_text as string | null) ?? null,
      link_url: (p.link_url as string | null) ?? null,
    });
  }

  let entries: SchedulePreview[] = [];
  if (postById.size > 0) {
    const variants = await svc
      .from("social_post_variant")
      .select("id, post_master_id, platform")
      .in("post_master_id", Array.from(postById.keys()));
    const variantInfo = new Map<
      string,
      { post_id: string; platform: SocialPlatform }
    >();
    for (const v of variants.data ?? []) {
      variantInfo.set(v.id as string, {
        post_id: v.post_master_id as string,
        platform: v.platform as SocialPlatform,
      });
    }

    const variantIds = Array.from(variantInfo.keys());
    if (variantIds.length > 0) {
      const schedule = await svc
        .from("social_schedule_entries")
        .select("id, post_variant_id, scheduled_at")
        .in("post_variant_id", variantIds)
        .is("cancelled_at", null)
        .gte("scheduled_at", fromIso)
        .lte("scheduled_at", toIso)
        .order("scheduled_at", { ascending: true });
      entries = (schedule.data ?? [])
        .map((s) => {
          const v = variantInfo.get(s.post_variant_id as string);
          if (!v) return null;
          const post = postById.get(v.post_id);
          if (!post) return null;
          return {
            id: s.id as string,
            scheduled_at: s.scheduled_at as string,
            platform: v.platform,
            master_text: post.master_text,
            link_url: post.link_url,
          } satisfies SchedulePreview;
        })
        .filter((x): x is SchedulePreview => x !== null);
    }
  }

  // Group by local date for rendering.
  const grouped = groupByLocalDate(entries, company.timezone);

  return (
    <main className="mx-auto max-w-3xl p-6">
      <header>
        <h1 className="text-2xl font-semibold">
          {company.name} — content calendar
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {grouped.length === 0
            ? "Nothing scheduled in the visible window. Check back soon."
            : `Showing posts from the last ${BACK_DAYS} days through the next ${FORWARD_DAYS}.`}
        </p>
      </header>

      {grouped.length === 0 ? null : (
        <ol className="mt-6 space-y-6" data-testid="viewer-calendar">
          {grouped.map(({ dateLabel, items }) => (
            <li key={dateLabel}>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {dateLabel}
              </h2>
              <ul className="mt-2 divide-y rounded-lg border bg-card">
                {items.map((e) => (
                  <li
                    key={e.id}
                    className="p-4"
                    data-testid={`viewer-entry-${e.id}`}
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium">
                        {PLATFORM_LABEL[e.platform] ?? e.platform}
                      </span>
                      <time className="text-sm text-muted-foreground tabular-nums">
                        {new Date(e.scheduled_at).toLocaleString("en-AU", {
                          hour: "2-digit",
                          minute: "2-digit",
                          timeZone: company.timezone,
                        })}
                      </time>
                    </div>
                    {e.master_text ? (
                      <p className="mt-2 whitespace-pre-wrap text-sm">
                        {e.master_text}
                      </p>
                    ) : null}
                    {e.link_url ? (
                      <p className="mt-2 truncate text-sm">
                        <a
                          href={e.link_url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-primary hover:underline"
                        >
                          {e.link_url}
                        </a>
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}

function groupByLocalDate(
  entries: SchedulePreview[],
  timezone: string,
): Array<{ dateLabel: string; items: SchedulePreview[] }> {
  const buckets = new Map<string, SchedulePreview[]>();
  for (const e of entries) {
    const dateLabel = new Date(e.scheduled_at).toLocaleDateString("en-AU", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: timezone,
    });
    const bucket = buckets.get(dateLabel) ?? [];
    bucket.push(e);
    buckets.set(dateLabel, bucket);
  }
  return Array.from(buckets.entries()).map(([dateLabel, items]) => ({
    dateLabel,
    items,
  }));
}

function InvalidLink() {
  return (
    <main className="mx-auto max-w-xl p-6 text-sm">
      <h1 className="text-xl font-semibold">Calendar link not valid</h1>
      <p className="mt-3 text-muted-foreground">
        This link is invalid, has expired, or has been revoked. Ask the
        team that sent it for a fresh one.
      </p>
    </main>
  );
}
