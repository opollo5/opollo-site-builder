import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// ---------------------------------------------------------------------------
// S1-19 — backfillScheduledPublishes against the live Supabase stack
// with a mocked QStash client.
//
// Covers:
//   - QSTASH_TOKEN unset → status='skipped', no DB read.
//   - Picks up future-dated, non-cancelled rows with NULL message id.
//   - Skips rows that already have a message_id (idempotent reruns).
//   - Skips cancelled rows.
//   - Skips past-dated rows (we never auto-fire late).
//   - Stores the new message_id back on the row (verified via DB read).
//   - Per-row enqueue failure counted as `failed`, doesn't abort the batch.
// ---------------------------------------------------------------------------

const mockClient = {
  publishJSON: vi.fn(),
  messages: {
    delete: vi.fn(),
  },
};

vi.mock("@/lib/qstash", async () => {
  return {
    getQstashClient: () => mockClient,
    getQstashReceiver: () => null,
    verifyQstashSignature: async () => ({
      ok: false,
      reason: "no_receiver" as const,
    }),
    __resetQstashForTests: () => {},
  };
});

import { backfillScheduledPublishes } from "@/lib/platform/social/publishing";
import { getServiceRoleClient } from "@/lib/supabase";

const COMPANY_ID = "abcdef00-0000-0000-0000-aaaaaaaa1919";

async function seedCompany(): Promise<void> {
  const svc = getServiceRoleClient();
  const r = await svc.from("platform_companies").insert({
    id: COMPANY_ID,
    name: "S1-19 Co",
    slug: "s1-19-co",
    domain: "s1-19.test",
    is_opollo_internal: false,
    timezone: "Australia/Melbourne",
    approval_default_rule: "any_one",
  });
  if (r.error) throw new Error(`seed company: ${r.error.message}`);
}

async function seedScheduleEntry(opts: {
  scheduledAt: string;
  qstashMessageId?: string | null;
  cancelledAt?: string | null;
}): Promise<string> {
  const svc = getServiceRoleClient();
  const master = await svc
    .from("social_post_master")
    .insert({
      company_id: COMPANY_ID,
      state: "approved",
      source_type: "manual",
      master_text: "hello",
    })
    .select("id")
    .single();
  if (master.error) throw new Error(`seed master: ${master.error.message}`);

  const variant = await svc
    .from("social_post_variant")
    .insert({
      post_master_id: master.data.id,
      platform: "linkedin_personal",
      variant_text: "hi",
    })
    .select("id")
    .single();
  if (variant.error) throw new Error(`seed variant: ${variant.error.message}`);

  const entry = await svc
    .from("social_schedule_entries")
    .insert({
      post_variant_id: variant.data.id,
      scheduled_at: opts.scheduledAt,
      qstash_message_id: opts.qstashMessageId ?? null,
      cancelled_at: opts.cancelledAt ?? null,
    })
    .select("id")
    .single();
  if (entry.error) throw new Error(`seed entry: ${entry.error.message}`);
  return entry.data.id as string;
}

const ORIGIN = "https://opollo.test";

beforeEach(async () => {
  mockClient.publishJSON.mockReset();
  mockClient.messages.delete.mockReset();
  await seedCompany();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("backfillScheduledPublishes — env gating", () => {
  it("returns skipped when QSTASH_TOKEN unset", async () => {
    const prior = process.env.QSTASH_TOKEN;
    delete process.env.QSTASH_TOKEN;
    try {
      const result = await backfillScheduledPublishes({ origin: ORIGIN });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.status).toBe("skipped");
      expect(mockClient.publishJSON).not.toHaveBeenCalled();
    } finally {
      if (prior !== undefined) process.env.QSTASH_TOKEN = prior;
    }
  });
});

describe("backfillScheduledPublishes — row selection", () => {
  beforeEach(() => {
    process.env.QSTASH_TOKEN = "test-token";
  });

  it("enqueues future-dated, NULL-message rows and stamps message_id", async () => {
    const futureIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const entryId = await seedScheduleEntry({ scheduledAt: futureIso });
    mockClient.publishJSON.mockResolvedValueOnce({ messageId: "msg_abc" });

    const result = await backfillScheduledPublishes({ origin: ORIGIN });
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.status !== "ok") return;
    expect(result.data.examined).toBe(1);
    expect(result.data.enqueued).toBe(1);
    expect(result.data.failed).toBe(0);

    const svc = getServiceRoleClient();
    const row = await svc
      .from("social_schedule_entries")
      .select("qstash_message_id")
      .eq("id", entryId)
      .single();
    expect(row.data?.qstash_message_id).toBe("msg_abc");
  });

  it("skips rows that already have a message_id", async () => {
    const futureIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await seedScheduleEntry({
      scheduledAt: futureIso,
      qstashMessageId: "msg_existing",
    });

    const result = await backfillScheduledPublishes({ origin: ORIGIN });
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.status !== "ok") return;
    expect(result.data.examined).toBe(0);
    expect(mockClient.publishJSON).not.toHaveBeenCalled();
  });

  it("skips cancelled rows", async () => {
    const futureIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await seedScheduleEntry({
      scheduledAt: futureIso,
      cancelledAt: new Date().toISOString(),
    });

    const result = await backfillScheduledPublishes({ origin: ORIGIN });
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.status !== "ok") return;
    expect(result.data.examined).toBe(0);
  });

  it("skips past-dated rows", async () => {
    const pastIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await seedScheduleEntry({ scheduledAt: pastIso });

    const result = await backfillScheduledPublishes({ origin: ORIGIN });
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.status !== "ok") return;
    expect(result.data.examined).toBe(0);
  });

  it("counts per-row enqueue failures without aborting", async () => {
    const futureIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await seedScheduleEntry({ scheduledAt: futureIso });
    await seedScheduleEntry({ scheduledAt: futureIso });

    mockClient.publishJSON
      .mockResolvedValueOnce({ messageId: "msg_ok" })
      .mockRejectedValueOnce(new Error("HTTP 500"));

    const result = await backfillScheduledPublishes({ origin: ORIGIN });
    expect(result.ok).toBe(true);
    if (!result.ok || result.data.status !== "ok") return;
    expect(result.data.examined).toBe(2);
    expect(result.data.enqueued).toBe(1);
    expect(result.data.failed).toBe(1);
  });
});
