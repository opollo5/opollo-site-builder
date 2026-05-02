"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Phase 1.5 follow-up — onboarding §7.5 "Try auto-import" button.
//
// Pastes a URL + picks a destination Site Builder site → POST
// /api/optimiser/pages/import → file a brief + brief_run, link to the
// brief run progress page so the operator can watch the import.
//
// Lives in PagesStep alongside "Add page manually" — same UI shape but
// runs the import pipeline instead of just registering a landing page.

type SiteOption = {
  id: string;
  name: string;
  wp_url: string;
  status: string;
};

export function TryAutoImportPanel({
  clientId,
}: {
  clientId: string;
}) {
  const [sites, setSites] = useState<SiteOption[]>([]);
  const [loadingSites, setLoadingSites] = useState(true);
  const [siteId, setSiteId] = useState<string>("");
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<
    | { tone: "ok"; brief_id: string; brief_run_id: string; site_id: string }
    | { tone: "err"; message: string }
    | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/sites/list", { cache: "no-store" });
        const json = await res.json();
        if (cancelled) return;
        if (json.ok) {
          const list: SiteOption[] = (json.data?.sites ?? []).map(
            (s: SiteOption) => ({
              id: s.id,
              name: s.name,
              wp_url: s.wp_url,
              status: s.status,
            }),
          );
          setSites(list);
          if (list.length > 0) setSiteId(list[0].id);
        }
      } finally {
        if (!cancelled) setLoadingSites(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit() {
    if (!url || !siteId) return;
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch("/api/optimiser/pages/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, client_id: clientId, site_id: siteId }),
      });
      const json = await res.json();
      if (json.ok) {
        setResult({
          tone: "ok",
          brief_id: json.data.brief_id as string,
          brief_run_id: json.data.brief_run_id as string,
          site_id: siteId,
        });
        setUrl("");
      } else {
        setResult({
          tone: "err",
          message: json.error?.message ?? "Import failed.",
        });
      }
    } catch (err) {
      setResult({
        tone: "err",
        message: err instanceof Error ? err.message : "Import failed.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-dashed border-border bg-muted/40 p-4">
      <div className="space-y-1">
        <p className="text-sm font-medium">
          Try auto-import (§7.5)
        </p>
        <p className="text-sm text-muted-foreground">
          Fetch the live URL, file an import-mode brief, and reverse-engineer
          the page into the Site Builder. The brief run runs through
          M12/M13 in full_page mode using the destination site&apos;s
          conventions. Use the brief-run progress link to watch + approve
          the result.
        </p>
      </div>
      <div className="grid gap-2 md:grid-cols-[1fr_240px_auto]">
        <Input
          placeholder="https://www.example.com/landing-page"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={submitting}
        />
        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={siteId}
          onChange={(e) => setSiteId(e.target.value)}
          disabled={submitting || loadingSites || sites.length === 0}
        >
          {loadingSites && <option>Loading sites…</option>}
          {!loadingSites && sites.length === 0 && (
            <option value="">No Site Builder sites available</option>
          )}
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.status})
            </option>
          ))}
        </select>
        <Button
          onClick={submit}
          disabled={submitting || !url || !siteId}
        >
          {submitting ? "Importing…" : "Try auto-import"}
        </Button>
      </div>
      {result?.tone === "ok" && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Import filed.{" "}
          <a
            href={`/optimiser/imports/${result.brief_id}`}
            className="underline-offset-4 hover:underline"
          >
            Open side-by-side review →
          </a>
        </div>
      )}
      {result?.tone === "err" && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          {result.message}
        </div>
      )}
      {sites.length === 0 && !loadingSites && (
        <p className="text-sm text-muted-foreground">
          No Site Builder sites are registered yet — register one under{" "}
          <a
            href="/admin/sites"
            className="underline-offset-4 hover:underline"
          >
            /admin/sites
          </a>{" "}
          before running an import.
        </p>
      )}
    </div>
  );
}
