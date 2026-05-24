interface SocialIconProps {
  size?: number;
  className?: string;
}

export function TikTokIcon({ size = 24, className }: SocialIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <circle cx="12" cy="12" r="12" fill="#000" />
      <path fill="#fff" d="M15.98 10.92c-1.17 0-2.29-.38-3.21-1.04v4.62c0 2.31-1.88 4.19-4.19 4.19s-4.19-1.88-4.19-4.19 1.88-4.19 4.19-4.19c.21 0 .42.02.63.05v2.18a2.04 2.04 0 0 0-2.61 1.96c0 1.12.92 2.04 2.04 2.04s2.04-.92 2.04-2.04V5.66h2.18c.04.22.1.43.18.63a4.05 4.05 0 0 0 2.94 2.46v2.17h.01z" />
    </svg>
  );
}
