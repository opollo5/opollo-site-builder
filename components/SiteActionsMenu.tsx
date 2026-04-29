"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useState, useRef, useEffect, ReactNode } from "react";

import { ConfirmActionModal } from "@/components/ConfirmActionModal";

// AUTH-FOUNDATION P2.3: the per-row Edit action used to open the
// EditSiteModal (name + wp_url only). It now navigates to
// /admin/sites/[id]/edit, the unified guided form that supports
// credential rotation alongside basics. EditSiteModal.tsx is left in
// place pending a separate cleanup PR once grep confirms no other
// surface imports it.

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
  wpUrl,
}: {
  siteId: string;
  name: string;
  wpUrl: string;
}) {
  const router = useRouter();
  const { openMenuId, setOpenMenuId } = useMenuContext();
  const [archiveOpen, setArchiveOpen] = useState(false);

  const menuId = `site-actions-${siteId}`;
  const isOpen = openMenuId === menuId;

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpenMenuId(isOpen ? null : menuId);
  };

  const handleAction = () => {
    setOpenMenuId(null);
  };

  return (
    <>
      <div className="relative inline-block">
        <button
          onClick={handleToggle}
          className="rounded px-2 py-1 text-muted-foreground hover:bg-muted"
          aria-label={`Actions for ${name}`}
          data-testid="site-actions-summary"
        >
          ⋯
        </button>

        {isOpen && (
          <div className="absolute right-0 z-10 mt-1 w-44 rounded-md border bg-background shadow-md">
            <button
              type="button"
              className="w-full px-3 py-1.5 text-left text-xs hover:bg-muted"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                router.push(`/admin/sites/${encodeURIComponent(siteId)}/edit`);
                handleAction();
              }}
              data-testid="site-edit-action"
            >
              Edit
            </button>
            <button
              type="button"
              className="w-full px-3 py-1.5 text-left text-xs text-destructive hover:bg-destructive/10"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setArchiveOpen(true);
                handleAction();
              }}
              data-testid="site-archive-action"
            >
              Archive
            </button>
            <button
              type="button"
              disabled
              className="w-full cursor-not-allowed px-3 py-1.5 text-left text-xs text-muted-foreground"
              title="Coming in a follow-up slice"
            >
              Clone DS (soon)
            </button>
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
    </>
  );
}
