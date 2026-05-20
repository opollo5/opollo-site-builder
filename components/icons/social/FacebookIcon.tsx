interface SocialIconProps {
  size?: number;
  className?: string;
}

export function FacebookIcon({ size = 24, className }: SocialIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <circle cx="12" cy="12" r="12" fill="#1877F2" />
      <path
        fill="#fff"
        d="M13.42 18v-6h2.04l.3-2.36h-2.34V8.13c0-.68.19-1.15 1.17-1.15h1.25V4.87a16.7 16.7 0 0 0-1.82-.1c-1.8 0-3.04 1.1-3.04 3.12v1.75H9v2.36h1.98V18h2.44z"
      />
    </svg>
  );
}
