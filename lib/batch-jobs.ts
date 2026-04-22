import { createHash } from "node:crypto";
import { Client } from "pg";

import { getServiceRoleClient } from "@/lib/supabase";
import {
  PROJECTED_COST_PER_BATCH_SLOT_CENTS,
  reserveBudget,
} from "@/lib/tenant-budgets";

// ---------------------------------------------------------------------------
// M3-2 — Batch-job creation.
//
// Creates a generation_jobs row + one generation_job_pages row per slot
// in a single Postgres transaction so the caller either gets a fully-
// populated batch or nothing. Idempotency is handled Stripe-style:
//
//   - POST with { Idempotency-Key: K } succeeds → job stored with
//     idempotency_key = K and body_hash = sha256(canonical body).
//
//   - Re-POST with same K + same body hash → replay: return the same
//     job id. No new rows.
//
//   - Re-POST with same K + different body hash → refuse with
//     IDEMPOTENCY_KEY_CONFLICT. The alternative (silent replay of
//     the original) would hide a genuine operator mistake.
//
// Atomicity strategy: a single pg transaction. We use `INSERT …
// ON CONFLICT (idempotency_key) DO NOTHING RETURNING id` so the
// existence check + insert happen in one round-trip. If the insert
// returned nothing, the key was taken — we SELECT the existing row,
// compare body_hash, and either replay or conflict. Slots are
// inserted inside the same transaction as the job; if slot insertion
// fails, the job insert is rolled back too, leaving the DB clean.
//
// Runtime: nodejs (uses `pg` directly for transactions).
// ---------------------------------------------------------------------------

export const BATCH_MAX_SLOTS = 100;

export type BatchSlotInput = {
  inputs: Record<string, unknown>;
};

export type CreateBatchInput = {
  site_id: string;
  template_id: string;
  slots: BatchSlotInput[];
  idempotency_key: string;
  created_by: string | null;
};

export type CreateBatchSuccess = {
  ok: true;
  data: {
    job_id: string;
    requested_count: number;
    idempotency_replay: boolean;
  };
};

export type CreateBatchError = {
  ok: false;
  error: {
    code:
      | "VALIDATION_FAILED"
      | "TEMPLATE_NOT_FOUND"
      | "TEMPLATE_NOT_ACTIVE"
      | "IDEMPOTENCY_KEY_CONFLICT"
      | "BUDGET_EXCEEDED"
      | "INTERNAL_ERROR";
    message: string;
    details?: Record<string, unknown>;
  };
};

export type CreateBatchResult = CreateBatchSuccess | CreateBatchError;

function errorResult(
  code: CreateBatchError["error"]["code"],
  message: string,
  details?: Record<string, unknown>,
): CreateBatchError {
  return { ok: false, error: { code, message, details } };
}

/**
 * Canonical JSON: keys sorted lexicographically at every level. Makes
 * body_hash stable across callers that construct the same logical
 * body with different key orderings.
 */
function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalStringify).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + canonicalStringify(obj[k]))
      .join(",") +
    "}"
  );
}

export function computeBodyHash(body: unknown): string {
  return createHash("sha256").update(canonicalStringify(body)).digest("hex");
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateInput(input: CreateBatchInput): CreateBatchError | null {
  if (!input.idempotency_key || typeof input.idempotency_key !== "string") {
    return errorResult(
      "VALIDATION_FAILED",
      "Idempotency-Key header is required.",
    );
  }
  if (input.idempotency_key.length > 255) {
    return errorResult(
      "VALIDATION_FAILED",
      "Idempotency-Key must be 255 characters or fewer.",
    );
  }
  if (!/^[0-9a-f-]{36}$/i.test(input.site_id)) {
    return errorResult("VALIDATION_FAILED", "site_id must be a UUID.");
  }
  if (!/^[0-9a-f-]{36}$/i.test(input.template_id)) {
    return errorResult("VALIDATION_FAILED", "template_id must be a UUID.");
  }
  if (!Array.isArray(input.slots) || input.slots.length === 0) {
    return errorResult(
      "VALIDATION_FAILED",
      "slots must be a non-empty array.",
    );
  }
  if (input.slots.length > BATCH_MAX_SLOTS) {
    return errorResult(
      "VALIDATION_FAILED",
      `slots count must be ${BATCH_MAX_SLOTS} or fewer (received ${input.slots.length}).`,
    );
  }
  for (let i = 0; i < input.slots.length; i++) {
    const slot = input.slots[i];
    if (
      !slot ||
      typeof slot !== "object" ||
      Array.isArray(slot) ||
      slot.inputs === null ||
      typeof slot.inputs !== "object" ||
      Array.isArray(slot.inputs)
    ) {
      return errorResult(
        "VALIDATION_FAILED",
        `slots[${i}].inputs must be an object.`,
      );
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Template activation check
// ---------------------------------------------------------------------------

async function assertTemplateForActiveSite(
  site_id: string,
  template_id: string,
): Promise<CreateBatchError | null> {
  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("design_templates")
    .select("id, design_system:design_systems!inner(id, site_id, status)")
    .eq("id", template_id)
    .maybeSingle();

  if (error) {
    return errorResult(
      "INTERNAL_ERROR",
      `Template lookup failed: ${error.message}`,
    );
  }
  if (!data) {
    return errorResult("TEMPLATE_NOT_FOUND", "No template with that id.");
  }
  const ds = data.design_system as unknown as {
    id: string;
    site_id: string;
    status: string;
  };
  if (ds.site_id !== site_id) {
    return errorResult(
      "TEMPLATE_NOT_FOUND",
      "Template does not belong to the requested site.",
    );
  }
  if (ds.status !== "active") {
    return errorResult(
      "TEMPLATE_NOT_ACTIVE",
      `Template's design system is '${ds.status}', not 'active'. Batch generation requires an active design system (HC-6).`,
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Creator
// ---------------------------------------------------------------------------

function requireDbUrl(): string {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    throw new Error(
      "SUPABASE_DB_URL is not set. Required by createBatchJob for the job + slots transaction.",
    );
  }
  return url;
}

export async function createBatchJob(
  input: CreateBatchInput,
): Promise<CreateBatchResult> {
  const v = validateInput(input);
  if (v) return v;

  const tmpl = await assertTemplateForActiveSite(
    input.site_id,
    input.template_id,
  );
  if (tmpl) return tmpl;

  const bodyForHash = {
    site_id: input.site_id,
    template_id: input.template_id,
    slots: input.slots,
  };
  const body_hash = computeBodyHash(bodyForHash);

  const client = new Client({ connectionString: requireDbUrl() });
  await client.connect();

  try {
    await client.query("BEGIN");

    // INSERT with ON CONFLICT DO NOTHING: if idempotency_key is taken
    // we get no RETURNING row and fall through to the existing-job
    // replay path.
    const insertJob = await client.query<{ id: string }>(
      `INSERT INTO generation_jobs
         (site_id, template_id, status, requested_count,
          idempotency_key, body_hash, created_by)
       VALUES ($1, $2, 'queued', $3, $4, $5, $6)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [
        input.site_id,
        input.template_id,
        input.slots.length,
        input.idempotency_key,
        body_hash,
        input.created_by,
      ],
    );

    if (insertJob.rows.length === 0) {
      // Existing job under this key. Replay iff body matches; otherwise
      // conflict.
      const existing = await client.query<{
        id: string;
        body_hash: string | null;
        requested_count: number;
      }>(
        `SELECT id, body_hash, requested_count
         FROM generation_jobs
         WHERE idempotency_key = $1`,
        [input.idempotency_key],
      );
      await client.query("COMMIT");

      const row = existing.rows[0];
      if (!row) {
        // Extremely unlikely: row vanished between INSERT conflict and
        // SELECT. Treat as a retry-worthy internal error.
        return errorResult(
          "INTERNAL_ERROR",
          "Idempotency key conflicted but the existing job could not be fetched.",
        );
      }
      if (row.body_hash !== body_hash) {
        return errorResult(
          "IDEMPOTENCY_KEY_CONFLICT",
          "An earlier request used this Idempotency-Key with a different body. Send a fresh key or match the original body.",
        );
      }
      return {
        ok: true,
        data: {
          job_id: row.id,
          requested_count: row.requested_count,
          idempotency_replay: true,
        },
      };
    }

    const job_id = insertJob.rows[0]!.id;

    // M8-2 — reserve the projected cost against the tenant's daily +
    // monthly budget. Runs inside the same transaction as the job
    // INSERT so a BUDGET_EXCEEDED rolls back the job atomically.
    // FOR UPDATE inside reserveBudget serialises concurrent enqueues
    // against the same tenant.
    const projectedCents =
      PROJECTED_COST_PER_BATCH_SLOT_CENTS * input.slots.length;
    const reservation = await reserveBudget(
      client,
      input.site_id,
      projectedCents,
    );
    if (!reservation.ok) {
      await client.query("ROLLBACK");
      if (reservation.code === "BUDGET_EXCEEDED") {
        return errorResult("BUDGET_EXCEEDED", reservation.message, {
          period: reservation.period,
          cap_cents: reservation.cap_cents,
          usage_cents: reservation.usage_cents,
          projected_cents: reservation.projected_cents,
        });
      }
      return errorResult("INTERNAL_ERROR", reservation.message);
    }

    // Bulk-insert slots. anthropic_idempotency_key / wp_idempotency_key
    // are deterministic on (job_id, slot_index) so every retry of the
    // same slot reuses the same key — Anthropic's cache + WP adoption
    // both hinge on this.
    const valuesSql: string[] = [];
    const valuesParams: unknown[] = [];
    for (let i = 0; i < input.slots.length; i++) {
      const base = i * 5;
      valuesSql.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`,
      );
      valuesParams.push(
        job_id,
        i,
        input.slots[i]!.inputs,
        `ant-${job_id}-${i}`,
        `wp-${job_id}-${i}`,
      );
    }

    await client.query(
      `INSERT INTO generation_job_pages
         (job_id, slot_index, inputs,
          anthropic_idempotency_key, wp_idempotency_key)
       VALUES ${valuesSql.join(", ")}`,
      valuesParams,
    );

    await client.query("COMMIT");

    return {
      ok: true,
      data: {
        job_id,
        requested_count: input.slots.length,
        idempotency_replay: false,
      },
    };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore secondary rollback failure
    }
    const message = err instanceof Error ? err.message : String(err);
    return errorResult(
      "INTERNAL_ERROR",
      `Batch creation failed: ${message}`,
    );
  } finally {
    await client.end();
  }
}
