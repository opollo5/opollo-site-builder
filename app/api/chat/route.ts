import Anthropic from "@anthropic-ai/sdk";

import {
  createPageJsonSchema,
  deletePageJsonSchema,
  getPageJsonSchema,
  listPagesJsonSchema,
  publishPageJsonSchema,
  updatePageJsonSchema,
  type ToolResponse,
} from "@/lib/tool-schemas";
import { executeCreatePage } from "@/lib/create-page";
import { executeDeletePage } from "@/lib/delete-page";
import { executeGetPage } from "@/lib/get-page";
import { executeListPages } from "@/lib/list-pages";
import { executePublishPage } from "@/lib/publish-page";
import { executeUpdatePage } from "@/lib/update-page";
import {
  buildSystemPrompt,
  type SystemPromptContext,
} from "@/lib/system-prompt";

type ToolExecutor = (input: unknown) => Promise<ToolResponse<any>>;

const TOOL_EXECUTORS: Record<string, ToolExecutor> = {
  create_page: executeCreatePage,
  list_pages: executeListPages,
  get_page: executeGetPage,
  update_page: executeUpdatePage,
  publish_page: executePublishPage,
  delete_page: executeDeletePage,
};

const ALL_TOOLS = [
  createPageJsonSchema,
  listPagesJsonSchema,
  getPageJsonSchema,
  updatePageJsonSchema,
  publishPageJsonSchema,
  deletePageJsonSchema,
];

export const runtime = "nodejs";

const MODEL = "claude-opus-4-7";
const MAX_TOKENS = 4096;
const MAX_ITERATIONS = 5;

const LEADSOURCE_BRAND_VOICE = `Outcome-led. Bold statements. No hedging. Lead with what the product does, not what's broken in the world. Say the thing everyone's thinking but nobody writes on their website. Keep it short. Make it sound like a real person said it. If it sounds like an AI or a committee wrote it, rewrite it.

Six voice rules:
1. Outcomes first — lead with the result, not the problem
2. Bold statements — "We tell you exactly." Full stop.
3. Short sentences
4. Say the real thing — if everyone's thinking it, say it
5. Honest about limits — "Works with most forms" not "every form"
6. Never salesy — no exclamation marks, no "Amazing!", no pressure

Power phrases to use: "Stop guessing. Start knowing.", "We tell you exactly.", "Where your best clients are coming from.", "Add the code. We do the rest.", "No BS."

Never say: "Every form", "100% accurate", "Leverage/Utilise/Seamlessly", "Powerful/Robust/Comprehensive", passive voice like "data is captured"`;

const LEADSOURCE_CONTEXT: SystemPromptContext = {
  site_name: "LeadSource",
  prefix: "ls",
  design_system_version: "1.0.0",
  design_system_updated: "n/a (Week 2)",
  design_system_html_full_file: "",
  brand_voice_content: LEADSOURCE_BRAND_VOICE,
  site_pages_tree: "[]",
  site_menus_current: "{}",
  homepage_id: "null",
  templates_list: "[]",
  session_recent_pages: "[]",
};

const SYSTEM_PROMPT = buildSystemPrompt(LEADSOURCE_CONTEXT);

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

        console.log("[api/chat] starting stream", {
          model: MODEL,
          msg_count: convo.length,
          system_prompt_chars: SYSTEM_PROMPT.length,
        });

        for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
          const streamed = client.messages.stream({
            model: MODEL,
            max_tokens: MAX_TOKENS,
            system: SYSTEM_PROMPT,
            tools: ALL_TOOLS,
            messages: convo,
          });

          for await (const event of streamed) {
            if (
              event.type === "content_block_delta" &&
              event.delta.type === "text_delta"
            ) {
              send("text", { delta: event.delta.text });
            }
          }

          const finalMsg = await streamed.finalMessage();
          stopReason = finalMsg.stop_reason;

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
              const r = await executor(tu.input);
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
          request_id: apiErr?.request_id,
          body: apiErr?.error,
          stack: err instanceof Error ? err.stack : undefined,
        };
        console.error("[api/chat] streaming error:", diagnostic);

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
