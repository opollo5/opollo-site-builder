#!/usr/bin/env tsx
/**
 * scripts/probes/probe-ai-prefill.ts
 *
 * LAYER 7 — Live diagnostic probe for the AI Prefill feature.
 *
 * Per the live diagnostic protocol in CLAUDE.md, completing this probe is
 * step 1 of 6 before any agent may claim "third-party bug" against Anthropic.
 *
 * Exercises the POST /api/sites/[id]/ai-prefill endpoint against a real
 * deployed URL, then validates that every field in the response matches
 * the expected shape. Output is markdown, suitable for an incident doc.
 *
 * Usage:
 *   npx tsx scripts/probes/probe-ai-prefill.ts \
 *     --url=https://opollo-site-builder.vercel.app \
 *     --site-id=<uuid> \
 *     --cookie="sb-access-token=..."
 *
 * Required flags:
 *   --url       Base URL of the deployed environment (no trailing slash)
 *   --site-id   UUID of the site to probe against
 *   --cookie    Session cookie header (obtain from a logged-in browser)
 *
 * Optional flags:
 *   --text      Override the document text sent (default: built-in fixture)
 */

type Outcome = {
  label: string;
  ok: boolean;
  statusCode: number;
  fieldsExtracted: number;
  title?: string | null;
  slug?: string | null;
  categories?: number;
  tags?: number;
  truncated?: boolean;
  errorMessage?: string;
};

function getArg(name: string, fallback: string): string {
  const m = process.argv.find((a) => a.startsWith(`--${name}=`));
  return m ? (m.split("=").slice(1).join("=") || fallback) : fallback;
}

const BASE_URL = getArg("url", "http://localhost:3000");
const SITE_ID = getArg("site-id", "");
const COOKIE = getArg("cookie", "");
const TEXT_OVERRIDE = getArg("text", "");

const DEFAULT_DOCUMENT = `
| **SEO Title** | AI Prefill Probe Test Post |
| --- | --- |
| **SEO Meta Description** | A synthetic document used by the live probe to verify that the AI prefill endpoint extracts metadata correctly. |
| **Category** | Technology |
| **Tags** | #ai #probe #testing |
| **URL** | https://example.com/blog/ai-prefill-probe |

# AI Prefill Probe Test Post

This document is used exclusively by the probe script to exercise the deterministic
pipe-table pre-extractor and, on a cache miss, the Anthropic Haiku fallback.

## Why This Matters

If this probe returns a non-200 or missing fields, check:
1. ANTHROPIC_API_KEY is set in the target deployment (vercel env ls --environment=production)
2. The rate-limit bucket has not been exhausted (check Upstash for rl:ai_prefill)
3. The route at app/api/sites/[id]/ai-prefill/route.ts is deployed (verify SHA)
`.trim();

async function probeText(document: string): Promise<Outcome> {
  const url = `${BASE_URL}/api/sites/${SITE_ID}/ai-prefill`;
  const form = new FormData();
  form.append("text", document);
  form.append("availableCategories", JSON.stringify(["Technology", "Marketing"]));
  form.append("availableTags", JSON.stringify(["ai", "testing"]));

  let statusCode = 0;
  try {
    const headers: Record<string, string> = {};
    if (COOKIE) headers["cookie"] = COOKIE;

    const res = await fetch(url, { method: "POST", body: form, headers });
    statusCode = res.status;

    const body = (await res.json()) as {
      ok: boolean;
      data?: { title?: string | null; seo_title?: string | null; meta_description?: string | null; slug?: string | null; content?: string; excerpt?: string | null; categories?: unknown[]; tags?: unknown[]; truncated?: boolean };
      error?: { message?: string };
    };

    if (!body.ok) {
      return {
        label: "POST /ai-prefill (text)",
        ok: false,
        statusCode,
        fieldsExtracted: 0,
        errorMessage: body?.error?.message ?? JSON.stringify(body),
      };
    }

    const d = body.data ?? {};
    const fieldsExtracted =
      [d.title, d.seo_title, d.meta_description, d.slug, d.excerpt].filter(Boolean)
        .length +
      ((d.content?.length ?? 0) > 0 ? 1 : 0) +
      (d.categories?.length ?? 0) +
      (d.tags?.length ?? 0);

    return {
      label: "POST /ai-prefill (text)",
      ok: true,
      statusCode,
      fieldsExtracted,
      title: d.title,
      slug: d.slug,
      categories: d.categories?.length ?? 0,
      tags: d.tags?.length ?? 0,
      truncated: d.truncated,
    };
  } catch (err) {
    return {
      label: "POST /ai-prefill (text)",
      ok: false,
      statusCode,
      fieldsExtracted: 0,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

function renderTable(outcomes: Outcome[]): string {
  const rows = outcomes.map((o) => {
    const status = o.ok ? "✅" : "❌";
    const detail = o.ok
      ? `fields=${o.fieldsExtracted} title="${o.title ?? ""}" slug="${o.slug ?? ""}" cats=${o.categories} tags=${o.tags} truncated=${o.truncated}`
      : `HTTP ${o.statusCode} — ${o.errorMessage ?? "unknown error"}`;
    return `| ${status} | ${o.label} | ${o.statusCode} | ${detail} |`;
  });

  return [
    "## AI Prefill Probe Results",
    "",
    `Probed: ${BASE_URL}/api/sites/${SITE_ID}/ai-prefill`,
    `At: ${new Date().toISOString()}`,
    "",
    "| Status | Case | HTTP | Detail |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

async function main() {
  if (!SITE_ID) {
    console.error("ERROR: --site-id=<uuid> is required.");
    process.exit(1);
  }

  console.log("# AI Prefill Live Probe\n");
  console.log(`Environment: ${BASE_URL}`);
  console.log(`Site ID:     ${SITE_ID}`);
  console.log(`Cookie:      ${COOKIE ? "set" : "NOT SET — request will be unauthenticated"}`);
  console.log();

  const document = TEXT_OVERRIDE || DEFAULT_DOCUMENT;
  const outcomes = await Promise.all([probeText(document)]);

  console.log(renderTable(outcomes));

  const failed = outcomes.filter((o) => !o.ok);
  if (failed.length > 0) {
    console.error(`\n${failed.length} probe(s) FAILED.`);
    process.exit(1);
  }
  console.log("All probes passed.");
}

main().catch((err) => {
  console.error("Probe script crashed:", err);
  process.exit(1);
});
