import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfirmActionModal } from "@/components/ConfirmActionModal";

// ---------------------------------------------------------------------------
// ConfirmActionModal — component tests
//
// Covers: hidden when closed, renders title/description when open,
// Escape/backdrop close, confirm CTA lifecycle, API success/error paths.
// ---------------------------------------------------------------------------

const BASE_PROPS = {
  title: "Archive version",
  description: "This cannot be undone.",
  confirmLabel: "Archive",
  endpoint: "/api/test/action",
  request: { method: "POST" as const, body: { version: 1 } },
  onClose: vi.fn(),
  onSuccess: vi.fn(),
};

function makeOkFetch(data: unknown = {}) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ ok: true, data }),
  } as Response);
}

function makeErrFetch(message = "Something went wrong") {
  return vi.fn().mockResolvedValue({
    ok: false,
    status: 400,
    json: () =>
      Promise.resolve({ ok: false, error: { code: "BAD_REQUEST", message } }),
  } as Response);
}

describe("ConfirmActionModal", () => {
  beforeEach(() => {
    BASE_PROPS.onClose.mockClear();
    BASE_PROPS.onSuccess.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders nothing when open is false", () => {
    const { container } = render(
      <ConfirmActionModal {...BASE_PROPS} open={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders title and description when open", () => {
    render(<ConfirmActionModal {...BASE_PROPS} open={true} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Archive version" }),
    ).toBeInTheDocument();
    expect(screen.getByText("This cannot be undone.")).toBeInTheDocument();
  });

  it("calls onClose when Escape is pressed", async () => {
    render(<ConfirmActionModal {...BASE_PROPS} open={true} />);
    await userEvent.keyboard("{Escape}");
    expect(BASE_PROPS.onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when backdrop is clicked", async () => {
    render(<ConfirmActionModal {...BASE_PROPS} open={true} />);
    const backdrop = screen.getByRole("dialog");
    fireEvent.click(backdrop);
    expect(BASE_PROPS.onClose).toHaveBeenCalledOnce();
  });

  it("calls onSuccess and onClose on successful API response", async () => {
    vi.stubGlobal("fetch", makeOkFetch({ version: 2 }));

    render(<ConfirmActionModal {...BASE_PROPS} open={true} />);
    await userEvent.click(screen.getByRole("button", { name: "Archive" }));

    await waitFor(() => expect(BASE_PROPS.onSuccess).toHaveBeenCalledOnce());
    expect(BASE_PROPS.onClose).toHaveBeenCalledOnce();
  });

  it("shows error message on API failure without closing", async () => {
    vi.stubGlobal("fetch", makeErrFetch("Version is already archived."));

    render(<ConfirmActionModal {...BASE_PROPS} open={true} />);
    await userEvent.click(screen.getByRole("button", { name: "Archive" }));

    await waitFor(() =>
      expect(
        screen.getByText("Version is already archived."),
      ).toBeInTheDocument(),
    );
    expect(BASE_PROPS.onSuccess).not.toHaveBeenCalled();
    expect(BASE_PROPS.onClose).not.toHaveBeenCalled();
  });

  it("renders extraContent slot when provided", () => {
    render(
      <ConfirmActionModal
        {...BASE_PROPS}
        open={true}
        extraContent={<p>Orphan warning: 3 templates will lose this component.</p>}
      />,
    );
    expect(
      screen.getByText(/Orphan warning/),
    ).toBeInTheDocument();
  });

  it("sends DELETE with searchParams when request method is DELETE", async () => {
    const fetchSpy = makeOkFetch();
    vi.stubGlobal("fetch", fetchSpy);

    render(
      <ConfirmActionModal
        {...BASE_PROPS}
        open={true}
        request={{
          method: "DELETE",
          searchParams: { expected_version_lock: 3 },
        }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Archive" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledOnce());
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toContain("expected_version_lock=3");
    expect((options as RequestInit).method).toBe("DELETE");
  });
});
