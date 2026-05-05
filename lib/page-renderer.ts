/**
 * lib/page-renderer.ts
 *
 * M16-6 — renders a PageDocument to an HTML string.
 *
 * Flow:
 *   1. Resolve refs (resolveRefs) — IDs → full objects.
 *   2. For each section in doc.content, call componentRegistry[type][variant].render(props).
 *      Props are merged with resolved refs for that section.
 *   3. Concatenate section HTML strings.
 *
 * Target-aware: preview wraps sections in a minimal HTML shell;
 * wordpress returns bare section fragments (existing Opollo contract).
 *
 * No DB calls. Pure function. Fast. Free.
 */

import { componentRegistry } from "@/lib/component-registry";
import { resolveRefs, type ResolverDeps } from "@/lib/ref-resolver";
import type { PageDocument, RenderTarget } from "@/lib/types/page-document";

// ─── TYPES ────────────────────────────────────────────────────────────────────

export type RenderResult = {
  html:     string;
  warnings: string[];
};

// ─── MAIN ─────────────────────────────────────────────────────────────────────

/**
 * Renders a PageDocument to HTML.
 *
 * @param doc     The page document to render
 * @param deps    Shared content rows + route rows needed by the ref-resolver
 * @param target  'preview' | 'wordpress'
 */
export function renderPageDocument(
  doc:    PageDocument,
  deps:   ResolverDeps,
  target: RenderTarget = "wordpress",
): RenderResult {
  const warnings: string[] = [];
  const resolved = resolveRefs(doc, deps);

  const sectionHtmlParts: string[] = [];

  for (const section of doc.content) {
    const { type, props } = section;
    const sectionId = props.id as string;
    const variant   = props.variant as string | undefined;

    // Look up component
    const componentType = componentRegistry[type];
    if (!componentType) {
      warnings.push(`Unknown component type "${type}" for section ${sectionId} — skipped`);
      continue;
    }
    const componentDef = variant ? componentType[variant] : undefined;
    if (!componentDef) {
      warnings.push(`Unknown variant "${variant}" for component "${type}" — skipped`);
      continue;
    }

    // Merge resolved refs into props
    const sectionRefs    = resolved[sectionId] ?? {};
    const mergedProps: Record<string, unknown> = {
      ...props,
      // Inject resolved objects so render functions can use them directly
      cta:         sectionRefs.cta,
      route:       sectionRefs.route,
      image:       sectionRefs.image,
      testimonial: sectionRefs.testimonial,
      services:    sectionRefs.services,
      faqs:        sectionRefs.faqs,
    };

    let sectionHtml: string;
    try {
      sectionHtml = componentDef.render(mergedProps, target);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Render error for ${type}:${variant ?? ""} section ${sectionId}: ${msg}`);
      continue;
    }

    sectionHtmlParts.push(sectionHtml);
  }

  const innerHtml = sectionHtmlParts.join("\n");

  if (target === "preview") {
    const html = buildPreviewShell(doc, innerHtml);
    return { html, warnings };
  }

  return { html: innerHtml, warnings };
}

// ─── PREVIEW SHELL ────────────────────────────────────────────────────────────

function buildPreviewShell(doc: PageDocument, inner: string): string {
  const title       = esc(doc.root.props.title);
  const description = esc(doc.root.props.description);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <meta name="description" content="${description}">
  <link rel="stylesheet" href="/opollo-components.css">
</head>
<body>
${inner}
</body>
</html>`;
}

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
