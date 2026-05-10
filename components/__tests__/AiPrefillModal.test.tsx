import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AiPrefillModal } from "@/components/AiPrefillModal";

// ---------------------------------------------------------------------------
// AiPrefillModal — component tests
//
// Covers: closed/open states, text input + char counter, file drop/select,
// file type validation, generate button lifecycle, error states, apply
// callback payload, loading-state lockout.
// ---------------------------------------------------------------------------

const BASE_PROPS = {
  siteId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  open: true,
  onClose: vi.fn(),
  onApply: vi.fn(),
};

// Stub fetch globally; tests override per-scenario.
function makeFetch(responses: Array<{ ok: boolean; data?: unknown; error?: unknown }>) {
  let call = 0;
  return vi.fn().mockImplementation(() => {
    const r = responses[call++] ?? responses[responses.length - 1];
    return Promise.resolve({
      ok: r!.ok,
      status: r!.ok ? 200 : 400,
      json: () => Promise.resolve(r!.ok ? { ok: true, data: r!.data } : { ok: false, error: r!.error }),
    });
  });
}

const TAX_RESPONSE = {
  ok: true,
  data: { items: [{ id: 1, name: "Marketing", slug: "marketing", count: 5 }] },
};

const PREFILL_RESPONSE = {
  ok: true,
  data: {
    title: "Test Post Title",
    content: "Test content paragraph.",
    seo_title: "Test SEO Title",
    meta_description: "Test meta description.",
    slug: "test-post-title",
    categories: [{ name: "Marketing", isNew: false }],
    tags: [{ name: "seo", isNew: true }],
    excerpt: null,
    truncated: false,
  },
};

describe("AiPrefillModal", () => {
  beforeEach(() => {
    BASE_PROPS.onClose.mockClear();
    BASE_PROPS.onApply.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the dialog when open=true", () => {
    global.fetch = makeFetch([TAX_RESPONSE]);
    render(<AiPrefillModal {...BASE_PROPS} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Generate from content")).toBeInTheDocument();
  });

  it("does not render dialog content when open=false", () => {
    render(<AiPrefillModal {...BASE_PROPS} open={false} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows char count that increments as user types", async () => {
    global.fetch = makeFetch([TAX_RESPONSE]);
    render(<AiPrefillModal {...BASE_PROPS} />);
    const ta = screen.getByTestId("ai-prefill-textarea");
    await userEvent.type(ta, "Hello");
    expect(screen.getByTestId("ai-prefill-char-count")).toHaveTextContent("5 / 20,000");
  });

  it("Generate button is disabled when textarea is empty and no file", () => {
    global.fetch = makeFetch([TAX_RESPONSE]);
    render(<AiPrefillModal {...BASE_PROPS} />);
    expect(screen.getByTestId("ai-prefill-generate")).toBeDisabled();
  });

  it("Generate button enables once textarea has content", async () => {
    global.fetch = makeFetch([TAX_RESPONSE]);
    render(<AiPrefillModal {...BASE_PROPS} />);
    await userEvent.type(screen.getByTestId("ai-prefill-textarea"), "some content");
    expect(screen.getByTestId("ai-prefill-generate")).toBeEnabled();
  });

  it("Cancel button calls onClose", async () => {
    global.fetch = makeFetch([TAX_RESPONSE]);
    render(<AiPrefillModal {...BASE_PROPS} />);
    await userEvent.click(screen.getByTestId("ai-prefill-cancel"));
    expect(BASE_PROPS.onClose).toHaveBeenCalledOnce();
  });

  it("successful generation calls onApply and then onClose", async () => {
    global.fetch = makeFetch([TAX_RESPONSE, TAX_RESPONSE, PREFILL_RESPONSE]);
    render(<AiPrefillModal {...BASE_PROPS} />);
    await userEvent.type(screen.getByTestId("ai-prefill-textarea"), "My blog content");
    await userEvent.click(screen.getByTestId("ai-prefill-generate"));

    await waitFor(() => {
      expect(BASE_PROPS.onApply).toHaveBeenCalledOnce();
      expect(BASE_PROPS.onClose).toHaveBeenCalledOnce();
    });
  });

  it("onApply receives resolved taxonomy options", async () => {
    global.fetch = makeFetch([TAX_RESPONSE, TAX_RESPONSE, PREFILL_RESPONSE]);
    render(<AiPrefillModal {...BASE_PROPS} />);
    await userEvent.type(screen.getByTestId("ai-prefill-textarea"), "content");
    await userEvent.click(screen.getByTestId("ai-prefill-generate"));

    await waitFor(() => expect(BASE_PROPS.onApply).toHaveBeenCalledOnce());
    const payload = BASE_PROPS.onApply.mock.calls[0][0];
    // Existing category "Marketing" should have real id=1 from taxonomy fetch
    expect(payload.categories[0].id).toBe(1);
    expect(payload.categories[0].name).toBe("Marketing");
    // New tag "seo" should have a negative id (placeholder)
    expect(payload.tags[0].id).toBeLessThan(0);
    expect(payload.tags[0].isNew).toBe(true);
  });

  it("shows error message when generation fails", async () => {
    global.fetch = makeFetch([
      TAX_RESPONSE,
      TAX_RESPONSE,
      { ok: false, error: { message: "Content extraction failed. Try again." } },
    ]);
    render(<AiPrefillModal {...BASE_PROPS} />);
    await userEvent.type(screen.getByTestId("ai-prefill-textarea"), "some text");
    await userEvent.click(screen.getByTestId("ai-prefill-generate"));

    await waitFor(() => {
      expect(screen.getByTestId("ai-prefill-error")).toHaveTextContent(
        "Content extraction failed. Try again.",
      );
    });
    expect(BASE_PROPS.onApply).not.toHaveBeenCalled();
    expect(BASE_PROPS.onClose).not.toHaveBeenCalled();
  });

  it("rejects unsupported file types with a file error message", async () => {
    global.fetch = makeFetch([TAX_RESPONSE]);
    render(<AiPrefillModal {...BASE_PROPS} />);
    const fileInput = screen.getByTestId("ai-prefill-file-input");
    const badFile = new File(["content"], "image.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [badFile] } });
    expect(
      await screen.findByText(/Unsupported file type/i),
    ).toBeInTheDocument();
    expect(screen.getByTestId("ai-prefill-generate")).toBeDisabled();
  });

  it("accepts .txt files without error", async () => {
    global.fetch = makeFetch([TAX_RESPONSE]);
    render(<AiPrefillModal {...BASE_PROPS} />);
    const fileInput = screen.getByTestId("ai-prefill-file-input");
    const txtFile = new File(["hello"], "draft.txt", { type: "text/plain" });
    fireEvent.change(fileInput, { target: { files: [txtFile] } });
    expect(screen.queryByText(/Unsupported file type/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("ai-prefill-generate")).toBeEnabled();
  });

  it("shows loading state while generating", async () => {
    let resolveFetch!: (v: unknown) => void;
    global.fetch = vi.fn().mockImplementation(() =>
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    render(<AiPrefillModal {...BASE_PROPS} />);
    await userEvent.type(screen.getByTestId("ai-prefill-textarea"), "content");
    await userEvent.click(screen.getByTestId("ai-prefill-generate"));

    expect(screen.getByTestId("ai-prefill-generate")).toBeDisabled();
    expect(screen.getByText(/Analysing content/i)).toBeInTheDocument();
    expect(screen.getByTestId("ai-prefill-cancel")).toBeDisabled();

    // Clean up: resolve the pending fetch.
    resolveFetch({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ok: true, data: TAX_RESPONSE.data }),
    });
  });
});
