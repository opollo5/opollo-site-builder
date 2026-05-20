interface SocialIconProps {
  size?: number;
  className?: string;
}

export function YouTubeIcon({ size = 24, className }: SocialIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <circle cx="12" cy="12" r="12" fill="#FF0000" />
      <path fill="#fff" d="m10.4 14.3 4.16-2.3-4.16-2.3v4.6z" />
      <path fill="#fff" d="M17.86 9.13a1.52 1.52 0 0 0-1.07-1.07C15.85 7.8 12 7.8 12 7.8s-3.85 0-4.79.26A1.52 1.52 0 0 0 6.14 9.13C5.88 10.07 5.88 12 5.88 12s0 1.93.26 2.87c.14.52.55.93 1.07 1.07.94.26 4.79.26 4.79.26s3.85 0 4.79-.26a1.52 1.52 0 0 0 1.07-1.07c.26-.94.26-2.87.26-2.87s0-1.93-.26-2.87z" />
    </svg>
  );
}
