import { StatusPill } from "@/components/ui/status-pill";

interface HealthBadgeProps {
  status: "green" | "amber" | "red";
}

const LABEL: Record<string, string> = {
  green: "Green",
  amber: "Amber",
  red: "Red",
};

const KIND: Record<string, "client_green" | "client_amber" | "client_red"> = {
  green: "client_green",
  amber: "client_amber",
  red: "client_red",
};

export function HealthBadge({ status }: HealthBadgeProps) {
  return <StatusPill kind={KIND[status]} label={LABEL[status]} />;
}
