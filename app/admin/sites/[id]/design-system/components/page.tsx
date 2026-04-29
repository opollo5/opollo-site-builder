"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { TableSkeleton } from "@/components/ui/skeleton";
import { H1, Lead } from "@/components/ui/typography";
import { ComponentFormModal, type ComponentFormMode } from "@/components/ComponentFormModal";
import { ComponentsGrid } from "@/components/ComponentsGrid";
import { ConfirmActionModal } from "@/components/ConfirmActionModal";
import {
  resolveSelectedDesignSystem,
  useDesignSystemLayout,
} from "@/components/design-system-context";
import type { DesignComponent } from "@/lib/components";
import type { DesignTemplate } from "@/lib/templates";

type LoadState =
  | { status: "idle" }
  | { status: "loading" }
  | {
      status: "ready";
      components: DesignComponent[];
      templates: DesignTemplate[];
    }
  | { status: "error"; message: string };

export default function DesignSystemComponentsPage() {
  const { versions, refetch: refetchLayout } = useDesignSystemLayout();
  const search = useSearchParams();
  const dsParam = search.get("ds");
  const selectedDs = useMemo(
    () => resolveSelectedDesignSystem(versions, dsParam),
    [versions, dsParam],
  );

  const [state, setState] = useState<LoadState>({ status: "idle" });
  const [formMode, setFormMode] = useState<ComponentFormMode | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DesignComponent | null>(null);

  const load = useCallback(async () => {
    if (!selectedDs) {
      setState({ status: "idle" });
      return;
    }
    setState({ status: "loading" });
    try {
      const res = await fetch(
        `/api/design-systems/${selectedDs.id}/preview`,
        { cache: "no-store" },
      );
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) {
        setState({
          status: "error",
          message:
            payload?.error?.message ??
            `Failed to load components (HTTP ${res.status}).`,
        });
        return;
      }
      setState({
        status: "ready",
        components: (payload.data?.components ?? []) as DesignComponent[],
        templates: (payload.data?.templates ?? []) as DesignTemplate[],
      });
    } catch (err) {
      setState({
        status: "error",
        message: `Network error: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    }
  }, [selectedDs]);

  useEffect(() => {
    void load();
  }, [load]);

  // Before deleting a component, find any templates that reference it by
  // name so the confirm modal can list them for the operator.
  const orphanTemplates = useMemo<DesignTemplate[]>(() => {
    if (!deleteTarget || state.status !== "ready") return [];
    return state.templates.filter((t) =>
      Array.isArray(t.composition)
        ? t.composition.some(
            (entry) =>
              typeof entry === "object" &&
              entry !== null &&
              (entry as { component?: string }).component ===
                deleteTarget.name,
          )
        : false,
    );
  }, [deleteTarget, state]);

  if (!selectedDs) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No design system selected for this site. Create a draft from the
          Versions tab first.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <H1>Components</H1>
          <Lead className="mt-0.5">
            Registered on design system v{selectedDs.version} (
            {selectedDs.status}).
          </Lead>
        </div>
        <Button
          onClick={() => setFormMode({ kind: "create" })}
          disabled={state.status !== "ready" && state.status !== "error"}
        >
          New component
        </Button>
      </div>

      <div className="mt-6">
        {state.status === "loading" && <TableSkeleton rows={5} cols={4} />}

        {state.status === "error" && (
          <Alert
            variant="destructive"
            title="Failed to load components"
            className="items-center justify-between"
          >
            <div className="flex items-center justify-between gap-3">
              <span>{state.message}</span>
              <Button variant="outline" size="sm" onClick={() => void load()}>
                Retry
              </Button>
            </div>
          </Alert>
        )}

        {state.status === "ready" && (
          <ComponentsGrid
            components={state.components}
            onEdit={(c) => setFormMode({ kind: "edit", component: c })}
            onDelete={(c) => setDeleteTarget(c)}
          />
        )}
      </div>

      {formMode && (
        <ComponentFormModal
          open
          mode={formMode}
          designSystemId={selectedDs.id}
          onClose={() => setFormMode(null)}
          onSuccess={() => {
            void load();
            refetchLayout();
          }}
        />
      )}

      {deleteTarget && (
        <ConfirmActionModal
          open
          title={`Delete "${deleteTarget.name}"?`}
          description={
            "This removes the component from the design system. Page templates that reference it by name will be left with unresolvable composition entries."
          }
          confirmLabel="Delete component"
          confirmVariant="destructive"
          endpoint={`/api/design-systems/${selectedDs.id}/components/${deleteTarget.id}`}
          request={{
            method: "DELETE",
            searchParams: {
              expected_version_lock: deleteTarget.version_lock,
            },
          }}
          extraContent={
            orphanTemplates.length > 0 ? (
              <div
                className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm text-yellow-900 dark:text-yellow-200"
                role="status"
              >
                <p className="font-medium">
                  This component is referenced by {orphanTemplates.length}{" "}
                  template{orphanTemplates.length === 1 ? "" : "s"}:
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {orphanTemplates.map((t) => (
                    <li key={t.id}>
                      {t.page_type}/{t.name}
                    </li>
                  ))}
                </ul>
                <p className="mt-2">
                  Delete anyway, or cancel and rewire the templates first.
                </p>
              </div>
            ) : null
          }
          onClose={() => setDeleteTarget(null)}
          onSuccess={() => {
            setDeleteTarget(null);
            void load();
            refetchLayout();
          }}
        />
      )}
    </>
  );
}
