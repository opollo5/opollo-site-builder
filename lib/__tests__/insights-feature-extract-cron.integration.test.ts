import { describe, it, expect, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { extractDeterministicFeatures } from '@/lib/insights/feature-extractor';

const supabaseUrl = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

function svc() {
  return createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
}

const TEST_BUNDLE_ID = `integration-test-features-${Date.now()}`;

describe('Insights feature extract — integration', () => {
  afterAll(async () => {
    await svc().from('ins_post_features').delete().eq('bundle_post_id', TEST_BUNDLE_ID);
  });

  it('inserts a feature row directly via extractDeterministicFeatures', async () => {
    const client = svc();

    const features = extractDeterministicFeatures({
      bundlePostId: TEST_BUNDLE_ID,
      companyId: '00000000-0000-0000-0000-000000000001',
      profileId: '00000000-0000-0000-0000-000000000001',
      source: 'composer',
      capCampaignPostId: null,
      platform: 'linkedin_personal',
      content: 'This is a test post for integration testing.',
      mediaUrls: null,
      postedAt: new Date('2026-05-23T10:00:00Z'),
      clientTimezone: 'Australia/Melbourne',
    });

    const { error } = await client.from('ins_post_features').insert(features);
    expect(error, `Insert should succeed: ${error?.message}`).toBeNull();
  });

  it('is idempotent — duplicate bundle_post_id returns 23505', async () => {
    const client = svc();

    const features = extractDeterministicFeatures({
      bundlePostId: TEST_BUNDLE_ID,
      companyId: '00000000-0000-0000-0000-000000000001',
      profileId: '00000000-0000-0000-0000-000000000001',
      source: 'composer',
      capCampaignPostId: null,
      platform: 'linkedin_personal',
      content: 'Duplicate attempt.',
      mediaUrls: null,
      postedAt: new Date('2026-05-23T10:00:00Z'),
      clientTimezone: 'UTC',
    });

    const { error } = await client.from('ins_post_features').insert(features);
    expect(error).not.toBeNull();
    expect(error?.code).toBe('23505');
  });

  it('find_posts_needing_feature_extract RPC exists and returns a result', async () => {
    const client = svc();
    const { error } = await client.rpc('find_posts_needing_feature_extract', {
      platforms: ['LINKEDIN', 'FACEBOOK'],
      limit_count: 1,
    });
    expect(error, `RPC should exist: ${error?.message}`).toBeNull();
  });
});
