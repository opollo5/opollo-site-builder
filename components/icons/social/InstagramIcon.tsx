interface SocialIconProps {
  size?: number;
  className?: string;
}

export function InstagramIcon({ size = 24, className }: SocialIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <defs>
        <linearGradient id="ig-grad" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#FED576" />
          <stop offset="30%" stopColor="#F47133" />
          <stop offset="60%" stopColor="#BC3081" />
          <stop offset="100%" stopColor="#4C63D2" />
        </linearGradient>
      </defs>
      <circle cx="12" cy="12" r="12" fill="url(#ig-grad)" />
      <rect x="7" y="7" width="10" height="10" rx="2.8" fill="none" stroke="#fff" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="2.3" fill="none" stroke="#fff" strokeWidth="1.5" />
      <circle cx="15.2" cy="8.8" r="0.7" fill="#fff" />
    </svg>
  );
}
