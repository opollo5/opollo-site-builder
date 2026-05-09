import type { Metadata } from "next";

import { AutosaveLabClient } from "./AutosaveLabClient";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = {
  title: "Autosave Validation Lab -- Opollo Internal",
  robots: { index: false, follow: false },
};

// /company/internal/autosave-lab
//
// Week 0 item 0.5 -- validation lab for the Spec 14 PR B autosave hooks.
// Runs 12 scenarios against useAutoSave + useTabLeader + useSessionGrace
// using mock save functions (no real API calls).
//
// Access: Opollo staff only (enforced by /company/internal/layout.tsx).
// Purpose: confirm the hooks behave correctly before wiring into Spec 22.
// All 12 scenarios must pass before FEATURE_AUTOSAVE_ADOPTED is enabled.

export default function AutosaveLabPage() {
  return (
    <main className="mx-auto max-w-4xl p-6">
      <PageHeader>
        <PageHeader.Title>Autosave Validation Lab</PageHeader.Title>
        <PageHeader.Subtitle className="text-sm">
          Spec 14 PR B — Week 0 item 0.5. Run all 12 scenarios before enabling{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">FEATURE_AUTOSAVE_ADOPTED</code>.
        </PageHeader.Subtitle>
      </PageHeader>
      <AutosaveLabClient />
    </main>
  );
}
