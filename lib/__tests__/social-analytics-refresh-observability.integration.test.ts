import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

function svc() {
  return createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
}

describe('social-analytics-refresh observability', () => {
  it('ins_ingest_log accepts a row from the analytics-refresh cron pattern', async () => {
    const client = svc();
    const { error } = await client.from('ins_ingest_log').insert({
      cron_route: '/api/cron/social-analytics-refresh',
      company_id: null,
      posts_processed: 0,
      metrics_recorded: 5,
      features_extracted: 0,
      errors: [],
      duration_ms: 2500,
    });
    expect(error, `ins_ingest_log insert should succeed: ${error?.message}`).toBeNull();
  });

  it('ins_ingest_log accepts an error payload', async () => {
    const client = svc();
    const { error } = await client.from('ins_ingest_log').insert({
      cron_route: '/api/cron/social-analytics-refresh',
      company_id: null,
      posts_processed: 0,
      metrics_recorded: 0,
      features_extracted: 0,
      errors: [{ error: 'BUNDLE_SOCIAL_API timeout' }],
      duration_ms: 30000,
    });
    expect(error, `error payload insert should succeed: ${error?.message}`).toBeNull();
  });
});
