import Link from "next/link";

import { Button } from "@/components/ui/button";
import { H1, H3, Lead } from "@/components/ui/typography";

// DESIGN-SYSTEM-OVERHAUL PR 8 — Appearance panel for copy_existing
// sites. Pure read-only summary of sites.extracted_design +
// sites.extracted_css_classes from the PR 7 wizard. Kadence sync is
// intentionally absent — copy_existing sites use the host theme's
// styling and we don't push our palette over it.

type ExtractedDesign = {
  colors?: {
    primary?: string | null;
    secondary?: string | null;
    accent?: string | null;
    background?: string | null;
    text?: string | null;
  };
  fonts?: { heading?: string | null; body?: string | null };
  layout_density?: string | null;
  visual_tone?: string | null;
  screenshot_url?: string | null;
  source_pages?: string[];
};

type ExtractedCssClasses = {
  container?: string | null;
  headings?: { h1?: string | null; h2?: string | null; h3?: string | null };
  button?: string | null;
  card?: string | null;
};

function isExtractedDesign(value: unknown): value is ExtractedDesign {
  return !!value && typeof value === "object";
}

function isExtractedClasses(value: unknown): value is ExtractedCssClasses {
  return !!value && typeof value === "object";
}

export function ExtractedProfilePanel({
  siteId,
  siteName,
  siteUrl,
  extractedDesign,
  extractedClasses,
}: {
  siteId: string;
  siteName: string;
  siteUrl: string;
  extractedDesign: unknown;
  extractedClasses: unknown;
}) {
  const design = isExtractedDesign(extractedDesign) ? extractedDesign : null;
  const classes = isExtractedClasses(extractedClasses) ? extractedClasses : null;
  const hasProfile = design !== null;

  return (
    <div data-testid="extracted-profile-panel" className="mt-6 space-y-6">
      <header>
        <H1>{siteName}</H1>
        <Lead className="mt-1">
          Appearance — design extracted from{" "}
          <a
            href={siteUrl}
            target="_blank"
            rel="noreferrer"
            className="underline-offset-2 hover:underline"
          >
            {siteUrl}
          </a>
        </Lead>
      </header>

      {!hasProfile ? (
        <section
          className="rounded-md border border-dashed bg-muted/20 p-6 text-sm"
          data-testid="extracted-profile-empty"
        >
          <p className="font-medium">
            We haven&apos;t extracted a design profile for this site yet.
          </p>
          <p className="mt-1 text-muted-foreground">
            Run the extraction so generated content can match the existing
            theme.
          </p>
          <Button asChild className="mt-4">
            <Link href={`/admin/sites/${siteId}/setup/extract`}>
              Set up your design profile →
            </Link>
          </Button>
        </section>
      ) : (
        <>
          <section className="rounded-md border bg-background p-5">
            <H3>Design profile</H3>
            <div className="mt-3 grid gap-6 md:grid-cols-2">
              <div>
                <h4 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
                  Colours
                </h4>
                <ul className="mt-2 space-y-1 text-sm">
                  {(["primary", "secondary", "accent", "background", "text"] as const).map(
                    (key) => {
                      const value = design.colors?.[key] ?? null;
                      return (
                        <li
                          key={key}
                          className="flex items-center gap-3 capitalize"
                        >
                          <span
                            className="h-5 w-5 shrink-0 rounded border"
                            style={{ backgroundColor: value ?? "transparent" }}
                            aria-hidden
                          />
                          <span className="w-24 text-muted-foreground">{key}</span>
                          <code className="font-mono text-sm">
                            {value ?? "—"}
                          </code>
                        </li>
                      );
                    },
                  )}
                </ul>

                <h4 className="mt-4 text-sm font-medium uppercase tracking-wide text-muted-foreground">
                  Fonts
                </h4>
                <ul className="mt-2 space-y-1 text-sm">
                  {(["heading", "body"] as const).map((key) => {
                    const value = design.fonts?.[key] ?? null;
                    return (
                      <li key={key} className="flex items-center gap-3 capitalize">
                        <span className="w-24 text-muted-foreground">{key}</span>
                        <span style={{ fontFamily: value ?? undefined }}>
                          {value ?? "(theme default)"}
                        </span>
                      </li>
                    );
                  })}
                </ul>

                <h4 className="mt-4 text-sm font-medium uppercase tracking-wide text-muted-foreground">
                  Tone
                </h4>
                <p className="mt-1 text-sm">
                  {design.layout_density ?? "medium"} ·{" "}
                  {design.visual_tone ?? "Neutral"}
                </p>
              </div>

              <div>
                {design.screenshot_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={design.screenshot_url}
                    alt={`${siteName} homepage screenshot`}
                    className="max-h-72 w-full rounded border object-contain"
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No screenshot captured.
                  </p>
                )}
                {design.source_pages && design.source_pages.length > 0 && (
                  <p className="mt-3 text-sm text-muted-foreground">
                    Source pages:{" "}
                    {design.source_pages.map((p, i) => (
                      <span key={p}>
                        {i > 0 && ", "}
                        <a
                          href={p}
                          target="_blank"
                          rel="noreferrer"
                          className="underline-offset-2 hover:underline"
                        >
                          {p}
                        </a>
                      </span>
                    ))}
                  </p>
                )}
              </div>
            </div>
          </section>

          {classes && (
            <section className="rounded-md border bg-background p-5">
              <H3>Detected CSS classes</H3>
              <p className="mt-1 text-sm text-muted-foreground">
                Generated content reuses these class names so it picks up the
                existing theme&apos;s styling without injecting new CSS.
              </p>
              <dl className="mt-3 grid gap-2 text-sm md:grid-cols-2">
                <ClassRow label="Container" value={classes.container ?? null} />
                <ClassRow label="H1" value={classes.headings?.h1 ?? null} />
                <ClassRow label="H2" value={classes.headings?.h2 ?? null} />
                <ClassRow label="H3" value={classes.headings?.h3 ?? null} />
                <ClassRow label="Button" value={classes.button ?? null} />
                <ClassRow label="Card" value={classes.card ?? null} />
              </dl>
            </section>
          )}

          <div className="flex justify-end">
            <Button asChild variant="outline">
              <Link href={`/admin/sites/${siteId}/setup/extract`}>
                Re-extract design profile
              </Link>
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function ClassRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-center justify-between rounded border bg-muted/20 px-3 py-1.5">
      <span className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <code className="font-mono text-sm">{value ?? "(none detected)"}</code>
    </div>
  );
}
