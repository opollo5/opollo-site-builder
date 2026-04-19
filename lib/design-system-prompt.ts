import type { DesignSystem } from "@/lib/design-systems";
import type { DesignComponent } from "@/lib/components";
import type { DesignTemplate } from "@/lib/templates";

// ---------------------------------------------------------------------------
// Pure render helpers for the design-system section of the system prompt.
//
// No database access — callers pass in already-fetched rows. This keeps the
// render layer testable without Supabase and lets loadActiveRegistry() in
// lib/system-prompt.ts do all the I/O in one place.
//
// Output is compact Markdown. The brief (§3.7) is explicit that component
// HTML templates are NOT inlined here — they'd blow the context window at
// 40-page batch scale. The generator (M3) fetches component HTML on demand
// via getComponent(id).
// ---------------------------------------------------------------------------

export function renderComponentSummary(c: DesignComponent): string {
  const head = c.variant
    ? `- ${c.name} [${c.category}/${c.variant}]`
    : `- ${c.name} [${c.category}]`;

  const purpose = (c.usage_notes ?? "").trim().split("\n")[0] ?? "";
  const purposeLine = purpose.length > 0 ? ` — ${purpose}` : "";

  const required = extractRequiredFields(c.content_schema);
  const fieldsLine =
    required.length > 0 ? `\n  Required fields: ${required.join(", ")}` : "";

  return `${head}${purposeLine}${fieldsLine}`;
}

export function renderTemplateSummary(t: DesignTemplate): string {
  const components = Array.isArray(t.composition)
    ? t.composition.map((entry) => String(entry.component ?? "?"))
    : [];
  const defaultTag = t.is_default ? " (default)" : "";
  const compositionLine =
    components.length > 0
      ? `\n  Composition: ${components.join(" → ")}`
      : "";
  return `- ${t.name} [${t.page_type}]${defaultTag}${compositionLine}`;
}

export function renderRegistryBlock(args: {
  site_name: string;
  prefix: string;
  ds: DesignSystem;
  components: DesignComponent[];
  templates: DesignTemplate[];
}): string {
  const { site_name, prefix, ds, components, templates } = args;
  const sortedComponents = [...components].sort((a, b) => {
    const cat = a.category.localeCompare(b.category);
    return cat !== 0 ? cat : a.name.localeCompare(b.name);
  });
  const sortedTemplates = [...templates].sort((a, b) => {
    const pt = a.page_type.localeCompare(b.page_type);
    return pt !== 0 ? pt : a.name.localeCompare(b.name);
  });

  const componentsSection = sortedComponents.length === 0
    ? "(none registered)"
    : sortedComponents.map(renderComponentSummary).join("\n");

  const templatesSection = sortedTemplates.length === 0
    ? "(none registered)"
    : sortedTemplates.map(renderTemplateSummary).join("\n");

  return [
    `# Site: ${site_name}`,
    `# Design system version: ${ds.version}`,
    `# Scope prefix: ${prefix}-`,
    ``,
    `## Available components (${sortedComponents.length} total)`,
    componentsSection,
    ``,
    `## Page templates (${sortedTemplates.length} total)`,
    templatesSection,
    ``,
    `## Design tokens`,
    ds.tokens_css.trim(),
    ``,
    `## Hard constraints`,
    `- Use only components listed above. Never invent class names outside the registry.`,
    `- Wrap every generated page in <div class="${prefix}-scope">...</div>.`,
    `- When you need a component's HTML template, request it by name — don't guess the markup.`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Private: extract the top-level `required` array from a JSON Schema. Tolerant
// of schemas that omit `required` or embed it under nested `properties`.
// ---------------------------------------------------------------------------

function extractRequiredFields(schema: unknown): string[] {
  if (!schema || typeof schema !== "object") return [];
  const required = (schema as { required?: unknown }).required;
  if (!Array.isArray(required)) return [];
  return required.filter((f): f is string => typeof f === "string");
}
