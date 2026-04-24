import "server-only";

import { z } from "zod";

import type {
  AnthropicCallFn,
  AnthropicResponse,
} from "@/lib/anthropic-call";
import type { SiteConventions } from "@/lib/site-conventions";

// ---------------------------------------------------------------------------
// M12-4 — Visual review pass.
//
// Write-safety-critical slice. Three invariants this lib must hold:
//
//   1. Screenshots never leak. The tmpdir created by the default render
//      is wrapped in try/finally so the cleanup runs on every path
//      (render success, render throw, critique throw). No Storage write,
//      no log line containing image bytes. Parent plan Risk #8.
//
//   2. Iteration cap is hard. The runner (brief-runner.ts) enforces the
//      2-iteration ceiling — this lib returns per-iteration results but
//      never loops itself. Enforcing the cap in a single place
//      (the runner) makes the "runner never runs iteration 3" test
//      simpler and keeps this lib stateless. Parent plan Risk #13.
//
//   3. Multi-modal content blocks flow through the anthropic-call wrapper
//      without touching disk or observability. The wrapper redacts
//      image bytes from Langfuse span input so the trace contract
//      survives.
// ---------------------------------------------------------------------------

// Viewport matches M7's publish preview — a typical desktop admin surface.
// Deliberately not responsive; per-breakpoint visual review is a future slice.
export const VISUAL_REVIEW_VIEWPORT_WIDTH = 1440;
export const VISUAL_REVIEW_VIEWPORT_HEIGHT = 900;

// Hard cap on visual iterations per page. See parent plan Risk #13.
// Surfaced here so tests + runner share the constant.
export const VISUAL_MAX_ITERATIONS = 2;

// Default per-page combined-cost ceiling (cents). Tenants can override
// via tenant_cost_budgets.per_page_ceiling_cents_override. See parent
// plan Risk #13.
export const BRIEF_PAGE_COST_CEILING_CENTS = 200;

// Max tokens for the critique response. Generous — most critiques are
// a handful of short bullet issues, but a pathological layout might
// produce a long diagnosis.
const CRITIQUE_MAX_TOKENS = 1024;

// ---------------------------------------------------------------------------
// Zod schema for the parsed critique.
// ---------------------------------------------------------------------------

const VisualIssueSchema = z.object({
  category: z.enum([
    "layout",
    "visual_hierarchy",
    "contrast",
    "whitespace",
    "cta_prominence",
    "other",
  ]),
  severity: z.enum(["high", "low"]),
  note: z.string().min(1).max(500),
});

export const VisualCritiqueSchema = z.object({
  issues: z.array(VisualIssueSchema).max(20),
  overall_notes: z.string().max(2000).default(""),
});

export type VisualCritique = z.infer<typeof VisualCritiqueSchema>;

export function hasSeverityHighIssues(critique: VisualCritique): boolean {
  return critique.issues.some((i) => i.severity === "high");
}

// ---------------------------------------------------------------------------
// Render function — DI seam. Tests stub this so chromium isn't required
// in the `test` CI job. Integration coverage with real chromium lands
// in the e2e spec (which installs chromium via the e2e CI workflow).
// ---------------------------------------------------------------------------

export type VisualRenderResult = {
  viewport_png_base64: string;
  full_page_png_base64: string;
  viewport_bytes: number;
  full_page_bytes: number;
};

export type VisualRenderFn = (opts: {
  draftHtml: string;
  siteConventionsCss?: string | null;
  viewportWidth?: number;
  viewportHeight?: number;
}) => Promise<VisualRenderResult>;

/**
 * Production render — dynamic-imports playwright-core so test
 * environments without chromium never attempt to launch a browser.
 *
 * Contract (parent plan Risk #8):
 *   - A unique tmpdir is created per call.
 *   - `draftHtml` is written into the tmpdir as `page.html`.
 *   - Chromium is launched headless, navigates `file://<tmp>/page.html`.
 *   - Viewport + full-page PNGs are returned as base64 strings.
 *   - The tmpdir is `rm -rf`'d and the browser closed in `finally`.
 *     No path — success, render throw, screenshot throw — leaves the
 *     tmpdir on disk.
 *
 * No Storage write. No log line. The base64 strings flow only to the
 * Claude multi-modal call via lib/anthropic-call (which redacts image
 * bytes from the Langfuse span).
 */
export const defaultVisualRender: VisualRenderFn = async (opts) => {
  const [{ mkdtemp, writeFile, rm }, { tmpdir }, { join }, pwCore] =
    await Promise.all([
      import("node:fs/promises"),
      import("node:os"),
      import("node:path"),
      import("playwright-core"),
    ]);

  const width = opts.viewportWidth ?? VISUAL_REVIEW_VIEWPORT_WIDTH;
  const height = opts.viewportHeight ?? VISUAL_REVIEW_VIEWPORT_HEIGHT;

  const htmlWrapped = opts.siteConventionsCss
    ? `<!doctype html><html><head><meta charset="utf-8"><style>${opts.siteConventionsCss}</style></head><body>${opts.draftHtml}</body></html>`
    : `<!doctype html><html><head><meta charset="utf-8"></head><body>${opts.draftHtml}</body></html>`;

  const dir = await mkdtemp(join(tmpdir(), "opollo-vr-"));
  const filePath = join(dir, "page.html");
  let browser: Awaited<
    ReturnType<typeof pwCore.chromium.launch>
  > | null = null;
  try {
    await writeFile(filePath, htmlWrapped, "utf8");
    browser = await pwCore.chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width, height },
    });
    const page = await context.newPage();
    await page.goto(`file://${filePath}`, { waitUntil: "networkidle" });
    const viewportPng = await page.screenshot({ type: "png", fullPage: false });
    const fullPagePng = await page.screenshot({ type: "png", fullPage: true });
    return {
      viewport_png_base64: viewportPng.toString("base64"),
      full_page_png_base64: fullPagePng.toString("base64"),
      viewport_bytes: viewportPng.length,
      full_page_bytes: fullPagePng.length,
    };
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
};

// ---------------------------------------------------------------------------
// Critique call — multi-modal.
// ---------------------------------------------------------------------------

export type VisualCritiqueContext = {
  pageTitle: string;
  pageSourceText: string;
  brandVoice: string | null;
  designDirection: string | null;
  siteConventions: SiteConventions | null;
  previousCritique: string | null;
};

function systemPromptForCritique(): string {
  return [
    "You are a visual design reviewer for a website page.",
    "You will be shown two screenshots (viewport-fit + full-page) of the page,",
    "plus the page brief and design conventions.",
    "Return a structured JSON critique focusing on material layout + readability issues.",
  ].join(" ");
}

function userPromptForCritique(ctx: VisualCritiqueContext): string {
  const parts: string[] = [];
  parts.push(
    `<page_spec>\nTitle: ${ctx.pageTitle}\n\n${ctx.pageSourceText}\n</page_spec>`,
  );
  if (ctx.brandVoice) {
    parts.push(`<brand_voice>\n${ctx.brandVoice}\n</brand_voice>`);
  }
  if (ctx.designDirection) {
    parts.push(
      `<design_direction>\n${ctx.designDirection}\n</design_direction>`,
    );
  }
  if (ctx.siteConventions) {
    parts.push(
      `<site_conventions>\n${JSON.stringify(ctx.siteConventions)}\n</site_conventions>`,
    );
  }
  if (ctx.previousCritique) {
    parts.push(
      `<previous_critique>\nThis is a re-review after one revise pass. Earlier critique was:\n${ctx.previousCritique}\n</previous_critique>`,
    );
  }
  parts.push(
    [
      "Respond with a single ```json fenced block containing an object of this shape:",
      "",
      "{",
      '  "issues": [',
      '    { "category": "layout" | "visual_hierarchy" | "contrast" | "whitespace" | "cta_prominence" | "other",',
      '      "severity": "high" | "low",',
      '      "note": "short concrete issue description (max 500 chars)" }',
      "  ],",
      '  "overall_notes": "(optional) page-level summary, max 2000 chars"',
      "}",
      "",
      "Flag severity=high ONLY for issues that materially block shipping: layout collapse, illegible text, missing CTA, unreadable contrast. Severity=low is polish work.",
      "If the page looks good, return an empty issues array.",
    ].join("\n"),
  );
  return parts.join("\n\n");
}

export type VisualCritiqueOk = {
  ok: true;
  critique: VisualCritique;
  response: AnthropicResponse;
};

export type VisualCritiqueFail = {
  ok: false;
  code: "CRITIQUE_PARSE_FAILED" | "ANTHROPIC_ERROR";
  message: string;
  response?: AnthropicResponse;
};

export type VisualCritiqueResult = VisualCritiqueOk | VisualCritiqueFail;

function extractJsonFromResponse(text: string): unknown | null {
  const fence = /```json\s*([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  let last: string | null = null;
  while ((m = fence.exec(text)) !== null) last = m[1] ?? null;
  const candidate = last ?? text;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

/**
 * Call Claude with the screenshots + page context and parse the
 * response as a VisualCritique. Malformed JSON or schema-invalid
 * payload → CRITIQUE_PARSE_FAILED (does NOT burn an iteration in the
 * runner; the runner retries once or commits with a quality_flag).
 */
export async function critiqueBriefPageVisually(opts: {
  call: AnthropicCallFn;
  model: string;
  ctx: VisualCritiqueContext;
  render: VisualRenderResult;
  idempotencyKey: string;
}): Promise<VisualCritiqueResult> {
  let response: AnthropicResponse;
  try {
    response = await opts.call({
      model: opts.model,
      max_tokens: CRITIQUE_MAX_TOKENS,
      system: systemPromptForCritique(),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: userPromptForCritique(opts.ctx) },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: opts.render.viewport_png_base64,
              },
            },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: opts.render.full_page_png_base64,
              },
            },
          ],
        },
      ],
      idempotency_key: opts.idempotencyKey,
    });
  } catch (err) {
    return {
      ok: false,
      code: "ANTHROPIC_ERROR",
      message: err instanceof Error ? err.message : String(err),
    };
  }

  const text = response.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const parsed = extractJsonFromResponse(text);
  if (parsed === null) {
    return {
      ok: false,
      code: "CRITIQUE_PARSE_FAILED",
      message: "Visual critique response did not contain parseable JSON.",
      response,
    };
  }
  const result = VisualCritiqueSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      code: "CRITIQUE_PARSE_FAILED",
      message: "Visual critique JSON failed schema validation.",
      response,
    };
  }
  return { ok: true, critique: result.data, response };
}

// ---------------------------------------------------------------------------
// One-iteration orchestrator — render + critique + cleanup. Used by the
// brief-runner's visual loop (which owns the iteration cap + cost
// ceiling).
// ---------------------------------------------------------------------------

export type VisualIterationOk = {
  ok: true;
  critique: VisualCritique;
  response: AnthropicResponse;
  render: VisualRenderResult;
};

export type VisualIterationFail = {
  ok: false;
  code: "RENDER_FAILED" | "CRITIQUE_PARSE_FAILED" | "ANTHROPIC_ERROR";
  message: string;
  response?: AnthropicResponse;
};

export type VisualIterationResult = VisualIterationOk | VisualIterationFail;

export async function runOneVisualIteration(opts: {
  render: VisualRenderFn;
  call: AnthropicCallFn;
  model: string;
  draftHtml: string;
  siteConventionsCss?: string | null;
  ctx: VisualCritiqueContext;
  idempotencyKey: string;
}): Promise<VisualIterationResult> {
  let rendered: VisualRenderResult;
  try {
    rendered = await opts.render({
      draftHtml: opts.draftHtml,
      siteConventionsCss: opts.siteConventionsCss,
    });
  } catch (err) {
    return {
      ok: false,
      code: "RENDER_FAILED",
      message: err instanceof Error ? err.message : String(err),
    };
  }

  const critiqueResult = await critiqueBriefPageVisually({
    call: opts.call,
    model: opts.model,
    ctx: opts.ctx,
    render: rendered,
    idempotencyKey: opts.idempotencyKey,
  });

  if (!critiqueResult.ok) {
    return {
      ok: false,
      code: critiqueResult.code,
      message: critiqueResult.message,
      ...(critiqueResult.response ? { response: critiqueResult.response } : {}),
    };
  }
  return {
    ok: true,
    critique: critiqueResult.critique,
    response: critiqueResult.response,
    render: rendered,
  };
}

// ---------------------------------------------------------------------------
// Cost ceiling helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the per-page cost ceiling for a given site. Returns the
 * tenant's override if set, otherwise the lib default.
 */
export function resolvePerPageCeilingCents(
  tenantOverride: number | null,
): number {
  if (tenantOverride !== null && tenantOverride > 0) return tenantOverride;
  return BRIEF_PAGE_COST_CEILING_CENTS;
}

/**
 * Check whether a projected iteration cost would push the page over
 * its ceiling. Returns true iff the next iteration should be SKIPPED.
 */
export function wouldExceedPageCeiling(opts: {
  currentPageCostCents: number;
  projectedIterationCostCents: number;
  ceilingCents: number;
}): boolean {
  return (
    opts.currentPageCostCents + opts.projectedIterationCostCents >
    opts.ceilingCents
  );
}
