"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmActionModal } from "@/components/ConfirmActionModal";
import { CreateDesignSystemModal } from "@/components/CreateDesignSystemModal";
import { DesignSystemsTable } from "@/components/DesignSystemsTable";
import { useDesignSystemLayout } from "@/components/design-system-context";
import type { DesignSystem } from "@/lib/design-systems";

type ActionTarget =
  | { kind: "activate"; ds: DesignSystem }
  | { kind: "archive"; ds: DesignSystem }
  | null;

export default function DesignSystemVersionsPage() {
  const { site, versions, refetch } = useDesignSystemLayout();
  const [createOpen, setCreateOpen] = useState(false);
  const [action, setAction] = useState<ActionTarget>(null);

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Versions</h1>
          <p className="text-sm text-muted-foreground">
            One version is active at a time. Edit draft versions before
            activating — activation is atomic and archives the previous active
            version.
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
        onSuccess={() => {
          refetch();
        }}
      />

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
              ? `This will archive the currently-active version. The site will have no active design system until another version is activated.`
              : `Archive this draft. It won't be available to activate afterwards.`
          }
          confirmLabel="Archive"
          confirmVariant="destructive"
          endpoint={`/api/design-systems/${action.ds.id}/archive`}
          request={{
            method: "POST",
            body: { expected_version_lock: action.ds.version_lock },
          }}
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
            refetch();
          }}
        />
      )}
    </>
  );
}
