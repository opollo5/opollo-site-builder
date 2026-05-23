import { StatusPill } from "@/components/ui/status-pill";

interface SourceBadgeProps {
  source: "cap" | "composer";
}

export function SourceBadge({ source }: SourceBadgeProps) {
  return (
    <StatusPill
      kind={source === "cap" ? "info" : "neutral"}
      label={source === "cap" ? "CAP" : "Composer"}
    />
  );
}
