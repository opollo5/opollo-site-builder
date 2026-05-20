interface SocialIconProps {
  size?: number;
  className?: string;
}

export function GoogleBusinessIcon({ size = 24, className }: SocialIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <circle cx="12" cy="12" r="12" fill="#fff" />
      <path d="M18.6 12.14c0-.45-.04-.88-.12-1.3H12v2.46h3.7c-.16.86-.65 1.59-1.38 2.08v1.73h2.23c1.3-1.2 2.05-2.97 2.05-4.97z" fill="#4285F4" />
      <path d="M12 19c1.86 0 3.42-.62 4.55-1.68l-2.23-1.73c-.62.42-1.41.66-2.32.66-1.78 0-3.29-1.2-3.83-2.82H5.87v1.78A7 7 0 0 0 12 19z" fill="#34A853" />
      <path d="M8.17 13.43A4.2 4.2 0 0 1 7.95 12c0-.5.08-.98.22-1.43V8.79H5.87A7 7 0 0 0 5 12c0 1.13.27 2.2.87 3.21l2.3-1.78z" fill="#FBBC05" />
      <path d="M12 7.75c1.01 0 1.92.35 2.63 1.03l1.97-1.97A7 7 0 0 0 12 5a7 7 0 0 0-6.13 3.79l2.3 1.78C8.71 8.95 10.22 7.75 12 7.75z" fill="#EA4335" />
    </svg>
  );
}
