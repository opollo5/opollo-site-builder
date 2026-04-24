"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useState, useRef, useEffect, ReactNode } from "react";
import { createPortal } from "react-dom";

import { ConfirmActionModal } from "@/components/ConfirmActionModal";
import { EditSiteModal } from "@/components/EditSiteModal";

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
  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const menuId = `site-actions-${siteId}`;
  const isOpen = openMenuId === menuId;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen || !buttonRef.current) {
      setMenuPos(null);
      return;
    }

    const rect = buttonRef.current.getBoundingClientRect();
    const menuHeight = 140;
    const viewportHeight = window.innerHeight;
    const spaceBelow = viewportHeight - rect.bottom;

    let top: number;
    if (spaceBelow < menuHeight + 10) {
      top = rect.top - menuHeight - 4;
    } else {
      top = rect.bottom + 4;
    }

    const left = rect.right - 176;

    setMenuPos({
      top: window.scrollY + top,
      left: window.scrollX + left,
    });
  }, [isOpen]);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpenMenuId(isOpen ? null : menuId);
  };

  const handleAction = () => {
    setOpenMenuId(null);
  };

  return (
    <>
      <button
        ref={buttonRef}
        onClick={handleToggle}
        className="rounded px-2 py-1 text-muted-foreground hover:bg-muted"
        aria-label={`Actions for ${name}`}
        data-testid="site-actions-summary"
      >
        ⋯
      </button>

      {mounted && isOpen && menuPos && createPortal(
        <div
          className="absolute z-50 w-44 rounded-md border bg-background shadow-md"
          style={{
            top: `${menuPos.top}px`,
            left: `${menuPos.left}px`,
          }}
        >
          <button
            type="button"
            className="w-full px-3 py-1.5 text-left text-xs hover:bg-muted"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setEditOpen(true);
              handleAction();
            }}
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
        </div>,
        document.body
      )}

      <EditSiteModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        site={{ id: siteId, name, wp_url: wpUrl }}
      />
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
