import { describe, expect, it } from "vitest";

import {
  DEFAULT_BUDGET_CAP_MULTIPLIER,
  ESTIMATED_CAPTION_CENTS_PER_IMAGE,
  IngestBudgetError,
  estimateIngestCost,
  parseIstockCsv,
  seedIstockLibrary,
} from "@/lib/istock-seed";
import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// M4-5 — iStock ingest tests.
//
// Covers:
//   - CSV parsing: required headers, optional columns, per-line errors.
//   - Cost estimate math.
//   - Dry-run returns plan without DB writes.
//   - Real run inserts image_library + transfer_jobs + transfer_job_items.
//   - Idempotent re-run with the same job key.
//   - Budget-cap abort with IngestBudgetError.
//   - Adoption: pre-existing image_library rows are reused, not duplicated.
// ---------------------------------------------------------------------------

const VALID_CSV = [
  "istock_id,url,width,height,bytes,license_type",
  "i-1,https://src.test/1.jpg,1024,768,123456,standard",
  "i-2,https://src.test/2.jpg,2048,1536,234567,standard",
  'i-3,"https://src.test/3.jpg",1600,1200,345678,editorial',
].join("\n");

describe("parseIstockCsv", () => {
  it("parses a valid CSV into typed rows", () => {
    const r = parseIstockCsv(VALID_CSV);
    expect(r.errors).toEqual([]);
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0]).toMatchObject({
      istock_id: "i-1",
      url: "https://src.test/1.jpg",
      width: 1024,
      height: 768,
      bytes: 123456,
      license_type: "standard",
    });
  });

  it("handles optional columns (license_type missing)", () => {
    const csv = ["istock_id,url", "i-1,https://src.test/a.jpg"].join("\n");
    const r = parseIstockCsv(csv);
    expect(r.errors).toEqual([]);
    expect(r.rows[0]?.license_type).toBeUndefined();
  });

  it("rejects a CSV missing istock_id column", () => {
    const csv = ["url", "https://src.test/a.jpg"].join("\n");
    const r = parseIstockCsv(csv);
    expect(r.rows).toEqual([]);
    expect(r.errors[0]?.message).toContain("istock_id");
  });

  it("reports per-line validation errors but keeps valid rows", () => {
    const csv = [
      "istock_id,url",
      "i-good,https://src.test/ok.jpg",
      "i-bad,not a url",
      "i-good-2,https://src.test/ok2.jpg",
    ].join("\n");
    const r = parseIstockCsv(csv);
    expect(r.rows).toHaveLength(2);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]?.line).toBe(3);
  });

  it("handles quoted URL cells", () => {
    const csv = [
      "istock_id,url",
      'i-q,"https://src.test/q.jpg"',
    ].join("\n");
    const r = parseIstockCsv(csv);
    expect(r.errors).toEqual([]);
    expect(r.rows[0]?.url).toBe("https://src.test/q.jpg");
  });
});

describe("estimateIngestCost", () => {
  it("scales linearly with image count", () => {
    const a = estimateIngestCost(100);
    const b = estimateIngestCost(200);
    expect(b.captionCents).toBe(a.captionCents * 2);
    expect(a.totalCents).toBeGreaterThan(0);
  });

  it("caption cents matches the per-image constant", () => {
    const e = estimateIngestCost(9_000);
    expect(e.captionCents).toBe(9_000 * ESTIMATED_CAPTION_CENTS_PER_IMAGE);
  });
});

// ---------------------------------------------------------------------------
// Seed runs
// ---------------------------------------------------------------------------

describe("seedIstockLibrary — dry run", () => {
  it("returns the plan without DB writes", async () => {
    const { rows } = parseIstockCsv(VALID_CSV);
    const result = await seedIstockLibrary({
      rows,
      jobIdempotencyKey: `dry-${Date.now()}`,
      dryRun: true,
    });
    expect(result.dryRun).toBe(true);
    expect(result.jobId).toBeNull();
    expect(result.itemsCreated).toBe(0);
    expect(result.imagesCreated).toBe(0);
    expect(result.estimate.imageCount).toBe(3);

    const svc = getServiceRoleClient();
    const { count: jobCount } = await svc
      .from("transfer_jobs")
      .select("*", { count: "exact", head: true });
    expect(jobCount ?? 0).toBe(0);
    const { count: imgCount } = await svc
      .from("image_library")
      .select("*", { count: "exact", head: true });
    expect(imgCount ?? 0).toBe(0);
  });
});

describe("seedIstockLibrary — real run", () => {
  it("inserts image_library + transfer_jobs + transfer_job_items", async () => {
    const { rows } = parseIstockCsv(VALID_CSV);
    const jobKey = `seed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const result = await seedIstockLibrary({
      rows,
      jobIdempotencyKey: jobKey,
    });
    expect(result.dryRun).toBe(false);
    expect(result.jobId).not.toBeNull();
    expect(result.imagesCreated).toBe(3);
    expect(result.imagesAdopted).toBe(0);
    expect(result.itemsCreated).toBe(3);

    const svc = getServiceRoleClient();
    const { data: images } = await svc
      .from("image_library")
      .select("source_ref, width_px, license_type")
      .order("source_ref", { ascending: true });
    expect(images).toHaveLength(3);
    expect(images?.[0]?.source_ref).toBe("i-1");
    expect(images?.[0]?.width_px).toBe(1024);

    const { data: job } = await svc
      .from("transfer_jobs")
      .select("id, type, idempotency_key, requested_count")
      .eq("idempotency_key", jobKey)
      .single();
    expect(job?.type).toBe("cloudflare_ingest");
    expect(job?.requested_count).toBe(3);

    const { data: items } = await svc
      .from("transfer_job_items")
      .select("slot_index, source_url, image_id, cloudflare_idempotency_key")
      .eq("transfer_job_id", result.jobId!)
      .order("slot_index", { ascending: true });
    expect(items).toHaveLength(3);
    expect(items?.[0]?.slot_index).toBe(0);
    expect(items?.[0]?.source_url).toBe("https://src.test/1.jpg");
    expect(items?.[0]?.image_id).not.toBeNull();
    expect(items?.[0]?.cloudflare_idempotency_key).toBe(
      `cf-${result.jobId}-0`,
    );
  });
});

describe("seedIstockLibrary — idempotency", () => {
  it("re-running with the same job key adopts the existing job and skips existing items", async () => {
    const { rows } = parseIstockCsv(VALID_CSV);
    const jobKey = `idem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const first = await seedIstockLibrary({
      rows,
      jobIdempotencyKey: jobKey,
    });
    expect(first.itemsCreated).toBe(3);

    const second = await seedIstockLibrary({
      rows,
      jobIdempotencyKey: jobKey,
    });
    expect(second.jobId).toBe(first.jobId);
    expect(second.itemsCreated).toBe(0);
    expect(second.imagesCreated).toBe(0);
    expect(second.imagesAdopted).toBe(3);

    const svc = getServiceRoleClient();
    const { count } = await svc
      .from("transfer_job_items")
      .select("*", { count: "exact", head: true })
      .eq("transfer_job_id", first.jobId!);
    expect(count).toBe(3);
  });

  it("adopts pre-existing image_library rows rather than duplicating", async () => {
    const svc = getServiceRoleClient();
    // Pre-insert one of the CSV's istock_ids.
    const { data: pre } = await svc
      .from("image_library")
      .insert({
        source: "istock",
        source_ref: "i-1",
        filename: "preexisting",
        width_px: 999,
      })
      .select("id")
      .single();
    const preId = pre?.id as string | undefined;

    const { rows } = parseIstockCsv(VALID_CSV);
    const jobKey = `adopt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const result = await seedIstockLibrary({
      rows,
      jobIdempotencyKey: jobKey,
    });
    expect(result.imagesAdopted).toBe(1);
    expect(result.imagesCreated).toBe(2);

    // The i-1 item still points at the pre-existing row, unchanged.
    const { data: items } = await svc
      .from("transfer_job_items")
      .select("slot_index, image_id")
      .eq("transfer_job_id", result.jobId!)
      .eq("slot_index", 0)
      .single();
    expect(items?.image_id).toBe(preId);

    // Pre-existing row's width_px was NOT overwritten.
    const { data: img } = await svc
      .from("image_library")
      .select("width_px, filename")
      .eq("id", preId!)
      .single();
    expect(img?.width_px).toBe(999);
    expect(img?.filename).toBe("preexisting");
  });
});

describe("seedIstockLibrary — budget cap", () => {
  it("throws IngestBudgetError when estimate exceeds the cap", async () => {
    const { rows } = parseIstockCsv(VALID_CSV);
    // estimate = 3 cents; cap = 1 cent → should abort.
    const err = await seedIstockLibrary({
      rows,
      jobIdempotencyKey: "budget-abort",
      budgetCapCents: 1,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(IngestBudgetError);
    expect((err as IngestBudgetError).capSource).toBe("caller");
  });

  it("auto-cap is DEFAULT_BUDGET_CAP_MULTIPLIER × estimate, floor 2000 cents", async () => {
    const { rows } = parseIstockCsv(VALID_CSV);
    const result = await seedIstockLibrary({
      rows,
      jobIdempotencyKey: `auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    });
    const expectedCap = Math.max(
      result.estimate.totalCents * DEFAULT_BUDGET_CAP_MULTIPLIER,
      2000,
    );
    expect(result.budgetCapCents).toBe(expectedCap);
  });

  it("M8-3: ISTOCK_SEED_CAP_CENTS env var caps above the caller's value", async () => {
    const { rows } = parseIstockCsv(VALID_CSV);
    process.env.ISTOCK_SEED_CAP_CENTS = "2";
    try {
      const err = await seedIstockLibrary({
        rows,
        jobIdempotencyKey: "env-cap",
        budgetCapCents: 1000,
      }).catch((e) => e);
      expect(err).toBeInstanceOf(IngestBudgetError);
      // Env cap (2c) is lower than caller (1000c) → env wins.
      expect((err as IngestBudgetError).capSource).toBe("env");
      expect((err as IngestBudgetError).budgetCapCents).toBe(2);
    } finally {
      delete process.env.ISTOCK_SEED_CAP_CENTS;
    }
  });

  it("M8-3: default uses min(2× estimate, env cap)", async () => {
    const { rows } = parseIstockCsv(VALID_CSV);
    // Env cap generous so default wins.
    process.env.ISTOCK_SEED_CAP_CENTS = "1000000";
    try {
      const result = await seedIstockLibrary({
        rows,
        jobIdempotencyKey: `default-${Date.now()}`,
      });
      expect(result.capSource).toBe("default");
      expect(result.envCapCents).toBe(1000000);
    } finally {
      delete process.env.ISTOCK_SEED_CAP_CENTS;
    }
  });
});
