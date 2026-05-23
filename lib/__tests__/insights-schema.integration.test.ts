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

  it('cap_generation_runs.operation CHECK constraint includes insights_feature_extract', async () => {
    const svc = getServiceClient();
    // Verify via information_schema rather than inserting a row (requires FK chain)
    const { data, error } = await svc
      .from('information_schema.check_constraints' as never)
      .select('check_clause')
      .like('constraint_name' as never, '%cap_generation_runs_operation%')
      .maybeSingle();
    expect(error).toBeNull();
    const clause = (data as Record<string, string> | null)?.check_clause ?? '';
    expect(clause).toContain('insights_feature_extract');
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
    // First insert succeeds
    const { error: firstError } = await svc.from('ins_post_features').insert(baseRow);
    expect(firstError).toBeNull();
    // Second insert with same bundle_post_id must fail with unique violation
    const { error: secondError } = await svc.from('ins_post_features').insert(baseRow);
    expect(secondError).not.toBeNull();
    expect(secondError?.code).toBe('23505');
    // Clean up
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
});
