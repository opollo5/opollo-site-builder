import { Button } from "@/components/ui/button";
import type { DesignComponent } from "@/lib/components";

function countRequiredFields(schema: unknown): number {
  if (!schema || typeof schema !== "object") return 0;
  const required = (schema as { required?: unknown }).required;
  if (!Array.isArray(required)) return 0;
  return required.filter((s) => typeof s === "string").length;
}

function variantLabel(c: DesignComponent): string {
  return c.variant ? `${c.category} · ${c.variant}` : c.category;
}

export function ComponentsGrid({
  components,
  onEdit,
  onDelete,
}: {
  components: DesignComponent[];
  onEdit: (c: DesignComponent) => void;
  onDelete: (c: DesignComponent) => void;
}) {
  if (components.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No components in this design system yet. Click &ldquo;New component&rdquo; to add
          one.
        </p>
      </div>
    );
  }

  const grouped = components.reduce<Record<string, DesignComponent[]>>(
    (acc, c) => {
      (acc[c.category] ??= []).push(c);
      return acc;
    },
    {},
  );
  const categories = Object.keys(grouped).sort();

  return (
    <div className="space-y-8">
      {categories.map((cat) => (
        <section key={cat}>
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {cat}
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {grouped[cat]
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((c) => (
                <li
                  key={c.id}
                  className="flex flex-col gap-2 rounded-md border p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-medium">{c.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {variantLabel(c)}
                      </div>
                    </div>
                    <div className="shrink-0 text-xs text-muted-foreground">
                      v<span className="font-mono">{c.version_lock}</span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {countRequiredFields(c.content_schema)} required field
                    {countRequiredFields(c.content_schema) === 1 ? "" : "s"}
                  </p>
                  <div className="mt-auto flex items-center justify-end gap-2 pt-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onDelete(c)}
                    >
                      Delete
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onEdit(c)}
                    >
                      Edit
                    </Button>
                  </div>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
