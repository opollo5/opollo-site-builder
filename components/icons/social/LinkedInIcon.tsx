interface SocialIconProps {
  size?: number;
  className?: string;
}

export function LinkedInIcon({ size = 24, className }: SocialIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <circle cx="12" cy="12" r="12" fill="#0A66C2" />
      <path
        fill="#fff"
        d="M9 9.5h2.6v1.4h.04c.36-.68 1.24-1.4 2.56-1.4 2.74 0 3.24 1.8 3.24 4.14V18h-2.7v-3.74c0-.9-.02-2.04-1.24-2.04-1.24 0-1.44.97-1.44 1.98V18H9V9.5zM6 9.5h2.7V18H6V9.5zM7.35 5.5a1.56 1.56 0 1 1 0 3.12 1.56 1.56 0 0 1 0-3.12z"
      />
    </svg>
  );
}
