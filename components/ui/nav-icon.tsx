import { type LucideIcon } from "lucide-react";

interface NavIconProps {
  icon: LucideIcon;
  size?: number;
  className?: string;
}

export function NavIcon({ icon: Icon, size = 24, className }: NavIconProps) {
  return <Icon size={size} strokeWidth={2} className={className} aria-hidden />;
}
