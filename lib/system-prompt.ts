import { readFileSync } from "node:fs";
import { join } from "node:path";

export type SystemPromptContext = {
  site_name: string;
  prefix: string;
  design_system_version: string;
  design_system_updated?: string;
  design_system_html_full_file: string;
  brand_voice_content: string;
  site_pages_tree: string;
  site_menus_current: string;
  homepage_id: string;
  templates_list: string;
  session_recent_pages: string;
};

const TEMPLATE_PATH = join(
  process.cwd(),
  "docs",
  "SYSTEM_PROMPT_v1.md",
);

let cachedTemplate: string | null = null;

function loadTemplate(): string {
  if (cachedTemplate !== null) return cachedTemplate;
  cachedTemplate = readFileSync(TEMPLATE_PATH, "utf-8");
  return cachedTemplate;
}

export function buildSystemPrompt(ctx: SystemPromptContext): string {
  const template = loadTemplate();
  return template
    .replaceAll("{{site_name}}", ctx.site_name)
    .replaceAll("{{prefix}}", ctx.prefix)
    .replaceAll("{{design_system_version}}", ctx.design_system_version)
    .replaceAll(
      "{{design_system_updated}}",
      ctx.design_system_updated ?? "n/a",
    )
    .replaceAll(
      "{{design_system_html_full_file}}",
      ctx.design_system_html_full_file,
    )
    .replaceAll("{{brand_voice_content}}", ctx.brand_voice_content)
    .replaceAll("{{site_pages_tree}}", ctx.site_pages_tree)
    .replaceAll("{{site_menus_current}}", ctx.site_menus_current)
    .replaceAll("{{homepage_id}}", ctx.homepage_id)
    .replaceAll("{{templates_list}}", ctx.templates_list)
    .replaceAll("{{session_recent_pages}}", ctx.session_recent_pages);
}

// Week 2 interim: site_context table stays empty, so brand voice, pages
// tree, menus, etc. reuse the LeadSource defaults for every site. Only the
// identity fields (name, prefix, DS version) come from the site record.
// When Stage 2 lands, the defaults will be overridable per-site via a
// site_context row.
export const LEADSOURCE_BRAND_VOICE_DEFAULT = `Outcome-led. Bold statements. No hedging. Lead with what the product does, not what's broken in the world. Say the thing everyone's thinking but nobody writes on their website. Keep it short. Make it sound like a real person said it. If it sounds like an AI or a committee wrote it, rewrite it.

Six voice rules:
1. Outcomes first — lead with the result, not the problem
2. Bold statements — "We tell you exactly." Full stop.
3. Short sentences
4. Say the real thing — if everyone's thinking it, say it
5. Honest about limits — "Works with most forms" not "every form"
6. Never salesy — no exclamation marks, no "Amazing!", no pressure

Power phrases to use: "Stop guessing. Start knowing.", "We tell you exactly.", "Where your best clients are coming from.", "Add the code. We do the rest.", "No BS."

Never say: "Every form", "100% accurate", "Leverage/Utilise/Seamlessly", "Powerful/Robust/Comprehensive", passive voice like "data is captured"`;

export type SiteIdentity = {
  site_name: string;
  prefix: string;
  design_system_version: string;
};

export function buildSystemPromptForSite(site: SiteIdentity): string {
  return buildSystemPrompt({
    site_name: site.site_name,
    prefix: site.prefix,
    design_system_version: site.design_system_version,
    design_system_updated: "n/a (Week 2)",
    design_system_html_full_file: "",
    brand_voice_content: LEADSOURCE_BRAND_VOICE_DEFAULT,
    site_pages_tree: "[]",
    site_menus_current: "{}",
    homepage_id: "null",
    templates_list: "[]",
    session_recent_pages: "[]",
  });
}
