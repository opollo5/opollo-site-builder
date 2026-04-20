import { execSync } from "node:child_process";

// Shared Supabase-CLI-status reader for the Vitest harness.
//
// The CLI's JSON output has shifted across versions (old uppercase
// snake_case like API_URL; newer releases use other shapes). Rather than
// track it, we:
//   1. Try JSON. Look up known fields with case-insensitive, multi-variant
//      key matching (UPPER_SNAKE, lower_snake, camelCase).
//   2. Fall back to plain-text `supabase status`, which has been stable
//      for years — labels like "API URL: http://..." at start of line.
//
// If both fail, we return null and the caller throws with a diagnostic
// that includes the raw CLI output so the next failure is debuggable
// from the job log alone.

export type SupabaseCreds = {
  apiUrl: string;
  serviceRoleKey: string;
  dbUrl?: string;
  anonKey?: string;
};

export function runCmd(
  cmd: string,
  opts?: { allowFailure?: boolean },
): string {
  try {
    return execSync(cmd, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    if (opts?.allowFailure) return "";
    throw err;
  }
}

// Case-insensitive field lookup across several candidate key names. JSON
// schema drift is inevitable with a fast-moving CLI; this absorbs it.
function findKey(
  obj: Record<string, unknown>,
  candidates: string[],
): string | undefined {
  const lower: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    lower[k.toLowerCase()] = v;
  }
  for (const c of candidates) {
    const v = lower[c.toLowerCase()];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

function fromJson(raw: string): SupabaseCreds | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const o = obj as Record<string, unknown>;

  const apiUrl = findKey(o, ["API_URL", "api_url", "apiUrl"]);
  const serviceRoleKey = findKey(o, [
    "SERVICE_ROLE_KEY",
    "service_role_key",
    "serviceRoleKey",
  ]);
  const dbUrl = findKey(o, ["DB_URL", "db_url", "dbUrl"]);
  const anonKey = findKey(o, ["ANON_KEY", "anon_key", "anonKey"]);

  if (!apiUrl || !serviceRoleKey) return null;
  return { apiUrl, serviceRoleKey, dbUrl, anonKey };
}

// Plain-text format has been stable since CLI v1.x. Labels look like:
//          API URL: http://127.0.0.1:54321
//           DB URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres
//         anon key: eyJ...
// service_role key: eyJ...
function fromText(raw: string): SupabaseCreds | null {
  const labels: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([^:]+?)\s*:\s*(.+?)\s*$/);
    if (!m) continue;
    const label = m[1].toLowerCase().replace(/[_-]/g, " ").replace(/\s+/g, " ");
    labels[label] = m[2];
  }

  const apiUrl = labels["api url"] ?? labels["api"];
  const serviceRoleKey =
    labels["service role key"] ?? labels["service_role key"];
  const dbUrl = labels["db url"];
  const anonKey = labels["anon key"];

  if (!apiUrl || !serviceRoleKey) return null;
  return { apiUrl, serviceRoleKey, dbUrl, anonKey };
}

export function readSupabaseCreds(): SupabaseCreds | null {
  const jsonRaw = runCmd("supabase status --output json", { allowFailure: true });
  if (jsonRaw) {
    const parsed = fromJson(jsonRaw);
    if (parsed) return parsed;
  }
  const textRaw = runCmd("supabase status", { allowFailure: true });
  if (textRaw) {
    const parsed = fromText(textRaw);
    if (parsed) return parsed;
  }
  return null;
}

// Diagnostic dump for the failing case — prints both raw outputs so the
// CI log shows exactly what shape we got and why it didn't parse.
export function diagnosticDump(): string {
  const jsonRaw = runCmd("supabase status --output json", { allowFailure: true });
  const textRaw = runCmd("supabase status", { allowFailure: true });
  return [
    "---- supabase status --output json ----",
    jsonRaw || "(empty / errored)",
    "---- supabase status (plain text) ----",
    textRaw || "(empty / errored)",
    "",
  ].join("\n");
}
