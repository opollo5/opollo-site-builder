"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { ImageTemplate } from "@/lib/image/templates";

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
  const byRatio = Object.groupBy(templates, (t) => t.aspectRatio);

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
  const def = template.definition;
  const isGlobal = template.companyId === null;

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium text-sm">{template.name}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isGlobal ? "Global default" : "Custom"} · v{template.version}
          </p>
        </div>
        {isGlobal && (
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            Global
          </span>
        )}
      </div>

      <div className="space-y-1 text-xs text-muted-foreground">
        <div className="flex justify-between">
          <span>Composition</span>
          <span className="font-medium text-foreground">{def.compositionType.replace("_", " ")}</span>
        </div>
        <div className="flex justify-between">
          <span>Font</span>
          <span className="font-medium text-foreground">{def.fontFamily ?? "Inter"}</span>
        </div>
        <div className="flex justify-between">
          <span>Logo</span>
          <span className="font-medium text-foreground">{def.logoPosition.replace(/-/g, " ")}</span>
        </div>
      </div>

      <Link href={`/company/image/templates/${template.id}/edit`} className="block">
        <Button variant="outline" size="sm" className="w-full">
          Edit
        </Button>
      </Link>
    </div>
  );
}
