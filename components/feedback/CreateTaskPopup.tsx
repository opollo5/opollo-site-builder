"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { PickResult } from "./ElementPicker";
import type { TicketSeverity } from "@/lib/feedback/types";

type Props = {
  companyId: string;
  pick: PickResult;
  screenshotDataUrl: string | null;
  consoleErrors: unknown[];
  pageUrl: string;
  onClose: () => void;
  onSubmitted: (ticketId: string) => void;
};

// ---------------------------------------------------------------------------
// CreateTaskPopup — capture popup.
//
// §3 v1.3: Title field removed — callers no longer send a title. The server
//   auto-generates the title from the first line of "What happened?".
// §4 naming: "Report an issue" / "Send report".
// §1 position: opens from bottom-left (left-20 bottom-16) to match the pill.
// ---------------------------------------------------------------------------

export function CreateTaskPopup({
  companyId,
  pick,
  screenshotDataUrl,
  consoleErrors,
  pageUrl,
  onClose,
  onSubmitted,
}: Props) {
  const [description, setDescription] = useState("");
  const [expectedBehavior, setExpectedBehavior] = useState("");
  const [severity, setSeverity] = useState<TicketSeverity>("normal");
  const [tags, setTagsRaw] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const descRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Focus the first field on open
    descRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!description.trim() || !expectedBehavior.trim()) {
      setError("Both fields are required.");
      return;
    }
    setError(null);
    setSubmitting(true);

    try {
      let screenshotObjectPath: string | null = null;
      if (screenshotDataUrl) {
        const urlResp = await fetch("/api/feedback/tickets/screenshot-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contentType: "image/png" }),
        });
        if (urlResp.ok) {
          const { data } = await urlResp.json();
          const res = await fetch(screenshotDataUrl);
          const blob = await res.blob();
          await fetch(data.uploadUrl, { method: "PUT", body: blob });
          screenshotObjectPath = data.objectPath;
        }
      }

      const payload = {
        companyId,
        // §3: no title field — server generates from description
        description: description.trim(),
        expectedBehavior: expectedBehavior.trim(),
        severity,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        pageUrl,
        cssSelector: pick.cssSelector,
        elementLabel: pick.elementLabel,
        clickXPct: pick.clickXPct,
        clickYPct: pick.clickYPct,
        viewportW: pick.viewportW,
        viewportH: pick.viewportH,
        devicePixelRatio: pick.devicePixelRatio,
        userAgent: navigator.userAgent,
        consoleErrors,
        screenshotObjectPath,
      };

      const resp = await fetch("/api/feedback/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        setError(body?.error?.message ?? "Failed to submit report.");
        return;
      }

      const { data } = await resp.json();
      onSubmitted(data.id);
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }, [companyId, consoleErrors, description, expectedBehavior, pageUrl, pick, screenshotDataUrl, severity, tags, onSubmitted]);

  return (
    <div
      data-testid="feedback-create-popup"
      // §1: anchored to bottom-left to match the repositioned pill
      className="fixed left-20 bottom-16 z-[10001] flex w-[680px] flex-col rounded-xl border border-gray-200 bg-white shadow-2xl"
    >
      {/* Header — §4: "Report an issue" */}
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-gray-900">Report an issue</h2>
        <button
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      {/* Body */}
      <div className="flex gap-4 p-4">
        {/* Left: two description fields + screenshot */}
        <div className="flex flex-1 flex-col gap-3">
          {/* §3: no Title field. First field gets auto-focus. */}

          {/* What happened */}
          <div className="relative">
            <label className="mb-1 block text-xs font-medium text-gray-600">
              What happened?<span className="ml-0.5 text-red-500">*</span>
            </label>
            <Textarea
              ref={descRef}
              placeholder="Describe what you did and what went wrong…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              rows={4}
              className="resize-none text-sm"
            />
            <span className="absolute right-2 bottom-2 text-xs text-gray-400">
              {description.length}/2000
            </span>
          </div>

          {/* Expected behavior */}
          <div className="relative">
            <label className="mb-1 block text-xs font-medium text-gray-600">
              What did you expect to happen?<span className="ml-0.5 text-red-500">*</span>
            </label>
            <Textarea
              placeholder="Describe what you expected instead…"
              value={expectedBehavior}
              onChange={(e) => setExpectedBehavior(e.target.value)}
              maxLength={2000}
              rows={3}
              className="resize-none text-sm"
            />
            <span className="absolute right-2 bottom-2 text-xs text-gray-400">
              {expectedBehavior.length}/2000
            </span>
          </div>

          {/* Screenshot thumbnail */}
          {screenshotDataUrl && (
            <div className="relative overflow-hidden rounded-md border border-gray-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={screenshotDataUrl}
                alt="Screenshot"
                className="w-full"
                style={{ maxHeight: 180 }}
              />
              <div
                className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-emerald-500 shadow"
                style={{ left: `${pick.clickXPct}%`, top: `${pick.clickYPct}%` }}
              />
            </div>
          )}
        </div>

        {/* Right: metadata */}
        <div className="flex w-44 flex-col gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Severity</label>
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value as TicketSeverity)}
              className="w-full rounded-md border border-gray-200 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="blocker">Blocker</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Tags</label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTagsRaw(e.target.value)}
              placeholder="ui, login…"
              className="w-full rounded-md border border-gray-200 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div className="rounded-md bg-gray-50 p-2 text-xs text-gray-500">
            <p className="font-medium text-gray-700">Element</p>
            <p className="truncate font-mono">{pick.cssSelector}</p>
          </div>
        </div>
      </div>

      {/* Footer — §4: "Send report" */}
      <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3">
        {error && <p className="flex-1 text-xs text-red-500">{error}</p>}
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            data-testid="feedback-submit"
            size="sm"
            onClick={handleSubmit}
            disabled={submitting}
            className="bg-emerald-600 text-white hover:bg-emerald-700"
          >
            {submitting ? "Sending…" : "Send report"}
          </Button>
        </div>
      </div>
    </div>
  );
}
