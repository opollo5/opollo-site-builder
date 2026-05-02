"use client";

import { useState } from "react";
import { Sparkles, UploadCloud } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type Mode = "copy_existing" | "new_design";

const OPTIONS: Array<{
  mode: Mode;
  title: string;
  blurb: string;
  Icon: typeof UploadCloud;
}> = [
  {
    mode: "copy_existing",
    title: "Upload content to an existing site",
    blurb:
      "This site already has a WordPress theme. We'll extract its design so new content matches it seamlessly.",
    Icon: UploadCloud,
  },
  {
    mode: "new_design",
    title: "Build a new website",
    blurb:
      "We'll help you design the site from scratch — concepts, colours, tone of voice, and a complete CSS system.",
    Icon: Sparkles,
  },
];

export function SiteOnboardingForm({ siteId }: { siteId: string }) {
  const [selected, setSelected] = useState<Mode | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/sites/${siteId}/onboarding`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ site_mode: selected }),
      });
      const payload = (await res.json().catch(() => null)) as
        | { ok: true; data: { redirect_to: string } }
        | { ok: false; error: { code: string; message: string } }
        | null;
      if (!res.ok || !payload?.ok) {
        setError(
          payload && payload.ok === false
            ? payload.error.message
            : `Failed to save (HTTP ${res.status}).`,
        );
        setSubmitting(false);
        return;
      }
      window.location.assign(payload.data.redirect_to);
    } catch (err) {
      setError(`Network error: ${err instanceof Error ? err.message : String(err)}`);
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-6 space-y-4" data-testid="site-onboarding-form">
      <div className="grid gap-4 md:grid-cols-2">
        {OPTIONS.map(({ mode, title, blurb, Icon }) => {
          const isSelected = selected === mode;
          return (
            <button
              key={mode}
              type="button"
              onClick={() => setSelected(mode)}
              className={`flex h-full flex-col gap-3 rounded-lg border-2 p-5 text-left transition-smooth focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                isSelected
                  ? "border-primary bg-primary/5"
                  : "border-muted hover:border-foreground/40"
              }`}
              data-testid={`site-onboarding-option-${mode}`}
              aria-pressed={isSelected}
            >
              <Icon
                aria-hidden
                className={`h-6 w-6 ${
                  isSelected ? "text-primary" : "text-muted-foreground"
                }`}
              />
              <div>
                <p className="text-base font-medium">{title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{blurb}</p>
              </div>
            </button>
          );
        })}
      </div>

      {error && (
        <Alert variant="destructive" title="Couldn't save your choice">
          {error}
        </Alert>
      )}

      <div className="flex items-center justify-end gap-3 pt-2">
        <Button
          type="button"
          onClick={() => void onSubmit()}
          disabled={!selected || submitting}
          data-testid="site-onboarding-submit"
        >
          {submitting ? "Saving…" : "Continue"}
        </Button>
      </div>
    </div>
  );
}
