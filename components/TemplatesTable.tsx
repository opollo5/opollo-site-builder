import { Button } from "@/components/ui/button";
import type { DesignTemplate } from "@/lib/templates";

function compositionPreview(t: DesignTemplate): string {
  if (!Array.isArray(t.composition)) return "—";
  const names = t.composition.map((c) =>
    typeof c === "object" && c !== null
      ? String((c as { component?: string }).component ?? "?")
      : "?",
  );
  if (names.length === 0) return "(empty)";
  if (names.length <= 3) return names.join(" → ");
  return `${names.slice(0, 3).join(" → ")} → +${names.length - 3} more`;
}

export function TemplatesTable({
  templates,
  onEdit,
  onDelete,
}: {
  templates: DesignTemplate[];
  onEdit: (t: DesignTemplate) => void;
  onDelete: (t: DesignTemplate) => void;
}) {
  if (templates.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No templates in this design system yet. Click &ldquo;New template&rdquo; to add
          one.
        </p>
      </div>
    );
  }

  const sorted = [...templates].sort((a, b) => {
    const pt = a.page_type.localeCompare(b.page_type);
    return pt !== 0 ? pt : a.name.localeCompare(b.name);
  });

  return (
    <div className="overflow-hidden rounded-md border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-medium">Page type</th>
            <th className="px-4 py-2 font-medium">Name</th>
            <th className="px-4 py-2 font-medium">Composition</th>
            <th className="px-4 py-2 font-medium">Default</th>
            <th className="px-4 py-2 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((t) => (
            <tr key={t.id} className="border-b last:border-b-0">
              <td className="px-4 py-3 font-mono text-xs">{t.page_type}</td>
              <td className="px-4 py-3 font-medium">{t.name}</td>
              <td className="px-4 py-3 text-xs text-muted-foreground">
                {compositionPreview(t)}
              </td>
              <td className="px-4 py-3 text-xs text-muted-foreground">
                {t.is_default ? "Yes" : "—"}
              </td>
              <td className="px-4 py-3">
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onDelete(t)}
                  >
                    Delete
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onEdit(t)}
                  >
                    Edit
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
