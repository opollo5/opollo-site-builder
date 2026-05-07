"use client";

import * as React from "react";

import { EmptyState, type EmptyStateProps } from "@/components/ui/empty-state";
import { RowActions, type RowAction } from "@/components/ui/row-actions";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Spec 18 — DataTable canonical primitive.
//
// One table to rule them all. Headers all-caps tracked, cells 14px,
// hover row, empty + loading states, optional row click + row actions
// menu, optional checkbox selection. Migration target for every
// bespoke `<table>` in the admin app.
//
// API summary:
//
//   const cols: ColumnDef<Site>[] = [
//     { key: 'name', header: 'Name', cell: row => <TableCell.Primary>{row.name}</TableCell.Primary> },
//     ...
//   ];
//   <DataTable
//     data={sites}
//     columns={cols}
//     rowKey={r => r.id}
//     onRowClick={r => navigate(`/admin/sites/${r.id}`)}
//     rowActions={r => [{ label: 'Edit', onClick: () => ... }]}
//     emptyState={{ icon, title, body, cta }}
//   />
//
// Headers / cells / row hover / actions menu are handled internally so
// every consumer table renders identically by default.
// ---------------------------------------------------------------------------

export interface ColumnDef<T> {
  key: string;
  header: React.ReactNode;
  /** CSS width — e.g. "200px", "20%", "minmax(0, 1fr)". */
  width?: string;
  align?: "left" | "right" | "center";
  cell: (row: T) => React.ReactNode;
}

export interface DataTableProps<T> {
  data: readonly T[];
  columns: ReadonlyArray<ColumnDef<T>>;
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  rowActions?: (row: T) => RowAction[];
  /**
   * `EmptyState` props (icon / title / body / cta) rendered when
   * `data.length === 0` and `loading === false`. Pass `null` to skip
   * rendering anything when empty (rare — most tables should opt in).
   */
  emptyState?: EmptyStateProps | null;
  loading?: boolean;
  /** Number of skeleton rows to render while `loading` is true. */
  loadingRowCount?: number;
  selectable?: boolean;
  selectedKeys?: ReadonlyArray<string>;
  onSelectionChange?: (selectedKeys: string[]) => void;
  /** Test-id on the root `<table>`. */
  testId?: string;
  /** Extra class on the wrapping `<div>`. */
  className?: string;
}

const HEADER_CLASS = cn(
  // Spec 18 canonical: all-caps, 12px, +0.05em tracking, weight 600,
  // muted color. Background: bg-muted/30. Bottom border 1px.
  "px-3 py-3 text-left text-[12px] font-semibold uppercase tracking-wider text-muted-foreground",
);

const CELL_CLASS = cn(
  // Spec 18 canonical: 14px text, py-3.5 (14px) / px-3 (12px). Bottom
  // border 1px on every row except the last (handled via last:border-0).
  "px-3 py-3.5 text-sm text-foreground",
);

export function DataTable<T>({
  data,
  columns,
  rowKey,
  onRowClick,
  rowActions,
  emptyState,
  loading = false,
  loadingRowCount = 5,
  selectable = false,
  selectedKeys,
  onSelectionChange,
  testId,
  className,
}: DataTableProps<T>) {
  // The root layout always renders `border` + rounded corners so empty +
  // populated states sit in the same chrome.
  const wrapperClass = cn("rounded-md border bg-background", className);

  if (!loading && data.length === 0 && emptyState !== null && emptyState !== undefined) {
    return (
      <div className={wrapperClass}>
        <div className="px-4 py-12">
          <EmptyState {...emptyState} />
        </div>
      </div>
    );
  }

  const showActionsCol = Boolean(rowActions);
  const showSelectCol = selectable;
  const allSelected =
    selectable &&
    selectedKeys !== undefined &&
    data.length > 0 &&
    selectedKeys.length === data.length;
  const someSelected =
    selectable &&
    selectedKeys !== undefined &&
    selectedKeys.length > 0 &&
    selectedKeys.length < data.length;

  function handleHeaderToggle() {
    if (!onSelectionChange) return;
    if (allSelected) {
      onSelectionChange([]);
    } else {
      onSelectionChange(data.map(rowKey));
    }
  }

  function handleRowToggle(key: string) {
    if (!onSelectionChange || selectedKeys === undefined) return;
    if (selectedKeys.includes(key)) {
      onSelectionChange(selectedKeys.filter((k) => k !== key));
    } else {
      onSelectionChange([...selectedKeys, key]);
    }
  }

  return (
    <div className={wrapperClass}>
      <div className="w-full overflow-x-auto">
        <table
          className="w-full table-auto border-collapse"
          data-testid={testId}
        >
          <thead className="border-b bg-muted/30">
            <tr>
              {showSelectCol && (
                <th className={cn(HEADER_CLASS, "w-10")}>
                  <input
                    type="checkbox"
                    checked={Boolean(allSelected)}
                    ref={(el) => {
                      if (el) el.indeterminate = Boolean(someSelected);
                    }}
                    onChange={handleHeaderToggle}
                    aria-label="Select all rows"
                    className="h-4 w-4 cursor-pointer rounded border-input"
                  />
                </th>
              )}
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    HEADER_CLASS,
                    col.align === "right" && "text-right",
                    col.align === "center" && "text-center",
                  )}
                  style={col.width ? { width: col.width } : undefined}
                >
                  {col.header}
                </th>
              ))}
              {showActionsCol && (
                // No header label; fixed narrow width for the `...` menu.
                <th className={cn(HEADER_CLASS, "w-10")}>
                  <span className="sr-only">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {loading
              ? renderSkeletonRows(
                  loadingRowCount,
                  columns.length +
                    (showSelectCol ? 1 : 0) +
                    (showActionsCol ? 1 : 0),
                )
              : data.map((row) => {
                  const key = rowKey(row);
                  const isSelected =
                    selectable && selectedKeys?.includes(key);
                  const clickable = Boolean(onRowClick);
                  return (
                    <tr
                      key={key}
                      data-row-key={key}
                      className={cn(
                        "border-b transition-smooth last:border-b-0",
                        "hover:bg-muted/30",
                        clickable && "cursor-pointer",
                        isSelected && "bg-primary/5",
                      )}
                      onClick={
                        clickable
                          ? () => onRowClick!(row)
                          : undefined
                      }
                    >
                      {showSelectCol && (
                        <td
                          className={cn(CELL_CLASS, "w-10")}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={Boolean(isSelected)}
                            onChange={() => handleRowToggle(key)}
                            aria-label={`Select row`}
                            className="h-4 w-4 cursor-pointer rounded border-input"
                          />
                        </td>
                      )}
                      {columns.map((col) => (
                        <td
                          key={col.key}
                          className={cn(
                            CELL_CLASS,
                            col.align === "right" && "text-right",
                            col.align === "center" && "text-center",
                          )}
                          style={col.width ? { width: col.width } : undefined}
                        >
                          {col.cell(row)}
                        </td>
                      ))}
                      {showActionsCol && (
                        <td
                          className={cn(CELL_CLASS, "w-10 text-right")}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <RowActions
                            actions={rowActions!(row)}
                            testId={`row-actions-${key}`}
                          />
                        </td>
                      )}
                    </tr>
                  );
                })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function renderSkeletonRows(count: number, totalCols: number): React.ReactNode {
  return Array.from({ length: count }).map((_, i) => (
    <tr key={`skel-${i}`} className="border-b last:border-b-0">
      {Array.from({ length: totalCols }).map((__, j) => (
        <td key={j} className={CELL_CLASS}>
          <Skeleton className="h-4 w-full max-w-[200px]" />
        </td>
      ))}
    </tr>
  ));
}
