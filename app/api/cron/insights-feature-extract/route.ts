import { NextResponse, type NextRequest } from 'next/server';
import { authorisedCronRequest, unauthorisedResponse } from '@/lib/platform/cron/cron-shared';
import { getServiceRoleClient } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { extractDeterministicFeatures } from '@/lib/insights/feature-extractor';
import { resolvePostSource } from '@/lib/insights/source-attribution';
import { recordHealthEvent } from '@/lib/platform/service-health/record';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!authorisedCronRequest(req)) return unauthorisedResponse();

  const startTime = Date.now();
  const svc = getServiceRoleClient();
  let postsProcessed = 0;
  const errors: { bundlePostId: string; error: string }[] = [];

  try {
    const { data: pendingPosts, error: queryError } = await svc.rpc(
      'find_posts_needing_feature_extract',
      { platforms: ['LINKEDIN', 'FACEBOOK'], limit_count: 100 },
    );

    if (queryError) throw queryError;

    for (const post of pendingPosts ?? []) {
      try {
        const { source, capCampaignPostId } = await resolvePostSource(post.bundle_post_id);

        const features = extractDeterministicFeatures({
          bundlePostId: post.bundle_post_id,
          companyId: post.company_id,
          profileId: post.profile_id,
          source,
          capCampaignPostId,
          platform: post.platform,
          content: post.content,
          mediaUrls: post.media_urls,
          postedAt: new Date(post.posted_at),
          clientTimezone: post.timezone ?? 'UTC',
        });

        const { error: insertError } = await svc
          .from('ins_post_features')
          .insert(features);

        if (insertError && insertError.code !== '23505') {
          throw insertError;
        }

        postsProcessed++;
      } catch (err) {
        errors.push({
          bundlePostId: post.bundle_post_id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const durationMs = Date.now() - startTime;

    await svc.from('ins_ingest_log').insert({
      cron_route: '/api/cron/insights-feature-extract',
      company_id: null,
      posts_processed: postsProcessed,
      metrics_recorded: 0,
      features_extracted: postsProcessed,
      errors,
      duration_ms: durationMs,
    });

    logger.info('ins.feature-extract.completed', {
      postsProcessed,
      errorCount: errors.length,
      durationMs,
    });

    if (postsProcessed > 0 && errors.length > postsProcessed * 0.1) {
      await recordHealthEvent({
        serviceName: 'insights',
        operation: 'feature_extract',
        eventType: 'service_5xx',
        severity: 'warning',
        details: { postsProcessed, errorCount: errors.length },
      });
    }

    return NextResponse.json({ ok: true, postsProcessed, errors: errors.length, durationMs });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - startTime;
    logger.error('ins.feature-extract.failed', { error });

    await svc.from('ins_ingest_log').insert({
      cron_route: '/api/cron/insights-feature-extract',
      company_id: null,
      posts_processed: 0,
      metrics_recorded: 0,
      features_extracted: 0,
      errors: [{ error }],
      duration_ms: durationMs,
    });

    await recordHealthEvent({
      serviceName: 'insights',
      operation: 'feature_extract',
      eventType: 'cron_stale',
      severity: 'warning',
      details: { error },
    });

    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
