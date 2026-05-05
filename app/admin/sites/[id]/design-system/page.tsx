"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { ConfirmActionModal } from "@/components/ConfirmActionModal";
import { CreateDesignSystemModal } from "@/components/CreateDesignSystemModal";
import { DesignSystemsTable } from "@/components/DesignSystemsTable";
import { Button } from "@/components/ui/button";
import { CardSkeleton } from "@/components/ui/skeleton";
import { H1, H3, Lead } from "@/components/ui/typography";
import { useDesignSystemLayout } from "@/components/design-system-context";
import type { DesignSystem } from "@/lib/design-systems";

// DESIGN-SYSTEM-OVERHAUL PR 9.
//
// The audit (PR 0) confirmed the four-tab UI is NOT load-bearing on
// generation: no brief runner / batch worker / blog pipeline reads
// from design_system_versions. The tabs are an isolated edit-and-store
// surface for power users.
//
// Default landing on /design-system now shows a simplified mode-aware
// summary. The full tab UI sits behind ?advanced=1 (the layout shows
// the tab nav only when that flag is set or when the operator is on
// a non-Versions sub-tab).

type SiteMode = "copy_existing" | "new_design" | null;

type SiteModeRow = {
  site_mode: SiteMode;
  extracted_design: unknown;
  design_tokens: unknown;
  design_direction_status: string | null;
};

type ActionTarget =
  | { kind: "activate"; ds: DesignSystem }
  | { kind: "archive"; ds: DesignSystem }
  | null;

export default function DesignSystemIndexPage() {
  const { site, versions, refetch } = useDesignSystemLayout();
  const search = useSearchParams();
  const advanced = search.get("advanced") === "1";

  const [modeRow, setModeRow] = useState<SiteModeRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [action, setAction] = useState<ActionTarget>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/sites/${site.id}/mode`, {
          cache: "no-store",
        });
        const payload = (await res.json().catch(() => null)) as
          | { ok: true; data: SiteModeRow }
          | { ok: false }
          | null;
        if (cancelled) return;
        if (res.ok && payload?.ok) setModeRow(payload.data);
      } catch {
        // Soft-fail — summary card falls back to a generic frame.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [site.id]);

  if (advanced) {
    return (
      <>
        <div className="flex items-center justify-between">
          <div>
            <H1>Versions (advanced)</H1>
            <p className="text-sm text-muted-foreground">
              One version is active at a time. Edit drafts before activating —
              activation is atomic and archives the previous active version.
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)}>New draft</Button>
        </div>

        <div className="mt-6">
          <DesignSystemsTable
            designSystems={versions}
            siteId={site.id}
            onActivate={(ds) => setAction({ kind: "activate", ds })}
            onArchive={(ds) => setAction({ kind: "archive", ds })}
          />
        </div>

        <CreateDesignSystemModal
          open={createOpen}
          siteId={site.id}
          onClose={() => setCreateOpen(false)}
          onSuccess={() => refetch()}
        />

        {action?.kind === "activate" && (
          <ConfirmActionModal
            open
            title={`Activate v${action.ds.version}?`}
            description={`This will archive the currently-active version for this site and promote v${action.ds.version} to active.`}
            confirmLabel="Activate"
            endpoint={`/api/design-systems/${action.ds.id}/activate`}
            request={{
              method: "POST",
              body: { expected_version_lock: action.ds.version_lock },
            }}
            onClose={() => setAction(null)}
            onSuccess={() => {
              setAction(null);
              refetch();
            }}
          />
        )}

        {action?.kind === "archive" && (
          <ConfirmActionModal
            open
            title={`Archive v${action.ds.version}?`}
            description={
              action.ds.status === "active"
                ? "This will archive the currently-active version. The site will have no active design system until another version is activated."
                : "Archive this draft. It won't be available to activate afterwards."
            }
            confirmLabel="Archive"
            confirmVariant="destructive"
            endpoint={`/api/design-systems/${action.ds.id}/archive`}
            request={{
              method: "POST",
              body: { expected_version_lock: action.ds.version_lock },
            }}
            onClose={() => setAction(null)}
            onSuccess={() => refetch()}
          />
        )}
      </>
    );
  }

  return (
    <>
      <H1>Design system</H1>
      <Lead className="mt-1">
        How {site.name} is styled when we generate content.
      </Lead>

      {modeRow === null ? (
        <CardSkeleton lines={3} />
      ) : (
        <ModeSummaryCard siteId={site.id} modeRow={modeRow} />
      )}

      <details className="mt-8 rounded-md border bg-muted/20 p-4 text-sm">
        <summary className="cursor-pointer font-medium">
          Advanced settings
        </summary>
        <p className="mt-2 text-muted-foreground">
          Power-user surface for editing raw design tokens, components, and
          templates. Most operators don&apos;t need to touch these — the
          summary above and the appearance panel cover the day-to-day flow.
        </p>
        <Link
          href={`/admin/sites/${site.id}/design-system?advanced=1`}
          className="mt-3 inline-block text-sm font-medium underline-offset-2 hover:underline"
          data-testid="design-system-advanced-link"
        >
          Show versions, components, templates →
        </Link>
      </details>
    </>
  );
}

function ModeSummaryCard({
  siteId,
  modeRow,
}: {
  siteId: string;
  modeRow: SiteModeRow;
}) {
  if (modeRow.site_mode === null) {
    return (
      <section
        className="mt-6 rounded-md border border-dashed bg-muted/20 p-6 text-sm"
        data-testid="design-system-not-onboarded"
      >
        <p className="font-medium">This site hasn&apos;t been onboarded yet.</p>
        <p className="mt-1 text-muted-foreground">
          Pick whether we&apos;re uploading content to an existing WordPress
          theme or building a fresh design.
        </p>
        <Button asChild className="mt-4">
          <Link href={`/admin/sites/${siteId}/onboarding`}>
            Set up now →
          </Link>
        </Button>
      </section>
    );
  }

  if (modeRow.site_mode === "copy_existing") {
    const hasProfile = !!modeRow.extracted_design;
    return (
      <section
        className="mt-6 rounded-md border bg-background p-5"
        data-testid="design-system-copy-existing"
      >
        <H3>Copy existing site</H3>
        <p className="mt-1 text-sm text-muted-foreground">
          Generated content uses the existing theme&apos;s class names and
          colours.{" "}
          {hasProfile
            ? "Design profile extracted; review on the appearance panel or re-extract from the setup."
            : "No profile extracted yet — run extraction to capture the theme."}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href={`/admin/sites/${siteId}/appearance`}>
              View appearance
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/admin/sites/${siteId}/setup/extract`}>
              {hasProfile ? "Re-extract design" : "Run extraction"}
            </Link>
          </Button>
        </div>
      </section>
    );
  }

  // new_design
  const approved = modeRow.design_direction_status === "approved";
  return (
    <section
      className="mt-6 rounded-md border bg-background p-5"
      data-testid="design-system-new-design"
    >
      <H3>New design</H3>
      <p className="mt-1 text-sm text-muted-foreground">
        {approved
          ? "Design direction approved. Tokens, concepts, and tone of voice are wired into generation."
          : "Design setup hasn't finished yet — open the wizard to pick a direction and tone of voice."}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button asChild variant="outline">
          <Link href={`/admin/sites/${siteId}/setup`}>
            {approved ? "Re-open setup" : "Continue setup"}
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={`/admin/sites/${siteId}/appearance`}>
            View appearance
          </Link>
        </Button>
      </div>
    </section>
  );
}
