"use client";

import { useState, useTransition } from "react";
import { PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Competitor } from "./CompetitorList";

interface AddCompetitorDialogProps {
  companyId: string;
  onAdded: (competitor: Competitor) => void;
}

export function AddCompetitorDialog({ companyId, onAdded }: AddCompetitorDialogProps) {
  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState<string>("LINKEDIN");
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedHandle = handle.trim();
    if (!trimmedHandle) {
      setError("Handle is required");
      return;
    }

    const res = await fetch(`/api/admin/insights/clients/${companyId}/competitors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        platform,
        handle: trimmedHandle,
        display_name: displayName.trim() || null,
      }),
    });

    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      if (res.status === 409) {
        setError("This competitor is already being tracked on this platform.");
      } else {
        setError(body?.error?.message ?? "Failed to add competitor");
      }
      return;
    }

    startTransition(() => {
      onAdded(body.competitor as Competitor);
      setOpen(false);
      setHandle("");
      setDisplayName("");
      setPlatform("LINKEDIN");
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" data-testid="add-competitor-trigger">
          <PlusIcon size={20} />
          Add competitor
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add competitor</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <label htmlFor="platform" className="text-sm font-medium text-tx-primary">
              Platform
            </label>
            <select
              id="platform"
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              data-testid="platform-select"
              className="w-full rounded-md border border-b2 bg-b1 px-3 py-2 text-sm text-tx-primary focus:outline-none focus:ring-2 focus:ring-pk-500"
            >
              <option value="LINKEDIN">LinkedIn</option>
              <option value="FACEBOOK">Facebook</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="handle" className="text-sm font-medium text-tx-primary">
              Handle
            </label>
            <Input
              id="handle"
              placeholder="e.g. acme-corp"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              data-testid="handle-input"
              maxLength={100}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="display-name" className="text-sm font-medium text-tx-primary">
              Display name <span className="text-tx-muted">(optional)</span>
            </label>
            <Input
              id="display-name"
              placeholder="e.g. Acme Corp"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              data-testid="display-name-input"
              maxLength={255}
            />
          </div>
          {error && (
            <p className="text-sm text-rd-500" role="alert" data-testid="add-competitor-error">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending} data-testid="add-competitor-submit">
              {isPending ? "Adding…" : "Add"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
