#!/usr/bin/env -S npx tsx
/**
 * scripts/audit.ts — Static analysis: catch logic errors before UAT.
 *
 * Eight checks (HIGH | MEDIUM | LOW severity):
 *   1. Middleware public paths              HIGH
 *   2. Admin API gate coverage              MEDIUM
 *   3. DB column references                 MEDIUM
 *   4. Migration ordering                   HIGH
 *   5. Typography minimums                  LOW
 *   6. Env var coverage                     LOW
 *   7. Unauthenticated API routes           HIGH
 *   8. Missing error handling on writes     MEDIUM
 *
 * Output:
 *   - Per-issue lines: FILE:LINE — CATEGORY — message
 *   - Summary table: category | count | severity
 *   - Exit code 1 if any HIGH severity issues
 *   - Exit code 0 if only MEDIUM / LOW
 *
 * Usage:
 *   npm run audit:static
 *   npx tsx scripts/audit.ts
 *
 * Heuristic-based; expect occasional false positives. Use the output as
 * a punch-list, not a CI-blocker for MEDIUM/LOW. HIGH severity rules
 * are intentionally narrow so that any HIGH hit is worth investigating.
 */

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, dirname } from "node:path";

// ============================================================================
// Types + constants
// ============================================================================

type Severity = "HIGH" | "MEDIUM" | "LOW";

interface Issue {
  category: string;
  severity: Severity;
  file: string;
  line: number;
  message: string;
}

const REPO_ROOT = process.cwd();

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".claude",
  ".git",
  "test-results",
  "playwright-report",
  "coverage",
  "__tests__",
  "_fixtures",
  "__fixtures__",
  "_evals",
  "__evals__",
]);

// ============================================================================
// File-walk + read helpers
// ============================================================================

function* walkFiles(dir: string, exts: readonly string[]): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e)) continue;
    const p = join(dir, e);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      yield* walkFiles(p, exts);
    } else if (exts.some((ext) => e.endsWith(ext))) {
      yield p;
    }
  }
}

function readSafe(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function relPath(file: string): string {
  return relative(REPO_ROOT, file).replace(/\\/g, "/");
}

function pageRouteFromFile(file: string): string {
  const rel = relPath(file);
  return (
    "/" +
    rel
      .replace(/^app\//, "")
      .replace(/\/page\.tsx$/, "")
      .replace(/\/route\.ts$/, "")
  ).replace(/\/+$/, "") || "/";
}

// ============================================================================
// Check 1 — Middleware public paths (HIGH)
// ============================================================================

interface MiddlewareData {
  publicPaths: Set<string>;
  publicPrefixes: string[];
}

function parseMiddleware(): MiddlewareData {
  const src = readSafe(join(REPO_ROOT, "middleware.ts"));
  const publicPaths = new Set<string>();
  const publicPrefixes: string[] = [];

  const setMatch = src.match(/PUBLIC_PATHS\s*=\s*new Set<[^>]*>\s*\(\s*\[([\s\S]*?)\]\s*\)/);
  if (setMatch) {
    const inside = setMatch[1];
    const re = /["'](\/[A-Za-z0-9_/\-]*)["']/g;
    let m;
    while ((m = re.exec(inside)) !== null) publicPaths.add(m[1]);
  }

  const prefixRe = /pathname\.startsWith\(\s*["'](\/[A-Za-z0-9_/\-]+\/)["']/g;
  let m2;
  while ((m2 = prefixRe.exec(src)) !== null) publicPrefixes.push(m2[1]);

  return { publicPaths, publicPrefixes };
}

function check1_middlewarePublicPaths(): Issue[] {
  const issues: Issue[] = [];
  const { publicPaths, publicPrefixes } = parseMiddleware();

  if (publicPaths.size === 0) {
    issues.push({
      category: "middleware-public-paths",
      severity: "HIGH",
      file: "middleware.ts",
      line: 0,
      message: "Could not extract PUBLIC_PATHS — parser miss or middleware refactored",
    });
    return issues;
  }

  const authDir = join(REPO_ROOT, "app", "auth");
  if (!existsSync(authDir)) return issues;

  // Path-segment keywords that signal "this page handles unauthenticated users".
  const PATH_KEYWORDS = [
    "invite",
    "approve",
    "reset",
    "verify",
    "callback",
    "accept",
    "forgot",
  ];

  const foundAuthPaths = new Set<string>();

  for (const file of walkFiles(authDir, [".tsx"])) {
    if (!file.endsWith("page.tsx")) continue;
    const route = pageRouteFromFile(file);
    foundAuthPaths.add(route);

    const lower = route.toLowerCase();
    const matchesKeyword = PATH_KEYWORDS.some((k) => lower.includes(k));
    if (!matchesKeyword) continue;

    const isPublic =
      publicPaths.has(route) ||
      publicPrefixes.some((p) => route.startsWith(p));
    if (!isPublic) {
      issues.push({
        category: "middleware-public-paths",
        severity: "HIGH",
        file: relPath(file),
        line: 1,
        message: `Auth page ${route} handles unauthenticated access (path keyword match) but is missing from PUBLIC_PATHS in middleware.ts`,
      });
    }
  }

  // Dead PUBLIC_PATHS entries — flag where no page.tsx + no api route exists.
  for (const p of publicPaths) {
    if (p === "/login" || p === "/logout" || p === "/auth-error") continue;
    if (p.startsWith("/api/")) continue;
    const candidate = join(REPO_ROOT, "app", p, "page.tsx");
    if (!existsSync(candidate) && !foundAuthPaths.has(p)) {
      issues.push({
        category: "middleware-public-paths",
        severity: "LOW",
        file: "middleware.ts",
        line: 0,
        message: `PUBLIC_PATHS entry ${p} has no corresponding page.tsx — dead entry?`,
      });
    }
  }

  return issues;
}

// ============================================================================
// Check 2 — Admin API gate coverage (MEDIUM)
// ============================================================================

function check2_adminApiGate(): Issue[] {
  const issues: Issue[] = [];
  const adminApiDir = join(REPO_ROOT, "app", "api", "admin");
  if (!existsSync(adminApiDir)) return issues;

  for (const file of walkFiles(adminApiDir, [".ts"])) {
    if (!file.endsWith("route.ts")) continue;
    const src = readSafe(file);
    const rel = relPath(file);

    if (!/requireAdminForApi\s*\(/.test(src)) {
      // Some routes use other gating (CRON_SECRET, custom). Check for
      // any auth-ish keyword before flagging.
      const hasAuth =
        /CRON_SECRET|getCurrentUser|getSession|OPOLLO_EMERGENCY_KEY|verifyToken/.test(
          src,
        );
      if (!hasAuth) {
        issues.push({
          category: "admin-api-gate",
          severity: "MEDIUM",
          file: rel,
          line: 1,
          message:
            "Admin API route does not call requireAdminForApi() and has no other auth gate",
        });
      }
      continue;
    }

    const lines = src.split(/\r?\n/);
    lines.forEach((line, idx) => {
      // Detect bare requireAdminForApi() with no arguments.
      if (/requireAdminForApi\s*\(\s*\)/.test(line)) {
        issues.push({
          category: "admin-api-gate",
          severity: "MEDIUM",
          file: rel,
          line: idx + 1,
          message:
            "requireAdminForApi() called with no args — pass explicit roles: ['super_admin', 'admin'] for clarity (default permits both since #379 but explicit is safer)",
        });
      }
      // Detect roles: ["admin"] without super_admin.
      const rolesOnlyAdmin = line.match(
        /requireAdminForApi\s*\(\s*\{\s*roles\s*:\s*\[\s*["']admin["']\s*\]/,
      );
      if (rolesOnlyAdmin) {
        issues.push({
          category: "admin-api-gate",
          severity: "MEDIUM",
          file: rel,
          line: idx + 1,
          message:
            'requireAdminForApi({ roles: ["admin"] }) excludes super_admin — should be ["super_admin", "admin"] unless intentional',
        });
      }
    });
  }
  return issues;
}

// ============================================================================
// Check 3 — DB column references (MEDIUM)
// ============================================================================

interface MigrationSchema {
  // table → set of known columns (best-effort)
  columns: Map<string, Set<string>>;
  // table → migration version where it was created
  createdIn: Map<string, string>;
}

function parseMigrations(): MigrationSchema {
  const migDir = join(REPO_ROOT, "supabase", "migrations");
  const columns = new Map<string, Set<string>>();
  const createdIn = new Map<string, string>();
  if (!existsSync(migDir)) return { columns, createdIn };

  const files = readdirSync(migDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const f of files) {
    const src = readSafe(join(migDir, f));
    const version = f.split("_")[0];

    // CREATE TABLE [IF NOT EXISTS] [public.]name (...);
    const createRe =
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?["']?([a-zA-Z_][a-zA-Z0-9_]*)["']?\s*\(([\s\S]*?)\)\s*;/gi;
    let cm;
    while ((cm = createRe.exec(src)) !== null) {
      const tbl = cm[1];
      const body = cm[2];
      if (!createdIn.has(tbl)) createdIn.set(tbl, version);
      const cols = columns.get(tbl) ?? new Set<string>();
      // Each line that starts with an identifier → column name.
      for (const rawLine of body.split(/,\s*\n|,(?=\s*[a-zA-Z_])/)) {
        const stripped = rawLine.trim();
        const colMatch = stripped.match(/^["']?([a-zA-Z_][a-zA-Z0-9_]*)["']?\s+/);
        if (colMatch) {
          const colName = colMatch[1].toLowerCase();
          // Filter out keywords that aren't columns.
          const reserved = new Set([
            "constraint",
            "primary",
            "foreign",
            "unique",
            "check",
            "exclude",
            "like",
            "index",
          ]);
          if (!reserved.has(colName)) cols.add(colName);
        }
      }
      columns.set(tbl, cols);
    }

    // ALTER TABLE name ADD COLUMN [IF NOT EXISTS] col ...
    const alterRe =
      /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?["']?([a-zA-Z_][a-zA-Z0-9_]*)["']?\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?["']?([a-zA-Z_][a-zA-Z0-9_]*)["']?/gi;
    let am;
    while ((am = alterRe.exec(src)) !== null) {
      const tbl = am[1];
      const col = am[2].toLowerCase();
      const cols = columns.get(tbl) ?? new Set<string>();
      cols.add(col);
      columns.set(tbl, cols);
    }
  }

  return { columns, createdIn };
}

function check3_dbColumnReferences(): Issue[] {
  const issues: Issue[] = [];
  const { columns } = parseMigrations();
  if (columns.size === 0) return issues;

  // Tables flagged by docs/DATA_CONVENTIONS.md as not-yet-folded for audit
  // columns. Writes of updated_by/created_by to these tables fail at
  // runtime with "column does not exist". Built-in list rather than
  // re-parsing the doc — these are the known offenders.
  const AUDIT_NOT_YET_FOLDED = new Set(["sites"]);

  // Pattern: .from("name").update({ ... }) | .insert({ ... }) | .upsert({ ... })
  const callRe =
    /\.from\(\s*["']([a-zA-Z_][a-zA-Z0-9_]*)["']\s*\)\s*\.\s*(update|insert|upsert)\s*\(\s*(\{[\s\S]*?\}|\[[\s\S]*?\])/g;

  for (const file of walkFiles(join(REPO_ROOT, "app"), [".ts", ".tsx"])) {
    if (file.includes("__tests__") || file.includes("/test")) continue;
    const src = readSafe(file);
    const rel = relPath(file);
    let m;
    while ((m = callRe.exec(src)) !== null) {
      const table = m[1];
      const objText = m[3];
      const knownCols = columns.get(table);

      // Extract simple top-level keys: `key:` at start of identifier.
      const keyRe = /(?:^|[\s,{])([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g;
      let km;
      const keysSeen = new Set<string>();
      while ((km = keyRe.exec(objText)) !== null) {
        keysSeen.add(km[1].toLowerCase());
      }

      const lineIdx = src.slice(0, m.index).split("\n").length;

      for (const key of keysSeen) {
        // Special case for not-yet-folded audit columns.
        if (
          AUDIT_NOT_YET_FOLDED.has(table) &&
          (key === "updated_by" || key === "created_by")
        ) {
          issues.push({
            category: "db-column-references",
            severity: "MEDIUM",
            file: rel,
            line: lineIdx,
            message: `Writing ${key} to '${table}' but per docs/DATA_CONVENTIONS.md the table hasn't been folded in to the audit-columns rollout yet — this UPDATE will fail at runtime`,
          });
          continue;
        }
        if (!knownCols) continue; // can't verify if we have no schema for the table
        if (!knownCols.has(key)) {
          issues.push({
            category: "db-column-references",
            severity: "MEDIUM",
            file: rel,
            line: lineIdx,
            message: `Column '${key}' is not present in any CREATE TABLE / ALTER TABLE for '${table}' under supabase/migrations/`,
          });
        }
      }
    }
  }

  return issues;
}

// ============================================================================
// Check 4 — Migration ordering (HIGH)
// ============================================================================

function check4_migrationOrdering(): Issue[] {
  const issues: Issue[] = [];
  const migDir = join(REPO_ROOT, "supabase", "migrations");
  if (!existsSync(migDir)) return issues;

  const files = readdirSync(migDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  // Duplicate version prefixes.
  const versionToFiles = new Map<string, string[]>();
  for (const f of files) {
    const v = f.split("_")[0];
    const arr = versionToFiles.get(v) ?? [];
    arr.push(f);
    versionToFiles.set(v, arr);
  }
  for (const [v, fs] of versionToFiles) {
    if (fs.length > 1) {
      issues.push({
        category: "migration-ordering",
        severity: "HIGH",
        file: `supabase/migrations/${fs[0]}`,
        line: 0,
        message: `Duplicate migration version prefix ${v} — ${fs.join(", ")}. supabase_migrations.schema_migrations enforces UNIQUE on version; one of these will be silently skipped.`,
      });
    }
  }

  // FK ordering — track tables created so far; flag REFERENCES to unknown tables.
  const created = new Set<string>();
  const createRe =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?["']?([a-zA-Z_][a-zA-Z0-9_]*)["']?/gi;
  const refRe =
    /REFERENCES\s+(?:public\.)?["']?([a-zA-Z_][a-zA-Z0-9_]*)["']?/gi;

  for (const f of files) {
    const src = readSafe(join(migDir, f));

    // Local creates first (a migration can self-reference within its own body).
    const localCreated = new Set<string>();
    let cm;
    while ((cm = createRe.exec(src)) !== null) {
      localCreated.add(cm[1]);
    }
    createRe.lastIndex = 0;

    // Now walk references — must resolve to either an earlier-created table
    // or one created in this same file.
    let rm;
    refRe.lastIndex = 0;
    while ((rm = refRe.exec(src)) !== null) {
      const target = rm[1];
      // Self-references to auth.* or pg_catalog.* are out of scope.
      if (target === "auth" || target.startsWith("pg_")) continue;
      if (created.has(target) || localCreated.has(target)) continue;
      const lineIdx = src.slice(0, rm.index).split("\n").length;
      issues.push({
        category: "migration-ordering",
        severity: "HIGH",
        file: `supabase/migrations/${f}`,
        line: lineIdx,
        message: `FK REFERENCES '${target}' but no CREATE TABLE for '${target}' has run yet at this point in the migration sequence`,
      });
    }

    for (const t of localCreated) created.add(t);
  }

  return issues;
}

// ============================================================================
// Check 5 — Typography minimums (LOW)
// ============================================================================

/**
 * Strip comments from a source line so checks don't false-positive on doc
 * mentions of forbidden patterns. Tracks block-comment state across lines.
 *
 *   - Block comments `/* ... *​/` (multi-line) — stripped, state carried.
 *   - Line comments `//` (TS/JS/JSX, not CSS) — everything after stripped.
 *   - JSX comments are wrapped `{/* ... *​/}` but the inner block-comment
 *     pattern is the same; the regex strip handles them naturally.
 *
 * Crude on string literals (`'//'` would be stripped) but acceptable for
 * the typography check since the false-positive risk on string-literal
 * `text-xs` is low (test fixtures already excluded via SKIP_DIRS).
 */
function stripComments(
  line: string,
  state: { inBlock: boolean },
  isCss: boolean,
): string {
  let result = line;

  if (state.inBlock) {
    const endIdx = result.indexOf("*/");
    if (endIdx === -1) return ""; // entire line is in a block comment
    result = result.slice(endIdx + 2);
    state.inBlock = false;
  }

  while (true) {
    const startIdx = result.indexOf("/*");
    if (startIdx === -1) break;
    const endIdx = result.indexOf("*/", startIdx + 2);
    if (endIdx === -1) {
      result = result.slice(0, startIdx);
      state.inBlock = true;
      break;
    }
    result = result.slice(0, startIdx) + result.slice(endIdx + 2);
  }

  if (!isCss) {
    const lineCommentIdx = result.indexOf("//");
    if (lineCommentIdx !== -1) result = result.slice(0, lineCommentIdx);
  }

  return result;
}

function check5_typography(): Issue[] {
  const issues: Issue[] = [];
  const roots = ["app", "components", "lib"];

  // text-xs occurrences.
  const textXsRe = /\btext-xs\b/;
  // Inline fontSize below 14px.
  const fsPxRe =
    /fontSize\s*:\s*["']?(0\.[0-7]\d*rem|[1-9]px|1[0-3]px|0\.[0-7]\d*em)["']?/;

  for (const root of roots) {
    const dir = join(REPO_ROOT, root);
    if (!existsSync(dir)) continue;
    for (const file of walkFiles(dir, [".ts", ".tsx", ".css"])) {
      const lines = readSafe(file).split(/\r?\n/);
      const rel = relPath(file);
      const isCss = file.endsWith(".css");
      const state = { inBlock: false };
      lines.forEach((ln, i) => {
        const stripped = stripComments(ln, state, isCss);
        if (textXsRe.test(stripped)) {
          issues.push({
            category: "typography-minimums",
            severity: "LOW",
            file: rel,
            line: i + 1,
            message: "text-xs (12px) is below the 0.875rem / 14px floor — uplift to text-sm (RULES.md #7)",
          });
        }
        if (fsPxRe.test(stripped)) {
          issues.push({
            category: "typography-minimums",
            severity: "LOW",
            file: rel,
            line: i + 1,
            message: "Inline fontSize is below the 14px floor (RULES.md #7)",
          });
        }
      });
    }
  }
  return issues;
}

// ============================================================================
// Check 6 — Env var coverage (LOW)
// ============================================================================

function check6_envVars(): Issue[] {
  const issues: Issue[] = [];
  const examplePath = join(REPO_ROOT, ".env.example");
  if (!existsSync(examplePath)) {
    issues.push({
      category: "env-vars",
      severity: "LOW",
      file: ".env.example",
      line: 0,
      message: ".env.example missing — cannot verify env-var coverage",
    });
    return issues;
  }
  const exampleSrc = readSafe(examplePath);
  const declared = new Set<string>();
  for (const line of exampleSrc.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=/);
    if (m) declared.add(m[1]);
  }

  // Extract referenced env vars in app + lib.
  const referenced = new Map<string, string>(); // name → first file:line
  const envRe = /process\.env\.([A-Z][A-Z0-9_]*)/g;
  for (const root of ["app", "lib"]) {
    const dir = join(REPO_ROOT, root);
    if (!existsSync(dir)) continue;
    for (const file of walkFiles(dir, [".ts", ".tsx"])) {
      if (file.includes("__tests__")) continue;
      const src = readSafe(file);
      let m;
      while ((m = envRe.exec(src)) !== null) {
        const name = m[1];
        if (!referenced.has(name)) {
          const lineIdx = src.slice(0, m.index).split("\n").length;
          referenced.set(name, `${relPath(file)}:${lineIdx}`);
        }
      }
    }
  }

  // Allow-list — these are framework / Vercel / Node built-ins that don't
  // need declaring in .env.example.
  const ALLOWLIST = new Set([
    "NODE_ENV",
    "VERCEL_ENV",
    "VERCEL_URL",
    "CI",
    "PORT",
    "NEXT_RUNTIME",
  ]);

  for (const [name, loc] of referenced) {
    if (ALLOWLIST.has(name)) continue;
    if (!declared.has(name)) {
      const [file, lineStr] = loc.split(":");
      issues.push({
        category: "env-vars",
        severity: "LOW",
        file,
        line: Number(lineStr),
        message: `process.env.${name} referenced but missing from .env.example`,
      });
    }
  }
  for (const name of declared) {
    if (ALLOWLIST.has(name)) continue;
    if (!referenced.has(name)) {
      issues.push({
        category: "env-vars",
        severity: "LOW",
        file: ".env.example",
        line: 0,
        message: `${name} declared in .env.example but no process.env.${name} reference in app/ or lib/`,
      });
    }
  }
  return issues;
}

// ============================================================================
// Check 7 — Unauthenticated API routes (HIGH)
// ============================================================================

function check7_unauthenticatedApi(): Issue[] {
  const issues: Issue[] = [];
  const apiDir = join(REPO_ROOT, "app", "api");
  if (!existsSync(apiDir)) return issues;

  const PUBLIC_PREFIXES = ["/api/auth/", "/api/health", "/api/webhooks/"];
  // Auth markers — any of these in the file body indicates the route gates itself.
  const AUTH_PATTERNS = [
    /requireAdminForApi/,
    /CRON_SECRET/,
    /OPOLLO_EMERGENCY_KEY/,
    /getCurrentUser/,
    /getSession/,
    /verifyToken/,
    /verifyMagicLink/,
    /createHash/,
    /getServiceRoleClient/,
    /\bauth\.getUser\b/,
  ];

  for (const file of walkFiles(apiDir, [".ts"])) {
    if (!file.endsWith("route.ts")) continue;
    const route = pageRouteFromFile(file);
    const cleanRoute = route.replace(/\[[^\]]+\]/g, ":param");

    // Skip explicitly public endpoints.
    if (PUBLIC_PREFIXES.some((p) => cleanRoute.startsWith(p))) continue;
    if (cleanRoute === "/api/health" || cleanRoute === "/api/emergency")
      continue;

    const src = readSafe(file);
    const hasAuth = AUTH_PATTERNS.some((p) => p.test(src));
    if (!hasAuth) {
      issues.push({
        category: "unauthenticated-api",
        severity: "HIGH",
        file: relPath(file),
        line: 1,
        message: `API route ${cleanRoute} has no detected auth gate — verify it is intentionally public or add requireAdminForApi / equivalent`,
      });
    }
  }
  return issues;
}

// ============================================================================
// Check 8 — Missing error handling on Supabase writes (MEDIUM)
// ============================================================================

function check8_errorHandling(): Issue[] {
  const issues: Issue[] = [];
  const writeRe =
    /\.\s*(update|insert|upsert|delete)\s*\(/g;

  for (const root of ["app", "lib"]) {
    const dir = join(REPO_ROOT, root);
    if (!existsSync(dir)) continue;
    for (const file of walkFiles(dir, [".ts", ".tsx"])) {
      if (file.includes("__tests__") || file.includes("/test")) continue;
      const src = readSafe(file);
      // Only consider files that import a supabase client to limit false
      // positives from arbitrary `.update(` on non-supabase objects.
      if (
        !/getServiceRoleClient|createMiddlewareAuthClient|createRouteAuthClient|@supabase\/(supabase-js|ssr)/.test(
          src,
        )
      ) {
        continue;
      }
      const lines = src.split(/\r?\n/);
      let m;
      writeRe.lastIndex = 0;
      while ((m = writeRe.exec(src)) !== null) {
        const idx = m.index;
        const lineIdx = src.slice(0, idx).split("\n").length;
        // Look at the next 12 lines + 6 lines before for an `.error`,
        // `if (...error)`, or destructured `{ error }` after this call.
        const window = lines
          .slice(Math.max(0, lineIdx - 1), lineIdx + 12)
          .join("\n");
        const hasErrorCheck =
          /\berror\b\s*[:),}]|\.\s*error\b|\bthrow\b|\bif\s*\(\s*error\s*\)|\bif\s*\(\s*[a-zA-Z_]+\.\s*error\s*\)|\bif\s*\(\s*!?\s*[a-zA-Z_]+\.\s*ok\s*\)/.test(
            window,
          );
        if (!hasErrorCheck) {
          // Skip if the call is inside a `await ... .maybeSingle()` chain
          // where the result is destructured upstream — we'd see `data`
          // alongside `error` patterns. Conservative skip.
          if (/\bdata\s*[:,}]/.test(window)) continue;
          issues.push({
            category: "error-handling",
            severity: "MEDIUM",
            file: relPath(file),
            line: lineIdx,
            message: `Supabase ${m[1]}() call has no detected error check within ±12 lines — verify the result.error is checked`,
          });
        }
      }
    }
  }
  return issues;
}

// ============================================================================
// Output
// ============================================================================

function colorByLevel(s: Severity): string {
  if (process.env.NO_COLOR) return s;
  const map: Record<Severity, string> = {
    HIGH: "\x1b[31mHIGH\x1b[0m",
    MEDIUM: "\x1b[33mMEDIUM\x1b[0m",
    LOW: "\x1b[36mLOW\x1b[0m",
  };
  return map[s];
}

function printResults(issues: Issue[]): boolean {
  if (issues.length === 0) {
    console.log("No issues found. Audit clean.");
    return false;
  }

  // Per-issue lines (sorted: HIGH first, then MEDIUM, then LOW).
  const ordered = [...issues].sort((a, b) => {
    const order = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    return order[a.severity] - order[b.severity] || a.file.localeCompare(b.file) || a.line - b.line;
  });
  for (const i of ordered) {
    console.log(
      `${i.file}:${i.line} — [${colorByLevel(i.severity)}] ${i.category} — ${i.message}`,
    );
  }

  // Summary table.
  const counts = new Map<string, { high: number; medium: number; low: number }>();
  for (const i of issues) {
    const c = counts.get(i.category) ?? { high: 0, medium: 0, low: 0 };
    if (i.severity === "HIGH") c.high += 1;
    else if (i.severity === "MEDIUM") c.medium += 1;
    else c.low += 1;
    counts.set(i.category, c);
  }
  console.log("");
  console.log("┌──────────────────────────────────────┬───────┬─────────┬──────┐");
  console.log("│ Category                             │ HIGH  │ MEDIUM  │ LOW  │");
  console.log("├──────────────────────────────────────┼───────┼─────────┼──────┤");
  for (const [cat, c] of [...counts.entries()].sort()) {
    const pad = (s: string, n: number) => s.padEnd(n);
    const num = (n: number, w: number) =>
      String(n).padStart(w);
    console.log(
      `│ ${pad(cat, 36)} │ ${num(c.high, 5)} │ ${num(c.medium, 7)} │ ${num(c.low, 4)} │`,
    );
  }
  console.log("└──────────────────────────────────────┴───────┴─────────┴──────┘");

  const highCount = issues.filter((i) => i.severity === "HIGH").length;
  const medCount = issues.filter((i) => i.severity === "MEDIUM").length;
  const lowCount = issues.filter((i) => i.severity === "LOW").length;
  console.log(
    `\nTotal: ${highCount} HIGH, ${medCount} MEDIUM, ${lowCount} LOW (${issues.length} issues)`,
  );

  return highCount > 0;
}

// ============================================================================
// Main
// ============================================================================

function main(): void {
  console.log("scripts/audit.ts — running 8 static checks...\n");

  const all: Issue[] = [
    ...check1_middlewarePublicPaths(),
    ...check2_adminApiGate(),
    ...check3_dbColumnReferences(),
    ...check4_migrationOrdering(),
    ...check5_typography(),
    ...check6_envVars(),
    ...check7_unauthenticatedApi(),
    ...check8_errorHandling(),
  ];

  const failed = printResults(all);
  if (failed) {
    console.log(
      "\nExit 1 — at least one HIGH severity issue. CI gate fails.",
    );
    process.exit(1);
  }
  console.log("\nExit 0 — no HIGH severity issues.");
  process.exit(0);
}

main();
