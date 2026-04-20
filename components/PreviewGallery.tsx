import type { DesignComponent } from "@/lib/components";
import type { DesignTemplate } from "@/lib/templates";

// Read-only preview. Renders each component's raw HTML template + CSS in
// <pre> blocks along with its content_schema fields; each template gets a
// composition chain arrow-diagram. No live rendering of the component
// output — that waits for M3's Handlebars-compatible renderer.

function fieldsList(schema: unknown): Array<{
  name: string;
  type: string;
  required: boolean;
  constraint?: string;
}> {
  if (!schema || typeof schema !== "object") return [];
  const s = schema as {
    properties?: Record<string, unknown>;
    required?: unknown;
  };
  const required = Array.isArray(s.required)
    ? s.required.filter((x): x is string => typeof x === "string")
    : [];
  const props = s.properties ?? {};
  return Object.entries(props).map(([name, def]) => {
    const d = (def ?? {}) as {
      type?: unknown;
      maxLength?: unknown;
      enum?: unknown;
      format?: unknown;
    };
    const constraints: string[] = [];
    if (typeof d.maxLength === "number") constraints.push(`max ${d.maxLength}`);
    if (Array.isArray(d.enum)) constraints.push(`enum ${d.enum.length}`);
    if (typeof d.format === "string") constraints.push(`format ${d.format}`);
    return {
      name,
      type: typeof d.type === "string" ? d.type : "any",
      required: required.includes(name),
      constraint: constraints.length > 0 ? constraints.join(", ") : undefined,
    };
  });
}

function compositionChain(t: DesignTemplate): string[] {
  if (!Array.isArray(t.composition)) return [];
  return t.composition.map((c) =>
    typeof c === "object" && c !== null
      ? String((c as { component?: string }).component ?? "?")
      : "?",
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function CodeBlock({ text }: { text: string }) {
  return (
    <pre className="max-h-80 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
      {text.length > 0 ? text : <em className="text-muted-foreground">(empty)</em>}
    </pre>
  );
}

export function PreviewGallery({
  components,
  templates,
}: {
  components: DesignComponent[];
  templates: DesignTemplate[];
}) {
  const sortedComponents = [...components].sort((a, b) => {
    const cat = a.category.localeCompare(b.category);
    return cat !== 0 ? cat : a.name.localeCompare(b.name);
  });
  const sortedTemplates = [...templates].sort((a, b) => {
    const pt = a.page_type.localeCompare(b.page_type);
    return pt !== 0 ? pt : a.name.localeCompare(b.name);
  });

  return (
    <div className="space-y-10">
      <section>
        <h2 className="mb-4 text-sm font-medium">
          Components ({sortedComponents.length})
        </h2>
        {sortedComponents.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            No components in this design system yet.
          </div>
        ) : (
          <div className="space-y-6">
            {sortedComponents.map((c) => {
              const fields = fieldsList(c.content_schema);
              return (
                <article key={c.id} className="rounded-md border p-4">
                  <header className="flex items-center justify-between border-b pb-3">
                    <div>
                      <div className="text-sm font-medium">{c.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {c.variant ? `${c.category} · ${c.variant}` : c.category}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      v<span className="font-mono">{c.version_lock}</span>
                    </div>
                  </header>

                  <div className="grid gap-4 pt-4 lg:grid-cols-2">
                    <Block label="HTML template">
                      <CodeBlock text={c.html_template} />
                    </Block>
                    <Block label="CSS">
                      <CodeBlock text={c.css} />
                    </Block>
                  </div>

                  <div className="mt-4">
                    <Block label={`Fields (${fields.length})`}>
                      {fields.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          content_schema has no properties.
                        </p>
                      ) : (
                        <ul className="mt-1 divide-y rounded-md border text-sm">
                          {fields.map((f) => (
                            <li
                              key={f.name}
                              className="flex items-center justify-between px-3 py-2"
                            >
                              <span className="font-mono text-xs">
                                {f.name}
                                {f.required && (
                                  <span className="ml-1 text-destructive">*</span>
                                )}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {f.type}
                                {f.constraint ? ` · ${f.constraint}` : ""}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </Block>
                  </div>

                  {c.usage_notes && (
                    <div className="mt-4">
                      <Block label="Usage notes">
                        <p className="text-sm text-muted-foreground">
                          {c.usage_notes}
                        </p>
                      </Block>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-4 text-sm font-medium">
          Templates ({sortedTemplates.length})
        </h2>
        {sortedTemplates.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            No templates in this design system yet.
          </div>
        ) : (
          <div className="space-y-4">
            {sortedTemplates.map((t) => {
              const chain = compositionChain(t);
              return (
                <article key={t.id} className="rounded-md border p-4">
                  <header className="flex items-center justify-between border-b pb-3">
                    <div>
                      <div className="text-sm font-medium">{t.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {t.page_type}
                        {t.is_default ? " · default" : ""}
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      v<span className="font-mono">{t.version_lock}</span>
                    </div>
                  </header>
                  <div className="pt-3">
                    <Block label={`Composition (${chain.length})`}>
                      {chain.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          (empty composition)
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          <span className="font-mono">{chain.join(" → ")}</span>
                        </p>
                      )}
                    </Block>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
