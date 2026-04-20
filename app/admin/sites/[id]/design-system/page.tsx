"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmActionModal } from "@/components/ConfirmActionModal";
import { CreateDesignSystemModal } from "@/components/CreateDesignSystemModal";
import { DesignSystemsTable } from "@/components/DesignSystemsTable";
import type { DesignSystem } from "@/lib/design-systems";

// Site-summary shape used for the breadcrumb + header. Narrower than
// SiteRecord — we only need what the UI displays.
type SiteSummary = {
  id: string;
  name: string;
  prefix: string;
};

type LoadState =
  | { status: "loading" }
  | { status: "ready"; site: SiteSummary; designSystems: DesignSystem[] }
  | { status: "error"; message: string };

type ActionTarget =
  | { kind: "activate"; ds: DesignSystem }
  | { kind: "archive"; ds: DesignSystem }
  | null;

export default function DesignSystemVersionsPage({
  params,
}: {
  params: { id: string };
}) {
  const siteId = params.id;
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [createOpen, setCreateOpen] = useState(false);
  const [action, setAction] = useState<ActionTarget>(null);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const [siteRes, dsRes] = await Promise.all([
        fetch(`/api/sites/${siteId}`, { cache: "no-store" }),
        fetch(`/api/sites/${siteId}/design-systems`, { cache: "no-store" }),
      ]);
      const [sitePayload, dsPayload] = await Promise.all([
        siteRes.json().catch(() => null),
        dsRes.json().catch(() => null),
      ]);

      if (!siteRes.ok || !sitePayload?.ok) {
        setState({
          status: "error",
          message:
            sitePayload?.error?.message ??
            `Failed to load site (HTTP ${siteRes.status}).`,
        });
        return;
      }
      if (!dsRes.ok || !dsPayload?.ok) {
        setState({
          status: "error",
          message:
            dsPayload?.error?.message ??
            `Failed to load design systems (HTTP ${dsRes.status}).`,
        });
        return;
      }

      const site = sitePayload.data?.site as SiteSummary | undefined;
      if (!site) {
        setState({ status: "error", message: "Site payload missing." });
        return;
      }

      setState({
        status: "ready",
        site: { id: site.id, name: site.name, prefix: site.prefix },
        designSystems: (dsPayload.data ?? []) as DesignSystem[],
      });
    } catch (err) {
      setState({
        status: "error",
        message: `Network error: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    }
  }, [siteId]);

  useEffect(() => {
    void load();
  }, [load]);

  const siteName = state.status === "ready" ? state.site.name : null;

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-muted-foreground">
            <Link href="/admin/sites" className="hover:underline">
              Sites
            </Link>
            <span className="mx-1">/</span>
            <span>{siteName ?? "…"}</span>
          </div>
          <h1 className="mt-1 text-xl font-semibold">Design system</h1>
          <p className="text-sm text-muted-foreground">
            Versions attached to this site. Exactly one can be active at a time.
          </p>
        </div>
        <Button
          onClick={() => setCreateOpen(true)}
          disabled={state.status !== "ready"}
        >
          New draft
        </Button>
      </div>

      <div className="mt-6">
        {state.status === "loading" && (
          <div className="rounded-md border p-8 text-center">
            <p className="text-sm text-muted-foreground">
              Loading design systems…
            </p>
          </div>
        )}

        {state.status === "error" && (
          <div
            className="flex items-center justify-between rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
            role="alert"
          >
            <span>{state.message}</span>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        )}

        {state.status === "ready" && (
          <DesignSystemsTable
            designSystems={state.designSystems}
            onActivate={(ds) => setAction({ kind: "activate", ds })}
            onArchive={(ds) => setAction({ kind: "archive", ds })}
          />
        )}
      </div>

      {state.status === "ready" && (
        <CreateDesignSystemModal
          open={createOpen}
          siteId={state.site.id}
          onClose={() => setCreateOpen(false)}
          onSuccess={() => {
            void load();
          }}
        />
      )}

      {action?.kind === "activate" && (
        <ConfirmActionModal
          open
          title={`Activate v${action.ds.version}?`}
          description={
            "This will archive the currently-active version for this site and promote v" +
            action.ds.version +
            " to active."
          }
          confirmLabel="Activate"
          endpoint={`/api/design-systems/${action.ds.id}/activate`}
          body={{ expected_version_lock: action.ds.version_lock }}
          onClose={() => setAction(null)}
          onSuccess={() => {
            setAction(null);
            void load();
          }}
        />
      )}

      {action?.kind === "archive" && (
        <ConfirmActionModal
          open
          title={`Archive v${action.ds.version}?`}
          description={
            action.ds.status === "active"
              ? `This will archive the currently-active version. The site will have no active design system until another version is activated.`
              : `Archive this draft. It won't be available to activate afterwards.`
          }
          confirmLabel="Archive"
          confirmVariant="destructive"
          endpoint={`/api/design-systems/${action.ds.id}/archive`}
          body={{ expected_version_lock: action.ds.version_lock }}
          warningsAccessor={(data) => {
            if (
              data &&
              typeof data === "object" &&
              "warnings" in data &&
              Array.isArray((data as { warnings: unknown }).warnings)
            ) {
              return (data as { warnings: string[] }).warnings;
            }
            return undefined;
          }}
          onClose={() => setAction(null)}
          onSuccess={() => {
            void load();
            // Don't clear action state here — if warnings were returned, the
            // modal stays open to show them, and the operator closes it
            // themselves via its Close button.
          }}
        />
      )}
    </>
  );
}
