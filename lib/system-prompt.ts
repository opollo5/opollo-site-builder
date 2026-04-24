import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getActiveDesignSystem,
  type DesignSystem,
} from "@/lib/design-systems";
import { listComponents, type DesignComponent } from "@/lib/components";
import { listTemplates, type DesignTemplate } from "@/lib/templates";
import { renderRegistryBlock } from "@/lib/design-system-prompt";
import { logger } from "@/lib/logger";

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

/**
 * Identity fields needed to build a system prompt for a site.
 *
 * `id` is optional for backwards compatibility with hard-coded fallback
 * callers (e.g. the module-init LeadSource prompt in app/api/chat/route.ts).
 *
 * When `id` is present AND FEATURE_DESIGN_SYSTEM_V2 is enabled AND the site
 * has an active design_systems row, `buildSystemPromptForSite` takes the
 * new registry path: queries the M1 data layer and injects a structured
 * component/template/tokens summary into the prompt.
 *
 * Otherwise — no id, flag off, or no active DS — it takes the legacy path,
 * which produces the same output as before M1d: empty design_system_html
 * blob plus the baked-in defaults.
 */
export type SiteIdentity = {
  site_name: string;
  prefix: string;
  design_system_version: string;
  id?: string;
};

// ---------------------------------------------------------------------------
// Feature flag — single source of truth. Treats "true" and "1" as on.
// Everything else (unset, "false", "0", other strings) is off.
// ---------------------------------------------------------------------------

export function isDesignSystemV2Enabled(): boolean {
  const raw = process.env.FEATURE_DESIGN_SYSTEM_V2;
  return raw === "true" || raw === "1";
}

// ---------------------------------------------------------------------------
// Registry loader — the one place in M1d that hits Supabase.
//
// Returns null if the site has no active design system, so callers can fall
// back to the legacy path without caring why. Throws ONLY for genuinely
// unexpected errors — the underlying lib returns ApiResponse envelopes for
// the known failure modes and we translate those to null + log.
// ---------------------------------------------------------------------------

// TODO(M3): consider site-keyed LRU with 5-min TTL around loadActiveRegistry().
// Expected to matter when batch generator makes ~40 consecutive reads per site.
export async function loadActiveRegistry(
  site_id: string,
): Promise<{
  ds: DesignSystem;
  components: DesignComponent[];
  templates: DesignTemplate[];
} | null> {
  const dsRes = await getActiveDesignSystem(site_id);
  if (!dsRes.ok) {
    logger.error("system_prompt.load_active_ds_failed", {
      site_id,
      error: dsRes.error,
    });
    return null;
  }
  if (dsRes.data === null) return null;

  const ds = dsRes.data;
  const [compRes, tmplRes] = await Promise.all([
    listComponents(ds.id),
    listTemplates(ds.id),
  ]);

  if (!compRes.ok) {
    logger.error("system_prompt.load_components_failed", {
      site_id,
      design_system_id: ds.id,
      error: compRes.error,
    });
    return null;
  }
  if (!tmplRes.ok) {
    logger.error("system_prompt.load_templates_failed", {
      site_id,
      design_system_id: ds.id,
      error: tmplRes.error,
    });
    return null;
  }

  return { ds, components: compRes.data, templates: tmplRes.data };
}

// ---------------------------------------------------------------------------
// Main builder. Async as of M1d — see SiteIdentity JSDoc for the path
// selection logic.
// ---------------------------------------------------------------------------

export async function buildSystemPromptForSite(
  site: SiteIdentity,
): Promise<string> {
  const {
    design_system_html_full_file,
    design_system_version,
    design_system_updated,
  } = await resolveDesignSystemSlot(site);

  return buildSystemPrompt({
    site_name: site.site_name,
    prefix: site.prefix,
    design_system_version,
    design_system_updated,
    design_system_html_full_file,
    brand_voice_content: LEADSOURCE_BRAND_VOICE_DEFAULT,
    site_pages_tree: "[]",
    site_menus_current: "{}",
    homepage_id: "null",
    templates_list: "[]",
    session_recent_pages: "[]",
  });
}

// Picks which content fills {{design_system_html_full_file}} and how the
// version / updated fields are labelled. Kept private — the path-selection
// logic is an implementation detail of buildSystemPromptForSite.
async function resolveDesignSystemSlot(site: SiteIdentity): Promise<{
  design_system_html_full_file: string;
  design_system_version: string;
  design_system_updated: string;
}> {
  const legacy = {
    design_system_html_full_file: "",
    design_system_version: site.design_system_version,
    design_system_updated: "n/a (Week 2)",
  };

  if (!isDesignSystemV2Enabled() || !site.id) {
    return legacy;
  }

  const registry = await loadActiveRegistry(site.id);
  if (!registry) {
    // Flag is on but we have no active DS (or a transient read failure).
    // An active-DS miss usually means someone forgot to activate a seeded
    // design system; logger.error routes to both stdout and Axiom so
    // operators see it in the same place as all other structured events.
    logger.error("system_prompt.resolve_design_system_slot_failed", {
      site_id: site.id,
      site_name: site.site_name,
      fallback: "legacy_html_blob",
    });
    return legacy;
  }

  const block = renderRegistryBlock({
    site_name: site.site_name,
    prefix: site.prefix,
    ds: registry.ds,
    components: registry.components,
    templates: registry.templates,
  });

  return {
    design_system_html_full_file: block,
    design_system_version: String(registry.ds.version),
    design_system_updated: registry.ds.activated_at ?? registry.ds.created_at,
  };
}
