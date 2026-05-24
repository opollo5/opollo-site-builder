"use client";

import { useState } from "react";

import { Card, CardHeader } from "@/components/ui/card";
import { Tabs, TabTrigger } from "@/components/ui/tabs";
import type { InsightsDashboardData } from "@/lib/insights/dashboard";
import { SourceComparison } from "./SourceComparison";
import { XPublishingPanel } from "./XPublishingPanel";
import { IntegrationHealthList } from "./IntegrationHealthList";

type FooterTab = "source" | "x" | "health";

interface DashboardFooterTabsProps {
  sourceComparison: InsightsDashboardData["sourceComparison"];
  xMetrics: InsightsDashboardData["xMetrics"];
  xConnected: boolean;
  integrationHealth: InsightsDashboardData["platforms"];
}

export function DashboardFooterTabs({
  sourceComparison,
  xMetrics,
  xConnected,
  integrationHealth,
}: DashboardFooterTabsProps) {
  const [activeTab, setActiveTab] = useState<FooterTab>("source");

  return (
    <Card className="border-b2" data-testid="dashboard-footer-tabs">
      <CardHeader className="pb-0">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as FooterTab)}>
          <TabTrigger value="source">Source comparison</TabTrigger>
          {xConnected && (
            <TabTrigger value="x" data-testid="x-tab">
              X publishing
            </TabTrigger>
          )}
          <TabTrigger value="health">Integration health</TabTrigger>
        </Tabs>
      </CardHeader>
      {activeTab === "source" && <SourceComparison data={sourceComparison} />}
      {activeTab === "x" && xConnected && <XPublishingPanel metrics={xMetrics} />}
      {activeTab === "health" && <IntegrationHealthList platforms={integrationHealth} />}
    </Card>
  );
}
