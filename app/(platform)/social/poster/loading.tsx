export default function SocialPosterLoading() {
  return (
    <div className="flex h-full flex-col">
      {/* Filter bar skeleton */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <div className="h-8 w-28 animate-pulse rounded-md bg-muted" />
        <div className="h-8 w-32 animate-pulse rounded-md bg-muted" />
        <div className="ml-auto h-8 w-28 animate-pulse rounded-md bg-muted" />
      </div>
      {/* Calendar grid skeleton */}
      <div className="flex-1 p-4">
        <div className="mb-3 h-6 w-32 animate-pulse rounded bg-muted" />
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: 35 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded border border-border bg-muted/30" />
          ))}
        </div>
      </div>
    </div>
  );
}
