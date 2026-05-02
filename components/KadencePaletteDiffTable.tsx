"use client";

import type { PaletteDiff, PaletteDiffEntry } from "@/lib/kadence-mapper";

// ---------------------------------------------------------------------------
// M13-5d — palette diff table.
//
// Renders an 8-row table comparing current Kadence palette slots
// against the DS-derived proposal. Used in the Appearance panel's
// always-visible diff section AND inside the sync-confirm modal so
// the operator sees exactly what's about to change before clicking
// Sync.
// ---------------------------------------------------------------------------

export function KadencePaletteDiffTable({
  diff,
  emptyState,
}: {
  diff: PaletteDiff;
  emptyState?: React.ReactNode;
}) {
  if (diff.entries.length === 0) {
    return (
      <>
        {emptyState ?? (
          <p className="text-sm text-muted-foreground">
            No diff to display — proposal is empty.
          </p>
        )}
      </>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-sm uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">Slot</th>
            <th className="px-3 py-2 text-left">Current</th>
            <th className="px-3 py-2 text-left">Proposed</th>
            <th className="px-3 py-2 text-right">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {diff.entries.map((entry) => (
            <DiffRow key={entry.slot} entry={entry} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DiffRow({ entry }: { entry: PaletteDiffEntry }) {
  return (
    <tr className={entry.changed ? "bg-yellow-500/5" : ""}>
      <td className="px-3 py-2 font-mono text-sm">{entry.slot}</td>
      <td className="px-3 py-2">
        <ColorCell name={entry.current.name} color={entry.current.color} />
      </td>
      <td className="px-3 py-2">
        <ColorCell name={entry.proposed.name} color={entry.proposed.color} />
      </td>
      <td className="px-3 py-2 text-right">
        {entry.changed ? (
          <span className="inline-flex rounded bg-yellow-500/10 px-2 py-0.5 text-sm font-medium text-yellow-900 dark:text-yellow-200">
            Changed
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">No change</span>
        )}
      </td>
    </tr>
  );
}

function ColorCell({
  name,
  color,
}: {
  name: string | null;
  color: string | null;
}) {
  if (!color) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className="inline-block h-5 w-5 shrink-0 rounded border"
        style={{ backgroundColor: color }}
      />
      <div className="min-w-0">
        <div className="font-mono text-sm">{color}</div>
        {name && (
          <div className="truncate text-sm text-muted-foreground">{name}</div>
        )}
      </div>
    </div>
  );
}
