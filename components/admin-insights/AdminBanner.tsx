"use client";

import { ShieldIcon } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

interface AdminBannerProps {
  clientName: string;
  companyId: string;
}

export function AdminBanner({ clientName, companyId }: AdminBannerProps) {
  const router = useRouter();

  return (
    <div
      className="bg-am/20 border-b border-am sticky top-0 z-50 px-4 py-2"
      data-testid="admin-banner"
    >
      <div className="flex items-center justify-between max-w-7xl mx-auto">
        <div className="flex items-center gap-2 text-sm">
          <ShieldIcon className="h-5 w-5 text-am" />
          <span className="font-semibold text-tx-primary">
            Viewing as admin · {clientName}
          </span>
          <span className="text-tx-secondary">· All actions logged</span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push(`/admin/insights/clients/${companyId}/competitors`)}
          >
            Manage competitors
          </Button>
          <Button variant="ghost" size="sm" onClick={() => router.push("/admin/insights")}>
            ← Back to roster
          </Button>
        </div>
      </div>
    </div>
  );
}
