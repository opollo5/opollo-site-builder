"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { NavIcon } from "@/components/ui/nav-icon";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { PageShell } from "@/components/ui/page-shell";
import { Skeleton } from "@/components/ui/skeleton";

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

  const breadcrumbSegments = [
    { label: "Admin", href: "/admin/sites" },
    { label: "Sites", href: "/admin/sites" },
    { label: "Site", href: `/admin/sites/${siteId}` },
    { label: "Site plan review" },
  ];

  if (loading) {
    return (
      <PageShell>
        <PageHeader>
          <PageHeader.Breadcrumb segments={breadcrumbSegments} />
          <PageHeader.Title>Site Plan Review</PageHeader.Title>
        </PageHeader>
        <div className="space-y-4">
          <Skeleton className="h-8 w-1/3" />
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </PageShell>
    );
  }

  if (!blueprint) {
    return (
      <PageShell>
        <PageHeader>
          <PageHeader.Breadcrumb segments={breadcrumbSegments} />
          <PageHeader.Title>Site Plan Review</PageHeader.Title>
        </PageHeader>
        <EmptyState
          icon={<NavIcon name="grid" size={20} />}
          iconLabel="No site plan"
          title="No site plan yet"
          body="Run the site planner from the brief run page to generate a plan before approving page generation."
        />
      </PageShell>
    );
  }

  const isApproved = blueprint.status === "approved";

  return (
    <PageShell>
      <PageHeader>
        <PageHeader.Breadcrumb segments={breadcrumbSegments} />
        <PageHeader.Title>Site Plan Review</PageHeader.Title>
        <PageHeader.Subtitle>
          Review the plan before approving page generation.
        </PageHeader.Subtitle>
        <PageHeader.Actions>
          <Badge tone={isApproved ? "success" : "neutral"}>
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
        </PageHeader.Actions>
      </PageHeader>

      <div className="space-y-6">
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
                    <Badge tone="outline" className="text-xs">{r.page_type}</Badge>
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
                      <Badge tone="outline" className="text-xs">{c.content_type}</Badge>
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
      </div>
    </PageShell>
  );
}
