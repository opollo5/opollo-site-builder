"use client";

import Link from "next/link";
import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CardSkeleton } from "@/components/ui/skeleton";
import {
  DesignSystemLayoutContext,
  resolveSelectedDesignSystem,
  type DesignSystemSiteSummary,
} from "@/components/design-system-context";
import { cn } from "@/lib/utils";
import type { DesignSystem } from "@/lib/design-systems";

// Shared shell for every page under /admin/sites/[id]/design-system.
//
// Responsibilities:
//   - load the site summary (for breadcrumb) and the full list of DS
//     versions (for the version selector + child pages via context)
//   - render the version selector dropdown, updating ?ds=<uuid> in the URL
//     on change
//   - render the tab nav for Versions / Components / Templates / Preview,
//     preserving the current ?ds across tabs
//   - provide { site, versions, refetch } via DesignSystemLayoutContext
//
// Children (each page) are responsible for reading ?ds themselves and
// handling the "no active DS" case — a single layout cannot represent
// every page's empty state cleanly.

type LoadState =
  | { status: "loading" }
  | { status: "ready"; site: DesignSystemSiteSummary; versions: DesignSystem[] }
  | { status: "error"; message: string };

const TABS = [
  { key: "versions", label: "Versions", subpath: "" },
  { key: "components", label: "Components", subpath: "/components" },
  { key: "templates", label: "Templates", subpath: "/templates" },
  { key: "preview", label: "Preview", subpath: "/preview" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function currentTab(pathname: string, siteId: string): TabKey {
  const base = `/admin/sites/${siteId}/design-system`;
  const tail = pathname.startsWith(base) ? pathname.slice(base.length) : "";
  if (tail.startsWith("/components")) return "components";
  if (tail.startsWith("/templates")) return "templates";
  if (tail.startsWith("/preview")) return "preview";
  return "versions";
}

export default function DesignSystemLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams<{ id: string }>();
  const siteId = params.id;
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [state, setState] = useState<LoadState>({ status: "loading" });

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

      const site = sitePayload.data?.site as DesignSystemSiteSummary | undefined;
      if (!site) {
        setState({ status: "error", message: "Site payload missing." });
        return;
      }

      setState({
        status: "ready",
        site: { id: site.id, name: site.name, prefix: site.prefix },
        versions: (dsPayload.data ?? []) as DesignSystem[],
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

  const dsParam = search.get("ds");
  const advancedFlag = search.get("advanced") === "1";
  const selectedDs = useMemo(
    () =>
      state.status === "ready"
        ? resolveSelectedDesignSystem(state.versions, dsParam)
        : null,
    [state, dsParam],
  );
  const tab = currentTab(pathname, siteId);
  // DESIGN-SYSTEM-OVERHAUL PR 9 — the four-tab UI is power-user surface
  // (audited as not load-bearing on generation). Show it only when the
  // operator opts in via ?advanced=1 OR they're already deep-linked
  // into a non-Versions tab. Default index page renders the simplified
  // summary instead.
  const showTabs = advancedFlag || tab !== "versions";

  function navigateToDs(newDsId: string) {
    const newParams = new URLSearchParams(search.toString());
    newParams.set("ds", newDsId);
    router.push(`${pathname}?${newParams.toString()}`);
  }

  function tabHref(subpath: string): string {
    const base = `/admin/sites/${siteId}/design-system${subpath}`;
    const params = new URLSearchParams();
    if (selectedDs) params.set("ds", selectedDs.id);
    if (advancedFlag && subpath === "") params.set("advanced", "1");
    const qs = params.toString();
    return qs.length > 0 ? `${base}?${qs}` : base;
  }

  const siteName = state.status === "ready" ? state.site.name : null;

  return (
    <>
      <div className="flex flex-col gap-2 border-b pb-4">
        <div className="flex items-center justify-between gap-4">
          <div className="text-xs text-muted-foreground">
            <Link href="/admin/sites" className="hover:underline">
              Sites
            </Link>
            <span className="mx-1">/</span>
            <span>{siteName ?? "…"}</span>
            <span className="mx-1">/</span>
            <span>Design system</span>
          </div>
          {state.status === "ready" && state.versions.length > 0 && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Version
              <select
                value={selectedDs?.id ?? ""}
                onChange={(e) => navigateToDs(e.target.value)}
                className="rounded-md border bg-background px-2 py-1 text-xs"
              >
                {state.versions
                  .slice()
                  .sort((a, b) => b.version - a.version)
                  .map((v) => (
                    <option key={v.id} value={v.id}>
                      v{v.version} · {v.status}
                    </option>
                  ))}
              </select>
            </label>
          )}
        </div>

        {showTabs && (
          <nav className="flex gap-1 text-sm" data-testid="design-system-tabs">
            {TABS.map((t) => (
              <Link
                key={t.key}
                href={tabHref(t.subpath)}
                className={cn(
                  "rounded-md px-3 py-1.5",
                  tab === t.key
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </Link>
            ))}
          </nav>
        )}
      </div>

      <div className="mt-6">
        {state.status === "loading" && <CardSkeleton lines={3} />}

        {state.status === "error" && (
          <Alert variant="destructive" title="Failed to load design system">
            <div className="flex items-center justify-between gap-3">
              <span>{state.message}</span>
              <Button variant="outline" size="sm" onClick={() => void load()}>
                Retry
              </Button>
            </div>
          </Alert>
        )}

        {state.status === "ready" && (
          <DesignSystemLayoutContext.Provider
            value={{
              site: state.site,
              versions: state.versions,
              refetch: () => void load(),
            }}
          >
            {children}
          </DesignSystemLayoutContext.Provider>
        )}
      </div>
    </>
  );
}
