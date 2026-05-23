import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { logger } from "@/lib/logger";
import { MSP_CYBERSEC_TOPIC_TAGS, TOPIC_TAG_SET } from "./taxonomies/msp-cybersec-topics";

export interface LLMFeatures {
  sentimentScore: number | null;
  topicTags: string[] | null;
}

const MODEL = "claude-haiku-4-5-20251001";

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  return new Anthropic({ apiKey });
}

export async function extractLLMFeatures(
  content: string,
  companyId: string,
): Promise<LLMFeatures> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { sentimentScore: null, topicTags: null };
  }

  const prompt = `Analyze this social post for an MSP/cybersecurity audience.

Post content:
"""
${content.slice(0, 2000)}
"""

Available topic tags (return only from this list):
${MSP_CYBERSEC_TOPIC_TAGS.join(", ")}

Return JSON only:
{
  "sentiment_score": <number from -1.0 to 1.0>,
  "topic_tags": [<1-5 tags from the available list>]
}`;

  try {
    const client = getClient();
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    });

    const responseText = msg.content[0]?.type === "text" ? msg.content[0].text : "{}";
    const parsed = JSON.parse(responseText);

    const validTags = (Array.isArray(parsed.topic_tags) ? parsed.topic_tags : []).filter(
      (tag: unknown) => typeof tag === "string" && TOPIC_TAG_SET.has(tag),
    );

    logger.info("ins.llm-extract.complete", {
      companyId,
      inputTokens: msg.usage.input_tokens,
      outputTokens: msg.usage.output_tokens,
      tagCount: validTags.length,
    });

    return {
      sentimentScore:
        typeof parsed.sentiment_score === "number"
          ? Math.max(-1, Math.min(1, parsed.sentiment_score))
          : null,
      topicTags: validTags.length > 0 ? validTags : null,
    };
  } catch (err) {
    logger.warn("ins.llm-extract.failed", {
      companyId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { sentimentScore: null, topicTags: null };
  }
}
