/**
 * Backfill LLM features (sentiment_score + topic_tags) for existing ins_post_features rows
 * where sentiment_score IS NULL.
 *
 * Usage: npx tsx scripts/backfill/insights-llm-features.ts [--dry-run]
 *
 * Requires: SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL, ANTHROPIC_API_KEY
 */

import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { TOPIC_TAG_SET } from "../../lib/insights/taxonomies/msp-cybersec-topics";

const DRY_RUN = process.argv.includes("--dry-run");
const BATCH_SIZE = 50;
const DELAY_MS = 1000;

const supabase = createClient(
  process.env.SUPABASE_URL ?? "",
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
);

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });

async function extractFeatures(
  content: string,
): Promise<{ sentimentScore: number | null; topicTags: string[] | null }> {
  try {
    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      messages: [
        {
          role: "user",
          content: `Analyze this social post. Return JSON only: {"sentiment_score": <-1.0 to 1.0>, "topic_tags": [<1-5 tags>]}\n\nAvailable tags: ${[...TOPIC_TAG_SET].join(", ")}\n\nPost:\n"""\n${content.slice(0, 2000)}\n"""`,
        },
      ],
    });

    const text = msg.content[0]?.type === "text" ? msg.content[0].text : "{}";
    const parsed = JSON.parse(text);
    const validTags = (Array.isArray(parsed.topic_tags) ? parsed.topic_tags : []).filter(
      (t: unknown) => typeof t === "string" && TOPIC_TAG_SET.has(t),
    );

    return {
      sentimentScore:
        typeof parsed.sentiment_score === "number"
          ? Math.max(-1, Math.min(1, parsed.sentiment_score))
          : null,
      topicTags: validTags.length > 0 ? validTags : null,
    };
  } catch (err) {
    console.warn("LLM extract failed:", err instanceof Error ? err.message : String(err));
    return { sentimentScore: null, topicTags: null };
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  console.log(`Starting LLM feature backfill (dry-run=${DRY_RUN})`);

  let offset = 0;
  let totalProcessed = 0;
  let totalUpdated = 0;

  while (true) {
    const { data: rows, error } = await supabase
      .from("ins_post_features")
      .select("id, bundle_post_id, company_id, content")
      .is("sentiment_score", null)
      .is("deleted_at", null)
      .order("posted_at", { ascending: false })
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) {
      console.error("Query failed:", error.message);
      break;
    }

    if (!rows || rows.length === 0) break;

    console.log(`Processing batch of ${rows.length} (offset ${offset})`);

    for (const row of rows) {
      const content = typeof row.content === "string" ? row.content : "";
      if (!content) {
        totalProcessed++;
        continue;
      }

      const features = await extractFeatures(content);

      if (!DRY_RUN && (features.sentimentScore !== null || features.topicTags !== null)) {
        const { error: updateError } = await supabase
          .from("ins_post_features")
          .update({
            sentiment_score: features.sentimentScore,
            topic_tags: features.topicTags,
          })
          .eq("id", row.id);

        if (updateError) {
          console.warn(`Update failed for ${row.bundle_post_id}:`, updateError.message);
        } else {
          totalUpdated++;
        }
      } else if (DRY_RUN) {
        console.log(`[dry-run] Would update ${row.bundle_post_id}: sentiment=${features.sentimentScore}, tags=${features.topicTags?.join(",") ?? "none"}`);
      }

      totalProcessed++;
    }

    offset += BATCH_SIZE;

    // Rate-limit-aware backoff between batches
    await sleep(DELAY_MS);
  }

  console.log(
    `Done. Processed ${totalProcessed} rows, updated ${totalUpdated} (dry-run=${DRY_RUN})`,
  );
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
