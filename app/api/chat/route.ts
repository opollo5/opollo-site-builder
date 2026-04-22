import Anthropic from "@anthropic-ai/sdk";

import {
  createPageJsonSchema,
  deletePageJsonSchema,
  getPageJsonSchema,
  listPagesJsonSchema,
  publishPageJsonSchema,
  searchImagesJsonSchema,
  updatePageJsonSchema,
  type ToolResponse,
} from "@/lib/tool-schemas";
import { executeCreatePage } from "@/lib/create-page";
import { executeDeletePage } from "@/lib/delete-page";
import { executeGetPage } from "@/lib/get-page";
import { executeListPages } from "@/lib/list-pages";
import { executePublishPage } from "@/lib/publish-page";
import { executeSearchImages } from "@/lib/search-images";
import { executeUpdatePage } from "@/lib/update-page";
import { buildSystemPromptForSite } from "@/lib/system-prompt";
import { getSite } from "@/lib/sites";
import { traceAnthropicStream } from "@/lib/langfuse";
import { logger } from "@/lib/logger";
import {
  runWithWpCredentials,
  type WpCredentialsOverride,
} from "@/lib/wordpress";

type ToolExecutor = (input: unknown) => Promise<ToolResponse<any>>;

const TOOL_EXECUTORS: Record<string, ToolExecutor> = {
  create_page: executeCreatePage,
  list_pages: executeListPages,
  get_page: executeGetPage,
  update_page: executeUpdatePage,
  publish_page: executePublishPage,
  delete_page: executeDeletePage,
  search_images: executeSearchImages,
};

const ALL_TOOLS = [
  createPageJsonSchema,
  listPagesJsonSchema,
  getPageJsonSchema,
  updatePageJsonSchema,
  publishPageJsonSchema,
  deletePageJsonSchema,
  searchImagesJsonSchema,
];

const EPHEMERAL = { type: "ephemeral" as const };

// Cache-marked tools: adding cache_control to the last tool marks the entire
// tools array as a cacheable prefix for Anthropic's prompt caching.
const CACHED_TOOLS = ALL_TOOLS.map((tool, idx) =>
  idx === ALL_TOOLS.length - 1
    ? { ...tool, cache_control: EPHEMERAL }
    : tool,
);

export const runtime = "nodejs";

const MODEL = "claude-opus-4-7";
const MAX_TOKENS = 4096;
const MAX_ITERATIONS = 5;

// The memoised prompt captures DS state at first-request time within each
// Vercel function instance. Activations propagate lazily as instances recycle.
// This is intentional for M1d; explicit invalidation comes in a later milestone
// alongside per-page iteration (M6 in the roadmap).
let leadsourceFallbackPromptPromise: Promise<string> | null = null;
function getLeadsourceFallbackPrompt(): Promise<string> {
  if (leadsourceFallbackPromptPromise === null) {
    leadsourceFallbackPromptPromise = buildSystemPromptForSite({
      site_name: "LeadSource",
      prefix: "ls",
      design_system_version: "1.0.0",
    });
  }
  return leadsourceFallbackPromptPromise;
}

function cachedSystemBlocks(prompt: string): Anthropic.TextBlockParam[] {
  return [{ type: "text", text: prompt, cache_control: EPHEMERAL }];
}

function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function errorResponse(code: string, message: string, status: number) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: {
        code,
        message,
        retryable: false,
        suggested_action:
          code === "VALIDATION_FAILED"
            ? "Send a JSON body with { messages: [...] }."
            : code === "NOT_FOUND"
              ? "Pick a site that still exists from /api/sites/list."
              : "Check server configuration.",
      },
      timestamp: new Date().toISOString(),
    }),
    { status, headers: { "content-type": "application/json" } },
  );
}

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return errorResponse("VALIDATION_FAILED", "Request body must be JSON.", 400);
  }

  const messages = body?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return errorResponse(
      "VALIDATION_FAILED",
      "messages array is required and must be non-empty.",
      400,
    );
  }

  const activeSiteIdRaw = body?.activeSiteId;
  const hasActiveSiteId =
    typeof activeSiteIdRaw === "string" && activeSiteIdRaw.trim().length > 0;

  // Resolve per-site context: explicit activeSiteId wins. A non-existent or
  // credential-less site returns a 4xx — we do not fall back silently, so the
  // caller sees exactly which site failed.
  let systemPrompt: string;
  let wpCreds: WpCredentialsOverride | undefined;
  let siteLogId: string | null = null;
  let siteLogName: string | null = null;

  if (hasActiveSiteId) {
    const siteId = activeSiteIdRaw.trim();
    const siteResult = await getSite(siteId, { includeCredentials: true });
    if (!siteResult.ok) {
      const code = siteResult.error.code;
      const status =
        code === "NOT_FOUND" ? 404 : code === "INTERNAL_ERROR" ? 500 : 400;
      return new Response(JSON.stringify(siteResult), {
        status,
        headers: { "content-type": "application/json" },
      });
    }
    const { site, credentials } = siteResult.data;
    if (!credentials) {
      return errorResponse(
        "INTERNAL_ERROR",
        `Site ${site.id} has no credentials — re-register or restore the credentials row.`,
        500,
      );
    }
    wpCreds = {
      wp_url: site.wp_url,
      wp_user: credentials.wp_user,
      wp_app_password: credentials.wp_app_password,
    };
    systemPrompt = await buildSystemPromptForSite({
      id: site.id,
      site_name: site.name,
      prefix: site.prefix,
      design_system_version: site.design_system_version,
    });
    siteLogId = site.id;
    siteLogName = site.name;
  } else {
    systemPrompt = await getLeadsourceFallbackPrompt();
    wpCreds = undefined;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return errorResponse(
      "INTERNAL_ERROR",
      "ANTHROPIC_API_KEY is not set.",
      500,
    );
  }

  const client = new Anthropic({ apiKey });
  const encoder = new TextEncoder();
  const cachedSystem = cachedSystemBlocks(systemPrompt);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(sseEvent(event, data)));
      };

      try {
        let convo: Anthropic.MessageParam[] = messages.map((m: any) => ({
          role: m.role,
          content: m.content,
        }));

        let stopReason: string | null = null;

        logger.info("api.chat.stream_start", {
          model: MODEL,
          msg_count: convo.length,
          system_prompt_chars: systemPrompt.length,
          site_id: siteLogId,
          site_name: siteLogName,
          using_env_fallback: !hasActiveSiteId,
        });

        for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
          const span = traceAnthropicStream({
            name: "chat_messages_stream",
            metadata: {
              model: MODEL,
              iter,
              site_id: siteLogId,
              using_env_fallback: !hasActiveSiteId,
            },
            input: {
              system_prompt_bytes: systemPrompt.length,
              msg_count: convo.length,
            },
          });

          const streamed = client.messages.stream({
            model: MODEL,
            max_tokens: MAX_TOKENS,
            system: cachedSystem,
            tools: CACHED_TOOLS,
            messages: convo,
          });

          let finalMsg: Anthropic.Message;
          try {
            for await (const event of streamed) {
              if (
                event.type === "content_block_delta" &&
                event.delta.type === "text_delta"
              ) {
                send("text", { delta: event.delta.text });
              }
            }
            finalMsg = await streamed.finalMessage();
          } catch (iterErr) {
            span.fail(
              iterErr instanceof Error ? iterErr.message : String(iterErr),
            );
            throw iterErr;
          }

          stopReason = finalMsg.stop_reason;

          span.recordFinal({
            id: finalMsg.id,
            model: finalMsg.model,
            stop_reason: finalMsg.stop_reason,
            usage: finalMsg.usage,
          });

          logger.info("api.chat.iteration_complete", {
            iter,
            stop_reason: finalMsg.stop_reason,
            input_tokens: finalMsg.usage.input_tokens,
            output_tokens: finalMsg.usage.output_tokens,
            cache_creation_input_tokens:
              finalMsg.usage.cache_creation_input_tokens ?? 0,
            cache_read_input_tokens:
              finalMsg.usage.cache_read_input_tokens ?? 0,
            site_id: siteLogId,
          });

          const toolUseBlocks = finalMsg.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
          );

          if (finalMsg.stop_reason !== "tool_use" || toolUseBlocks.length === 0) {
            break;
          }

          const toolResultBlocks: Anthropic.ToolResultBlockParam[] = [];
          for (const tu of toolUseBlocks) {
            send("tool_use", { id: tu.id, name: tu.name, input: tu.input });

            let result: unknown;
            let isError = false;
            const executor = TOOL_EXECUTORS[tu.name];
            if (executor) {
              const r = await runWithWpCredentials(wpCreds, () =>
                executor(tu.input),
              );
              result = r;
              if (!r.ok) isError = true;
            } else {
              result = {
                ok: false,
                error: {
                  code: "VALIDATION_FAILED",
                  message: `Unknown tool: ${tu.name}`,
                  retryable: false,
                  suggested_action: `Available tools: ${Object.keys(TOOL_EXECUTORS).join(", ")}.`,
                },
                timestamp: new Date().toISOString(),
              };
              isError = true;
            }

            send("tool_result", { tool_use_id: tu.id, result, is_error: isError });

            toolResultBlocks.push({
              type: "tool_result",
              tool_use_id: tu.id,
              content: JSON.stringify(result),
              is_error: isError,
            });
          }

          convo = [
            ...convo,
            { role: "assistant", content: finalMsg.content },
            { role: "user", content: toolResultBlocks },
          ];

          if (iter === MAX_ITERATIONS - 1) {
            stopReason = "max_iterations";
          }
        }

        send("done", { stop_reason: stopReason ?? "unknown" });
      } catch (err) {
        const apiErr = err instanceof Anthropic.APIError ? err : null;

        const diagnostic = {
          model: MODEL,
          message: err instanceof Error ? err.message : String(err),
          name: err instanceof Error ? err.name : undefined,
          status: apiErr?.status,
          request_id: apiErr?.requestID,
          body: apiErr?.error,
          stack: err instanceof Error ? err.stack : undefined,
        };
        logger.error("api.chat.streaming_error", diagnostic);

        send("error", {
          code: "INTERNAL_ERROR",
          message: diagnostic.message,
          details: {
            name: diagnostic.name,
            status: diagnostic.status,
            request_id: diagnostic.request_id,
            body: diagnostic.body,
          },
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
