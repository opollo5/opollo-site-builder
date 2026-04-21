import { describe, expect, it } from "vitest";

import {
  CaptionCallError,
  type AnthropicCaptionCallFn,
  type CaptionApiResponse,
} from "@/lib/anthropic-caption";
import {
  leaseNextTransferItem,
  processTransferItemCaption,
} from "@/lib/transfer-worker";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// M4-4 — Anthropic captioning stage tests.
//
// Pins the invariants the rest of M4 depends on:
//
//   1. Idempotency-Key stays stable across retries of the same item.
//      Stub records the request; two runs with the same item id see
//      the same key.
//
//   2. Event log is written BEFORE the image_library UPDATE and BEFORE
//      the state column flips to 'succeeded'. If a later UPDATE fails,
//      the billing facts are still recoverable from transfer_events.
//
//   3. Structural validation on the JSON payload — caption length, alt
//      length, tags count — mitigates risk #8 (caption quality drift)
//      at the boundary, not deep in the worker.
//
//   4. Retryable vs non-retryable classification flows through to the
//      item state (pending+retry_after vs failed+failure_code).
//
//   5. Cost reconciliation: sum of transfer_job_items.cost_cents for a
//      job equals the sum derived from transfer_events' caption
//      response rows. Event log is truth.
//
//   6. Crash recovery — an item stuck in 'captioning' with expired
//      lease is reaped to pending and the next worker drives it to
//      succeeded using the same idempotency key.
// ---------------------------------------------------------------------------

// A valid JSON payload that passes the Zod structural schema: caption
// 40-280 chars, alt_text 10-200 chars, tags 3-10 entries.
const VALID_PAYLOAD = JSON.stringify({
  caption:
    "A studio photograph of a tabby cat sitting on a windowsill facing soft morning light.",
  alt_text: "Tabby cat on windowsill in soft morning light.",
  tags: ["cat", "animal", "pet", "indoor", "lifestyle"],
});

type RecordedCaptionCall = {
  idempotency_key: string;
  image_url: string;
  model: string;
};

function makeStubCall(opts: {
  model?: string;
  rawText?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  record?: RecordedCaptionCall[];
  responseId?: string;
}): AnthropicCaptionCallFn {
  let counter = 0;
  return async (req) => {
    counter += 1;
    if (opts.record) {
      opts.record.push({
        idempotency_key: req.idempotency_key,
        image_url: req.image_url,
        model: req.model ?? "claude-sonnet-4-6",
      });
    }
    const response: CaptionApiResponse = {
      id: opts.responseId ?? `resp_${req.idempotency_key}_${counter}`,
      model: opts.model ?? "claude-sonnet-4-6",
      raw_text: opts.rawText ?? VALID_PAYLOAD,
      stop_reason: "end_turn",
      usage: opts.usage ?? {
        input_tokens: 1_200,
        output_tokens: 200,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    };
    return response;
  };
}

function makeThrowingStub(err: unknown): AnthropicCaptionCallFn {
  return async () => {
    throw err;
  };
}

// ---------------------------------------------------------------------------
// Seeds
// ---------------------------------------------------------------------------

async function seedImageLibraryRow(): Promise<string> {
  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("image_library")
    .insert({
      source: "istock",
      source_ref: `istock-${Math.random().toString(36).slice(2, 10)}`,
      filename: "test.jpg",
      width_px: 1024,
      height_px: 768,
    })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`seedImageLibraryRow: ${error?.message ?? "no row"}`);
  }
  return data.id as string;
}

async function seedCaptionJobWithItems(n: number): Promise<{
  jobId: string;
  itemIds: string[];
  imageIds: string[];
}> {
  const svc = getServiceRoleClient();
  const { data: job, error: jobErr } = await svc
    .from("transfer_jobs")
    .insert({
      type: "cloudflare_ingest",
      requested_count: n,
      idempotency_key: `caption-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    })
    .select("id")
    .single();
  if (jobErr || !job) throw new Error(`seed job: ${jobErr?.message}`);

  const imageIds: string[] = [];
  for (let i = 0; i < n; i++) {
    imageIds.push(await seedImageLibraryRow());
  }

  const { data: itemRows, error: itemsErr } = await svc
    .from("transfer_job_items")
    .insert(
      Array.from({ length: n }, (_, i) => ({
        transfer_job_id: job.id,
        slot_index: i,
        image_id: imageIds[i],
        cloudflare_idempotency_key: `cf-${job.id}-${i}`,
        anthropic_idempotency_key: `an-${job.id}-${i}`,
        source_url: `https://fixtures.test/image-${i}.jpg`,
      })),
    )
    .select("id, slot_index")
    .order("slot_index", { ascending: true });
  if (itemsErr || !itemRows) throw new Error(`seed items: ${itemsErr?.message}`);

  return {
    jobId: job.id as string,
    itemIds: itemRows.map((r) => r.id as string),
    imageIds,
  };
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("processTransferItemCaption — happy path", () => {
  it("walks the item leased → captioning → succeeded and writes caption/alt/tags", async () => {
    const { jobId, itemIds, imageIds } = await seedCaptionJobWithItems(1);
    const leased = await leaseNextTransferItem("w-happy");
    expect(leased?.id).toBe(itemIds[0]);
    if (!leased) return;

    const record: RecordedCaptionCall[] = [];
    await processTransferItemCaption(leased.id, "w-happy", {
      captionCall: makeStubCall({ record }),
    });

    expect(record.length).toBe(1);
    expect(record[0]?.idempotency_key).toBe(leased.anthropic_idempotency_key);
    expect(record[0]?.image_url).toBe("https://fixtures.test/image-0.jpg");
    expect(record[0]?.model).toBe("claude-sonnet-4-6");

    const svc = getServiceRoleClient();
    const { data: item } = await svc
      .from("transfer_job_items")
      .select("state, worker_id, lease_expires_at, cost_cents, failure_code")
      .eq("id", leased.id)
      .single();
    expect(item?.state).toBe("succeeded");
    expect(item?.worker_id).toBeNull();
    expect(item?.lease_expires_at).toBeNull();
    expect(item?.failure_code).toBeNull();
    expect(Number(item?.cost_cents)).toBeGreaterThan(0);

    const { data: image } = await svc
      .from("image_library")
      .select("caption, alt_text, tags")
      .eq("id", imageIds[0])
      .single();
    expect(image?.caption).toContain("tabby cat");
    expect((image?.alt_text as string).length).toBeGreaterThanOrEqual(10);
    expect(image?.tags).toEqual([
      "cat",
      "animal",
      "pet",
      "indoor",
      "lifestyle",
    ]);

    const { data: job } = await svc
      .from("transfer_jobs")
      .select("status, succeeded_count, total_cost_usd_cents, finished_at")
      .eq("id", jobId)
      .single();
    expect(job?.status).toBe("succeeded");
    expect(job?.succeeded_count).toBe(1);
    expect(Number(job?.total_cost_usd_cents)).toBeGreaterThan(0);
    expect(job?.finished_at).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Idempotency key stability across retries
// ---------------------------------------------------------------------------

describe("processTransferItemCaption — idempotency key stability", () => {
  it("re-processing the same item (post-reset) uses the same Anthropic idempotency key", async () => {
    const { itemIds } = await seedCaptionJobWithItems(1);
    const leased = await leaseNextTransferItem("w-a");
    expect(leased?.id).toBe(itemIds[0]);
    if (!leased) return;

    // Bypass processTransferItemCaption's own write path so the assertion
    // focuses on key reuse. Hard-reset the item back to pending.
    const svc = getServiceRoleClient();
    await svc
      .from("transfer_job_items")
      .update({
        state: "pending",
        worker_id: null,
        lease_expires_at: null,
      })
      .eq("id", leased.id);

    const reLeased = await leaseNextTransferItem("w-b");
    expect(reLeased?.id).toBe(leased.id);
    if (!reLeased) return;

    const record: RecordedCaptionCall[] = [];
    await processTransferItemCaption(reLeased.id, "w-b", {
      captionCall: makeStubCall({ record }),
    });

    expect(record[0]?.idempotency_key).toBe(
      leased.anthropic_idempotency_key,
    );
    // Idempotency key is deterministic on the item row, not on the lease.
    expect(reLeased.anthropic_idempotency_key).toBe(
      leased.anthropic_idempotency_key,
    );
  });
});

// ---------------------------------------------------------------------------
// Event-log-first ordering
// ---------------------------------------------------------------------------

describe("processTransferItemCaption — event log first", () => {
  it("writes anthropic_caption_response_received with cost + usage before state=succeeded", async () => {
    const { itemIds } = await seedCaptionJobWithItems(1);
    const leased = await leaseNextTransferItem("w-ev");
    if (!leased) throw new Error("lease failed");

    await processTransferItemCaption(leased.id, "w-ev", {
      captionCall: makeStubCall({
        usage: {
          input_tokens: 1_500,
          output_tokens: 300,
          cache_creation_input_tokens: 100,
          cache_read_input_tokens: 50,
        },
      }),
    });

    const svc = getServiceRoleClient();
    const { data: events } = await svc
      .from("transfer_events")
      .select("event_type, payload_jsonb, cost_cents, created_at")
      .eq("transfer_job_item_id", itemIds[0])
      .order("created_at", { ascending: true });

    const types = (events ?? []).map((e) => e.event_type as string);
    const captionIdx = types.indexOf("anthropic_caption_response_received");
    const succeededEvent = (events ?? []).findIndex(
      (e) =>
        e.event_type === "state_advanced" &&
        (e.payload_jsonb as { to?: string } | null)?.to === "succeeded",
    );
    expect(captionIdx).toBeGreaterThan(-1);
    expect(succeededEvent).toBeGreaterThan(captionIdx);

    const captionEvent = events?.[captionIdx];
    const details = captionEvent?.payload_jsonb as Record<string, unknown>;
    expect(details.input_tokens).toBe(1_500);
    expect(details.output_tokens).toBe(300);
    expect(details.cache_creation_input_tokens).toBe(100);
    expect(details.cache_read_input_tokens).toBe(50);
    expect(details.rate_found).toBe(true);
    expect(details.pricing_version).toBeDefined();
    expect(details.parse_ok).toBe(true);
    expect(typeof details.cost_usd_cents).toBe("number");
    expect(details.cost_usd_cents as number).toBeGreaterThan(0);
    // cost_cents column on the event matches the payload.
    expect(Number(captionEvent?.cost_cents)).toBe(
      details.cost_usd_cents as number,
    );
  });
});

// ---------------------------------------------------------------------------
// Parse failure — non-retryable, cost still recorded
// ---------------------------------------------------------------------------

describe("processTransferItemCaption — parse failure", () => {
  it("marks the item failed with CAPTION_PARSE_FAILED and records cost", async () => {
    const { itemIds, imageIds } = await seedCaptionJobWithItems(1);
    const leased = await leaseNextTransferItem("w-parse");
    if (!leased) throw new Error("lease failed");

    await processTransferItemCaption(leased.id, "w-parse", {
      captionCall: makeStubCall({
        rawText: "sure! here is your caption: (not JSON)",
      }),
    });

    const svc = getServiceRoleClient();
    const { data: item } = await svc
      .from("transfer_job_items")
      .select("state, failure_code, failure_detail, cost_cents")
      .eq("id", leased.id)
      .single();
    expect(item?.state).toBe("failed");
    expect(item?.failure_code).toBe("CAPTION_PARSE_FAILED");
    expect(Number(item?.cost_cents)).toBeGreaterThan(0);

    // image_library.caption remains NULL since the payload was unparseable.
    const { data: image } = await svc
      .from("image_library")
      .select("caption, alt_text, tags")
      .eq("id", imageIds[0])
      .single();
    expect(image?.caption).toBeNull();
    expect(image?.alt_text).toBeNull();
    expect(image?.tags).toEqual([]);

    // Job aggregation flips to 'failed' because the only slot failed.
    const { data: events } = await svc
      .from("transfer_events")
      .select("event_type, payload_jsonb")
      .eq("transfer_job_item_id", itemIds[0])
      .order("created_at", { ascending: true });
    const types = (events ?? []).map((e) => e.event_type);
    expect(types).toContain("anthropic_caption_response_received");
    const respEvent = (events ?? []).find(
      (e) => e.event_type === "anthropic_caption_response_received",
    );
    const respDetails = respEvent?.payload_jsonb as Record<string, unknown>;
    expect(respDetails.parse_ok).toBe(false);
    expect(respDetails.parse_failure_code).toBe("CAPTION_PARSE_FAILED");
  });
});

// ---------------------------------------------------------------------------
// Structural validation failure
// ---------------------------------------------------------------------------

describe("processTransferItemCaption — validation failure", () => {
  it("marks the item failed with CAPTION_VALIDATION_FAILED when tags count is out of bounds", async () => {
    await seedCaptionJobWithItems(1);
    const leased = await leaseNextTransferItem("w-validate");
    if (!leased) throw new Error("lease failed");

    const badPayload = JSON.stringify({
      caption:
        "A photo of something — just one tag supplied which is below the minimum of three.",
      alt_text: "Photo placeholder.",
      tags: ["too-few"],
    });
    await processTransferItemCaption(leased.id, "w-validate", {
      captionCall: makeStubCall({ rawText: badPayload }),
    });

    const svc = getServiceRoleClient();
    const { data: item } = await svc
      .from("transfer_job_items")
      .select("state, failure_code")
      .eq("id", leased.id)
      .single();
    expect(item?.state).toBe("failed");
    expect(item?.failure_code).toBe("CAPTION_VALIDATION_FAILED");
  });
});

// ---------------------------------------------------------------------------
// Retryable API error — defers with retry_after
// ---------------------------------------------------------------------------

describe("processTransferItemCaption — retryable API error", () => {
  it("resets the item to pending with retry_after on a 429", async () => {
    const { itemIds } = await seedCaptionJobWithItems(1);
    const leased = await leaseNextTransferItem("w-rate");
    if (!leased) throw new Error("lease failed");
    // retry_count was bumped to 1 on the lease. The backoff table has
    // an entry for retry_count=1 → 1s, so the defer path fires.

    await processTransferItemCaption(leased.id, "w-rate", {
      captionCall: makeThrowingStub(
        new CaptionCallError("ANTHROPIC_RATE_LIMITED", "429 too many", {
          retryable: true,
          httpStatus: 429,
        }),
      ),
    });

    const svc = getServiceRoleClient();
    const { data: item } = await svc
      .from("transfer_job_items")
      .select("state, worker_id, retry_after, failure_code, retry_count")
      .eq("id", leased.id)
      .single();
    expect(item?.state).toBe("pending");
    expect(item?.worker_id).toBeNull();
    expect(item?.failure_code).toBeNull();
    expect(item?.retry_after).not.toBeNull();
    expect(new Date(item!.retry_after as string).getTime()).toBeGreaterThan(
      Date.now() - 1_000,
    );
    expect(item?.retry_count).toBe(1);

    const { data: events } = await svc
      .from("transfer_events")
      .select("event_type, payload_jsonb")
      .eq("transfer_job_item_id", itemIds[0])
      .order("created_at", { ascending: true });
    const types = (events ?? []).map((e) => e.event_type);
    expect(types).toContain("anthropic_caption_failed");
    const failEvent = (events ?? []).find(
      (e) => e.event_type === "anthropic_caption_failed",
    );
    expect(
      (failEvent?.payload_jsonb as { retryable?: boolean } | null)?.retryable,
    ).toBe(true);
  });

  it("exhausts the retry budget to a terminal failure after 3 attempts", async () => {
    const { itemIds } = await seedCaptionJobWithItems(1);
    const throwing = makeThrowingStub(
      new CaptionCallError("ANTHROPIC_RATE_LIMITED", "429", {
        retryable: true,
        httpStatus: 429,
      }),
    );
    const svc = getServiceRoleClient();

    // Three attempts. Reset retry_after between attempts so the lease
    // is eligible (real workers wait for the backoff to elapse; tests
    // short-circuit by clearing it).
    for (let attempt = 1; attempt <= 3; attempt++) {
      await svc
        .from("transfer_job_items")
        .update({ retry_after: null })
        .eq("id", itemIds[0]);

      const leased = await leaseNextTransferItem(`w-exh-${attempt}`);
      expect(leased?.id).toBe(itemIds[0]);
      if (!leased) return;
      expect(leased.retry_count).toBe(attempt);
      await processTransferItemCaption(leased.id, `w-exh-${attempt}`, {
        captionCall: throwing,
      });
    }

    const { data: item } = await svc
      .from("transfer_job_items")
      .select("state, failure_code, retry_count")
      .eq("id", itemIds[0])
      .single();
    expect(item?.state).toBe("failed");
    expect(item?.failure_code).toBe("ANTHROPIC_RATE_LIMITED");
    expect(item?.retry_count).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Non-retryable API error — fails terminally on first attempt
// ---------------------------------------------------------------------------

describe("processTransferItemCaption — non-retryable API error", () => {
  it("marks the item failed on the first 400 without deferring", async () => {
    const { itemIds } = await seedCaptionJobWithItems(1);
    const leased = await leaseNextTransferItem("w-400");
    if (!leased) throw new Error("lease failed");

    await processTransferItemCaption(leased.id, "w-400", {
      captionCall: makeThrowingStub(
        new CaptionCallError("ANTHROPIC_CLIENT_ERROR", "bad request", {
          retryable: false,
          httpStatus: 400,
        }),
      ),
    });

    const svc = getServiceRoleClient();
    const { data: item } = await svc
      .from("transfer_job_items")
      .select("state, failure_code, failure_detail, retry_after")
      .eq("id", itemIds[0])
      .single();
    expect(item?.state).toBe("failed");
    expect(item?.failure_code).toBe("ANTHROPIC_CLIENT_ERROR");
    expect(item?.retry_after).toBeNull();
    expect(item?.failure_detail).toBe("bad request");
  });
});

// ---------------------------------------------------------------------------
// Lease reaped mid-stage — recovery + single Anthropic call observed
// ---------------------------------------------------------------------------

describe("processTransferItemCaption — crash recovery", () => {
  it("a reaped item is driven to succeeded with the same idempotency key", async () => {
    const { itemIds, imageIds } = await seedCaptionJobWithItems(1);

    // Simulate a crashed worker that advanced to 'captioning' then died.
    const svc = getServiceRoleClient();
    await svc
      .from("transfer_job_items")
      .update({
        state: "captioning",
        worker_id: "w-crashed",
        lease_expires_at: new Date(Date.now() - 1_000).toISOString(),
        retry_count: 1,
      })
      .eq("id", itemIds[0]);

    // Next worker leases (the lease-expired branch picks this up).
    const leased = await leaseNextTransferItem("w-recovered");
    expect(leased?.id).toBe(itemIds[0]);
    if (!leased) return;
    // State returns to 'leased' on re-acquisition and retry_count bumps.
    expect(leased.retry_count).toBe(2);

    const record: RecordedCaptionCall[] = [];
    await processTransferItemCaption(leased.id, "w-recovered", {
      captionCall: makeStubCall({ record }),
    });

    // Exactly one call observed on this run — the stub is per-test.
    // The idempotency key matches what the crashed worker would have sent.
    expect(record.length).toBe(1);
    expect(record[0]?.idempotency_key).toBe(leased.anthropic_idempotency_key);

    const { data: item } = await svc
      .from("transfer_job_items")
      .select("state")
      .eq("id", itemIds[0])
      .single();
    expect(item?.state).toBe("succeeded");

    const { data: image } = await svc
      .from("image_library")
      .select("caption")
      .eq("id", imageIds[0])
      .single();
    expect(image?.caption).toContain("tabby cat");
  });
});

// ---------------------------------------------------------------------------
// Cost reconciliation across a completed job
// ---------------------------------------------------------------------------

describe("processTransferItemCaption — cost reconciliation", () => {
  it("sum(item.cost_cents) == sum(transfer_events cost) == job.total_cost", async () => {
    const { jobId, itemIds } = await seedCaptionJobWithItems(4);

    for (let i = 0; i < 4; i++) {
      const leased = await leaseNextTransferItem(`w-rec-${i}`);
      expect(leased?.id).toBe(itemIds[i]);
      if (!leased) return;
      await processTransferItemCaption(leased.id, `w-rec-${i}`, {
        captionCall: makeStubCall({
          usage: {
            input_tokens: 1_000 * (i + 1),
            output_tokens: 150 * (i + 1),
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        }),
      });
    }

    const svc = getServiceRoleClient();
    const { data: items } = await svc
      .from("transfer_job_items")
      .select("cost_cents, state")
      .eq("transfer_job_id", jobId);
    expect(items?.every((r) => r.state === "succeeded")).toBe(true);
    const itemSum = (items ?? []).reduce(
      (s, r) => s + Number(r.cost_cents),
      0,
    );

    const { data: events } = await svc
      .from("transfer_events")
      .select("cost_cents")
      .eq("transfer_job_id", jobId)
      .eq("event_type", "anthropic_caption_response_received");
    const eventSum = (events ?? []).reduce(
      (s, e) => s + Number(e.cost_cents),
      0,
    );

    expect(itemSum).toBeGreaterThan(0);
    expect(itemSum).toBe(eventSum);

    const { data: job } = await svc
      .from("transfer_jobs")
      .select("total_cost_usd_cents, status, succeeded_count")
      .eq("id", jobId)
      .single();
    expect(Number(job?.total_cost_usd_cents)).toBe(itemSum);
    expect(job?.status).toBe("succeeded");
    expect(job?.succeeded_count).toBe(4);
  });
});
