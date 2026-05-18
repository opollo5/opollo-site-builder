// Public route group — no authentication required.
// Used by: /review/[token] (approval review page).

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
