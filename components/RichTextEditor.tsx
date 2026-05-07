"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { NavIcon } from "@/components/ui/nav-icon";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// RichTextEditor — Tiptap-backed rich text editor with inline toolbar.
//
// Props:
//   value       — HTML string (controlled; synced from parent on change)
//   onChange    — fires on every edit with the current HTML
//   placeholder — shown when empty
//   disabled    — sets the editor to read-only
//
// Toolbar: Bold · Italic · H1 · H2 · H3 · BulletList · OrderedList ·
//          Blockquote · Link · Undo · Redo
// Word count + estimated read time display right-aligned in the toolbar.
// Clean Word paste: strips mso-* properties, class="Mso*", and <o:…> tags.
// ---------------------------------------------------------------------------

const READING_WPM = 230;

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  disabled = false,
  className,
}: RichTextEditorProps) {
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const linkInputRef = useRef<HTMLInputElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Link.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder }),
      CharacterCount,
    ],
    content: value,
    onUpdate({ editor: e }) {
      onChange(e.getHTML());
    },
    editable: !disabled,
    editorProps: {
      transformPastedHTML(html) {
        return html
          .replace(/mso-[a-z-]+\s*:[^;}"]+;?/gi, "")
          .replace(/class="[^"]*Mso[^"]*"/gi, "")
          .replace(/<o:[^>]+>[\s\S]*?<\/o:[^>]+>/gi, "")
          .replace(/<o:[^/]+\/>/gi, "");
      },
      attributes: {
        class:
          "prose prose-sm max-w-none min-h-[400px] px-3 py-2 focus:outline-none",
      },
    },
  });

  // Sync external value (e.g. after docx file load or parent reset).
  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    if (current !== value) {
      editor.commands.setContent(value || "", { emitUpdate: false });
    }
    // editor identity is stable; intentionally only re-run on value change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Propagate disabled toggle without recreating the editor.
  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [disabled, editor]);

  const words: number =
    (editor?.storage.characterCount as { words?: () => number } | undefined)?.words?.() ?? 0;
  const minutes = words > 0 ? Math.max(1, Math.round(words / READING_WPM)) : 0;

  return (
    <div className={cn("rounded-md border bg-background", className)}>
      {/* Toolbar */}
      <div
        aria-label="Text formatting toolbar"
        className="flex flex-wrap items-center gap-0.5 border-b p-1"
      >
        <ToolbarButton
          onClick={() => editor?.chain().focus().toggleBold().run()}
          active={editor?.isActive("bold")}
          title="Bold (⌘B)"
        >
          <NavIcon name="bold" size={14} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor?.chain().focus().toggleItalic().run()}
          active={editor?.isActive("italic")}
          title="Italic (⌘I)"
        >
          <NavIcon name="italic" size={14} />
        </ToolbarButton>
        <Divider />
        <ToolbarButton
          onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
          active={editor?.isActive("heading", { level: 1 })}
          title="Heading 1"
        >
          <span className="font-mono text-xs font-semibold leading-none">H1</span>
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
          active={editor?.isActive("heading", { level: 2 })}
          title="Heading 2"
        >
          <span className="font-mono text-xs font-semibold leading-none">H2</span>
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
          active={editor?.isActive("heading", { level: 3 })}
          title="Heading 3"
        >
          <span className="font-mono text-xs font-semibold leading-none">H3</span>
        </ToolbarButton>
        <Divider />
        <ToolbarButton
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
          active={editor?.isActive("bulletList")}
          title="Bullet list"
        >
          <NavIcon name="list" size={14} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          active={editor?.isActive("orderedList")}
          title="Numbered list"
        >
          <NavIcon name="list2" size={14} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor?.chain().focus().toggleBlockquote().run()}
          active={editor?.isActive("blockquote")}
          title="Blockquote"
        >
          <NavIcon name="quote-open" size={14} />
        </ToolbarButton>
        <Divider />
        <ToolbarButton
          onClick={() => {
            if (editor?.isActive("link")) {
              editor.chain().focus().unsetLink().run();
            } else {
              setLinkDialogOpen(true);
            }
          }}
          active={editor?.isActive("link")}
          title="Link"
        >
          <NavIcon name="link2" size={14} />
        </ToolbarButton>
        <Divider />
        <ToolbarButton
          onClick={() => editor?.chain().focus().undo().run()}
          disabled={!editor?.can().undo()}
          title="Undo (⌘Z)"
        >
          <NavIcon name="undo" size={14} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor?.chain().focus().redo().run()}
          disabled={!editor?.can().redo()}
          title="Redo (⌘⇧Z)"
        >
          <NavIcon name="redo" size={14} />
        </ToolbarButton>

        {/* Word count — right-aligned */}
        {words > 0 && (
          <span
            data-testid="rte-word-count"
            className="ml-auto text-xs text-muted-foreground"
          >
            {words.toLocaleString()} {words === 1 ? "word" : "words"} · {minutes} min read
          </span>
        )}
      </div>

      {/* Editor area */}
      <EditorContent editor={editor} />

      {/* Link insert dialog */}
      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Insert link</DialogTitle>
          </DialogHeader>
          <Input
            ref={linkInputRef}
            type="url"
            placeholder="https://example.com"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const url = linkInputRef.current?.value.trim() ?? "";
                if (url) editor?.chain().focus().setLink({ href: url }).run();
                setLinkDialogOpen(false);
              }
            }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLinkDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const url = linkInputRef.current?.value.trim() ?? "";
                if (url) editor?.chain().focus().setLink({ href: url }).run();
                setLinkDialogOpen(false);
              }}
            >
              Insert
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function Divider() {
  return <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />;
}

function ToolbarButton({
  onClick,
  active,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={cn(
        "rounded p-1.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
        disabled && "cursor-not-allowed opacity-40",
      )}
    >
      {children}
    </button>
  );
}
