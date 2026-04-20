"use client";

import { useCallback, useEffect, useState } from "react";

import { AddSiteModal } from "@/components/AddSiteModal";
import { SitesTable } from "@/components/SitesTable";
import { Button } from "@/components/ui/button";
import type { SiteListItem } from "@/lib/tool-schemas";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; sites: SiteListItem[] }
  | { status: "error"; message: string };

export default function ManageSitesPage() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [modalOpen, setModalOpen] = useState(false);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const res = await fetch("/api/sites/list", { cache: "no-store" });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) {
        setState({
          status: "error",
          message:
            payload?.error?.message ??
            `Failed to load sites (HTTP ${res.status}).`,
        });
        return;
      }
      setState({
        status: "ready",
        sites: (payload.data?.sites ?? []) as SiteListItem[],
      });
    } catch (err) {
      setState({
        status: "error",
        message: `Network error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Manage sites</h1>
          <p className="text-sm text-muted-foreground">
            WordPress sites connected to this builder.
          </p>
        </div>
        <Button onClick={() => setModalOpen(true)}>Add new site</Button>
      </div>

      <div className="mt-6">
        {state.status === "loading" && (
          <div className="rounded-md border p-8 text-center">
            <p className="text-sm text-muted-foreground">Loading sites…</p>
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

        {state.status === "ready" && <SitesTable sites={state.sites} />}
      </div>

      <AddSiteModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSuccess={() => {
          void load();
        }}
      />
    </>
  );
}
