// Shared helper for the direct-Postgres workers (brief-runner,
// batch-worker, regeneration-worker, transfer-worker, batch-jobs,
// batch-publisher, regeneration-publisher, tenant-budgets, auth-revoke,
// and the process-brief-runner cron). Returns an explicit pg.ClientConfig
// (host/port/user/password/database/ssl) parsed from SUPABASE_DB_URL.
//
// Why bypass pg.Client's `connectionString` field:
//   pg-connection-string@2.12.0 uses `new URL(str, 'postgres://base')`
//   as its parser. On some runtimes (notably the Vercel serverless Node
//   runtime serving this project) the `postgresql:` non-special scheme
//   does not yield a `hostname` from the input URL, so the parser falls
//   back to the base URL — handing pg.Client `host: "base"` and producing
//   the cryptic `getaddrinfo ENOTFOUND base` cron failures we hit during
//   UAT. Locally (Node 24, same library) the parser works fine. Rather
//   than chase the runtime-version difference, we parse with Node's
//   native `URL` ourselves and pass explicit fields, sidestepping the
//   library's base-URL fallback.

import type { ClientConfig } from "pg";

export function requireDbConfig(): ClientConfig {
  const raw = process.env.SUPABASE_DB_URL;
  if (!raw) {
    throw new Error(
      "SUPABASE_DB_URL is not set. Required for direct Postgres connections.",
    );
  }
  return parseDbUrl(raw);
}

export function parseDbUrl(raw: string): ClientConfig {
  // Swap postgresql:/postgres: for http: so the WHATWG URL parser
  // treats it as a special scheme (hostname always extracted, no
  // base-URL fallback).
  const httpish = raw.replace(/^postgres(ql)?:/, "http:");
  let url: URL;
  try {
    url = new URL(httpish);
  } catch (e) {
    throw new Error(
      `SUPABASE_DB_URL is not a parseable URL: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const host = url.hostname;
  if (!host || host === "base") {
    throw new Error(
      `SUPABASE_DB_URL parsed an empty or fallback host (${host || "<empty>"}). The configured value does not contain a recognisable hostname.`,
    );
  }

  const port = url.port ? Number(url.port) : 5432;
  const user = url.username ? decodeURIComponent(url.username) : undefined;
  const password = url.password ? decodeURIComponent(url.password) : undefined;
  const database = url.pathname && url.pathname.length > 1
    ? decodeURIComponent(url.pathname.slice(1))
    : undefined;

  // SSL: hosted Supabase pooler/direct requires TLS; the local
  // `supabase start` Docker image uses unencrypted Postgres on
  // 127.0.0.1 (vitest's globalSetup spins this up for the CI test
  // job + local dev). Detect by host. rejectUnauthorized:false on
  // remote matches the pre-fix behaviour with sslmode=require.
  const isLocal =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "host.docker.internal";
  const ssl = isLocal ? false : { rejectUnauthorized: false };

  return { host, port, user, password, database, ssl };
}
