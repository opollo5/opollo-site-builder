import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { createBatchJob } from "@/lib/batch-jobs";
import { leaseNextPage, processSlotDummy } from "@/lib/batch-worker";
import { createComponent } from "@/lib/components";
import {
  activateDesignSystem,
  createDesignSystem,
} from "@/lib/design-systems";
import { getServiceRoleClient } from "@/lib/supabase";
import { createTemplate } from "@/lib/templates";

import {
  seedAuthUser,
  signInAs,
  type SeededAuthUser,
} from "./_auth-helpers";
import {
  minimalComponentContentSchema,
  minimalComposition,
  seedSite,
} from "./_helpers";

// ---------------------------------------------------------------------------
// M3-8 — POST /api/admin/batch/[id]/cancel.
//
// Pins:
//   1. 403 for an operator cancelling another operator's batch.
//   2. 404 on unknown job id.
//   3. 409 INVALID_STATE on a terminal-status batch.
//   4. Happy path: status→'cancelled', pending slots flipped to
//      'skipped', batch_cancelled event logged.
//   5. Idempotent re-cancel: 200 with changed:false, no duplicate events.
//   6. In-flight slot completion after cancel preserves 'cancelled'
//      status (the worker's status CASE doesn't flip back).
// ---------------------------------------------------------------------------

const mockState = vi.hoisted(() => ({
  client: null as SupabaseClient | null,
}));

vi.mock("@/lib/auth", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return {
    ...actual,
    createRouteAuthClient: () => {
      if (!mockState.client) {
        throw new Error("batch-cancel.test: mockState.client not set");
      }
      return mockState.client;
    },
  };
});

import { POST as cancelPOST } from "@/app/api/admin/batch/[id]/cancel/route";

function anonClient(): SupabaseClient {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function signedInClient(email: string): Promise<SupabaseClient> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({
    email,
    password: "test-password-1234",
  });
  if (error) throw new Error(`signedInClient: ${error.message}`);
  return client;
}

async function seedActiveTemplateForSite(siteId: string): Promise<string> {
  const ds = await createDesignSystem({
    site_id: siteId,
    version: 1,
    tokens_css: "",
    base_styles: "",
  });
  if (!ds.ok) throw new Error(ds.error.message);
  for (const name of ["hero-centered", "footer-default"]) {
    const c = await createComponent({
      design_system_id: ds.data.id,
      name,
      variant: null,
      category: name.split("-")[0] ?? "misc",
      html_template: `<section>${name}</section>`,
      css: ".ls-x {}",
      content_schema: minimalComponentContentSchema(),
    });
    if (!c.ok) throw new Error(c.error.message);
  }
  const t = await createTemplate({
    design_system_id: ds.data.id,
    page_type: "homepage",
    name: "homepage-default",
    composition: minimalComposition(),
    required_fields: { hero: ["headline"] },
    is_default: true,
  });
  if (!t.ok) throw new Error(t.error.message);
  const activated = await activateDesignSystem(ds.data.id, 1);
  if (!activated.ok) throw new Error(activated.error.message);
  return t.data.id;
}

async function seedBatch(
  slots: number,
  createdBy: string | null,
): Promise<string> {
  const site = await seedSite({ prefix: "ls" });
  const templateId = await seedActiveTemplateForSite(site.id);
  const res = await createBatchJob({
    site_id: site.id,
    template_id: templateId,
    slots: Array.from({ length: slots }, (_, i) => ({
      inputs: { slug: `cancel-${i}` },
    })),
    idempotency_key: `cancel-${Date.now()}-${Math.random()}`,
    created_by: createdBy,
  });
  if (!res.ok) throw new Error(res.error.message);
  return res.data.job_id;
}

function makeRequest(): Request {
  return new Request("http://localhost:3000/api/admin/batch/x/cancel", {
    method: "POST",
  });
}

let admin: SeededAuthUser;
let operator: SeededAuthUser;
let otherOperator: SeededAuthUser;

beforeEach(async () => {
  process.env.FEATURE_SUPABASE_AUTH = "true";
  admin = await seedAuthUser({ role: "admin" });
  operator = await seedAuthUser({ role: "admin" });
  otherOperator = await seedAuthUser({ role: "admin" });
});

afterEach(() => {
  delete process.env.FEATURE_SUPABASE_AUTH;
  mockState.client = null;
});

// ---------------------------------------------------------------------------
// Authorisation
// ---------------------------------------------------------------------------

describe("POST /cancel: authorisation", () => {
  it("403 when a non-creator operator tries to cancel another operator's batch", async () => {
    const jobId = await seedBatch(2, operator.id);
    mockState.client = await signedInClient(otherOperator.email);
    const res = await cancelPOST(makeRequest(), {
      params: { id: jobId },
    });
    expect(res.status).toBe(403);
  });

  it("allows an admin to cancel any batch", async () => {
    const jobId = await seedBatch(2, operator.id);
    mockState.client = await signedInClient(admin.email);
    const res = await cancelPOST(makeRequest(), {
      params: { id: jobId },
    });
    expect(res.status).toBe(200);
  });

  it("allows the creating operator to cancel", async () => {
    const jobId = await seedBatch(2, operator.id);
    mockState.client = await signedInClient(operator.email);
    const res = await cancelPOST(makeRequest(), {
      params: { id: jobId },
    });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("POST /cancel: validation", () => {
  it("400 on non-UUID id", async () => {
    mockState.client = await signedInClient(admin.email);
    const res = await cancelPOST(makeRequest(), {
      params: { id: "not-a-uuid" },
    });
    expect(res.status).toBe(400);
  });

  it("404 on unknown job id", async () => {
    mockState.client = await signedInClient(admin.email);
    const res = await cancelPOST(makeRequest(), {
      params: { id: "00000000-0000-0000-0000-000000000000" },
    });
    expect(res.status).toBe(404);
  });

  it("409 INVALID_STATE on a terminal-status job (succeeded)", async () => {
    const jobId = await seedBatch(1, admin.id);
    // Force job status to succeeded.
    await getServiceRoleClient()
      .from("generation_jobs")
      .update({
        status: "succeeded",
        finished_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    mockState.client = await signedInClient(admin.email);
    const res = await cancelPOST(makeRequest(), {
      params: { id: jobId },
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("INVALID_STATE");
  });
});

// ---------------------------------------------------------------------------
// Happy path + idempotency
// ---------------------------------------------------------------------------

describe("POST /cancel: outcomes", () => {
  it("flips status to cancelled, marks pending slots skipped, logs event", async () => {
    const jobId = await seedBatch(3, admin.id);
    mockState.client = await signedInClient(admin.email);

    const res = await cancelPOST(makeRequest(), {
      params: { id: jobId },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe("cancelled");
    expect(body.data.changed).toBe(true);

    const svc = getServiceRoleClient();
    const { data: job } = await svc
      .from("generation_jobs")
      .select("status, cancel_requested_at, finished_at")
      .eq("id", jobId)
      .single();
    expect(job?.status).toBe("cancelled");
    expect(job?.cancel_requested_at).not.toBeNull();
    expect(job?.finished_at).not.toBeNull();

    const { data: slots } = await svc
      .from("generation_job_pages")
      .select("state, last_error_code")
      .eq("job_id", jobId);
    for (const s of slots ?? []) {
      expect(s.state).toBe("skipped");
      expect(s.last_error_code).toBe("CANCELLED");
    }

    const { data: events } = await svc
      .from("generation_events")
      .select("event")
      .eq("job_id", jobId)
      .eq("event", "batch_cancelled");
    expect(events?.length).toBe(1);
  });

  it("idempotent re-cancel: 200 with changed:false, no duplicate events", async () => {
    const jobId = await seedBatch(1, admin.id);
    mockState.client = await signedInClient(admin.email);

    const first = await cancelPOST(makeRequest(), {
      params: { id: jobId },
    });
    expect(first.status).toBe(200);

    const second = await cancelPOST(makeRequest(), {
      params: { id: jobId },
    });
    expect(second.status).toBe(200);
    const body = await second.json();
    expect(body.data.changed).toBe(false);

    const svc = getServiceRoleClient();
    const { data: events } = await svc
      .from("generation_events")
      .select("id")
      .eq("job_id", jobId)
      .eq("event", "batch_cancelled");
    expect(events?.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// In-flight slot completion preserves 'cancelled' status
// ---------------------------------------------------------------------------

describe("POST /cancel: in-flight slot completion preserves cancelled status", () => {
  it("a succeeded in-flight slot does not flip job status back", async () => {
    const jobId = await seedBatch(2, admin.id);
    const svc = getServiceRoleClient();

    // Lease slot 0 (simulates in-flight work).
    const inFlight = await leaseNextPage("inflight-worker");
    if (!inFlight) throw new Error("lease failed");

    // Cancel the job. Slot 1 (still pending) goes to skipped; slot 0
    // is 'leased' so it stays.
    mockState.client = await signedInClient(admin.email);
    const res = await cancelPOST(makeRequest(), {
      params: { id: jobId },
    });
    expect(res.status).toBe(200);

    const { data: preJob } = await svc
      .from("generation_jobs")
      .select("status")
      .eq("id", jobId)
      .single();
    expect(preJob?.status).toBe("cancelled");

    // Complete slot 0 via the dummy processor (faster than
    // the full Anthropic path).
    await processSlotDummy(inFlight.id, "inflight-worker");

    // Job status must still be 'cancelled'. succeeded_count can
    // update; status doesn't flip back.
    const { data: postJob } = await svc
      .from("generation_jobs")
      .select("status, succeeded_count")
      .eq("id", jobId)
      .single();
    expect(postJob?.status).toBe("cancelled");
    expect(postJob?.succeeded_count).toBe(1);
  });
});
