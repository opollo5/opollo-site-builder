"use client";

import Link from "next/link";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CapCampaign, CampaignStatus } from "@/lib/cap/campaigns";

type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

interface Props {
  companyId: string;
  subscriptionId: string;
  initialCampaigns: CapCampaign[];
}

const STATUS_TONE: Record<CampaignStatus, "success" | "info" | "warning" | "error" | "neutral"> = {
  draft: "neutral",
  generating: "info",
  review: "warning",
  approved: "success",
  pushed: "success",
  published: "success",
  archived: "neutral",
  failed: "error",
};

export function CapCampaignList({ companyId, initialCampaigns }: Props) {
  const [campaigns, setCampaigns] = useState<CapCampaign[]>(initialCampaigns);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState<string | null>(null);

  async function handleGenerate(campaignId: string) {
    setError(null);
    setGenerating(campaignId);
    const res = await fetch(`/api/platform/cap/campaigns/${campaignId}/generate`, {
      method: "POST",
    });
    const json = (await res.json()) as ApiResponse<{ status: string }>;
    setGenerating(null);

    if (!res.ok || !json.ok) {
      setError(!json.ok ? json.error.message : "Generation failed.");
      return;
    }

    setCampaigns((prev) =>
      prev.map((c) =>
        c.id === campaignId ? { ...c, status: json.data.status as CampaignStatus } : c,
      ),
    );
  }

  if (campaigns.length === 0) {
    return (
      <div className="rounded-md border border-border p-6 text-center text-sm text-muted-foreground">
        No campaigns yet. Campaigns are created automatically when the monthly generation cron runs,
        or you can create one manually via the API.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
          {error}
        </div>
      )}
      {campaigns.map((campaign) => {
        const monthLabel = new Date(campaign.month).toLocaleString("en-AU", {
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        });
        const isGeneratable = campaign.status === "draft" || campaign.status === "failed";

        return (
          <Card key={campaign.id}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                <span>{monthLabel}</span>
                <Badge tone={STATUS_TONE[campaign.status]}>
                  {campaign.status.charAt(0).toUpperCase() + campaign.status.slice(1)}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">{campaign.monthly_objective}</p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/admin/companies/${companyId}/cap/campaigns/${campaign.id}`}>
                    View posts
                  </Link>
                </Button>
                {isGeneratable && (
                  <Button
                    size="sm"
                    disabled={generating === campaign.id}
                    onClick={() => void handleGenerate(campaign.id)}
                  >
                    {generating === campaign.id ? "Generating…" : "Generate content"}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
