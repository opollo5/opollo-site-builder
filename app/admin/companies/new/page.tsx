import { PlatformCompanyCreateForm } from "@/components/PlatformCompanyCreateForm";

// P3-2 — Opollo admin "create company" page. Server-rendered shell;
// the form posts to POST /api/admin/companies. Gated by
// app/admin/layout.tsx's checkAdminAccess (operator-side).

export const dynamic = "force-dynamic";

export default function NewCompanyPage() {
  return <PlatformCompanyCreateForm />;
}
