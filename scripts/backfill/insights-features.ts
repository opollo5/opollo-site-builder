/**
 * One-time backfill: extract deterministic features for all published posts
 * that don't yet have an ins_post_features row.
 *
 * Run from project root:
 *   npx tsx scripts/backfill/insights-features.ts
 */
import { getServiceRoleClient } from '@/lib/supabase';
import { extractDeterministicFeatures } from '@/lib/insights/feature-extractor';
import { resolvePostSource } from '@/lib/insights/source-attribution';

async function backfill() {
  const svc = getServiceRoleClient();
  let totalProcessed = 0;

  while (true) {
    const { data: posts, error } = await svc.rpc('find_posts_needing_feature_extract', {
      platforms: ['LINKEDIN', 'FACEBOOK'],
      limit_count: 500,
    });

    if (error) {
      console.error('Query error:', error);
      process.exit(1);
    }

    if (!posts || posts.length === 0) break;

    for (const post of posts) {
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

      const { error: insertError } = await svc.from('ins_post_features').insert(features);
      if (insertError && insertError.code !== '23505') {
        console.error(`Failed to insert for ${post.bundle_post_id}:`, insertError);
      } else {
        totalProcessed++;
      }
    }

    console.log(`Processed ${totalProcessed} posts so far...`);
  }

  console.log(`Backfill complete: ${totalProcessed} posts extracted.`);
}

backfill().catch(console.error);
