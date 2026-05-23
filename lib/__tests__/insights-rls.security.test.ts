import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

// Cross-tenant isolation tests for Insights RLS policies.
// These tests require a running local Supabase instance.

const supabaseUrl = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const anonKey = process.env.SUPABASE_ANON_KEY ?? '';

function svc() {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

const COMPANY_A = '11111111-1111-1111-1111-111111111111';
const COMPANY_B = '22222222-2222-2222-2222-222222222222';

describe('Insights RLS — cross-tenant isolation', () => {
  it('blocks cross-tenant reads on ins_post_features', async () => {
    const client = svc();

    // Insert a feature row for company A using service role
    const bundleId = `rls-test-${Date.now()}`;
    await client.from('ins_post_features').insert({
      company_id: COMPANY_A,
      profile_id: '00000000-0000-0000-0000-000000000001',
      source: 'composer',
      bundle_post_id: bundleId,
      platform: 'LINKEDIN',
      word_count: 10,
      sentence_count: 1,
      has_question: false,
      has_link: false,
      has_media: false,
      day_of_week: 1,
      hour_of_day_utc: 10,
      hour_of_day_client_tz: 10,
      posted_at: new Date().toISOString(),
    });

    // Query as anon (no company membership) — should return 0 rows
    const anon = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false },
    });
    const { data } = await anon
      .from('ins_post_features')
      .select('id')
      .eq('company_id', COMPANY_A);
    expect(data?.length ?? 0).toBe(0);

    // Clean up
    await client.from('ins_post_features').delete().eq('bundle_post_id', bundleId);
  });

  it('blocks anon reads on ins_ingest_log (staff-only)', async () => {
    const anon = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false },
    });
    const { data } = await anon.from('ins_ingest_log').select('id');
    expect(data?.length ?? 0).toBe(0);
  });

  it('blocks anon reads on ins_admin_audit (staff-only)', async () => {
    const anon = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false },
    });
    const { data } = await anon.from('ins_admin_audit').select('id');
    expect(data?.length ?? 0).toBe(0);
  });

  it('blocks anon reads on ins_recommendations', async () => {
    const anon = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false },
    });
    const { data } = await anon
      .from('ins_recommendations')
      .select('id')
      .eq('company_id', COMPANY_A);
    expect(data?.length ?? 0).toBe(0);
  });

  it('blocks anon reads on ins_client_memory', async () => {
    const anon = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false },
    });
    const { data } = await anon
      .from('ins_client_memory')
      .select('id')
      .eq('company_id', COMPANY_A);
    expect(data?.length ?? 0).toBe(0);
  });
});
