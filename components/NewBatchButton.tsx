"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  NewBatchModal,
  type BatchTemplateOption,
} from "@/components/NewBatchModal";

// Thin client wrapper around NewBatchModal so server components
// (site detail + batches list) stay server-rendered and only this
// island owns the modal open state.

export function NewBatchButton({
  site,
  templates,
  disabled,
  label = "Run batch",
}: {
  site: { id: string; name: string } | null;
  templates: BatchTemplateOption[];
  disabled?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        disabled={disabled || !site || templates.length === 0}
        title={
          !site
            ? "Pick a site first."
            : templates.length === 0
              ? "This site has no active templates yet."
              : undefined
        }
      >
        {label}
      </Button>
      <NewBatchModal
        open={open}
        onClose={() => setOpen(false)}
        site={site}
        templates={templates}
      />
    </>
  );
}
