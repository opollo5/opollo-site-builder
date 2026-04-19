"use client";

import { useCallback, useRef, useState } from "react";

import { PreviewPane } from "@/components/PreviewPane";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type ChatMessage = {
  role: "user" | "assistant";
  text: string;
};

type ApiMessage = {
  role: "user" | "assistant";
  content: string;
};

const PREVIEW_TOOLS = new Set([
  "create_page",
  "update_page",
  "get_page",
  "publish_page",
]);

export default function HomePage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [previewPageId, setPreviewPageId] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const toolUseNamesRef = useRef<Record<string, string>>({});

  const appendDeltaToLastAssistant = useCallback((delta: string) => {
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (!last || last.role !== "assistant") return prev;
      next[next.length - 1] = { ...last, text: last.text + delta };
      return next;
    });
  }, []);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || streaming) return;

    const userMsg: ChatMessage = { role: "user", text: trimmed };
    const apiMessages: ApiMessage[] = [...messages, userMsg].map((m) => ({
      role: m.role,
      content: m.text,
    }));

    setMessages((prev) => [
      ...prev,
      userMsg,
      { role: "assistant", text: "" },
    ]);
    setInput("");
    setStreaming(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: apiMessages }),
        signal: ctrl.signal,
      });

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => "");
        appendDeltaToLastAssistant(`\n[error: ${res.status} ${text}]`);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const block of events) {
          const lines = block.split("\n");
          const eventLine = lines.find((l) => l.startsWith("event:"));
          const dataLine = lines.find((l) => l.startsWith("data:"));
          if (!eventLine || !dataLine) continue;
          const type = eventLine.slice("event:".length).trim();
          let payload: any = null;
          try {
            payload = JSON.parse(dataLine.slice("data:".length).trim());
          } catch {
            continue;
          }

          if (type === "text" && typeof payload?.delta === "string") {
            appendDeltaToLastAssistant(payload.delta);
          } else if (type === "tool_use") {
            if (typeof payload?.id === "string" && typeof payload?.name === "string") {
              toolUseNamesRef.current[payload.id] = payload.name;
            }
            appendDeltaToLastAssistant(
              `\n[tool: ${payload.name}]`,
            );
          } else if (type === "tool_result") {
            const ok = payload?.result?.ok;
            const toolName = toolUseNamesRef.current[payload?.tool_use_id];
            const pageId = payload?.result?.data?.page_id;
            if (
              ok &&
              typeof toolName === "string" &&
              PREVIEW_TOOLS.has(toolName) &&
              typeof pageId === "number"
            ) {
              setPreviewPageId(pageId);
            }
            appendDeltaToLastAssistant(
              `\n[tool_result: ${ok ? "ok" : payload?.result?.error?.code ?? "error"}]`,
            );
          } else if (type === "error") {
            appendDeltaToLastAssistant(
              `\n[error: ${payload?.message ?? "unknown"}]`,
            );
          }
        }
      }
    } catch (err) {
      if ((err as any)?.name !== "AbortError") {
        appendDeltaToLastAssistant(
          `\n[error: ${err instanceof Error ? err.message : String(err)}]`,
        );
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [appendDeltaToLastAssistant, input, messages, streaming]);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex h-12 flex-none items-center border-b px-4">
        <span className="text-sm font-semibold">LeadSource</span>
        <span className="ml-3 text-xs text-muted-foreground">
          Opollo Site Builder · Day 1
        </span>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <section className="flex w-2/5 flex-col border-r">
          <ScrollArea className="flex-1">
            <div className="space-y-3 p-4">
              {messages.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Describe the page you want to create.
                </p>
              )}
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex",
                    m.role === "user" ? "justify-end" : "justify-start",
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[85%] whitespace-pre-wrap rounded-md px-3 py-2 text-sm",
                      m.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-foreground",
                    )}
                  >
                    {m.text || (streaming && i === messages.length - 1 ? "…" : "")}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
          <form
            className="flex flex-none gap-2 border-t p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void handleSend();
            }}
          >
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Describe the page you want…"
              disabled={streaming}
              className="min-h-[60px] flex-1 resize-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
            />
            <Button
              type="submit"
              disabled={streaming || !input.trim()}
              className="self-end"
            >
              {streaming ? "…" : "Send"}
            </Button>
          </form>
        </section>
        <section className="flex w-3/5 flex-col border-l bg-muted/30">
          <div className="flex h-10 flex-none items-center border-b bg-background px-4 text-xs text-muted-foreground">
            Preview
          </div>
          <div className="flex flex-1 overflow-hidden">
            <PreviewPane pageId={previewPageId} />
          </div>
        </section>
      </div>
    </div>
  );
}
