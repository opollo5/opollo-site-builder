import { describe, expect, it } from "vitest";

import { createComponent } from "@/lib/components";
import {
  activateDesignSystem,
  createDesignSystem,
} from "@/lib/design-systems";
import { getServiceRoleClient } from "@/lib/supabase";
import { createTemplate } from "@/lib/templates";
import { computeBodyHash, createBatchJob } from "@/lib/batch-jobs";

import {
  minimalComponentContentSchema,
  minimalComposition,
  seedSite,
} from "./_helpers";

// ---------------------------------------------------------------------------
// M3-2 — createBatchJob (idempotent job + slots creation).
//
// Pins the correctness contract the HTTP route is a thin wrapper over:
//   - Validation: site_id / template_id UUID; slots 1..100; inputs object.
//   - Template must belong to an ACTIVE design system for the requested site.
//   - Stripe-style idempotency: key + body hash match → replay; key
//     with different body → IDEMPOTENCY_KEY_CONFLICT.
//   - Atomicity: job + all slot rows commit together; slot count == requested_count.
//   - Slot keys deterministic: anthropic_idempotency_key = "ant-{job}-{i}",
//     wp_idempotency_key = "wp-{job}-{i}". Worker retries reuse the same key.
// ---------------------------------------------------------------------------

async function seedActiveTemplateForSite(siteId: string): Promise<string> {
  const ds = await createDesignSystem({
    site_id: siteId,
    version: 1,
    tokens_css: "",
    base_styles: "",
  });
  if (!ds.ok) throw new Error(`seed ds: ${ds.error.message}`);

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
    if (!c.ok) throw new Error(`seed component: ${c.error.message}`);
  }

  const t = await createTemplate({
    design_system_id: ds.data.id,
    page_type: "homepage",
    name: "homepage-default",
    composition: minimalComposition(),
    required_fields: { hero: ["headline"] },
    is_default: true,
  });
  if (!t.ok) throw new Error(`seed template: ${t.error.message}`);

  const activated = await activateDesignSystem(ds.data.id, 1);
  if (!activated.ok) throw new Error(`activate: ${activated.error.message}`);

  return t.data.id;
}

function simpleSlots(n: number): Array<{ inputs: Record<string, unknown> }> {
  return Array.from({ length: n }, (_, i) => ({
    inputs: { slug: `slug-${i}`, topic: `topic ${i}` },
  }));
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("createBatchJob — validation", () => {
  it("rejects missing idempotency key", async () => {
    const site = await seedSite();
    const templateId = await seedActiveTemplateForSite(site.id);
    const res = await createBatchJob({
      site_id: site.id,
      template_id: templateId,
      slots: simpleSlots(1),
      idempotency_key: "",
      created_by: null,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects non-UUID site_id", async () => {
    const res = await createBatchJob({
      site_id: "not-a-uuid",
      template_id: "00000000-0000-0000-0000-000000000000",
      slots: simpleSlots(1),
      idempotency_key: "k1",
      created_by: null,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects empty slots", async () => {
    const site = await seedSite();
    const templateId = await seedActiveTemplateForSite(site.id);
    const res = await createBatchJob({
      site_id: site.id,
      template_id: templateId,
      slots: [],
      idempotency_key: "k-empty",
      created_by: null,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects more than 100 slots", async () => {
    const site = await seedSite();
    const templateId = await seedActiveTemplateForSite(site.id);
    const res = await createBatchJob({
      site_id: site.id,
      template_id: templateId,
      slots: simpleSlots(101),
      idempotency_key: "k-big",
      created_by: null,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects non-object slot.inputs", async () => {
    const site = await seedSite();
    const templateId = await seedActiveTemplateForSite(site.id);
    const res = await createBatchJob({
      site_id: site.id,
      template_id: templateId,
      slots: [{ inputs: "oops" as unknown as Record<string, unknown> }],
      idempotency_key: "k-inputs",
      created_by: null,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("VALIDATION_FAILED");
  });
});

// ---------------------------------------------------------------------------
// Template activation checks
// ---------------------------------------------------------------------------

describe("createBatchJob — template checks", () => {
  it("returns TEMPLATE_NOT_FOUND when template id is unknown", async () => {
    const site = await seedSite();
    const res = await createBatchJob({
      site_id: site.id,
      template_id: "00000000-0000-0000-0000-000000000000",
      slots: simpleSlots(1),
      idempotency_key: "k-notfound",
      created_by: null,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("TEMPLATE_NOT_FOUND");
  });

  it("returns TEMPLATE_NOT_FOUND when template belongs to another site", async () => {
    const siteA = await seedSite({ prefix: "aa" });
    const siteB = await seedSite({ prefix: "bb" });
    const templateA = await seedActiveTemplateForSite(siteA.id);
    const res = await createBatchJob({
      site_id: siteB.id,
      template_id: templateA,
      slots: simpleSlots(1),
      idempotency_key: "k-cross",
      created_by: null,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("TEMPLATE_NOT_FOUND");
  });

  it("returns TEMPLATE_NOT_ACTIVE when the template's design system is draft", async () => {
    const site = await seedSite();
    // Create template WITHOUT activating.
    const ds = await createDesignSystem({
      site_id: site.id,
      version: 1,
      tokens_css: "",
      base_styles: "",
    });
    if (!ds.ok) throw new Error(ds.error.message);
    for (const name of ["hero-centered", "footer-default"]) {
      await createComponent({
        design_system_id: ds.data.id,
        name,
        variant: null,
        category: name.split("-")[0] ?? "misc",
        html_template: `<section>${name}</section>`,
        css: ".ls-x {}",
        content_schema: minimalComponentContentSchema(),
      });
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

    const res = await createBatchJob({
      site_id: site.id,
      template_id: t.data.id,
      slots: simpleSlots(1),
      idempotency_key: "k-draft",
      created_by: null,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("TEMPLATE_NOT_ACTIVE");
  });
});

// ---------------------------------------------------------------------------
// Happy path + atomicity
// ---------------------------------------------------------------------------

describe("createBatchJob — creation", () => {
  it("inserts the job + all slots atomically", async () => {
    const site = await seedSite();
    const templateId = await seedActiveTemplateForSite(site.id);

    const res = await createBatchJob({
      site_id: site.id,
      template_id: templateId,
      slots: simpleSlots(5),
      idempotency_key: `k-happy-${Date.now()}`,
      created_by: null,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.requested_count).toBe(5);
    expect(res.data.idempotency_replay).toBe(false);

    const svc = getServiceRoleClient();
    const { data: job } = await svc
      .from("generation_jobs")
      .select("status, requested_count, body_hash")
      .eq("id", res.data.job_id)
      .single();
    expect(job?.status).toBe("queued");
    expect(job?.requested_count).toBe(5);
    expect(job?.body_hash).toBeTruthy();

    const { data: slots } = await svc
      .from("generation_job_pages")
      .select(
        "slot_index, state, anthropic_idempotency_key, wp_idempotency_key",
      )
      .eq("job_id", res.data.job_id)
      .order("slot_index", { ascending: true });
    expect(slots?.length).toBe(5);
    for (let i = 0; i < 5; i++) {
      expect(slots?.[i]?.slot_index).toBe(i);
      expect(slots?.[i]?.state).toBe("pending");
      expect(slots?.[i]?.anthropic_idempotency_key).toBe(
        `ant-${res.data.job_id}-${i}`,
      );
      expect(slots?.[i]?.wp_idempotency_key).toBe(
        `wp-${res.data.job_id}-${i}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Idempotency semantics
// ---------------------------------------------------------------------------

describe("createBatchJob — idempotency", () => {
  it("replays on same key + same body", async () => {
    const site = await seedSite();
    const templateId = await seedActiveTemplateForSite(site.id);
    const key = `k-replay-${Date.now()}`;
    const slots = simpleSlots(3);

    const first = await createBatchJob({
      site_id: site.id,
      template_id: templateId,
      slots,
      idempotency_key: key,
      created_by: null,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await createBatchJob({
      site_id: site.id,
      template_id: templateId,
      slots,
      idempotency_key: key,
      created_by: null,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.data.job_id).toBe(first.data.job_id);
    expect(second.data.idempotency_replay).toBe(true);
    expect(second.data.requested_count).toBe(3);

    // No second set of slots was inserted.
    const svc = getServiceRoleClient();
    const { data: slotRows } = await svc
      .from("generation_job_pages")
      .select("id")
      .eq("job_id", first.data.job_id);
    expect(slotRows?.length).toBe(3);
  });

  it("replay is stable under different slot ORDERINGS if body hash uses canonical JSON", async () => {
    // Guard against a future refactor that relies on key insertion order.
    const a = computeBodyHash({
      site_id: "s",
      template_id: "t",
      slots: [{ inputs: { a: 1, b: 2 } }],
    });
    const b = computeBodyHash({
      slots: [{ inputs: { b: 2, a: 1 } }],
      template_id: "t",
      site_id: "s",
    });
    expect(a).toBe(b);
  });

  it("returns IDEMPOTENCY_KEY_CONFLICT on same key + different body", async () => {
    const site = await seedSite();
    const templateId = await seedActiveTemplateForSite(site.id);
    const key = `k-conflict-${Date.now()}`;

    const first = await createBatchJob({
      site_id: site.id,
      template_id: templateId,
      slots: simpleSlots(2),
      idempotency_key: key,
      created_by: null,
    });
    expect(first.ok).toBe(true);

    const second = await createBatchJob({
      site_id: site.id,
      template_id: templateId,
      slots: simpleSlots(3), // different body
      idempotency_key: key,
      created_by: null,
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.code).toBe("IDEMPOTENCY_KEY_CONFLICT");
  });
});
