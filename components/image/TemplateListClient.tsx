"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { ImageTemplate } from "@/lib/image/templates";
import { TEMPLATE_SCHEMA_VERSION } from "@/lib/image/template-model";

const RATIO_LABELS: Record<string, string> = {
  "1x1": "1:1 Square",
  "4x5": "4:5 Portrait",
  "9x16": "9:16 Story",
  "16x9": "16:9 Landscape",
  "4x3": "4:3 Landscape (GBP)",
};

interface Props {
  companyId: string;
  templates: ImageTemplate[];
}

export function TemplateListClient({ templates }: Props) {
  const byRatio = templates.reduce<Record<string, ImageTemplate[]>>((acc, t) => {
    (acc[t.aspectRatio] ??= []).push(t);
    return acc;
  }, {});

  return (
    <div className="space-y-8">
      {(["1x1", "4x5", "16x9", "9x16", "4x3"] as const).map((ratio) => {
        const group = byRatio[ratio] ?? [];
        return (
          <section key={ratio}>
            <h2 className="mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              {RATIO_LABELS[ratio]}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.map((tpl) => (
                <TemplateCard key={tpl.id} template={tpl} />
              ))}
              {group.length === 0 && (
                <p className="text-sm text-muted-foreground">No templates yet.</p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function TemplateCard({ template }: { template: ImageTemplate }) {
  const isGlobal = template.companyId === null;
  const isV2 = template.schemaVersion === TEMPLATE_SCHEMA_VERSION;

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium text-sm">{template.name}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isGlobal ? "Global default" : "Custom"} · v{template.version}
            {isV2 && <span className="ml-1.5 rounded-full bg-primary/10 text-primary px-1.5 py-0.5">v2</span>}
          </p>
        </div>
        {isGlobal && (
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            Global
          </span>
        )}
      </div>

      {isV2 ? (
        // v2 layer-based template: definition is a Template object, not TemplateDefinition.
        // Show canvas dimensions and layer count instead of v1 composition fields.
        <V2TemplateDetails template={template} />
      ) : (
        // v1 fixed-zone template: safe to read compositionType / logoPosition.
        <V1TemplateDetails template={template} />
      )}

      <Link href={`/company/image/templates/${template.id}/edit`} className="block">
        <Button variant="outline" size="sm" className="w-full">
          Edit
        </Button>
      </Link>
    </div>
  );
}

function V1TemplateDetails({ template }: { template: ImageTemplate }) {
  const def = template.definition;
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      <div className="flex justify-between">
        <span>Composition</span>
        <span className="font-medium text-foreground">
          {typeof def.compositionType === "string" ? def.compositionType.replace("_", " ") : "—"}
        </span>
      </div>
      <div className="flex justify-between">
        <span>Font</span>
        <span className="font-medium text-foreground">{def.fontFamily ?? "Inter"}</span>
      </div>
      <div className="flex justify-between">
        <span>Logo</span>
        <span className="font-medium text-foreground">
          {typeof def.logoPosition === "string" ? def.logoPosition.replace(/-/g, " ") : "—"}
        </span>
      </div>
    </div>
  );
}

function V2TemplateDetails({ template }: { template: ImageTemplate }) {
  const t = template.resolvedTemplate;
  if (!t) return null;
  return (
    <div className="space-y-1 text-xs text-muted-foreground">
      <div className="flex justify-between">
        <span>Canvas</span>
        <span className="font-medium text-foreground">{t.width} × {t.height}</span>
      </div>
      <div className="flex justify-between">
        <span>Layers</span>
        <span className="font-medium text-foreground">{t.layers.length}</span>
      </div>
      <div className="flex justify-between">
        <span>Variants</span>
        <span className="font-medium text-foreground">{t.variants.length || "None"}</span>
      </div>
    </div>
  );
}
