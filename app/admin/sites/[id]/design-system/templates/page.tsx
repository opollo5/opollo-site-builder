"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmActionModal } from "@/components/ConfirmActionModal";
import { TemplateFormModal, type TemplateFormMode } from "@/components/TemplateFormModal";
import { TemplatesTable } from "@/components/TemplatesTable";
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

export default function DesignSystemTemplatesPage() {
  const { versions, refetch: refetchLayout } = useDesignSystemLayout();
  const search = useSearchParams();
  const dsParam = search.get("ds");
  const selectedDs = useMemo(
    () => resolveSelectedDesignSystem(versions, dsParam),
    [versions, dsParam],
  );

  const [state, setState] = useState<LoadState>({ status: "idle" });
  const [formMode, setFormMode] = useState<TemplateFormMode | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DesignTemplate | null>(null);

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
            `Failed to load templates (HTTP ${res.status}).`,
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

  const availableComponentNames =
    state.status === "ready" ? state.components.map((c) => c.name) : [];

  if (!selectedDs) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No design system selected. Create a draft from the Versions tab
          first.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Templates</h1>
          <p className="text-sm text-muted-foreground">
            Page-type templates on design system v{selectedDs.version} (
            {selectedDs.status}).
          </p>
        </div>
        <Button
          onClick={() => setFormMode({ kind: "create" })}
          disabled={state.status !== "ready" && state.status !== "error"}
        >
          New template
        </Button>
      </div>

      <div className="mt-6">
        {state.status === "loading" && (
          <div className="rounded-md border p-8 text-center">
            <p className="text-sm text-muted-foreground">Loading templates…</p>
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
          <TemplatesTable
            templates={state.templates}
            onEdit={(t) => setFormMode({ kind: "edit", template: t })}
            onDelete={(t) => setDeleteTarget(t)}
          />
        )}
      </div>

      {formMode && (
        <TemplateFormModal
          open
          mode={formMode}
          designSystemId={selectedDs.id}
          availableComponentNames={availableComponentNames}
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
          title={`Delete template "${deleteTarget.page_type}/${deleteTarget.name}"?`}
          description={
            "This removes the template. Pages that reference it by template_id will keep working — templates are a snapshot at page-generation time."
          }
          confirmLabel="Delete template"
          confirmVariant="destructive"
          endpoint={`/api/design-systems/${selectedDs.id}/templates/${deleteTarget.id}`}
          request={{
            method: "DELETE",
            searchParams: {
              expected_version_lock: deleteTarget.version_lock,
            },
          }}
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
