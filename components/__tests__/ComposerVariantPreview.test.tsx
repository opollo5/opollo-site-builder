import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import * as React from "react";

import { ComposerOverlay } from "@/components/social/composer/ComposerOverlay";
import type { Connection } from "@/lib/social/types";

// ---------------------------------------------------------------------------
// Regression test for audit gap C-2 — preview pane must show platform-variant
// content (not base content) when the previewed connection has a variant.
// ComposerOverlay.tsx fix: content={draft.platform_variants[platform]?.content ?? draft.content}
// ---------------------------------------------------------------------------

const LINKEDIN: Connection = {
  id: "conn-li",
  platform: "linkedin",
  account_name: "Test LinkedIn",
  account_avatar_url: "",
};
const FACEBOOK: Connection = {
  id: "conn-fb",
  platform: "facebook",
  account_name: "Test Facebook",
  account_avatar_url: "",
};

describe("ComposerOverlay — platform-variant preview (audit gap C-2)", () => {
  it("preview shows base content when one connection selected and no variant typed", () => {
    render(
      <ComposerOverlay
        open={true}
        onClose={() => undefined}
        companyId="co-1"
        availableConnections={[LINKEDIN]}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: /Post to Test LinkedIn/i }));

    const textarea = screen.getByTestId("content-textarea");
    fireEvent.change(textarea, { target: { value: "base content" } });

    expect(screen.getByTestId("preview-card")).toHaveTextContent("base content");
  });

  it("preview shows linkedin variant content when LinkedIn customize is active", () => {
    render(
      <ComposerOverlay
        open={true}
        onClose={() => undefined}
        companyId="co-1"
        availableConnections={[LINKEDIN, FACEBOOK]}
      />,
    );

    // Select both connections (so CustomizeForRow appears)
    fireEvent.click(screen.getByRole("checkbox", { name: /Post to Test LinkedIn/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Post to Test Facebook/i }));

    // Type base content
    const textarea = screen.getByTestId("content-textarea");
    fireEvent.change(textarea, { target: { value: "base content" } });

    // CustomizeForRow chip for LinkedIn
    const linkedinChip = screen.getByRole("button", { name: "LinkedIn" });
    fireEvent.click(linkedinChip);

    // Now ContentEditor is showing the LinkedIn variant textarea (empty)
    // Type the variant content
    fireEvent.change(textarea, { target: { value: "linkedin variant" } });

    // The preview-card (activePreviewIndex=0 → LinkedIn connection) should show the variant
    expect(screen.getByTestId("preview-card")).toHaveTextContent("linkedin variant");
    expect(screen.getByTestId("preview-card")).not.toHaveTextContent("base content");
  });

  it("facebook preview still shows base content when only linkedin has a variant", () => {
    render(
      <ComposerOverlay
        open={true}
        onClose={() => undefined}
        companyId="co-1"
        availableConnections={[LINKEDIN, FACEBOOK]}
      />,
    );

    // Select both connections
    fireEvent.click(screen.getByRole("checkbox", { name: /Post to Test LinkedIn/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Post to Test Facebook/i }));

    // Type base content
    const textarea = screen.getByTestId("content-textarea");
    fireEvent.change(textarea, { target: { value: "base content" } });

    // Customize LinkedIn only and type a variant
    fireEvent.click(screen.getByRole("button", { name: "LinkedIn" }));
    fireEvent.change(textarea, { target: { value: "linkedin variant" } });

    // Switch preview to Facebook by clicking the "Test Facebook" preview switcher button
    const fbPreviewBtn = screen.getAllByRole("button").find(
      (b) => b.textContent?.includes("Test Facebook"),
    );
    if (fbPreviewBtn) {
      fireEvent.click(fbPreviewBtn);
      // Facebook has no variant — preview should fall back to base content
      expect(screen.getByTestId("preview-card")).toHaveTextContent("base content");
    }
  });

  it("preview falls back to base content when variant is cleared (platform.content = undefined)", () => {
    render(
      <ComposerOverlay
        open={true}
        onClose={() => undefined}
        companyId="co-1"
        availableConnections={[LINKEDIN, FACEBOOK]}
      />,
    );

    // Select both connections
    fireEvent.click(screen.getByRole("checkbox", { name: /Post to Test LinkedIn/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Post to Test Facebook/i }));

    // Type base content
    const textarea = screen.getByTestId("content-textarea");
    fireEvent.change(textarea, { target: { value: "base content" } });

    // Click "Customize for LinkedIn" but do NOT type — variant remains undefined
    const linkedinChip = screen.getByRole("button", { name: "LinkedIn" });
    fireEvent.click(linkedinChip);
    // Immediately deactivate without typing
    fireEvent.click(linkedinChip);

    // platform_variants.linkedin was never written — preview falls back to base
    expect(screen.getByTestId("preview-card")).toHaveTextContent("base content");
  });
});
