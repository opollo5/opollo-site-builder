"use client";

/**
 * EditorHeader — save/exit/name bar at the top of the v2 template editor.
 * Contains: template name (editable), undo/redo buttons, save button, exit link.
 */

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useEditor } from "./EditorContext";

interface EditorHeaderProps {
  companyId: string;
  templateId: string;
}

export function EditorHeader({ companyId, templateId }: EditorHeaderProps) {
  const { state, dispatch, canUndo, canRedo } = useEditor();
  const { template, isDirty, isSaving } = state;
  const router = useRouter();
  const [editingName, setEditingName] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const handleSave = useCallback(async () => {
    dispatch({ type: "set_saving", isSaving: true });
    try {
      const res = await fetch(`/api/platform/image/templates/${templateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_id: companyId,
          layer_template: template,
          schema_version: 2,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message ?? `Save failed (${res.status})`);
      }
      dispatch({ type: "mark_clean" });
      toast.success("Template saved successfully.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      dispatch({ type: "set_saving", isSaving: false });
    }
  }, [companyId, templateId, template, dispatch, router]);

  const commitName = useCallback(() => {
    setEditingName(false);
    if (nameRef.current) {
      const name = nameRef.current.value.trim();
      if (name && name !== template.name) {
        dispatch({ type: "update_template_name", name });
      }
    }
  }, [template.name, dispatch]);

  return (
    <header className="h-12 border-b border-border flex items-center gap-2 px-3 bg-background shrink-0">
      {/* Exit */}
      <Link
        href={`/company/image/templates`}
        className="text-sm text-muted-foreground hover:text-foreground transition-colors mr-1"
        onClick={(e) => {
          if (isDirty && !confirm("Unsaved changes. Leave anyway?")) e.preventDefault();
        }}
      >
        ← Templates
      </Link>

      <div className="w-px h-5 bg-border mx-1" />

      {/* Template name */}
      {editingName ? (
        <Input
          ref={nameRef}
          defaultValue={template.name}
          className="h-7 text-sm w-48"
          autoFocus
          onBlur={commitName}
          onKeyDown={(e) => { if (e.key === "Enter") commitName(); if (e.key === "Escape") setEditingName(false); }}
        />
      ) : (
        <button
          className="text-sm font-medium truncate max-w-xs hover:underline"
          onDoubleClick={() => setEditingName(true)}
          title="Double-click to rename"
        >
          {template.name}
          {isDirty && <span className="ml-1 text-muted-foreground">•</span>}
        </button>
      )}

      <div className="flex-1" />

      {/* Undo / Redo */}
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        disabled={!canUndo}
        onClick={() => dispatch({ type: "undo" })}
        title="Undo (Ctrl+Z)"
      >
        ↩ Undo
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        disabled={!canRedo}
        onClick={() => dispatch({ type: "redo" })}
        title="Redo (Ctrl+Y)"
      >
        Redo ↪
      </Button>

      <div className="w-px h-5 bg-border mx-1" />

      {/* Save */}
      <Button
        size="sm"
        className="h-7 text-xs"
        disabled={!isDirty || isSaving}
        onClick={handleSave}
      >
        {isSaving ? "Saving…" : "Save"}
      </Button>
    </header>
  );
}
