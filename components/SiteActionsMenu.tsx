"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import { toastSuccess } from "@/lib/toast-success";
import { ConfirmActionModal } from "@/components/ConfirmActionModal";
import { NavIcon } from "@/components/ui/nav-icon";
import { translateTestConnectionErrorCode } from "@/lib/error-translations";

// AUTH-FOUNDATION P2.3 + Spec 01 — per-row dropdown for /admin/sites.
// Final menu order (top → bottom):
//
//   1. Edit                  → /admin/sites/[id]/edit
//   2. Test Connection       → POST /api/sites/[id]/test-connection
//   3. (divider)
//   4. Archive               → DELETE /api/sites/[id]    (soft-archive)
//   5. Delete                → DELETE /api/sites/[id]/purge  (super_admin only)
//
// The "Clone DS (soon)" disabled stub from the AUTH-FOUNDATION P2.3
// implementation has been removed entirely — there was never a
// controller, plan doc, or follow-up slice; orphaned UI per the spec.
//
// Test Connection runs inline (no confirm modal). Toast on result.
// Delete is the only confirmed action and renders only when canDelete
// is true (server-derived from session role per the layout's pattern).

type MenuContextType = {
  openMenuId: string | null;
  setOpenMenuId: (id: string | null) => void;
};

const MenuContext = createContext<MenuContextType | undefined>(undefined);

function useMenuContext() {
  const context = useContext(MenuContext);
  if (!context) {
    throw new Error("useMenuContext must be used within MenuProvider");
  }
  return context;
}

export function MenuProvider({ children }: { children: ReactNode }) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    }

    if (openMenuId) {
      document.addEventListener("click", handleClickOutside);
      return () => document.removeEventListener("click", handleClickOutside);
    }
  }, [openMenuId]);

  return (
    <MenuContext.Provider value={{ openMenuId, setOpenMenuId }}>
      <div ref={menuRef}>{children}</div>
    </MenuContext.Provider>
  );
}

export function SiteActionsMenu({
  siteId,
  name,
  canDelete = false,
}: {
  siteId: string;
  name: string;
  wpUrl?: string;
  /**
   * Spec 01 §3.2 — gate the Delete (purge) item on super_admin. Defaults
   * to false so non-Sites-list surfaces (the per-site detail page's
   * action menu, etc.) get the safe behaviour automatically.
   */
  canDelete?: boolean;
}) {
  const router = useRouter();
  const { openMenuId, setOpenMenuId } = useMenuContext();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [testing, setTesting] = useState(false);

  const menuId = `site-actions-${siteId}`;
  const isOpen = openMenuId === menuId;

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpenMenuId(isOpen ? null : menuId);
  };

  const closeMenu = () => setOpenMenuId(null);

  async function handleTestConnection() {
    if (testing) return;
    setTesting(true);
    closeMenu();
    try {
      const res = await fetch(
        `/api/sites/${encodeURIComponent(siteId)}/test-connection`,
        { method: "POST" },
      );
      const payload = (await res.json().catch(() => null)) as
        | { ok: true }
        | { ok: false; errorCode?: string }
        | null;
      if (payload && payload.ok === true) {
        toastSuccess("Connection healthy");
        // Refresh the row so the "Last tested" cell updates from the
        // freshly written timestamp.
        router.refresh();
        return;
      }
      const code =
        payload && payload.ok === false
          ? (payload.errorCode ?? "WP_ERROR")
          : "WP_ERROR";
      toast.error(translateTestConnectionErrorCode(code));
    } catch (err) {
      toast.error(
        translateTestConnectionErrorCode("REST_UNREACHABLE"),
        {
          description:
            err instanceof Error ? err.message : String(err),
        },
      );
    } finally {
      setTesting(false);
    }
  }

  return (
    <>
      <div className="relative inline-block">
        <button
          onClick={handleToggle}
          className="rounded px-2 py-1 text-muted-foreground hover:bg-muted"
          aria-label={`Actions for ${name}`}
          data-testid="site-actions-summary"
          disabled={testing}
        >
          {testing ? (
            <NavIcon name="sync" size={16} className="animate-spin" />
          ) : (
            "⋯"
          )}
        </button>

        {isOpen && (
          <div className="absolute right-0 z-10 mt-1 w-48 rounded-md border bg-background shadow-md">
            <button
              type="button"
              className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                router.push(`/admin/sites/${encodeURIComponent(siteId)}/edit`);
                closeMenu();
              }}
              data-testid="site-edit-action"
            >
              Edit
            </button>
            <button
              type="button"
              className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void handleTestConnection();
              }}
              data-testid="site-test-connection-action"
            >
              Test Connection
            </button>
            <div
              role="separator"
              aria-hidden="true"
              className="my-1 h-px bg-border"
            />
            <button
              type="button"
              className="w-full px-3 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setArchiveOpen(true);
                closeMenu();
              }}
              data-testid="site-archive-action"
            >
              Archive
            </button>
            {canDelete && (
              <button
                type="button"
                className="w-full px-3 py-1.5 text-left text-sm text-destructive hover:bg-destructive/10"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDeleteOpen(true);
                  closeMenu();
                }}
                data-testid="site-delete-action"
              >
                Delete
              </button>
            )}
          </div>
        )}
      </div>

      {archiveOpen && (
        <ConfirmActionModal
          open
          title={`Archive "${name}"?`}
          description="The site will be hidden from the list; its prefix is freed for reuse. Active generation batches are not cancelled automatically."
          confirmLabel="Archive"
          confirmVariant="destructive"
          endpoint={`/api/sites/${encodeURIComponent(siteId)}`}
          request={{ method: "DELETE", searchParams: {} }}
          onClose={() => setArchiveOpen(false)}
          onSuccess={() => {
            setArchiveOpen(false);
            router.refresh();
          }}
        />
      )}

      {deleteOpen && (
        <ConfirmActionModal
          open
          title="Delete site permanently?"
          description={`Permanently delete ${name}? This removes the site, all its briefs, posts, and credentials. This cannot be undone.`}
          confirmLabel="Delete permanently"
          confirmVariant="destructive"
          endpoint={`/api/sites/${encodeURIComponent(siteId)}/purge`}
          request={{ method: "DELETE", searchParams: {} }}
          onClose={() => setDeleteOpen(false)}
          onSuccess={() => {
            setDeleteOpen(false);
            toastSuccess("Site deleted permanently");
            router.refresh();
          }}
        />
      )}
    </>
  );
}
