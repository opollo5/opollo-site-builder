"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

// Minimal "Run batch" modal. Operators pick a template for a given
// site and paste one slug-per-line; each line becomes a slot. The
// form POSTs to /api/admin/batch with an auto-generated
// Idempotency-Key, then navigates to the new batch's detail page on
// success.
//
// Scope pragmatism: richer per-slot fields (keywords, topic, meta
// overrides) can land once we have a design for them. Slug is the
// only truly required input for M3's page generation.

export type BatchTemplateOption = {
  id: string;
  name: string;
  page_type: string;
};

export function NewBatchModal({
  open,
  onClose,
  site,
  templates,
}: {
  open: boolean;
  onClose: () => void;
  site: { id: string; name: string } | null;
  templates: BatchTemplateOption[];
}) {
  const router = useRouter();
  const [templateId, setTemplateId] = useState<string>("");
  const [slugsText, setSlugsText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTemplateId(templates[0]?.id ?? "");
      setSlugsText("");
      setError(null);
      setSubmitting(false);
    }
  }, [open, templates]);

  const slugs = useMemo(
    () =>
      slugsText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    [slugsText],
  );

  if (!open) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!site) {
      setError("No site selected.");
      return;
    }
    if (!templateId) {
      setError("Pick a template.");
      return;
    }
    if (slugs.length === 0) {
      setError("Add at least one slug.");
      return;
    }
    if (slugs.length > 100) {
      setError("Maximum 100 slugs per batch.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const idempotencyKey =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `batch-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const res = await fetch("/api/admin/batch", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify({
          site_id: site.id,
          template_id: templateId,
          slots: slugs.map((slug) => ({ inputs: { slug } })),
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok || !payload?.ok) {
        setError(
          payload?.error?.message ?? `Batch creation failed (HTTP ${res.status}).`,
        );
        setSubmitting(false);
        return;
      }
      const jobId = payload.data?.job_id as string | undefined;
      onClose();
      if (jobId) {
        router.push(`/admin/batches/${jobId}`);
      } else {
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="nb-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-lg border bg-background p-6 shadow-lg">
        <h2 id="nb-title" className="text-lg font-semibold">
          New batch{site ? ` — ${site.name}` : ""}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Generate multiple pages against a locked template. One slug
          per line; each becomes a slot the worker generates
          independently.
        </p>
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div>
            <label htmlFor="nb-template" className="block text-sm font-medium">
              Template
            </label>
            <select
              id="nb-template"
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              disabled={submitting || templates.length === 0}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              {templates.length === 0 && (
                <option value="">No templates available</option>
              )}
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.page_type})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="nb-slugs" className="block text-sm font-medium">
              Slugs ({slugs.length})
            </label>
            <Textarea
              id="nb-slugs"
              placeholder={"first-page\nsecond-page\nthird-page"}
              value={slugsText}
              onChange={(e) => setSlugsText(e.target.value)}
              disabled={submitting}
              className="font-mono min-h-[140px]"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              One slug per line. Up to 100 per batch.
            </p>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || templates.length === 0}>
              {submitting ? "Creating…" : "Run batch"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
