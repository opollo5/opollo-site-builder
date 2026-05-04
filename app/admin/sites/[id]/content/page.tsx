"use client";

import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

// /admin/sites/[id]/content — M16-7.
//
// Shared content manager. Lists all non-deleted shared_content rows for
// the site; allows inline label/content editing and soft-delete.

type ContentRow = {
  id:           string;
  content_type: string;
  label:        string;
  content:      Record<string, unknown>;
  version_lock: number;
};

type EditState = {
  row:         ContentRow;
  label:       string;
  contentJson: string;
  saving:      boolean;
  error:       string | null;
};

export default function SharedContentPage({
  params,
}: {
  params: { id: string };
}) {
  const siteId = params.id;

  const [rows, setRows]       = useState<ContentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [edit, setEdit]       = useState<EditState | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/sites/${siteId}/shared-content`);
      const json = await res.json() as { ok: boolean; data: ContentRow[]; error?: { message: string } };
      if (!json.ok) { setError(json.error?.message ?? "Load failed."); return; }
      setRows(json.data ?? []);
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => { void load(); }, [load]);

  function openEdit(row: ContentRow) {
    setEdit({
      row,
      label:       row.label,
      contentJson: JSON.stringify(row.content, null, 2),
      saving:      false,
      error:       null,
    });
  }

  async function saveEdit() {
    if (!edit) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(edit.contentJson) as Record<string, unknown>;
    } catch {
      setEdit(e => e ? { ...e, error: "Content must be valid JSON." } : e);
      return;
    }
    setEdit(e => e ? { ...e, saving: true, error: null } : e);
    try {
      const res = await fetch(
        `/api/sites/${siteId}/shared-content/${edit.row.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            version_lock: edit.row.version_lock,
            label:        edit.label,
            content:      parsed,
          }),
        },
      );
      const json = await res.json() as { ok: boolean; error?: { message: string } };
      if (!json.ok) {
        setEdit(e => e ? { ...e, saving: false, error: json.error?.message ?? "Save failed." } : e);
        return;
      }
      setEdit(null);
      void load();
    } catch {
      setEdit(e => e ? { ...e, saving: false, error: "Network error." } : e);
    }
  }

  async function handleDelete(row: ContentRow) {
    if (!confirm(`Delete "${row.label}"? This cannot be undone.`)) return;
    setDeleting(row.id);
    try {
      const res = await fetch(
        `/api/sites/${siteId}/shared-content/${row.id}`,
        {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      const json = await res.json() as { ok: boolean };
      if (json.ok) void load();
    } finally {
      setDeleting(null);
    }
  }

  const byType = rows.reduce<Record<string, ContentRow[]>>((acc, row) => {
    (acc[row.content_type] ??= []).push(row);
    return acc;
  }, {});

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Shared Content</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Reusable content objects referenced from generated pages.
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No shared content yet. Run the site planner to generate it.
        </p>
      ) : (
        Object.entries(byType).map(([type, typeRows]) => (
          <Card key={type}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Badge tone="outline">{type}</Badge>
                <span className="text-muted-foreground font-normal text-sm">({typeRows.length})</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="p-3 text-left font-medium">Label</th>
                    <th className="p-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {typeRows.map((row, i) => (
                    <tr key={row.id} className={i % 2 === 0 ? "" : "bg-muted/30"}>
                      <td className="p-3">{row.label}</td>
                      <td className="p-3 text-right">
                        <div className="inline-flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openEdit(row)}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={deleting === row.id}
                            onClick={() => void handleDelete(row)}
                            className="text-destructive hover:text-destructive"
                          >
                            {deleting === row.id ? "Deleting…" : "Delete"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        ))
      )}

      {edit && (
        <Dialog open onOpenChange={() => setEdit(null)}>
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>Edit — {edit.row.content_type}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {edit.error && (
                <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                  {edit.error}
                </div>
              )}
              <div className="space-y-1">
                <label htmlFor="sc-label" className="text-sm font-medium">Label</label>
                <Input
                  id="sc-label"
                  value={edit.label}
                  onChange={e => setEdit(s => s ? { ...s, label: e.target.value } : s)}
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="sc-content" className="text-sm font-medium">Content (JSON)</label>
                <Textarea
                  id="sc-content"
                  className="min-h-48 font-mono text-xs"
                  value={edit.contentJson}
                  onChange={e => setEdit(s => s ? { ...s, contentJson: e.target.value } : s)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEdit(null)} disabled={edit.saving}>
                Cancel
              </Button>
              <Button onClick={() => void saveEdit()} disabled={edit.saving}>
                {edit.saving ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </main>
  );
}
