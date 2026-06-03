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
// CreateTaskPopup — capture popup that appears after element pick.
//
// Left: description textarea + screenshot thumbnail with click-pin.
// Right: Severity selector, tags.
// Submit → POST /api/feedback/tickets (screenshot already uploaded by parent).
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
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<TicketSeverity>("normal");
  const [tags, setTagsRaw] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!title.trim() || !description.trim()) {
      setError("Title and description are required.");
      return;
    }
    setError(null);
    setSubmitting(true);

    try {
      // Upload screenshot if we have one.
      let screenshotObjectPath: string | null = null;
      if (screenshotDataUrl) {
        const urlResp = await fetch("/api/feedback/tickets/screenshot-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contentType: "image/png" }),
        });
        if (urlResp.ok) {
          const { data } = await urlResp.json();
          // Convert data URL to blob.
          const res = await fetch(screenshotDataUrl);
          const blob = await res.blob();
          await fetch(data.uploadUrl, { method: "PUT", body: blob });
          screenshotObjectPath = data.objectPath;
        }
      }

      const payload = {
        companyId,
        title: title.trim(),
        description: description.trim(),
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
        setError(body?.error?.message ?? "Failed to submit ticket.");
        return;
      }

      const { data } = await resp.json();
      onSubmitted(data.id);
    } catch (err) {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }, [companyId, consoleErrors, description, pageUrl, pick, screenshotDataUrl, severity, tags, title, onSubmitted]);

  return (
    <div
      data-testid="feedback-create-popup"
      className="fixed right-16 bottom-16 z-[10001] flex w-[640px] flex-col rounded-xl border border-gray-200 bg-white shadow-2xl"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-gray-900">Report a bug</h2>
        <button
          onClick={onClose}
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      {/* Body */}
      <div className="flex gap-4 p-4">
        {/* Left: description + screenshot */}
        <div className="flex flex-1 flex-col gap-3">
          <input
            ref={titleRef}
            type="text"
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="rounded-md border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500"
          />

          <div className="relative">
            <Textarea
              placeholder="Describe what you expected vs. what happened…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              rows={5}
              className="resize-none text-sm"
            />
            <span className="absolute right-2 bottom-2 text-xs text-gray-400">
              {description.length}/2000
            </span>
          </div>

          {/* Screenshot thumbnail with click pin */}
          {screenshotDataUrl && (
            <div className="relative overflow-hidden rounded-md border border-gray-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={screenshotDataUrl}
                alt="Screenshot"
                className="w-full object-contain"
                style={{ maxHeight: 200 }}
              />
              {/* Click-position pin */}
              <div
                className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-emerald-500 shadow"
                style={{
                  left: `${pick.clickXPct}%`,
                  top: `${pick.clickYPct}%`,
                }}
              />
            </div>
          )}
        </div>

        {/* Right: metadata */}
        <div className="flex w-48 flex-col gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Severity</label>
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value as TicketSeverity)}
              className="w-full rounded-md border border-gray-200 px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="blocker">Blocker</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Tags (comma-separated)</label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTagsRaw(e.target.value)}
              placeholder="ui, navigation…"
              className="w-full rounded-md border border-gray-200 px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div className="rounded-md bg-gray-50 p-2 text-xs text-gray-500">
            <p className="font-medium text-gray-700">Element</p>
            <p className="truncate font-mono">{pick.cssSelector}</p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3">
        {error && <p className="text-xs text-red-500">{error}</p>}
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
            {submitting ? "Submitting…" : "Submit bug report"}
          </Button>
        </div>
      </div>
    </div>
  );
}
