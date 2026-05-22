"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { reportableToast } from "@/lib/error-reporting/reportable-toast";
import { toastSuccess } from "@/lib/toast-success";
import { ConfirmActionModal } from "@/components/ConfirmActionModal";
import { NavIcon } from "@/components/ui/nav-icon";
import { RowActions, type RowAction } from "@/components/ui/row-actions";
import { translateTestConnectionErrorCode } from "@/lib/error-translations";

// Per-row overflow menu for /admin/sites rows.
// Replaces bespoke context-menu with canonical RowActions (Spec 18 / Item 4).
//
// Menu items (in order):
//   1. Edit             → /admin/sites/[id]/edit
//   2. Test Connection  → POST /api/sites/[id]/test-connection
//   3. Archive          → opens ConfirmActionModal (soft-delete)
//   4. Delete           → opens ConfirmActionModal (purge, super_admin only)

export function SiteActionsMenu({
  siteId,
  name,
  canDelete = false,
}: {
  siteId: string;
  name: string;
  wpUrl?: string;
  canDelete?: boolean;
}) {
  const router = useRouter();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [testing, setTesting] = useState(false);

  async function handleTestConnection() {
    if (testing) return;
    setTesting(true);
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
        router.refresh();
        return;
      }
      const code =
        payload && payload.ok === false
          ? (payload.errorCode ?? "WP_ERROR")
          : "WP_ERROR";
      const codeMsg = translateTestConnectionErrorCode(code);
      reportableToast.error(codeMsg, { message: codeMsg, type: code });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      reportableToast.error(
        translateTestConnectionErrorCode("REST_UNREACHABLE"),
        { message: errMsg, type: "REST_UNREACHABLE" },
        { description: errMsg },
      );
    } finally {
      setTesting(false);
    }
  }

  const actions: RowAction[] = [
    {
      label: "Edit",
      icon: <NavIcon name="pencil" size={14} />,
      onClick: () => router.push(`/admin/sites/${encodeURIComponent(siteId)}/edit`),
    },
    {
      label: "Test Connection",
      icon: <NavIcon name="sync" size={14} />,
      onClick: () => { void handleTestConnection(); },
      disabled: testing,
    },
    {
      label: "Archive",
      variant: "destructive",
      onClick: () => setArchiveOpen(true),
    },
    ...(canDelete
      ? [{
          label: "Delete",
          icon: <NavIcon name="trash2" size={14} />,
          variant: "destructive" as const,
          onClick: () => setDeleteOpen(true),
        }]
      : []),
  ];

  return (
    <>
      <RowActions
        actions={actions}
        label={`Actions for ${name}`}
        testId="site-actions-summary"
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
