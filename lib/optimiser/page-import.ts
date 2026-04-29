import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Page import (§7.5) — the bridge between read-only and full-automation
// management modes. Full implementation depends on the Site Builder's
// M12/M13 generation engine supporting `brief_shape = "import"`, which
// is a Phase 1.5 enhancement (§7.5.3).
//
// Until that lands, the optimiser exposes a "manual rebuild" fallback:
// the staff member triggers an import attempt, the engine fetches the
// live URL, and the engine surfaces the source HTML + a brief-template
// for staff to manually rebuild via the existing Site Builder chat.
// Once the rebuild is done, staff can flip the page to full_automation.
// ---------------------------------------------------------------------------

export type ImportPlan = {
  page_id: string;
  url: string;
  /**
   * Whether the Site Builder generation engine supports
   * brief_shape = "import" today. Phase 1: false (always). When the
   * Site Builder ships the import shape, flip this via env or feature
   * flag and the auto path becomes available.
   */
  auto_import_available: boolean;
  /** Suggested brief copy staff can paste into the Site Builder. */
  manual_brief_template: string;
  /** Truncated source HTML preview. */
  source_html_preview: string | null;
  /** TRUE if the live URL was reachable. */
  source_reachable: boolean;
  source_error?: string;
};

const SOURCE_HTML_LIMIT = 8 * 1024;

function isAutoImportAvailable(): boolean {
  // Phase 1: never auto-import. The flag stays false until M12/M13's
  // brief_shape=import lands; then ops flips OPT_AUTO_IMPORT_ENABLED=1
  // and the route becomes the auto path.
  const flag = process.env.OPT_AUTO_IMPORT_ENABLED;
  return flag === "true" || flag === "1";
}

export async function planPageImport(args: {
  clientId: string;
  pageId: string;
}): Promise<ImportPlan> {
  const supabase = getServiceRoleClient();
  const { data: page, error } = await supabase
    .from("opt_landing_pages")
    .select("id, client_id, url, display_name")
    .eq("id", args.pageId)
    .eq("client_id", args.clientId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(`planPageImport: ${error.message}`);
  if (!page) throw new Error(`planPageImport: page not found`);

  const { html, ok, error: fetchErr } = await fetchSource(page.url as string);

  return {
    page_id: page.id as string,
    url: page.url as string,
    auto_import_available: isAutoImportAvailable(),
    manual_brief_template: buildManualBriefTemplate({
      url: page.url as string,
      displayName: (page.display_name as string | null) ?? null,
    }),
    source_html_preview: html ? html.slice(0, SOURCE_HTML_LIMIT) : null,
    source_reachable: ok,
    source_error: fetchErr,
  };
}

async function fetchSource(
  url: string,
): Promise<{ html: string | null; ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": "Opollo-Optimiser/1.0 (+page-import)" },
    });
    if (!res.ok) {
      return {
        html: null,
        ok: false,
        error: `${res.status} ${res.statusText}`,
      };
    }
    const text = await res.text();
    return { html: text, ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("optimiser.page_import.fetch_failed", { url, error: message });
    return { html: null, ok: false, error: message };
  }
}

function buildManualBriefTemplate(args: {
  url: string;
  displayName: string | null;
}): string {
  const name = args.displayName ?? "Imported landing page";
  return [
    `# Manual page import — ${name}`,
    ``,
    `Source URL: ${args.url}`,
    ``,
    `Use this prompt in the Site Builder chat to rebuild the page using the target site's design system. Once the rebuild publishes, return to /optimiser and flip the page to full_automation mode.`,
    ``,
    `> Rebuild this landing page in our existing design system. Match the structure of the source URL above (hero with H1 / subheadline, primary CTA above the fold, trust signals, form, FAQ, footer CTA). Preserve the offer wording verbatim. Use components from the active site_conventions only — no freeform HTML.`,
    ``,
    `When the Site Builder's brief_shape=import lands, this template will be replaced with an automated reverse-engineering pass.`,
  ].join("\n");
}
