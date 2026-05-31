"use client";

/**
 * EditorShell — three-pane layout for the v2 template editor (§4).
 *
 * Layout: [left 280px] | [canvas flex-1] | [right 280px]
 * Header: save / exit / name / undo-redo
 * Canvas: scale-to-fit, dark background, exact canvas px dimensions
 *
 * U1: shell + static DOM renderer + layer list + placeholder properties.
 * U2+: canvas interaction (react-konva selection/drag/resize).
 */

import { EditorProvider } from "./EditorContext";
import { EditorHeader } from "./EditorHeader";
import { EditorLeftPanel } from "./EditorLeftPanel";
import { EditorCanvas } from "./EditorCanvas";
import { EditorRightPanel } from "./EditorRightPanel";
import type { Template } from "@/lib/image/template-model";

interface EditorShellProps {
  template: Template;
  companyId: string;
  templateId: string;
}

export function EditorShell({ template, companyId, templateId }: EditorShellProps) {
  return (
    <EditorProvider template={template}>
      {/* fixed inset-0: escapes the platform NavShell's max-w-7xl / py-8 content
          wrapper so the editor occupies the full viewport. z-50 keeps it above
          the NavShell chrome (rail + section panel). */}
      <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-background">
        <EditorHeader companyId={companyId} templateId={templateId} />

        <div className="flex-1 flex overflow-hidden">
          <EditorLeftPanel />
          <EditorCanvas />
          <EditorRightPanel />
        </div>
      </div>
    </EditorProvider>
  );
}
