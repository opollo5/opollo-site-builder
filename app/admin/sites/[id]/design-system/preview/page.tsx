"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { PreviewGallery } from "@/components/PreviewGallery";
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

export default function DesignSystemPreviewPage() {
  const { versions } = useDesignSystemLayout();
  const search = useSearchParams();
  const dsParam = search.get("ds");
  const selectedDs = useMemo(
    () => resolveSelectedDesignSystem(versions, dsParam),
    [versions, dsParam],
  );

  const [state, setState] = useState<LoadState>({ status: "idle" });

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
            `Failed to load preview (HTTP ${res.status}).`,
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

  if (!selectedDs) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No design system selected. Create a draft from the Versions tab first.
        </p>
      </div>
    );
  }

  return (
    <>
      <div>
        <h1 className="text-xl font-semibold">Preview</h1>
        <p className="text-sm text-muted-foreground">
          Read-only metadata view of design system v{selectedDs.version} (
          {selectedDs.status}). Live component rendering lands with M3 — this
          page shows raw templates + CSS + field schemas + composition chains.
        </p>
      </div>

      <div className="mt-6">
        {state.status === "loading" && (
          <div className="rounded-md border p-8 text-center">
            <p className="text-sm text-muted-foreground">Loading preview…</p>
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
          <PreviewGallery
            components={state.components}
            templates={state.templates}
          />
        )}
      </div>
    </>
  );
}
