import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DataTable, type ColumnDef } from "@/components/ui/data-table";
import { Pill } from "@/components/ui/pill";
import { TableCell } from "@/components/ui/table-cell";

// ---------------------------------------------------------------------------
// Spec 18 — DataTable + Pill + TableCell component tests.
// ---------------------------------------------------------------------------

interface Row {
  id: string;
  name: string;
  status: "Connected" | "Not Connected";
}

const SAMPLE: Row[] = [
  { id: "a", name: "Alpha", status: "Connected" },
  { id: "b", name: "Beta", status: "Not Connected" },
];

const COLS: ColumnDef<Row>[] = [
  {
    key: "name",
    header: "Name",
    cell: (r) => <TableCell.Primary>{r.name}</TableCell.Primary>,
  },
  {
    key: "status",
    header: "Status",
    cell: (r) => (
      <Pill variant={r.status === "Connected" ? "success" : "neutral"}>
        {r.status}
      </Pill>
    ),
  },
];

describe("DataTable", () => {
  it("renders headers + rows", () => {
    render(<DataTable data={SAMPLE} columns={COLS} rowKey={(r) => r.id} />);
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("renders the empty state when data is empty and emptyState is provided", () => {
    render(
      <DataTable<Row>
        data={[]}
        columns={COLS}
        rowKey={(r) => r.id}
        emptyState={{
          icon: <span>icon</span>,
          title: "Nothing yet",
          body: "Try adding one.",
        }}
      />,
    );
    expect(screen.getByText("Nothing yet")).toBeInTheDocument();
    expect(screen.getByText("Try adding one.")).toBeInTheDocument();
  });

  it("renders skeleton rows when loading", () => {
    const { container } = render(
      <DataTable<Row>
        data={[]}
        columns={COLS}
        rowKey={(r) => r.id}
        loading
        loadingRowCount={3}
      />,
    );
    // 3 skeleton rows × 2 columns = 6 skeleton cells.
    const rows = container.querySelectorAll("tbody tr");
    expect(rows.length).toBe(3);
  });

  it("fires onRowClick when a row is clicked", async () => {
    const onRowClick = vi.fn();
    render(
      <DataTable
        data={SAMPLE}
        columns={COLS}
        rowKey={(r) => r.id}
        onRowClick={onRowClick}
      />,
    );
    const row = screen.getByText("Alpha").closest("tr");
    expect(row).not.toBeNull();
    fireEvent.click(row!);
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick).toHaveBeenCalledWith(SAMPLE[0]);
  });

  it("renders the row actions menu and fires action callbacks", async () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    render(
      <DataTable
        data={SAMPLE}
        columns={COLS}
        rowKey={(r) => r.id}
        rowActions={(r) => [
          { label: `Edit ${r.name}`, onClick: onEdit },
          {
            label: `Delete ${r.name}`,
            variant: "destructive" as const,
            onClick: onDelete,
          },
        ]}
      />,
    );
    const triggers = screen.getAllByRole("button", { name: "Row actions" });
    expect(triggers.length).toBe(2);
    await userEvent.click(triggers[0]);
    const editItem = await screen.findByRole("menuitem", { name: "Edit Alpha" });
    await userEvent.click(editItem);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("does not fire onRowClick when the row actions trigger is clicked", async () => {
    const onRowClick = vi.fn();
    render(
      <DataTable
        data={SAMPLE}
        columns={COLS}
        rowKey={(r) => r.id}
        onRowClick={onRowClick}
        rowActions={() => [{ label: "Noop", onClick: vi.fn() }]}
      />,
    );
    const triggers = screen.getAllByRole("button", { name: "Row actions" });
    await userEvent.click(triggers[0]);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("toggles selection when checkbox column is enabled", async () => {
    const onSelectionChange = vi.fn();
    const { rerender } = render(
      <DataTable
        data={SAMPLE}
        columns={COLS}
        rowKey={(r) => r.id}
        selectable
        selectedKeys={[]}
        onSelectionChange={onSelectionChange}
      />,
    );
    const checkboxes = screen.getAllByRole("checkbox");
    // 1 header + 2 rows = 3 checkboxes.
    expect(checkboxes.length).toBe(3);
    await userEvent.click(checkboxes[1]);
    expect(onSelectionChange).toHaveBeenCalledWith(["a"]);

    // Render with one selected; clicking the header should select all.
    rerender(
      <DataTable
        data={SAMPLE}
        columns={COLS}
        rowKey={(r) => r.id}
        selectable
        selectedKeys={["a"]}
        onSelectionChange={onSelectionChange}
      />,
    );
    await userEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(onSelectionChange).toHaveBeenLastCalledWith(["a", "b"]);
  });
});

describe("Pill", () => {
  it("renders all six variants with the children verbatim", () => {
    const variants = ["success", "neutral", "warning", "danger", "info", "accent"] as const;
    for (const v of variants) {
      const { unmount } = render(<Pill variant={v}>{v}-label</Pill>);
      expect(screen.getByText(`${v}-label`)).toBeInTheDocument();
      unmount();
    }
  });
});

describe("TableCell helpers", () => {
  it("Stack renders both primary and secondary lines", () => {
    render(<TableCell.Stack primary="Site name" secondary="never tested" />);
    expect(screen.getByText("Site name")).toBeInTheDocument();
    expect(screen.getByText("never tested")).toBeInTheDocument();
  });

  it("Stack omits secondary when not provided", () => {
    render(<TableCell.Stack primary="Site name" />);
    expect(screen.getByText("Site name")).toBeInTheDocument();
  });

  it("Empty renders an em-dash", () => {
    render(<TableCell.Empty />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("Mono wraps content in a <code>", () => {
    const { container } = render(<TableCell.Mono>foo-bar</TableCell.Mono>);
    expect(container.querySelector("code")).not.toBeNull();
  });
});
