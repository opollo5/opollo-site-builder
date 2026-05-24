interface SocialIconProps {
  size?: number;
  className?: string;
}

export function XIcon({ size = 24, className }: SocialIconProps) {
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
      <path
        fill="#fff"
        d="M13.85 11.05 17.92 6.4h-1.27l-3.53 4.04L10.3 6.4H6.83l4.27 6.12-4.27 4.88h1.27l3.74-4.27 2.98 4.27h3.47l-4.44-6.35zm-1.32 1.5-.43-.62L8.4 7.32h1.85l2.78 3.96.43.62 3.6 5.16h-1.85l-2.93-4.21z"
      />
    </svg>
  );
}
