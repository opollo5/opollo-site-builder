#!/usr/bin/env node
// Diagnose stuck batch image generation jobs.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
try {
  const lines = readFileSync(resolve(__dir, '../.env.local'), 'utf8').split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[k]) process.env[k] = v;
  }
} catch { /* rely on process.env */ }

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function run() {
  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // last 30 min

  // 1. Most recent batches
  const { data: batches, error: bErr } = await db
    .from('image_generation_batches')
    .select('id, state, total_jobs, completed_jobs, failed_jobs, created_at, updated_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(5);
  if (bErr) console.error('batches error:', bErr.message);
  else {
    console.log('\n=== Recent Batches (last 30 min) ===');
    batches.forEach(b => console.log(JSON.stringify(b)));
  }

  const batchId = batches?.[0]?.id;

  // 2. Jobs for most recent batch
  if (batchId) {
    const { data: jobs, error: jErr } = await db
      .from('image_generation_jobs')
      .select('id, state, error_class, error_detail, created_at, updated_at, started_at, completed_at')
      .eq('batch_id', batchId)
      .order('created_at', { ascending: true });
    if (jErr) console.error('jobs error:', jErr.message);
    else {
      console.log(`\n=== Jobs for batch ${batchId} ===`);
      jobs.forEach(j => console.log(JSON.stringify(j)));
    }
  }

  // 3. Recent log entries
  const logTables = ['image_generation_log', 'image_gen_log', 'image_job_log'];
  for (const tbl of logTables) {
    const { data: logs, error: lErr } = await db
      .from(tbl)
      .select('*')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(20);
    if (!lErr) {
      console.log(`\n=== ${tbl} (last 30 min) ===`);
      logs.forEach(l => console.log(JSON.stringify(l)));
      break;
    }
  }

  // 4. Any PENDING jobs older than 5 min (stuck)
  const stuckSince = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: stuck, error: sErr } = await db
    .from('image_generation_jobs')
    .select('id, batch_id, state, created_at, updated_at, error_class, error_detail')
    .in('state', ['pending', 'queued', 'running'])
    .lt('created_at', stuckSince)
    .order('created_at', { ascending: false })
    .limit(10);
  if (sErr) console.error('stuck query error:', sErr.message);
  else {
    console.log('\n=== Jobs PENDING/RUNNING older than 5 min ===');
    stuck.forEach(j => console.log(JSON.stringify(j)));
    if (!stuck.length) console.log('(none)');
  }
}

run().catch(e => { console.error(e.message); process.exit(1); });
