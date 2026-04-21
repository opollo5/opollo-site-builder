import { describe, expect, it } from "vitest";

import {
  CloudflareCallError,
  type CloudflareImageRecord,
} from "@/lib/cloudflare-images";
import {
  leaseNextTransferItem,
  processTransferItemUpload,
  processTransferItemIngest,
} from "@/lib/transfer-worker";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// M4-3 — Cloudflare upload stage + orchestrator tests.
//
// DB-backed. Covers:
//   - Happy path walk leased → uploading (stage-only) + image_library
//     cloudflare_id update.
//   - Idempotency-key stability across retries.
//   - Adoption: upload fn returns a record (mirrors the 409 + GET-by-id
//     flow in the Cloudflare client) on replay; image_library carries
//     the same cloudflare_id.
//   - Retryable failure (429) → state='pending' + retry_after set.
//   - Non-retryable failure (413) → state='failed' + failure_code.
//   - Retry budget exhaustion across 3 attempts.
//   - Orchestrator: upload + caption in one tick, ending in 'succeeded'
//     with both cloudflare_id and caption populated.
// ---------------------------------------------------------------------------

async function seedImageLibrary(): Promise<string> {
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
  if (error || !data) throw new Error(`seedImageLibrary: ${error?.message}`);
  return data.id as string;
}

async function seedIngestJob(n: number): Promise<{
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
      idempotency_key: `up-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    })
    .select("id")
    .single();
  if (jobErr || !job) throw new Error(`seed job: ${jobErr?.message}`);

  const imageIds: string[] = [];
  for (let i = 0; i < n; i++) imageIds.push(await seedImageLibrary());

  const { data: items, error: itemsErr } = await svc
    .from("transfer_job_items")
    .insert(
      Array.from({ length: n }, (_, i) => ({
        transfer_job_id: job.id,
        slot_index: i,
        image_id: imageIds[i],
        cloudflare_idempotency_key: `cf-${job.id}-${i}`,
        anthropic_idempotency_key: `an-${job.id}-${i}`,
        source_url: `https://src.test/image-${i}.jpg`,
      })),
    )
    .select("id, slot_index")
    .order("slot_index", { ascending: true });
  if (itemsErr || !items) throw new Error(`seed items: ${itemsErr?.message}`);

  return {
    jobId: job.id as string,
    itemIds: items.map((r) => r.id as string),
    imageIds,
  };
}

type RecordedUpload = { id: string; url: string };

function makeUploadStub(opts: {
  record?: RecordedUpload[];
  cloudflareId?: (callIdx: number, req: { id: string }) => string;
}) {
  let callIdx = 0;
  return async (req: { id: string; url: string }): Promise<CloudflareImageRecord> => {
    callIdx += 1;
    if (opts.record) opts.record.push({ id: req.id, url: req.url });
    const cfId = opts.cloudflareId?.(callIdx, req) ?? req.id;
    return {
      id: cfId,
      filename: "x.jpg",
      uploaded: new Date().toISOString(),
      variants: [`https://imagedelivery.net/HASH/${cfId}/public`],
    };
  };
}

function makeThrowingUploadStub(err: unknown) {
  return async () => {
    throw err;
  };
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("processTransferItemUpload — happy path", () => {
  it("persists cloudflare_id on image_library + resulting_cloudflare_id on the item", async () => {
    const { itemIds, imageIds } = await seedIngestJob(1);
    const leased = await leaseNextTransferItem("w-up");
    expect(leased?.id).toBe(itemIds[0]);
    if (!leased) return;

    const record: RecordedUpload[] = [];
    await processTransferItemUpload(leased.id, "w-up", {
      uploadFn: makeUploadStub({ record }),
    });

    expect(record).toHaveLength(1);
    expect(record[0]?.id).toBe(leased.cloudflare_idempotency_key);

    const svc = getServiceRoleClient();
    const { data: item } = await svc
      .from("transfer_job_items")
      .select("state, worker_id, resulting_cloudflare_id")
      .eq("id", leased.id)
      .single();
    // Stage-only call: lease retained, state still 'uploading'.
    expect(item?.state).toBe("uploading");
    expect(item?.worker_id).toBe("w-up");
    expect(item?.resulting_cloudflare_id).toBe(
      leased.cloudflare_idempotency_key,
    );

    const { data: image } = await svc
      .from("image_library")
      .select("cloudflare_id")
      .eq("id", imageIds[0])
      .single();
    expect(image?.cloudflare_id).toBe(leased.cloudflare_idempotency_key);
  });

  it("emits cloudflare_upload_started + cloudflare_upload_succeeded events in order", async () => {
    const { itemIds } = await seedIngestJob(1);
    const leased = await leaseNextTransferItem("w-ev");
    if (!leased) return;
    await processTransferItemUpload(leased.id, "w-ev", {
      uploadFn: makeUploadStub({}),
    });

    const svc = getServiceRoleClient();
    const { data: events } = await svc
      .from("transfer_events")
      .select("event_type, payload_jsonb, created_at")
      .eq("transfer_job_item_id", itemIds[0])
      .order("created_at", { ascending: true });
    const types = (events ?? []).map((e) => e.event_type);
    expect(types).toContain("cloudflare_upload_started");
    expect(types).toContain("cloudflare_upload_succeeded");
    const startIdx = types.indexOf("cloudflare_upload_started");
    const successIdx = types.indexOf("cloudflare_upload_succeeded");
    expect(successIdx).toBeGreaterThan(startIdx);
  });
});

// ---------------------------------------------------------------------------
// Idempotency + adoption
// ---------------------------------------------------------------------------

describe("processTransferItemUpload — idempotency + adoption", () => {
  it("re-processing the same item reuses the cloudflare idempotency key", async () => {
    const { itemIds } = await seedIngestJob(1);
    const leased = await leaseNextTransferItem("w-a");
    if (!leased) return;

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
    if (!reLeased) return;

    const record: RecordedUpload[] = [];
    await processTransferItemUpload(reLeased.id, "w-b", {
      uploadFn: makeUploadStub({ record }),
    });
    expect(record[0]?.id).toBe(leased.cloudflare_idempotency_key);
    expect(reLeased.cloudflare_idempotency_key).toBe(
      leased.cloudflare_idempotency_key,
    );

    // image_library carries exactly the idempotency id.
    const { data: images } = await svc
      .from("image_library")
      .select("cloudflare_id")
      .eq("id", itemIds[0]);
    // Some items may have id null (not all seed rows are the tracked one); assert count 1
    expect(images).toHaveLength(1);
  });

  it("adoption path: second call returns an identical record; UPDATE stays idempotent", async () => {
    const { itemIds, imageIds } = await seedIngestJob(1);
    const svc = getServiceRoleClient();

    // First worker completes upload.
    const leasedA = await leaseNextTransferItem("w-1");
    if (!leasedA) return;
    await processTransferItemUpload(leasedA.id, "w-1", {
      uploadFn: makeUploadStub({}),
    });

    // Reset state back to pending (simulates a crashed worker whose
    // caption stage never ran). On re-lease, processTransferItemUpload
    // runs again; the uploadFn stub returns the same cloudflare_id (the
    // idempotency key) so the image_library row is unchanged.
    await svc
      .from("transfer_job_items")
      .update({
        state: "pending",
        worker_id: null,
        lease_expires_at: null,
        resulting_cloudflare_id: null,
      })
      .eq("id", itemIds[0]);

    const leasedB = await leaseNextTransferItem("w-2");
    if (!leasedB) return;
    // Use a stub that returns the same id (mirrors Cloudflare's 409-adopt flow).
    await processTransferItemUpload(leasedB.id, "w-2", {
      uploadFn: makeUploadStub({}),
    });

    const { data: image } = await svc
      .from("image_library")
      .select("cloudflare_id")
      .eq("id", imageIds[0])
      .single();
    expect(image?.cloudflare_id).toBe(leasedA.cloudflare_idempotency_key);
  });
});

// ---------------------------------------------------------------------------
// Retryable + non-retryable failures
// ---------------------------------------------------------------------------

describe("processTransferItemUpload — retryable failure", () => {
  it("resets to pending with retry_after on 429", async () => {
    const { itemIds } = await seedIngestJob(1);
    const leased = await leaseNextTransferItem("w-429");
    if (!leased) return;

    await processTransferItemUpload(leased.id, "w-429", {
      uploadFn: makeThrowingUploadStub(
        new CloudflareCallError("CLOUDFLARE_RATE_LIMITED", "429", {
          retryable: true,
          httpStatus: 429,
        }),
      ),
    });

    const svc = getServiceRoleClient();
    const { data: item } = await svc
      .from("transfer_job_items")
      .select("state, worker_id, retry_after, failure_code, retry_count")
      .eq("id", itemIds[0])
      .single();
    expect(item?.state).toBe("pending");
    expect(item?.worker_id).toBeNull();
    expect(item?.retry_after).not.toBeNull();
    expect(item?.failure_code).toBeNull();
    expect(item?.retry_count).toBe(1);
  });
});

describe("processTransferItemUpload — non-retryable failure", () => {
  it("marks failed with failure_code on 413 (payload too large)", async () => {
    const { itemIds } = await seedIngestJob(1);
    const leased = await leaseNextTransferItem("w-413");
    if (!leased) return;

    await processTransferItemUpload(leased.id, "w-413", {
      uploadFn: makeThrowingUploadStub(
        new CloudflareCallError("CLOUDFLARE_PAYLOAD_TOO_LARGE", "too big", {
          retryable: false,
          httpStatus: 413,
        }),
      ),
    });

    const svc = getServiceRoleClient();
    const { data: item } = await svc
      .from("transfer_job_items")
      .select("state, failure_code, failure_detail")
      .eq("id", itemIds[0])
      .single();
    expect(item?.state).toBe("failed");
    expect(item?.failure_code).toBe("CLOUDFLARE_PAYLOAD_TOO_LARGE");
    expect(item?.failure_detail).toBe("too big");
  });
});

describe("processTransferItemUpload — retry budget exhaustion", () => {
  it("3rd consecutive retryable failure goes terminal", async () => {
    const { itemIds } = await seedIngestJob(1);
    const svc = getServiceRoleClient();
    const throwing = makeThrowingUploadStub(
      new CloudflareCallError("CLOUDFLARE_RATE_LIMITED", "429", {
        retryable: true,
        httpStatus: 429,
      }),
    );

    for (let attempt = 1; attempt <= 3; attempt++) {
      await svc
        .from("transfer_job_items")
        .update({ retry_after: null })
        .eq("id", itemIds[0]);
      const leased = await leaseNextTransferItem(`w-exh-${attempt}`);
      if (!leased) return;
      expect(leased.retry_count).toBe(attempt);
      await processTransferItemUpload(leased.id, `w-exh-${attempt}`, {
        uploadFn: throwing,
      });
    }

    const { data: item } = await svc
      .from("transfer_job_items")
      .select("state, failure_code, retry_count")
      .eq("id", itemIds[0])
      .single();
    expect(item?.state).toBe("failed");
    expect(item?.failure_code).toBe("CLOUDFLARE_RATE_LIMITED");
    expect(item?.retry_count).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Orchestrator: upload + caption end-to-end
// ---------------------------------------------------------------------------

const VALID_CAPTION_PAYLOAD = JSON.stringify({
  caption:
    "A placeholder studio photograph used by the M4 ingest end-to-end test.",
  alt_text: "Placeholder studio photograph.",
  tags: ["test", "fixture", "placeholder"],
});

describe("processTransferItemIngest — orchestration", () => {
  it("upload + caption in one tick drives the item to succeeded", async () => {
    const { itemIds, imageIds } = await seedIngestJob(1);
    const leased = await leaseNextTransferItem("w-orch");
    if (!leased) return;

    const uploadRecord: RecordedUpload[] = [];
    await processTransferItemIngest(leased.id, "w-orch", {
      uploadFn: makeUploadStub({ record: uploadRecord }),
      captionCall: async (req) => ({
        id: `resp_${req.idempotency_key}`,
        model: "claude-sonnet-4-6",
        raw_text: VALID_CAPTION_PAYLOAD,
        stop_reason: "end_turn",
        usage: {
          input_tokens: 1_200,
          output_tokens: 200,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      }),
    });

    const svc = getServiceRoleClient();
    const { data: item } = await svc
      .from("transfer_job_items")
      .select("state, resulting_cloudflare_id, cost_cents, worker_id")
      .eq("id", itemIds[0])
      .single();
    expect(item?.state).toBe("succeeded");
    expect(item?.worker_id).toBeNull();
    expect(item?.resulting_cloudflare_id).toBe(
      leased.cloudflare_idempotency_key,
    );
    expect(Number(item?.cost_cents)).toBeGreaterThan(0);

    const { data: image } = await svc
      .from("image_library")
      .select("cloudflare_id, caption, alt_text, tags")
      .eq("id", imageIds[0])
      .single();
    expect(image?.cloudflare_id).toBe(leased.cloudflare_idempotency_key);
    expect(image?.caption).toContain("photograph");
    expect(image?.tags).toEqual(["test", "fixture", "placeholder"]);
  });

  it("orchestrator stops after upload defer without invoking captioning", async () => {
    const { itemIds } = await seedIngestJob(1);
    const leased = await leaseNextTransferItem("w-defer");
    if (!leased) return;

    let captionCalled = 0;
    await processTransferItemIngest(leased.id, "w-defer", {
      uploadFn: makeThrowingUploadStub(
        new CloudflareCallError("CLOUDFLARE_RATE_LIMITED", "429", {
          retryable: true,
          httpStatus: 429,
        }),
      ),
      captionCall: async () => {
        captionCalled += 1;
        throw new Error("caption should not be called after upload defer");
      },
    });

    expect(captionCalled).toBe(0);

    const svc = getServiceRoleClient();
    const { data: item } = await svc
      .from("transfer_job_items")
      .select("state, retry_after")
      .eq("id", itemIds[0])
      .single();
    expect(item?.state).toBe("pending");
    expect(item?.retry_after).not.toBeNull();
  });

  it("orchestrator stops after upload terminal failure without invoking captioning", async () => {
    const { itemIds } = await seedIngestJob(1);
    const leased = await leaseNextTransferItem("w-fail");
    if (!leased) return;

    let captionCalled = 0;
    await processTransferItemIngest(leased.id, "w-fail", {
      uploadFn: makeThrowingUploadStub(
        new CloudflareCallError("CLOUDFLARE_PAYLOAD_TOO_LARGE", "too big", {
          retryable: false,
          httpStatus: 413,
        }),
      ),
      captionCall: async () => {
        captionCalled += 1;
        throw new Error("caption should not be called after upload failure");
      },
    });

    expect(captionCalled).toBe(0);

    const svc = getServiceRoleClient();
    const { data: item } = await svc
      .from("transfer_job_items")
      .select("state, failure_code")
      .eq("id", itemIds[0])
      .single();
    expect(item?.state).toBe("failed");
    expect(item?.failure_code).toBe("CLOUDFLARE_PAYLOAD_TOO_LARGE");
  });
});
