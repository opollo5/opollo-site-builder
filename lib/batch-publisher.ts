import { Client } from "pg";

import {
  extractCloudflareIds,
  rewriteImageUrls,
} from "@/lib/html-image-rewrite";
import { LEADSOURCE_FONT_LOAD_HTML } from "@/lib/leadsource-fonts";
import {
  transferImagesForPage,
  type WpMediaCallBundle,
} from "@/lib/wp-media-transfer";

// ---------------------------------------------------------------------------
// M3-6 — WP publish with pre-commit slug claim.
//
// publishSlot runs after M3-5 gates pass. It walks the slot from
// 'validating' → 'publishing' → 'succeeded', doing the work that
// actually mutates the client's WordPress site:
//
//   1. State-advance validating → publishing (guarded by worker_id).
//
//   2. pg_try_advisory_xact_lock on hashtext(site_id || ':' || slug).
//      If the lock isn't granted immediately, another worker is in
//      the middle of publishing the same slug for the same site; we
//      fail fast with SLUG_CONFLICT rather than serialising behind
//      a network-bound competitor. Pinned by the multi-worker test.
//
//   3. Pre-commit INSERT into `pages` with slug + wp_page_id=NULL.
//      The UNIQUE (site_id, slug) constraint added in M3-1 is the
//      durable concurrency claim. On 23505 unique_violation:
//        - If the existing `pages` row was inserted by a prior
//          attempt of the same slot (detected via the slot already
//          having pages_id set), we ADOPT it — proceed with the
//          existing row instead of creating a duplicate on WP.
//        - Otherwise another job owns the slug: SLUG_CONFLICT.
//
//   4. WP call: GET by slug first to handle the "previous worker
//      published but crashed before committing pages row" case,
//      where WP already has a live page for this slug. If found we
//      PUT to update the content; otherwise POST to create. Both
//      paths return wp_page_id.
//
//   5. UPDATE pages.wp_page_id + generated_html.
//
//   6. Advance slot publishing → succeeded + link pages_id. Parent
//      job aggregates roll.
//
// Runtime: nodejs. WP-call function is dependency-injected
// (WpCallBundle), so concurrency / adoption tests can drive the flow
// without any real HTTP traffic.
// ---------------------------------------------------------------------------

export type WpCreateResult =
  | { ok: true; wp_page_id: number; slug: string }
  | { ok: false; code: string; message: string; retryable: boolean };

export type WpUpdateResult =
  | { ok: true; wp_page_id: number }
  | { ok: false; code: string; message: string; retryable: boolean };

export type WpGetBySlugResult =
  | { ok: true; found: { wp_page_id: number; status: string } | null }
  | { ok: false; code: string; message: string; retryable: boolean };

export type WpCallBundle = {
  getBySlug: (slug: string) => Promise<WpGetBySlugResult>;
  create: (input: {
    slug: string;
    title: string;
    content: string;
  }) => Promise<WpCreateResult>;
  update: (input: {
    wp_page_id: number;
    content: string;
  }) => Promise<WpUpdateResult>;
  /**
   * M4-7 — optional WP media transfer leg. When present and the page
   * HTML references Cloudflare-delivered images, the publisher runs
   * per-image transfer + URL rewrite before wp.create / wp.update.
   * When absent, the publisher ships HTML as-is (M3 behaviour).
   */
  media?: WpMediaCallBundle;
  /**
   * M4-7 — constructs a Cloudflare delivery URL for a given image id.
   * Used as the source URL for the WP media-upload step. When absent
   * the default uses `CLOUDFLARE_IMAGES_HASH` from the environment.
   */
  cloudflareUrlFor?: (cloudflareId: string) => string;
};

export type PublishContext = {
  job_id: string;
  site_id: string;
  slug: string;
  title: string;
  generated_html: string;
  design_system_version: string;
};

function requireDbUrl(): string {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    throw new Error(
      "SUPABASE_DB_URL is not set. Required by publishSlot for the pages claim transaction.",
    );
  }
  return url;
}

async function withClient<T>(
  provided: Client | null,
  fn: (c: Client) => Promise<T>,
): Promise<T> {
  if (provided) return fn(provided);
  const c = new Client({ connectionString: requireDbUrl() });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

// PostgreSQL advisory locks take bigint keys. hashtext returns int4,
// so we widen to bigint via Postgres itself — see the SQL below — and
// that's what the lock is keyed on.

/**
 * Publish a slot to WordPress. Returns `{ ok: true }` on success or
 * `{ ok: false, code, message, retryable }` on failure. On failure,
 * the caller is responsible for marking the slot 'failed' — publishSlot
 * itself only advances state to 'publishing' and back to 'succeeded'
 * on success; a failure leaves the slot in 'publishing' with the
 * error stamped so the reaper's next cycle (or a retry at M3-7) can
 * pick it up.
 */
export async function publishSlot(
  slotId: string,
  workerId: string,
  publishCtx: PublishContext,
  wp: WpCallBundle,
  opts: { client?: Client | null } = {},
): Promise<
  | { ok: true; pagesId: string; wpPageId: number; adopted: boolean }
  | { ok: false; code: string; message: string; retryable: boolean }
> {
  // --- State transition: validating → publishing --------------------------
  let alreadyAdoptedPagesId: string | null = null;

  await withClient(opts.client ?? null, async (c) => {
    const advance = await c.query(
      `
      UPDATE generation_job_pages
         SET state = 'publishing',
             last_heartbeat_at = now(),
             updated_at = now()
       WHERE id = $1 AND worker_id = $2 AND state = 'validating'
       RETURNING pages_id
      `,
      [slotId, workerId],
    );
    if ((advance.rowCount ?? 0) === 0) {
      throw new Error(
        `publishSlot: lease stolen from worker ${workerId} before publishing slot ${slotId}`,
      );
    }
    alreadyAdoptedPagesId =
      (advance.rows[0]?.pages_id as string | null) ?? null;

    await c.query(
      `
      INSERT INTO generation_events (job_id, page_slot_id, event, details)
      VALUES ($1, $2, 'state_advanced',
              jsonb_build_object('to', 'publishing', 'worker_id', $3::text))
      `,
      [publishCtx.job_id, slotId, workerId],
    );
  });

  // --- Pre-commit pages claim + advisory lock, then WP work ---------------
  //
  // This transaction holds the advisory lock through the WP call so a
  // second worker racing the same slug fails fast at try-lock and can
  // short-circuit to SLUG_CONFLICT without ever touching WP.
  let pagesId: string | null = alreadyAdoptedPagesId;
  let wpPageId: number | null = null;
  let adopted = alreadyAdoptedPagesId !== null;

  return await withClient(opts.client ?? null, async (c) => {
    try {
      await c.query("BEGIN");

      const lockKey = `${publishCtx.site_id}:${publishCtx.slug}`;
      const lockRes = await c.query<{ locked: boolean }>(
        `SELECT pg_try_advisory_xact_lock(hashtext($1)::bigint) AS locked`,
        [lockKey],
      );
      if (!lockRes.rows[0]?.locked) {
        await c.query("ROLLBACK");
        return {
          ok: false as const,
          code: "SLUG_CONFLICT",
          message: `Another worker is currently publishing slug '${publishCtx.slug}' on this site.`,
          retryable: false,
        };
      }

      if (pagesId) {
        // Slot already links to a pages row (previous attempt, reaped).
        // Pick up whatever wp_page_id that prior attempt stored so we
        // can skip a redundant WP create when it's already non-zero.
        const existing = await c.query<{ wp_page_id: number }>(
          `SELECT wp_page_id FROM pages WHERE id = $1`,
          [pagesId],
        );
        const existingWpId = existing.rows[0]?.wp_page_id ?? 0;
        if (existingWpId > 0) {
          wpPageId = existingWpId;
        }
      } else {
        // Attempt the pre-commit INSERT. UNIQUE (site_id, slug) on
        // `pages` (M3-1) is the durable concurrency guard. We wrap the
        // INSERT in a SAVEPOINT so we can recover from a 23505
        // unique_violation without aborting the outer transaction —
        // Postgres marks the whole tx aborted (25P02) on an unhandled
        // error, which blocks the follow-up SELECTs we need for the
        // adoption decision.
        await c.query("SAVEPOINT pages_insert");
        try {
          const insertRes = await c.query<{ id: string }>(
            `
            INSERT INTO pages
              (site_id, slug, title, page_type, design_system_version,
               wp_page_id, status)
            VALUES ($1, $2, $3, 'batch', $4::int, 0, 'draft')
            RETURNING id
            `,
            [
              publishCtx.site_id,
              publishCtx.slug,
              publishCtx.title,
              publishCtx.design_system_version,
            ],
          );
          await c.query("RELEASE SAVEPOINT pages_insert");
          pagesId = insertRes.rows[0]!.id;
        } catch (err) {
          const pgErr = err as { code?: string };
          if (pgErr.code !== "23505") {
            await c.query("ROLLBACK TO SAVEPOINT pages_insert");
            await c.query("RELEASE SAVEPOINT pages_insert");
            throw err;
          }
          await c.query("ROLLBACK TO SAVEPOINT pages_insert");
          await c.query("RELEASE SAVEPOINT pages_insert");

          // UNIQUE violation. Determine whether to adopt.
          const existing = await c.query<{
            id: string;
            wp_page_id: number;
          }>(
            `SELECT id, wp_page_id
               FROM pages
              WHERE site_id = $1 AND slug = $2`,
            [publishCtx.site_id, publishCtx.slug],
          );
          const row = existing.rows[0];
          if (!row) {
            // Race window: violation fired but row gone. Fail conservatively.
            await c.query("ROLLBACK");
            return {
              ok: false as const,
              code: "SLUG_CONFLICT",
              message: "Unique violation but no existing pages row visible.",
              retryable: true,
            };
          }

          // Check whether the existing row is owned by a slot from THIS job.
          // If so it's a previous attempt of ours — adopt. Otherwise some
          // other job owns the slug and we refuse to publish over it.
          const ownership = await c.query<{ job_id: string }>(
            `SELECT job_id
               FROM generation_job_pages
              WHERE pages_id = $1`,
            [row.id],
          );
          const ownerJob = ownership.rows[0]?.job_id;
          if (ownerJob && ownerJob !== publishCtx.job_id) {
            await c.query("ROLLBACK");
            return {
              ok: false as const,
              code: "SLUG_CONFLICT",
              message: `Slug '${publishCtx.slug}' is owned by another job.`,
              retryable: false,
            };
          }

          pagesId = row.id;
          adopted = true;
          // If a prior attempt already got a wp_page_id (they crashed
          // after WP but before slot finalisation), carry it through
          // so we skip the redundant WP create.
          if (row.wp_page_id > 0) {
            wpPageId = row.wp_page_id;
          }
        }
      }

      // --- M4-7: transfer referenced images into the client WP media ----
      //
      // Runs BEFORE the WP page create/update so the rewritten HTML is
      // what lands on WordPress. Uses its own supabase-js client — the
      // pg transaction we hold here is scoped to the slug claim and is
      // NOT held across the image/WP HTTP calls below.
      //
      // Skipped when wp.media is absent (M3 behaviour) or the HTML
      // references no Cloudflare delivery URLs.
      let finalHtml = publishCtx.generated_html;
      if (wp.media) {
        const cloudflareIds = extractCloudflareIds(publishCtx.generated_html);
        if (cloudflareIds.size > 0) {
          const transfer = await transferImagesForPage({
            cloudflareIds,
            siteId: publishCtx.site_id,
            wpMedia: wp.media,
            cloudflareUrlFor:
              wp.cloudflareUrlFor ??
              ((id) =>
                `https://imagedelivery.net/${process.env.CLOUDFLARE_IMAGES_HASH ?? ""}/${id}/public`),
          });
          if (!transfer.ok) {
            await c.query("ROLLBACK");
            return {
              ok: false as const,
              code: transfer.code,
              message: transfer.message,
              retryable: transfer.retryable,
            };
          }
          const rewrite = rewriteImageUrls(
            publishCtx.generated_html,
            transfer.mapping,
          );
          finalHtml = rewrite.rewrittenHtml;
        }
      }

      // Prepend the LeadSource font-load <link> markup for the WP-bound
      // HTML only. `finalHtml` stays as the post-image-rewrite body so
      // the downstream `pages.generated_html` UPDATE captures the model
      // output verbatim; fonts are a rendering concern injected at the
      // WP boundary. See lib/leadsource-fonts.ts.
      const wpBoundHtml = LEADSOURCE_FONT_LOAD_HTML + finalHtml;

      // --- WP call: GET-first for idempotent adoption, then POST or PUT --
      if (wpPageId === null) {
        const existing = await wp.getBySlug(publishCtx.slug);
        if (!existing.ok) {
          await c.query("ROLLBACK");
          return {
            ok: false as const,
            code: existing.code,
            message: existing.message,
            retryable: existing.retryable,
          };
        }
        if (existing.found) {
          // WP already has a post for this slug — adopt + update.
          const upd = await wp.update({
            wp_page_id: existing.found.wp_page_id,
            content: wpBoundHtml,
          });
          if (!upd.ok) {
            await c.query("ROLLBACK");
            return {
              ok: false as const,
              code: upd.code,
              message: upd.message,
              retryable: upd.retryable,
            };
          }
          wpPageId = upd.wp_page_id;
        } else {
          const created = await wp.create({
            slug: publishCtx.slug,
            title: publishCtx.title,
            content: wpBoundHtml,
          });
          if (!created.ok) {
            await c.query("ROLLBACK");
            return {
              ok: false as const,
              code: created.code,
              message: created.message,
              retryable: created.retryable,
            };
          }
          wpPageId = created.wp_page_id;
        }
      }

      // --- Final UPDATEs: pages + slot ---
      await c.query(
        `
        UPDATE pages
           SET wp_page_id = $2,
               generated_html = $3,
               updated_at = now()
         WHERE id = $1
        `,
        [pagesId, wpPageId, finalHtml],
      );

      const finalise = await c.query(
        `
        UPDATE generation_job_pages
           SET state = 'succeeded',
               pages_id = $3,
               wp_page_id = $4,
               finished_at = COALESCE(finished_at, now()),
               lease_expires_at = NULL,
               worker_id = NULL,
               updated_at = now()
         WHERE id = $1 AND worker_id = $2 AND state = 'publishing'
        `,
        [slotId, workerId, pagesId, wpPageId],
      );
      if ((finalise.rowCount ?? 0) === 0) {
        await c.query("ROLLBACK");
        throw new Error(
          `publishSlot: lease stolen from worker ${workerId} at finalisation of slot ${slotId}`,
        );
      }

      await c.query(
        `
        UPDATE generation_jobs j
           SET succeeded_count = succeeded_count + 1,
               status = CASE
                          WHEN j.succeeded_count + 1 + j.failed_count
                               >= j.requested_count
                            THEN CASE
                                   WHEN j.failed_count = 0 THEN 'succeeded'
                                   ELSE 'partial'
                                 END
                          ELSE 'running'
                        END,
               finished_at = CASE
                               WHEN j.succeeded_count + 1 + j.failed_count
                                    >= j.requested_count
                                 THEN now()
                               ELSE j.finished_at
                             END,
               updated_at = now()
         WHERE id = $1
        `,
        [publishCtx.job_id],
      );

      await c.query(
        `
        INSERT INTO generation_events (job_id, page_slot_id, event, details)
        VALUES ($1, $2, 'state_advanced',
                jsonb_build_object('to', 'succeeded', 'worker_id', $3::text,
                                   'wp_page_id', $4::int,
                                   'adopted', $5::boolean))
        `,
        [publishCtx.job_id, slotId, workerId, wpPageId, adopted],
      );

      await c.query("COMMIT");
      return {
        ok: true as const,
        pagesId: pagesId!,
        wpPageId: wpPageId!,
        adopted,
      };
    } catch (err) {
      try {
        await c.query("ROLLBACK");
      } catch {
        // ignore
      }
      throw err;
    }
  });
}
