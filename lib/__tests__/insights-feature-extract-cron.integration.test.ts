import { describe, it, expect, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { extractDeterministicFeatures } from '@/lib/insights/feature-extractor';
import type { InsPostFeatures } from '@/lib/insights/types';

// PostgREST requires snake_case column names; TypeScript interfaces use camelCase.
function toDbRow(f: Omit<InsPostFeatures, 'id' | 'extractedAt' | 'createdAt' | 'updatedAt' | 'sentimentScore' | 'topicTags'>) {
  return {
    company_id: f.companyId,
    profile_id: f.profileId,
    source: f.source,
    bundle_post_id: f.bundlePostId,
    cap_campaign_post_id: f.capCampaignPostId,
    platform: f.platform,
    word_count: f.wordCount,
    sentence_count: f.sentenceCount,
    has_question: f.hasQuestion,
    emoji_count: f.emojiCount,
    hashtag_count: f.hashtagCount,
    has_link: f.hasLink,
    has_media: f.hasMedia,
    media_type: f.mediaType,
    reading_grade: f.readingGrade,
    day_of_week: f.dayOfWeek,
    hour_of_day_utc: f.hourOfDayUtc,
    hour_of_day_client_tz: f.hourOfDayClientTz,
    posted_at: f.postedAt,
  };
}

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

    const row = toDbRow(features);
    const { error } = await client.from('ins_post_features').insert(row);
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

    const row = toDbRow(features);
    const { error } = await client.from('ins_post_features').insert(row);
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
