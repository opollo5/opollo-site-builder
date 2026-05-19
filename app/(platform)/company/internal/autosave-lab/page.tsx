import type { Metadata } from "next";

import { AutosaveLabClient } from "./AutosaveLabClient";
import { TDashboardFeed } from "@/templates";

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
    <TDashboardFeed
      title="Autosave Validation Lab"
      subtitle="Spec 14 PR B — Week 0 item 0.5. Run all 12 scenarios before enabling FEATURE_AUTOSAVE_ADOPTED."
      breadcrumb={[
        { label: "Company", href: "/company" },
        { label: "Internal" },
        { label: "Autosave lab" },
      ]}
      feed={<AutosaveLabClient />}
    />
  );
}
