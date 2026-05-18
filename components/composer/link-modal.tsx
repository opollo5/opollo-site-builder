"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ---------------------------------------------------------------------------
// LinkModal — URL insertion + optional UTM parameter builder for the composer.
//
// Opens a Dialog where the user pastes a URL and optionally adds UTM params
// (source, medium, campaign, term, content). Emits the final built URL.
// ---------------------------------------------------------------------------

interface LinkModalProps {
  open: boolean;
  initialUrl?: string | null;
  onConfirm: (url: string) => void;
  onClose: () => void;
}

function buildUtm(
  base: string,
  source: string,
  medium: string,
  campaign: string,
  term: string,
  content: string,
): string {
  try {
    const url = new URL(base.startsWith("http") ? base : `https://${base}`);
    if (source) url.searchParams.set("utm_source", source);
    if (medium) url.searchParams.set("utm_medium", medium);
    if (campaign) url.searchParams.set("utm_campaign", campaign);
    if (term) url.searchParams.set("utm_term", term);
    if (content) url.searchParams.set("utm_content", content);
    return url.toString();
  } catch {
    return base;
  }
}

export function LinkModal({ open, initialUrl, onConfirm, onClose }: LinkModalProps) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const [showUtm, setShowUtm] = useState(false);
  const [utmSource, setUtmSource] = useState("");
  const [utmMedium, setUtmMedium] = useState("social");
  const [utmCampaign, setUtmCampaign] = useState("");
  const [utmTerm, setUtmTerm] = useState("");
  const [utmContent, setUtmContent] = useState("");
  const urlRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setUrl(initialUrl ?? "");
      urlRef.current?.focus();
    }
  }, [open, initialUrl]);

  const builtUrl = showUtm
    ? buildUtm(url, utmSource, utmMedium, utmCampaign, utmTerm, utmContent)
    : url.trim();

  function handleConfirm() {
    const final = builtUrl.trim();
    if (!final) return;
    onConfirm(final);
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Insert link</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div>
            <label htmlFor="link-url-input" className="mb-1 block text-sm font-medium">
              URL
            </label>
            <input
              id="link-url-input"
              ref={urlRef}
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
              className="w-full rounded border border-white/10 bg-background px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-pk"
            />
          </div>

          <button
            type="button"
            onClick={() => setShowUtm((v) => !v)}
            className="self-start text-xs text-muted-foreground underline hover:text-foreground"
          >
            {showUtm ? "Hide UTM params" : "+ Add UTM parameters"}
          </button>

          {showUtm && (
            <div className="grid grid-cols-2 gap-2 rounded-md border border-white/10 bg-white/5 p-3">
              {([
                ["utm_source", "Source", utmSource, setUtmSource, "e.g. linkedin"],
                ["utm_medium", "Medium", utmMedium, setUtmMedium, "e.g. social"],
                ["utm_campaign", "Campaign", utmCampaign, setUtmCampaign, "e.g. spring-launch"],
                ["utm_term", "Term", utmTerm, setUtmTerm, "optional"],
                ["utm_content", "Content", utmContent, setUtmContent, "optional"],
              ] as [string, string, string, (v: string) => void, string][]).map(
                ([id, label, value, setter, ph]) => (
                  <div key={id} className={id === "utm_source" || id === "utm_medium" ? "" : "col-span-1"}>
                    <label htmlFor={id} className="mb-0.5 block text-xs text-muted-foreground">
                      {label}
                    </label>
                    <input
                      id={id}
                      type="text"
                      value={value}
                      onChange={(e) => setter(e.target.value)}
                      placeholder={ph}
                      className="w-full rounded border border-white/10 bg-background px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-pk"
                    />
                  </div>
                ),
              )}
            </div>
          )}

          {showUtm && builtUrl && (
            <p className="break-all rounded bg-white/5 px-2 py-1.5 text-xs text-muted-foreground">
              {builtUrl}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={!url.trim()}>
            Insert link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
