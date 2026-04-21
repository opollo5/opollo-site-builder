// ---------------------------------------------------------------------------
// M6-2 — Tier-2 static HTML preview.
//
// Renders `generated_html` inside a sandboxed iframe via srcdoc. The
// sandbox is intentionally narrow — we DO NOT allow scripts, forms,
// or top-navigation so an accidentally-embedded `<script>` in an
// operator-authored brief can't execute. `allow-same-origin` is off
// too; we don't need it for static HTML + our design-system CSS.
//
// Rendering cap: if generated_html exceeds 500KB we show a size
// warning + a download link rather than inlining — keeps the admin
// page responsive on pathological rows.
// ---------------------------------------------------------------------------

const INLINE_HTML_MAX_BYTES = 500 * 1024;

function estimateBytes(html: string): number {
  // Byte-length estimate without spawning Buffer / TextEncoder on the
  // server render hot path. Approximation is fine — we only need to
  // gate the "inline vs. download" decision.
  return html.length;
}

export function PageHtmlPreview({ html }: { html: string | null }) {
  if (!html) {
    return (
      <div
        className="flex h-64 w-full items-center justify-center rounded-md border bg-muted/30 text-sm text-muted-foreground"
        data-testid="page-html-preview-empty"
      >
        No generated HTML for this page yet.
      </div>
    );
  }

  if (estimateBytes(html) > INLINE_HTML_MAX_BYTES) {
    return (
      <div
        className="flex h-64 w-full flex-col items-center justify-center gap-2 rounded-md border bg-muted/30 p-6 text-sm text-muted-foreground"
        data-testid="page-html-preview-too-large"
      >
        <p>
          Generated HTML is larger than {INLINE_HTML_MAX_BYTES / 1024}KB — inline
          preview skipped to keep the admin page responsive.
        </p>
        <p className="text-xs">
          Open the page in WordPress admin to view it rendered.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-white">
      <div className="flex items-center justify-between border-b px-3 py-2 text-xs text-muted-foreground">
        <span>Preview (static, design-system CSS only)</span>
        <span className="font-mono">
          {(estimateBytes(html) / 1024).toFixed(1)} KB
        </span>
      </div>
      {/*
        sandbox omits allow-scripts, allow-forms, allow-top-navigation,
        and allow-same-origin on purpose. The iframe renders the HTML
        and our DS CSS only; nothing executes or navigates.
      */}
      <iframe
        title="Page HTML preview"
        srcDoc={html}
        sandbox=""
        className="h-[70vh] w-full"
        data-testid="page-html-preview-iframe"
      />
    </div>
  );
}
