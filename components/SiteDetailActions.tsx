"use client";

import { MenuProvider, SiteActionsMenu } from "@/components/SiteActionsMenu";
import { NewBatchButton } from "@/components/NewBatchButton";
import type { BatchTemplateOption } from "@/components/NewBatchModal";

export function SiteDetailActions({
  site,
  templates,
}: {
  site: { id: string; name: string; wp_url: string };
  templates: BatchTemplateOption[];
}) {
  return (
    <div className="flex flex-col items-end gap-2">
      <NewBatchButton
        site={{ id: site.id, name: site.name }}
        templates={templates}
      />
      <MenuProvider>
        <SiteActionsMenu
          siteId={site.id}
          name={site.name}
          wpUrl={site.wp_url}
        />
      </MenuProvider>
    </div>
  );
}
