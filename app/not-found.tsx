import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-page-title text-foreground">Page not found</h1>
      <p className="text-base text-muted-foreground">
        We couldn&rsquo;t find the page you&rsquo;re looking for.
      </p>
      <Link
        href="/"
        className="text-sm font-medium underline underline-offset-4"
      >
        Go home
      </Link>
    </main>
  );
}
