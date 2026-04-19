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
