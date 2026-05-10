import { NextResponse, type NextRequest } from "next/server";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { createRouteAuthClient, getCurrentUser } from "@/lib/auth";
import {
  checkRateLimit,
  getClientIp,
  rateLimitExceeded,
} from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { extract, CHAR_LIMIT } from "@/lib/ai-prefill";

// POST /api/sites/[id]/ai-prefill
//
// Accepts a blog draft (paste text or file upload) and returns structured
// metadata for pre-filling the BlogPostComposer form. The deterministic
// pipe-table pre-extractor runs first for markdown/text inputs; only on
// cache miss does the request hit Anthropic Haiku.
//
// Request: multipart/form-data
//   text          — pasted plain text (mutually exclusive with file)
//   file          — uploaded file (.docx, .pdf, .md, .html, .txt)
//   availableCategories — JSON string: string[] of WP category names
//   availableTags       — JSON string: string[] of WP tag names
//
// Response: { ok: true, data: ExtractResult } | { ok: false, error: {...} }

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  if (!UUID_RE.test(params.id)) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: "Site id must be a UUID.",
        },
      },
      { status: 400 },
    );
  }

  const supabase = createRouteAuthClient();
  const user = await getCurrentUser(supabase);
  const rlId = user ? `user:${user.id}` : `ip:${getClientIp(req)}`;
  const rl = await checkRateLimit("ai_prefill", rlId);
  if (!rl.ok) return rateLimitExceeded(rl);

  let rawText: string;
  let isMarkdownOrText = true;
  let fileType = "paste";

  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    const pastedText = form.get("text") as string | null;
    const catRaw = form.get("availableCategories") as string | null;
    const tagRaw = form.get("availableTags") as string | null;

    let availableCategories: string[] = [];
    let availableTags: string[] = [];
    try {
      if (catRaw) availableCategories = JSON.parse(catRaw) as string[];
    } catch { /* fail-soft */ }
    try {
      if (tagRaw) availableTags = JSON.parse(tagRaw) as string[];
    } catch { /* fail-soft */ }

    if (file && file.size > 0) {
      const name = file.name.toLowerCase();

      if (
        name.endsWith(".docx") ||
        file.type.includes("wordprocessingml")
      ) {
        fileType = "docx";
        const docxBuf = await file.arrayBuffer();
        // convertToMarkdown exists at runtime but is absent from @types/mammoth;
        // extractRawText is typed and gives plain text (valid for the pre-extractor).
        const mammoth = await import("mammoth");
        const result = await mammoth.extractRawText({ arrayBuffer: docxBuf });
        rawText = result.value;
        isMarkdownOrText = true;
      } else if (
        name.endsWith(".pdf") ||
        file.type === "application/pdf"
      ) {
        fileType = "pdf";
        const pdfArrayBuf = await file.arrayBuffer();
        const pdfBuf = Buffer.from(pdfArrayBuf);
        // pdf-parse ships as CJS; its ESM re-export omits the .default type.
        type PdfParseFn = (buf: Buffer) => Promise<{ text: string }>;
        const pdfMod = await import("pdf-parse");
        const pdfParse = (pdfMod as unknown as { default: PdfParseFn }).default ?? (pdfMod as unknown as PdfParseFn);
        const parsed = await pdfParse(pdfBuf);
        rawText = parsed.text;
        isMarkdownOrText = false;
      } else {
        fileType = name.endsWith(".html") ? "html" : name.endsWith(".md") ? "md" : "txt";
        rawText = await file.text();
        isMarkdownOrText =
          !name.endsWith(".html") && !file.type.includes("html");
      }
    } else if (pastedText && pastedText.trim().length > 0) {
      rawText = pastedText;
      isMarkdownOrText = true;
    } else {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "VALIDATION_FAILED",
            message: "Provide a file or text.",
          },
        },
        { status: 400 },
      );
    }

    const inputChars = Math.min(rawText.length, CHAR_LIMIT);

    logger.info("api.ai_prefill.request", {
      site_id: params.id,
      input_chars: inputChars,
      file_type: fileType,
      is_markdown: isMarkdownOrText,
      truncated: rawText.length > CHAR_LIMIT,
    });

    const result = await extract(
      rawText,
      availableCategories,
      availableTags,
      isMarkdownOrText,
    );

    const fieldsExtracted =
      [result.title, result.seo_title, result.meta_description, result.slug, result.excerpt]
        .filter(Boolean).length +
      (result.content.length > 0 ? 1 : 0) +
      result.categories.length +
      result.tags.length;

    logger.info("api.ai_prefill.response", {
      site_id: params.id,
      fields_extracted: fieldsExtracted,
      categories_count: result.categories.length,
      tags_count: result.tags.length,
      truncated: result.truncated,
    });

    return NextResponse.json({ ok: true, data: result });
  } catch (err) {
    logger.error("api.ai_prefill.error", {
      site_id: params.id,
      err: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Content extraction failed. Try again.",
        },
      },
      { status: 500 },
    );
  }
}
