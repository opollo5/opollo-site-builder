#!/usr/bin/env -S npx tsx
// ---------------------------------------------------------------------------
// scripts/check-supabase-env-consistency.ts
//
// Purpose: catch the class of env-drift bug that caused the 2026-05-29
// publish-due incident. That incident was a manual Vercel dashboard mistake
// where SUPABASE_URL was migrated to the staging project while SUPABASE_DB_URL
// stayed pointed at production's pooler (preview scope) and the production
// pooler URL had the wrong region segment (aws-0- instead of aws-1-). The
// resulting "Tenant or user not found" errors cost ~5 days of stuck scheduled
// posts before being diagnosed.
//
// This script reads the three Supabase env vars, extracts the project ref
// from each, and asserts:
//   1. All set refs match (URL ref == NEXT_PUBLIC ref == DB_URL ref).
//   2. SUPABASE_DB_URL host is the pooler format (aws-N-<region>.pooler.supabase.com),
//      NOT the direct-connection format (db.<ref>.supabase.co) — the latter
//      is IPv6-only and Vercel runtime is IPv4-only, so direct hosts always
//      fail with ENOTFOUND at runtime.
//
// Exit codes:
//   0 — all set refs match + DB URL is pooler-format.
//   1 — mismatch detected (clear error printed to stderr).
//   2 — required env var missing or unparseable.
//
// CLI usage:
//   SUPABASE_URL=... SUPABASE_DB_URL=... npm run check:supabase-env-consistency
//
// Library usage (for unit tests):
//   import { checkConsistency } from './check-supabase-env-consistency';
//   const result = checkConsistency({ SUPABASE_URL: '...', SUPABASE_DB_URL: '...' });
// ---------------------------------------------------------------------------

export interface ConsistencyResult {
  ok: boolean;
  /** Single-line summary suitable for CI logs. */
  summary: string;
  /** Per-var breakdown for the failure-detail block. */
  vars: Record<string, { value_present: boolean; ref: string | null; host?: string | null; shape?: string }>;
  /** Reasons the check failed. Empty when ok === true. */
  errors: string[];
}

const REST_URL_RE = /^https?:\/\/([a-z0-9]+)\.supabase\.co(?:\/.*)?$/;
const DIRECT_DB_URL_RE = /^postgres(ql)?:\/\/[^@]+@db\.([a-z0-9]+)\.supabase\.co(?::\d+)?(?:\/.*)?$/;
const POOLER_DB_URL_RE = /^postgres(ql)?:\/\/postgres\.([a-z0-9]+):[^@]+@([a-z0-9-]+\.pooler\.supabase\.com)(?::(\d+))?(?:\/.*)?$/;

interface ParsedRef {
  ref: string | null;
  host: string | null;
  shape: "rest" | "pooler" | "direct" | "unrecognised";
}

function parseSupabaseEnvValue(value: string): ParsedRef {
  const rest = value.match(REST_URL_RE);
  if (rest) return { ref: rest[1], host: null, shape: "rest" };

  const pooler = value.match(POOLER_DB_URL_RE);
  if (pooler) return { ref: pooler[2], host: pooler[3], shape: "pooler" };

  const direct = value.match(DIRECT_DB_URL_RE);
  if (direct) return { ref: direct[2], host: `db.${direct[2]}.supabase.co`, shape: "direct" };

  return { ref: null, host: null, shape: "unrecognised" };
}

export function checkConsistency(env: Record<string, string | undefined>): ConsistencyResult {
  const errors: string[] = [];
  const vars: ConsistencyResult["vars"] = {};

  // Required: SUPABASE_URL + SUPABASE_DB_URL. NEXT_PUBLIC_SUPABASE_URL is
  // optional (production scope intentionally omits it in some configs).
  const REQUIRED = ["SUPABASE_URL", "SUPABASE_DB_URL"] as const;
  const OPTIONAL = ["NEXT_PUBLIC_SUPABASE_URL"] as const;

  const refByVar: Record<string, string | null> = {};
  let dbShape: "pooler" | "direct" | "unrecognised" | null = null;
  let dbHost: string | null = null;

  for (const name of [...REQUIRED, ...OPTIONAL]) {
    const value = env[name];
    if (!value) {
      vars[name] = { value_present: false, ref: null };
      if ((REQUIRED as readonly string[]).includes(name)) {
        errors.push(`Missing required env var: ${name}`);
      }
      continue;
    }
    const parsed = parseSupabaseEnvValue(value);
    vars[name] = {
      value_present: true,
      ref: parsed.ref,
      host: parsed.host,
      shape: parsed.shape,
    };
    refByVar[name] = parsed.ref;
    if (name === "SUPABASE_DB_URL") {
      dbShape = parsed.shape === "rest" ? "unrecognised" : parsed.shape;
      dbHost = parsed.host;
    }
    if (parsed.shape === "unrecognised") {
      errors.push(`${name} value did not match any known Supabase URL shape (REST / pooler / direct)`);
    }
  }

  // Ref-match check: all SET refs must agree.
  const setRefs = Object.entries(refByVar).filter(([, ref]) => ref !== null);
  if (setRefs.length >= 2) {
    const firstRef = setRefs[0][1] as string;
    const mismatches = setRefs.filter(([, ref]) => ref !== firstRef);
    if (mismatches.length > 0) {
      const lines = setRefs.map(([k, ref]) => `  ${k}: project ref = ${ref}`).join("\n");
      errors.push(
        `Project ref mismatch across Supabase env vars:\n${lines}\n` +
          `Every set Supabase URL must point at the same project. Mixing refs means REST writes go to one project ` +
          `and DB writes go to another — silent data divergence.`,
      );
    }
  }

  // DB host shape check: pooler required, direct rejected.
  if (dbShape === "direct") {
    errors.push(
      `SUPABASE_DB_URL host is direct-connection format (${dbHost}). Supabase direct connections are IPv6-only; ` +
        `Vercel runtime is IPv4-only — this will always fail with ENOTFOUND. ` +
        `Use the session pooler URL instead: postgresql://postgres.<ref>:<pwd>@aws-N-<region>.pooler.supabase.com:5432/postgres`,
    );
  }

  const summary = errors.length === 0
    ? `OK — all set Supabase refs match (${refByVar.SUPABASE_URL ?? "?"})${dbShape === "pooler" ? `, DB host is pooler (${dbHost})` : ""}`
    : `FAIL — ${errors.length} consistency error(s)`;

  return { ok: errors.length === 0, summary, vars, errors };
}

// ---------------------------------------------------------------------------
// CLI entry point — runs only when invoked as a script, not when imported.
// ---------------------------------------------------------------------------

function main(): void {
  const result = checkConsistency({
    SUPABASE_URL: process.env.SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_DB_URL: process.env.SUPABASE_DB_URL,
  });

  if (result.ok) {
    console.log(result.summary);
    process.exit(0);
  }

  console.error("Supabase env-var consistency check FAILED.\n");
  console.error("Detected state:");
  for (const [name, info] of Object.entries(result.vars)) {
    if (!info.value_present) {
      console.error(`  ${name}: (not set)`);
    } else {
      console.error(`  ${name}: ref=${info.ref ?? "(unparseable)"} host=${info.host ?? "n/a"} shape=${info.shape ?? "?"}`);
    }
  }
  console.error("\nErrors:");
  for (const err of result.errors) {
    console.error(`  - ${err}`);
  }
  console.error("\nSee scripts/check-supabase-env-consistency.ts header for the incident context.");
  // Exit 2 if a required var is missing, 1 for inconsistency.
  const missing = result.errors.some((e) => e.startsWith("Missing required"));
  process.exit(missing ? 2 : 1);
}

// CJS: `require.main === module`. ESM (which tsx uses): no equivalent, but
// import.meta.url comparison works. Use a defensive check that works either way.
const isDirectInvocation =
  // ESM check
  (typeof import.meta !== "undefined" &&
    import.meta.url &&
    process.argv[1] &&
    new URL(import.meta.url).pathname.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "")) ||
  // CJS fallback
  (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module);

if (isDirectInvocation) {
  main();
}
