import { StatusPill } from "@/components/ui/status-pill";

const PLATFORM_LABEL: Record<string, string> = {
  linkedin_personal: "LinkedIn",
  linkedin_company: "LinkedIn",
  facebook_page: "Facebook",
  x: "X",
  gbp: "Google Business",
  instagram_business: "Instagram",
};

interface PlatformBadgeProps {
  platform: string;
}

export function PlatformBadge({ platform }: PlatformBadgeProps) {
  const label = PLATFORM_LABEL[platform] ?? platform;
  return <StatusPill kind="info" label={label} />;
}
