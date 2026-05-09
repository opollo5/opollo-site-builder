#!/usr/bin/env tsx
/**
 * scripts/probes/bundle-social.ts
 *
 * LAYER 7 — Live diagnostic probe for bundle.social.
 *
 * Run on demand against real credentials when an integration regression
 * lands. Output is a markdown report ready to paste into a support
 * ticket or incident doc. Per the live diagnostic protocol in
 * CLAUDE.md, completing this probe is step 1 of 6 before any agent
 * may claim "third-party bug" against bundle.social.
 *
 * Usage (from a shell with env loaded):
 *   npx tsx scripts/probes/bundle-social.ts [--platform=linkedin_personal] [--redirect=https://...]
 *
 * Required env (read but never printed):
 *   BUNDLE_SOCIAL_API
 *   BUNDLE_SOCIAL_TEAMID
 *
 * What this exercises:
 *   - socialAccountCreatePortalLink with each platform individually
 *   - the empty-platforms[] fallback (all configured types)
 *   - LinkedIn personal+company combo (the dedup case)
 *   - redirectUrl variants (with vs without query string)
 *
 * Output: a markdown table of (platform, request body, response url,
 * has_token, status). Errors render with status code + redacted body
 * so the file is safe to attach to a ticket.
 */

import { Bundlesocial, ApiError } from "bundlesocial";

type Outcome = {
  case: string;
  request: { socialAccountTypes: string[]; redirectUrl: string };
  ok: boolean;
  responseUrl?: string;
  hasToken?: boolean;
  status?: number;
  errorMessage?: string;
};

function getArg(name: string, fallback: string): string {
  const m = process.argv.find((a) => a.startsWith(`--${name}=`));
  return m ? m.split("=", 2)[1] ?? fallback : fallback;
}

async function probe(
  client: Bundlesocial,
  teamId: string,
  caseName: string,
  socialAccountTypes: Array<"LINKEDIN" | "FACEBOOK" | "TWITTER" | "GOOGLE_BUSINESS">,
  redirectUrl: string,
): Promise<Outcome> {
  const request = { socialAccountTypes, redirectUrl };
  try {
    const res = await client.socialAccount.socialAccountCreatePortalLink({
      requestBody: { teamId, redirectUrl, socialAccountTypes },
    });
    const url = res?.url ?? "";
    let hasToken = false;
    try {
      const u = new URL(url);
      hasToken = u.search.length > 0;
    } catch {
      hasToken = false;
    }
    return { case: caseName, request, ok: true, responseUrl: url, hasToken };
  } catch (err) {
    if (err instanceof ApiError) {
      return {
        case: caseName,
        request,
        ok: false,
        status: err.status,
        // Stringify err.body but truncate to 240 chars so a leaked token
        // (if any) gets clipped in support tickets.
        errorMessage: String(err.body ?? err.message).slice(0, 240),
      };
    }
    return {
      case: caseName,
      request,
      ok: false,
      errorMessage: err instanceof Error ? err.message.slice(0, 240) : String(err),
    };
  }
}

function renderMarkdown(outcomes: Outcome[]): string {
  const lines: string[] = [];
  lines.push("# bundle.social probe report");
  lines.push("");
  lines.push(`Run at: ${new Date().toISOString()}`);
  lines.push("");
  lines.push(
    "| # | Case | Types | redirectUrl | OK | Has token | Status | Notes |",
  );
  lines.push(
    "|---|---|---|---|---|---|---|---|",
  );
  outcomes.forEach((o, i) => {
    const types = o.request.socialAccountTypes.join(",") || "(empty)";
    const redirect = o.request.redirectUrl;
    const ok = o.ok ? "✅" : "❌";
    const tok = o.hasToken == null ? "—" : o.hasToken ? "yes" : "no";
    const status = o.status?.toString() ?? "—";
    const notes = o.ok
      ? o.hasToken
        ? "URL contains query string"
        : "URL has no query string — likely whitelist mismatch"
      : (o.errorMessage ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
    lines.push(
      `| ${i + 1} | ${o.case} | ${types} | ${redirect} | ${ok} | ${tok} | ${status} | ${notes} |`,
    );
  });
  lines.push("");
  lines.push("## Diagnostic checks");
  lines.push("");
  const teamPrefix = (process.env.BUNDLE_SOCIAL_TEAMID ?? "").slice(0, 8) || "(unset)";
  lines.push(`- BUNDLE_SOCIAL_TEAMID prefix: \`${teamPrefix}…\``);
  lines.push(
    `- BUNDLE_SOCIAL_API set: ${process.env.BUNDLE_SOCIAL_API ? "yes" : "no"}`,
  );
  lines.push(
    `- All cases returned URL without token: ${
      outcomes.every((o) => o.ok && o.hasToken === false) ? "YES — likely redirect domain not whitelisted in bundle.social team settings" : "no"
    }`,
  );
  return lines.join("\n");
}

async function main(): Promise<void> {
  const apiKey = process.env.BUNDLE_SOCIAL_API;
  const teamId = process.env.BUNDLE_SOCIAL_TEAMID;
  if (!apiKey) {
    console.error("BUNDLE_SOCIAL_API is not set. Aborting.");
    process.exit(2);
  }
  if (!teamId) {
    console.error("BUNDLE_SOCIAL_TEAMID is not set. Aborting.");
    process.exit(2);
  }

  const client = new Bundlesocial(apiKey);
  const redirect = getArg(
    "redirect",
    "https://opollo-site-builder.vercel.app/api/platform/social/connections/callback?company_id=00000000-0000-0000-0000-000000000000",
  );

  const outcomes: Outcome[] = [];
  outcomes.push(await probe(client, teamId, "linkedin only", ["LINKEDIN"], redirect));
  outcomes.push(await probe(client, teamId, "facebook only", ["FACEBOOK"], redirect));
  outcomes.push(await probe(client, teamId, "twitter only", ["TWITTER"], redirect));
  outcomes.push(
    await probe(client, teamId, "google business only", ["GOOGLE_BUSINESS"], redirect),
  );
  outcomes.push(
    await probe(
      client,
      teamId,
      "all four (deduped)",
      ["LINKEDIN", "FACEBOOK", "TWITTER", "GOOGLE_BUSINESS"],
      redirect,
    ),
  );
  outcomes.push(
    await probe(
      client,
      teamId,
      "linkedin x2 (must dedupe)",
      ["LINKEDIN", "LINKEDIN"],
      redirect,
    ),
  );
  outcomes.push(
    await probe(client, teamId, "redirect without query string", ["LINKEDIN"], redirect.split("?")[0]!),
  );

  const md = renderMarkdown(outcomes);
  process.stdout.write(md + "\n");
}

main().catch((err) => {
  console.error("probe failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
