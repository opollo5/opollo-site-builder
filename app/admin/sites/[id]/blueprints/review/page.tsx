"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// /admin/sites/[id]/blueprints/review — M16-7.
//
// Operator reviews the SitePlan produced by the site planner (Pass 0+1)
// and approves it to unlock page generation. Approve → status=approved,
// which gates processPageM16 in the brief runner.

type SiteBlueprint = {
  id:           string;
  status:       "draft" | "approved";
  brand_name:   string;
  route_plan:   unknown[];
  nav_items:    unknown[];
  footer_items: unknown[];
  cta_catalogue:unknown[];
  seo_defaults: Record<string, unknown>;
  version_lock: number;
};

type RouteRow = {
  slug:      string;
  page_type: string;
  label:     string;
  ordinal:   number | null;
};

type SharedRow = {
  id:           string;
  content_type: string;
  label:        string;
};

export default function BlueprintReviewPage({
  params,
}: {
  params: { id: string };
}) {
  const router = useRouter();
  const siteId = params.id;

  const [blueprint, setBlueprint] = useState<SiteBlueprint | null>(null);
  const [routes, setRoutes]       = useState<RouteRow[]>([]);
  const [content, setContent]     = useState<SharedRow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [bpRes, routesRes, contentRes] = await Promise.all([
          fetch(`/api/sites/${siteId}/blueprints`),
          fetch(`/api/sites/${siteId}/routes`),
          fetch(`/api/sites/${siteId}/shared-content`),
        ]);

        const bpJson     = await bpRes.json() as { ok: boolean; data: SiteBlueprint | null; error?: { message: string } };
        const routesJson = await routesRes.json() as { ok: boolean; data: RouteRow[] };
        const contentJson = await contentRes.json() as { ok: boolean; data: SharedRow[] };

        if (!bpJson.ok) {
          setError(bpJson.error?.message ?? "Failed to load blueprint.");
          return;
        }
        setBlueprint(bpJson.data);
        if (routesJson.ok)  setRoutes(routesJson.data ?? []);
        if (contentJson.ok) setContent(contentJson.data ?? []);
      } catch {
        setError("Network error — could not load blueprint.");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [siteId]);

  async function handleApprove() {
    if (!blueprint) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/sites/${siteId}/blueprints/${blueprint.id}/approve`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ version_lock: blueprint.version_lock }),
        },
      );
      const json = await res.json() as { ok: boolean; error?: { message: string } };
      if (!json.ok) {
        setError(json.error?.message ?? "Approve failed.");
        return;
      }
      router.push(`/admin/sites/${siteId}`);
    } catch {
      setError("Network error — approve failed.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRevert() {
    if (!blueprint) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/sites/${siteId}/blueprints/${blueprint.id}/revert`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ version_lock: blueprint.version_lock }),
        },
      );
      const json = await res.json() as { ok: boolean; error?: { message: string } };
      if (!json.ok) {
        setError(json.error?.message ?? "Revert failed.");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error — revert failed.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-4xl p-6">
        <p className="text-muted-foreground text-sm">Loading site plan…</p>
      </main>
    );
  }

  if (!blueprint) {
    return (
      <main className="mx-auto max-w-4xl p-6">
        <p className="text-muted-foreground text-sm">
          No site plan found. Run the site planner from the brief run page first.
        </p>
      </main>
    );
  }

  const isApproved = blueprint.status === "approved";

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Site Plan Review</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review the plan before approving page generation.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={isApproved ? "default" : "secondary"}>
            {isApproved ? "Approved" : "Draft"}
          </Badge>
          {isApproved ? (
            <Button variant="outline" size="sm" disabled={saving} onClick={() => void handleRevert()}>
              Revert to draft
            </Button>
          ) : (
            <Button size="sm" disabled={saving} onClick={() => void handleApprove()}>
              {saving ? "Approving…" : "Approve plan"}
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Brand</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm">{blueprint.brand_name || <span className="text-muted-foreground">—</span>}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Route Plan ({routes.length} pages)</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="p-3 text-left font-medium">Ordinal</th>
                <th className="p-3 text-left font-medium">Slug</th>
                <th className="p-3 text-left font-medium">Type</th>
                <th className="p-3 text-left font-medium">Label</th>
              </tr>
            </thead>
            <tbody>
              {routes.map((r, i) => (
                <tr key={r.slug} className={i % 2 === 0 ? "" : "bg-muted/30"}>
                  <td className="p-3 tabular-nums text-muted-foreground">{r.ordinal ?? i}</td>
                  <td className="p-3 font-mono">{r.slug}</td>
                  <td className="p-3">
                    <Badge variant="outline" className="text-xs">{r.page_type}</Badge>
                  </td>
                  <td className="p-3">{r.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {content.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Shared Content ({content.length} items)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-3 text-left font-medium">Type</th>
                  <th className="p-3 text-left font-medium">Label</th>
                </tr>
              </thead>
              <tbody>
                {content.map((c, i) => (
                  <tr key={c.id} className={i % 2 === 0 ? "" : "bg-muted/30"}>
                    <td className="p-3">
                      <Badge variant="outline" className="text-xs">{c.content_type}</Badge>
                    </td>
                    <td className="p-3">{c.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <hr className="border-border" />

      <details className="rounded-md border p-3 text-sm">
        <summary className="cursor-pointer font-medium text-muted-foreground">Raw plan JSON</summary>
        <pre className="mt-3 overflow-auto rounded bg-muted p-3 text-xs">
          {JSON.stringify({ nav_items: blueprint.nav_items, footer_items: blueprint.footer_items, cta_catalogue: blueprint.cta_catalogue, seo_defaults: blueprint.seo_defaults }, null, 2)}
        </pre>
      </details>
    </main>
  );
}
