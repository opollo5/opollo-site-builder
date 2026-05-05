"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

type ReextractResult = {
  dimensions_updated: boolean;
  width_px: number | null;
  height_px: number | null;
  istock_id: string | null;
  istock_id_added: boolean;
  notes: string[];
};

export function ReextractMetadataButton({ imageId }: { imageId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/images/${imageId}/reextract`, {
        method: "POST",
      });
      const payload = (await res.json().catch(() => null)) as
        | { ok: true; data: ReextractResult }
        | { ok: false; error: { code: string; message: string } }
        | null;
      if (!res.ok || !payload?.ok) {
        setError(
          payload && payload.ok === false
            ? payload.error.message
            : `Re-extract failed (HTTP ${res.status}).`,
        );
        setBusy(false);
        return;
      }
      const data = payload.data;
      const parts: string[] = [];
      if (data.dimensions_updated && data.width_px && data.height_px) {
        parts.push(`Dimensions ${data.width_px}×${data.height_px}px`);
      }
      if (data.istock_id_added && data.istock_id) {
        parts.push(`iStock id ${data.istock_id}`);
      }
      setMessage(
        parts.length === 0
          ? "Nothing new to extract — the row was already complete."
          : `Updated: ${parts.join(", ")}.`,
      );
      startTransition(() => router.refresh());
    } catch (err) {
      setError(`Network error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void onClick()}
        disabled={busy}
        data-testid="image-reextract-button"
      >
        {busy ? "Re-extracting…" : "Re-extract metadata"}
      </Button>
      {message && (
        <p className="text-sm text-muted-foreground" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
