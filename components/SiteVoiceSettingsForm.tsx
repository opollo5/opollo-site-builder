"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

// ---------------------------------------------------------------------------
// RS-2 — site-level brand voice & design direction editor.
//
// Reads/writes /api/admin/sites/[id]/voice with optimistic version_lock.
// Operator sets the values once; brief commit forms inherit them as
// defaults. Per-brief override still wins at commit time — those values
// live on the briefs row, not here.
// ---------------------------------------------------------------------------

const ERROR_TRANSLATIONS: Record<string, string> = {
  VERSION_CONFLICT:
    "Another tab updated this site's voice settings. Refresh to see the latest values, then re-apply your edit.",
  VALIDATION_FAILED:
    "We couldn't save those values. Check the form and try again.",
  FORBIDDEN: "Your account doesn't have permission to edit site settings.",
  UNAUTHORIZED: "Please sign in again.",
  NOT_FOUND: "This site no longer exists. Refresh the page and try again.",
};

const FIELD_MAX_BYTES = 4096;

export function SiteVoiceSettingsForm({
  siteId,
  initialBrandVoice,
  initialDesignDirection,
  initialVersionLock,
}: {
  siteId: string;
  initialBrandVoice: string | null;
  initialDesignDirection: string | null;
  initialVersionLock: number;
}) {
  const router = useRouter();
  const [brandVoice, setBrandVoice] = useState(initialBrandVoice ?? "");
  const [designDirection, setDesignDirection] = useState(
    initialDesignDirection ?? "",
  );
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    setSavedAt(null);
    try {
      const res = await fetch(`/api/admin/sites/${siteId}/voice`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expected_version_lock: initialVersionLock,
          patch: {
            // Empty string = clear the value (null) so "operator opened
            // the field, typed, then cleared" is treated the same as
            // "explicitly empty".
            brand_voice: brandVoice.trim() === "" ? null : brandVoice,
            design_direction:
              designDirection.trim() === "" ? null : designDirection,
          },
        }),
      });
      const payload = (await res.json()) as
        | { ok: true; data: { brand_voice: string | null } }
        | { ok: false; error: { code: string; message: string } };
      if (payload.ok) {
        setSavedAt(new Date().toLocaleTimeString());
        router.refresh();
        return;
      }
      setFormError(
        ERROR_TRANSLATIONS[payload.error.code] ?? payload.error.message,
      );
    } catch (err) {
      setFormError(
        `Network error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="site-brand-voice" className="block text-sm font-medium">
          Brand voice
        </label>
        <Textarea
          id="site-brand-voice"
          className="mt-1"
          rows={5}
          value={brandVoice}
          onChange={(e) => setBrandVoice(e.target.value)}
          disabled={submitting}
          maxLength={FIELD_MAX_BYTES}
          placeholder="e.g. Warm, confident, plain language. Avoid jargon. Second-person (you / your) by default."
        />
        <p className="mt-1 text-xs text-muted-foreground">
          How every page on this site should sound. New briefs inherit this as
          a default. {FIELD_MAX_BYTES.toLocaleString()} characters max.
        </p>
      </div>

      <div>
        <label
          htmlFor="site-design-direction"
          className="block text-sm font-medium"
        >
          Design direction
        </label>
        <Textarea
          id="site-design-direction"
          className="mt-1"
          rows={5}
          value={designDirection}
          onChange={(e) => setDesignDirection(e.target.value)}
          disabled={submitting}
          maxLength={FIELD_MAX_BYTES}
          placeholder="e.g. Generous white space. Hero with photo background. Single CTA per section, accent color for emphasis."
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Visual constraints for the anchor cycle on every brief. New briefs
          inherit this as a default. {FIELD_MAX_BYTES.toLocaleString()}{" "}
          characters max.
        </p>
      </div>

      {formError && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {formError}
        </div>
      )}

      {savedAt && !formError && (
        <div
          role="status"
          className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm text-emerald-700"
        >
          Saved at {savedAt}. Reload to see version_lock advance.
        </div>
      )}

      <div className="flex items-center justify-end">
        <Button type="submit" disabled={submitting}>
          {submitting ? "Saving…" : "Save voice settings"}
        </Button>
      </div>
    </form>
  );
}
