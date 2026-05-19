export interface TErrorStateProps {
  title: string;
  body: string;
  /** Optional CTA rendered below the body (e.g. a back-link or Button). */
  cta?: React.ReactNode;
}

/**
 * T-ERROR-STATE
 *
 * Full-screen error page for unauthenticated/static error surfaces.
 * No nav, no session dependency. Minimal markup.
 */
export function TErrorState({ title, body, cta }: TErrorStateProps) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-page-title text-foreground">{title}</h1>
      <p className="text-base text-muted-foreground">{body}</p>
      {cta}
    </main>
  );
}
