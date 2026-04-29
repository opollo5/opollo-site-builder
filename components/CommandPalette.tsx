"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  FileText,
  Globe,
  Image as ImageIcon,
  KeyRound,
  PenSquare,
  Plus,
  Settings,
  Sparkles,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";

// ---------------------------------------------------------------------------
// C-1 — Global ⌘K command palette.
//
// Mounted once in app/admin/layout.tsx. Listens for ⌘K / Ctrl+K
// anywhere in the admin tree and opens a cmdk dialog with:
//
//   • Navigate — every admin surface (Sites, Batches, Images, Users,
//     Settings).
//   • Sites — lazy-fetched list of all sites (loads on first open).
//     Click navigates to /admin/sites/[id].
//   • Recent — last 5 sites the operator visited (persisted in
//     localStorage; survives across sessions).
//   • Quick actions — "Add a site" opens AddSiteModal via the
//     /admin/sites surface.
//
// Microcopy follows the polish brief: action-oriented, Opollo-
// specific, no AI tropes ("Jump to Sites" not "Quick navigation").
// ---------------------------------------------------------------------------

const RECENT_SITES_LS_KEY = "opollo:command-palette:recent-sites";
const RECENT_LIMIT = 5;

interface RecentSite {
  id: string;
  name: string;
}

interface SiteItem {
  id: string;
  name: string;
  prefix: string;
  status: string;
}

interface NavigateItem {
  label: string;
  description?: string;
  href: string;
  icon: LucideIcon;
  keywords?: string;
}

const NAVIGATE_ITEMS: readonly NavigateItem[] = [
  {
    label: "Sites",
    description: "Manage WordPress sites",
    href: "/admin/sites",
    icon: Globe,
    keywords: "sites wordpress wp manage",
  },
  {
    label: "Post a blog",
    description: "Start a new post — single or bulk",
    href: "/admin/posts/new",
    icon: PenSquare,
    keywords: "post blog new draft compose write bulk upload",
  },
  {
    label: "Batches",
    description: "Generation runs",
    href: "/admin/batches",
    icon: Workflow,
    keywords: "batches jobs generation runs",
  },
  {
    label: "Images",
    description: "Image library",
    href: "/admin/images",
    icon: ImageIcon,
    keywords: "images library media uploads",
  },
  {
    label: "Users",
    description: "Operator access",
    href: "/admin/users",
    icon: Users,
    keywords: "users team operators access roles",
  },
  {
    label: "Account security",
    description: "Change your password",
    href: "/account/security",
    icon: KeyRound,
    keywords: "account security password 2fa profile",
  },
];

function readRecentSites(): RecentSite[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_SITES_LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (r): r is RecentSite =>
          typeof r === "object" &&
          r !== null &&
          typeof (r as RecentSite).id === "string" &&
          typeof (r as RecentSite).name === "string",
      )
      .slice(0, RECENT_LIMIT);
  } catch {
    return [];
  }
}

function writeRecentSite(site: RecentSite) {
  if (typeof window === "undefined") return;
  const current = readRecentSites();
  const next = [
    site,
    ...current.filter((r) => r.id !== site.id),
  ].slice(0, RECENT_LIMIT);
  try {
    window.localStorage.setItem(RECENT_SITES_LS_KEY, JSON.stringify(next));
  } catch {
    // localStorage full / disabled — silently no-op.
  }
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sites, setSites] = useState<SiteItem[] | null>(null);
  const [sitesError, setSitesError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentSite[]>([]);

  // ⌘K / Ctrl+K opens (or closes) the palette from anywhere in the
  // admin tree. Mac uses ⌘ via metaKey; Windows / Linux use Ctrl.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Refresh the recent list every time the palette opens (cheap;
  // localStorage read).
  useEffect(() => {
    if (!open) return;
    setRecent(readRecentSites());
  }, [open]);

  // Lazy-load the site list on first open. Keeps the layout JS bundle
  // light; loads in parallel with the operator typing.
  useEffect(() => {
    if (!open || sites !== null) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/sites/list", { cache: "no-store" });
        if (cancelled) return;
        const payload = (await res.json().catch(() => null)) as
          | { ok: true; data: { sites: SiteItem[] } }
          | { ok: false; error: { code: string; message: string } }
          | null;
        if (payload?.ok) {
          setSites(payload.data.sites);
        } else {
          setSitesError(
            payload?.ok === false
              ? payload.error.message
              : `Failed to load sites (HTTP ${res.status}).`,
          );
        }
      } catch (err) {
        if (cancelled) return;
        setSitesError(
          `Network error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, sites]);

  const navigate = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  const navigateToSite = useCallback(
    (site: { id: string; name: string }) => {
      writeRecentSite({ id: site.id, name: site.name });
      navigate(`/admin/sites/${site.id}`);
    },
    [navigate],
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="overflow-hidden p-0">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <Command shouldFilter={true}>
          <CommandInput
            placeholder="Type a command, route, or site name…"
            autoFocus
          />
          <CommandList className="max-h-[420px]">
            <CommandEmpty>
              No matching command, route, or site. Try a different query.
            </CommandEmpty>

            {recent.length > 0 && (
              <CommandGroup heading="Recent sites">
                {recent.map((site) => (
                  <CommandItem
                    key={`recent-${site.id}`}
                    value={`recent ${site.name}`}
                    onSelect={() => navigateToSite(site)}
                  >
                    <Globe aria-hidden className="h-4 w-4 text-muted-foreground" />
                    <span className="truncate">{site.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {recent.length > 0 && <CommandSeparator />}

            <CommandGroup heading="Navigate">
              {NAVIGATE_ITEMS.map((item) => {
                const Icon = item.icon;
                return (
                  <CommandItem
                    key={item.href}
                    value={`${item.label} ${item.keywords ?? ""}`}
                    onSelect={() => navigate(item.href)}
                  >
                    <Icon aria-hidden className="h-4 w-4 text-muted-foreground" />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.description && (
                      <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                        {item.description}
                      </span>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>

            {sites && sites.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading={`Sites (${sites.length})`}>
                  {sites.map((site) => (
                    <CommandItem
                      key={site.id}
                      value={`site ${site.name} ${site.prefix} ${site.status}`}
                      onSelect={() => navigateToSite(site)}
                    >
                      <Globe aria-hidden className="h-4 w-4 text-muted-foreground" />
                      <span className="flex-1 truncate">{site.name}</span>
                      <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                        /{site.prefix}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}

            {sites && sites.length === 0 && (
              <CommandGroup heading="Sites">
                <CommandItem
                  value="add-site"
                  onSelect={() => navigate("/admin/sites")}
                >
                  <Plus aria-hidden className="h-4 w-4 text-muted-foreground" />
                  <span className="flex-1">Add your first site</span>
                </CommandItem>
              </CommandGroup>
            )}

            {sitesError && (
              <CommandGroup heading="Sites">
                <CommandItem disabled value="sites-error">
                  <Sparkles aria-hidden className="h-4 w-4 text-destructive" />
                  <span className="text-destructive">{sitesError}</span>
                </CommandItem>
              </CommandGroup>
            )}

            <CommandSeparator />

            <CommandGroup heading="Settings">
              <CommandItem
                value="settings account-security"
                onSelect={() => navigate("/account/security")}
              >
                <Settings
                  aria-hidden
                  className="h-4 w-4 text-muted-foreground"
                />
                <span>Account security</span>
              </CommandItem>
              <CommandItem
                value="docs help"
                onSelect={() => {
                  setOpen(false);
                  // Eat the link click; CommandItem's onSelect closes
                  // the palette, then we open the docs in a new tab.
                  window.open(
                    "https://github.com/opollo5/opollo-site-builder",
                    "_blank",
                  );
                }}
              >
                <FileText
                  aria-hidden
                  className="h-4 w-4 text-muted-foreground"
                />
                <span className="flex-1">Open docs (GitHub)</span>
                <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                  ↗
                </span>
              </CommandItem>
            </CommandGroup>
          </CommandList>
          <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <kbd className="rounded border bg-muted px-1 font-mono text-[10px]">
                ↑↓
              </kbd>
              navigate
              <kbd className="ml-2 rounded border bg-muted px-1 font-mono text-[10px]">
                ↵
              </kbd>
              select
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border bg-muted px-1 font-mono text-[10px]">
                esc
              </kbd>
              close
            </span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
