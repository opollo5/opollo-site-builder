import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

function getServiceClient() {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

describe('Insights foundation schema', () => {
  it('creates all 9 ins_* tables', async () => {
    const svc = getServiceClient();
    const expectedTables = [
      'ins_post_features',
      'ins_client_memory',
      'ins_recommendations',
      'ins_recommendation_evidence',
      'ins_consent',
      'ins_ingest_log',
      'ins_admin_audit',
      'ins_competitor_accounts',
      'ins_competitor_posts',
    ];
    for (const table of expectedTables) {
      const { error } = await svc
        .from(table)
        .select('*', { count: 'exact', head: true });
      expect(error, `Table ${table} should exist`).toBeNull();
    }
  });

  it('enforces unique constraint on ins_post_features.bundle_post_id', async () => {
    const svc = getServiceClient();
    const bundleId = `rls-schema-test-${Date.now()}`;
    const baseRow = {
      company_id: '00000000-0000-0000-0000-000000000001',
      profile_id: '00000000-0000-0000-0000-000000000001',
      source: 'composer',
      bundle_post_id: bundleId,
      platform: 'linkedin_personal',
      word_count: 10,
      sentence_count: 1,
      has_question: false,
      has_link: false,
      has_media: false,
      day_of_week: 1,
      hour_of_day_utc: 10,
      hour_of_day_client_tz: 10,
      posted_at: new Date().toISOString(),
    };
    const { error: firstError } = await svc.from('ins_post_features').insert(baseRow);
    expect(firstError).toBeNull();
    const { error: secondError } = await svc.from('ins_post_features').insert(baseRow);
    expect(secondError).not.toBeNull();
    expect(secondError?.code).toBe('23505');
    await svc.from('ins_post_features').delete().eq('bundle_post_id', bundleId);
  });

  it('ins_ingest_log accepts an insert row', async () => {
    const svc = getServiceClient();
    const { error } = await svc.from('ins_ingest_log').insert({
      cron_route: '/api/cron/test',
      posts_processed: 0,
      metrics_recorded: 0,
      features_extracted: 0,
      errors: [],
      duration_ms: 100,
    });
    expect(error).toBeNull();
  });

  it('ins_recommendations accepts a row with valid confidence_band', async () => {
    const svc = getServiceClient();
    const { error } = await svc.from('ins_recommendations').insert({
      company_id: '00000000-0000-0000-0000-000000000001',
      platform: 'linkedin_personal',
      recommendation_type: 'posting_time',
      headline: 'Post on Tuesday mornings',
      body: 'Your Tuesday 9am posts get 3x engagement.',
      success_metric: 'engagement_rate',
      confidence_score: 0.85,
      confidence_band: 'strong',
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
    expect(error).toBeNull();
  });
});
