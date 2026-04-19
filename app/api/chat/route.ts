import Anthropic from "@anthropic-ai/sdk";

import { createPageJsonSchema } from "@/lib/tool-schemas";
import { executeCreatePage } from "@/lib/create-page";

export const runtime = "nodejs";

const MODEL = "claude-opus-4-7";
const MAX_TOKENS = 4096;
const MAX_ITERATIONS = 5;

const PLACEHOLDER_SYSTEM_PROMPT = `You are the LeadSource site builder. For Day 1 you can create WordPress pages via the create_page tool.

Wrap every page body in this scoped container:
<div class="ls-page ls-page-{template_type}" data-ds-version="1.0.0">
  ...content...
</div>

Use only classes beginning with "ls-". Call create_page with a valid draft once you have enough information. Be terse; no preambles, no postambles.`;

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
        });

        for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
          const streamed = client.messages.stream({
            model: MODEL,
            max_tokens: MAX_TOKENS,
            system: PLACEHOLDER_SYSTEM_PROMPT,
            tools: [createPageJsonSchema],
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
            if (tu.name === "create_page") {
              const r = await executeCreatePage(tu.input);
              result = r;
              if (!r.ok) isError = true;
            } else {
              result = {
                ok: false,
                error: {
                  code: "VALIDATION_FAILED",
                  message: `Unknown tool: ${tu.name}`,
                  retryable: false,
                  suggested_action: "Only create_page is available in Day 1.",
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
