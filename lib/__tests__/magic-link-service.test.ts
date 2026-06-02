import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getServiceRoleClient } from "@/lib/supabase";
import {
  consume,
  issue,
  regenerate,
  revoke,
  validate,
} from "@/lib/platform/magic-link";
import { regenerateApprovalLink } from "@/lib/platform/magic-link";
import { addRecipient } from "@/lib/platform/social/approvals/recipients/add";
import { resolveRecipientByToken } from "@/lib/platform/social/approvals";

// ---------------------------------------------------------------------------
// Integration tests for the magic-link service (B1).
// Runs against the real local Supabase instance.
// ---------------------------------------------------------------------------

const COMPANY_ID = "00001740-0000-0000-0000-000000000001";

async function seedCompany(id: string) {
  const svc = getServiceRoleClient();
  // Use the last 8 chars for the slug to avoid UNIQUE collisions with other test
  // suites. Fail loudly — silently swallowing the error leaves the FK dangling.
  const { error } = await svc.from("platform_companies").upsert(
    { id, name: "Magic Link Test Co", slug: `ml-test-${id.slice(-8)}` },
    { onConflict: "id" },
  );
  if (error) throw new Error(`seedCompany failed: ${error.message}`);
}

async function seedApprovalRequest(companyId: string) {
  const svc = getServiceRoleClient();
  // Create a minimal post master row for the approval request
  const { data: post } = await svc
    .from("social_post_master")
    .insert({
      company_id: companyId,
      master_text: "Magic link test post",
      state: "pending_client_approval",
    })
    .select("id")
    .single();
  if (!post) throw new Error("Failed to seed post master");

  const { data: req } = await svc
    .from("social_approval_requests")
    .insert({
      company_id: companyId,
      post_master_id: post.id,
      approval_rule: "any_one",
      expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      snapshot_payload: { master_text: "Magic link test post" },
    })
    .select("id")
    .single();
  if (!req) throw new Error("Failed to seed approval request");
  return { requestId: req.id, postId: post.id };
}

beforeAll(async () => {
  await seedCompany(COMPANY_ID);
});

afterAll(async () => {
  const svc = getServiceRoleClient();
  await svc.from("magic_links").delete().eq("company_id", COMPANY_ID);
  await svc.from("social_approval_recipients").delete().eq("email", "reviewer@ml-test.example.com");
  await svc.from("social_approval_requests").delete().eq("company_id", COMPANY_ID);
  await svc.from("social_post_master").delete().eq("company_id", COMPANY_ID);
  await svc.from("platform_companies").delete().eq("id", COMPANY_ID);
});

// ---------------------------------------------------------------------------
// Core service
// ---------------------------------------------------------------------------

describe("issue", () => {
  it("returns a 64-char hex raw token and stores only the hash", async () => {
    const { rawToken, link } = await issue({
      purpose: "approval",
      companyId: COMPANY_ID,
      email: "reviewer@ml-test.example.com",
    });
    expect(rawToken).toMatch(/^[0-9a-f]{64}$/i);
    expect(link.token_hash).toHaveLength(64);
    expect(link.token_hash).not.toBe(rawToken);
    expect(link.consumed_at).toBeNull();
    expect(link.revoked_at).toBeNull();
    expect(link.session_expires_at).toBeNull();
  });

  it("respects custom ttlMs", async () => {
    const before = Date.now();
    const { link } = await issue({
      purpose: "login",
      ttlMs: 60_000, // 1 minute
      email: "short-ttl@ml-test.example.com",
    });
    const expiresAt = new Date(link.expires_at).getTime();
    expect(expiresAt).toBeGreaterThan(before + 55_000);
    expect(expiresAt).toBeLessThan(before + 65_000);
  });
});

describe("validate", () => {
  it("returns valid for a fresh unused link", async () => {
    const { rawToken } = await issue({
      purpose: "approval",
      companyId: COMPANY_ID,
      email: "v@ml-test.example.com",
    });
    const r = await validate(rawToken);
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.sessionActive).toBe(false);
  });

  it("returns not_found for an unknown token", async () => {
    const r = await validate("a".repeat(64));
    expect(r).toMatchObject({ valid: false, reason: "not_found" });
  });

  it("returns revoked for a revoked link", async () => {
    const { rawToken, link } = await issue({
      purpose: "approval",
      companyId: COMPANY_ID,
      email: "revoke-validate@ml-test.example.com",
    });
    await revoke({ linkId: link.id });
    const r = await validate(rawToken);
    expect(r).toMatchObject({ valid: false, reason: "revoked" });
  });

  it("returns expired for a link past expires_at", async () => {
    const { rawToken, link } = await issue({
      purpose: "approval",
      ttlMs: -1000, // immediately expired
      companyId: COMPANY_ID,
      email: "expired@ml-test.example.com",
    });
    // Force the expires_at to be in the past
    const svc = getServiceRoleClient();
    await svc
      .from("magic_links")
      .update({ expires_at: new Date(Date.now() - 5000).toISOString() })
      .eq("id", link.id);
    const r = await validate(rawToken);
    expect(r).toMatchObject({ valid: false, reason: "expired" });
  });
});

describe("consume", () => {
  it("first click sets consumed_at and session_expires_at", async () => {
    const { rawToken, link: issued } = await issue({
      purpose: "approval",
      companyId: COMPANY_ID,
      email: "consume1@ml-test.example.com",
    });
    const before = Date.now();
    const r = await consume(rawToken);
    expect(r.valid).toBe(true);
    if (!r.valid) return;
    expect(r.isNewConsumption).toBe(true);
    expect(r.link.consumed_at).not.toBeNull();
    expect(r.link.session_expires_at).not.toBeNull();
    const sessionExpiry = new Date(r.link.session_expires_at!).getTime();
    // session should be ~23h from now
    expect(sessionExpiry).toBeGreaterThan(before + 22 * 60 * 60 * 1000);
    expect(sessionExpiry).toBeLessThan(before + 24 * 60 * 60 * 1000);
  });

  it("second consume within session returns isNewConsumption=false", async () => {
    const { rawToken } = await issue({
      purpose: "approval",
      companyId: COMPANY_ID,
      email: "consume2@ml-test.example.com",
    });
    await consume(rawToken);
    const r = await consume(rawToken);
    expect(r.valid).toBe(true);
    if (r.valid) expect(r.isNewConsumption).toBe(false);
  });

  it("returns session_expired after session_expires_at has passed", async () => {
    const { rawToken, link } = await issue({
      purpose: "approval",
      companyId: COMPANY_ID,
      email: "session-expired@ml-test.example.com",
    });
    // Consume + immediately expire the session
    await consume(rawToken);
    const svc = getServiceRoleClient();
    await svc
      .from("magic_links")
      .update({ session_expires_at: new Date(Date.now() - 5000).toISOString() })
      .eq("id", link.id);
    const r = await consume(rawToken);
    expect(r).toMatchObject({ valid: false, reason: "session_expired" });
  });

  it("login purpose: consumed_at set but session_expires_at is null", async () => {
    const { rawToken } = await issue({
      purpose: "login",
      email: "login-consume@ml-test.example.com",
    });
    const r = await consume(rawToken);
    expect(r.valid).toBe(true);
    if (!r.valid) return;
    expect(r.link.consumed_at).not.toBeNull();
    expect(r.link.session_expires_at).toBeNull();
  });
});

describe("revoke", () => {
  it("revoke by linkId marks revoked_at", async () => {
    const { rawToken, link } = await issue({
      purpose: "approval",
      companyId: COMPANY_ID,
      email: "revoke-by-id@ml-test.example.com",
    });
    const { ok, count } = await revoke({ linkId: link.id });
    expect(ok).toBe(true);
    expect(count).toBe(1);
    const r = await validate(rawToken);
    expect(r).toMatchObject({ valid: false, reason: "revoked" });
  });

  it("revoke by subject revokes all active links for that subject", async () => {
    const subjectId = "00001740-0000-0000-0000-000000000099";
    const { rawToken: t1 } = await issue({
      purpose: "approval",
      subjectType: "approval_recipient",
      subjectId,
      companyId: COMPANY_ID,
      email: "revoke-subj-a@ml-test.example.com",
    });
    const { rawToken: t2 } = await issue({
      purpose: "approval",
      subjectType: "approval_recipient",
      subjectId,
      companyId: COMPANY_ID,
      email: "revoke-subj-b@ml-test.example.com",
    });
    const { count } = await revoke({ subjectType: "approval_recipient", subjectId });
    expect(count).toBe(2);
    expect((await validate(t1)).valid).toBe(false);
    expect((await validate(t2)).valid).toBe(false);
  });

  it("is idempotent — revoking an already-revoked link returns count=0", async () => {
    const { link } = await issue({
      purpose: "approval",
      companyId: COMPANY_ID,
      email: "idempotent-revoke@ml-test.example.com",
    });
    await revoke({ linkId: link.id });
    const { ok, count } = await revoke({ linkId: link.id });
    expect(ok).toBe(true);
    expect(count).toBe(0);
  });
});

describe("regenerate", () => {
  it("revokes old link and issues a new one with regenerated_from set", async () => {
    const { rawToken: old, link: oldLink } = await issue({
      purpose: "approval",
      companyId: COMPANY_ID,
      email: "regen@ml-test.example.com",
    });
    const { rawToken: fresh, link: freshLink } = await regenerate(oldLink.id);

    expect(fresh).not.toBe(old);
    expect(freshLink.regenerated_from).toBe(oldLink.id);
    // Old token is revoked
    expect((await validate(old)).valid).toBe(false);
    // New token is valid
    expect((await validate(fresh)).valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Approval consumer wiring
// ---------------------------------------------------------------------------

describe("addRecipient (B1 upgrade)", () => {
  it("creates a magic_links row, sets magic_link_id FK, and dual-writes token_hash", async () => {
    const { requestId } = await seedApprovalRequest(COMPANY_ID);
    const svc = getServiceRoleClient();

    const result = await addRecipient({
      approvalRequestId: requestId,
      companyId: COMPANY_ID,
      email: "wired-reviewer@ml-test.example.com",
      name: "Test Reviewer",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { recipient, rawToken } = result.data;

    // Recipient has magic_link_id set
    const { data: recipientRow } = await svc
      .from("social_approval_recipients")
      .select("magic_link_id, token_hash")
      .eq("id", recipient.id)
      .single();
    expect(recipientRow?.magic_link_id).not.toBeNull();

    // magic_links row exists
    const { data: ml } = await svc
      .from("magic_links")
      .select("id, token_hash, subject_id")
      .eq("id", recipientRow!.magic_link_id!)
      .single();
    expect(ml).not.toBeNull();
    expect(ml?.subject_id).toBe(recipient.id);

    // Dual write: token_hash on recipient matches magic_links row
    expect(recipientRow?.token_hash).toBe(ml?.token_hash);

    // Raw token validates
    expect((await validate(rawToken)).valid).toBe(true);
  });
});

describe("resolveRecipientByToken (service-aware lookup)", () => {
  it("resolves a new-style token via magic_links (consumes on first access)", async () => {
    const { requestId } = await seedApprovalRequest(COMPANY_ID);
    const addResult = await addRecipient({
      approvalRequestId: requestId,
      companyId: COMPANY_ID,
      email: "resolve-new@ml-test.example.com",
      name: "Resolve Test",
    });
    expect(addResult.ok).toBe(true);
    if (!addResult.ok) return;

    const resolved = await resolveRecipientByToken(addResult.data.rawToken);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.data.recipient.email).toBe("resolve-new@ml-test.example.com");

    // Second resolve within session should also succeed
    const resolved2 = await resolveRecipientByToken(addResult.data.rawToken);
    expect(resolved2.ok).toBe(true);
  });

  it("resolves a legacy token (no magic_links row) via fallback", async () => {
    // Insert a recipient directly with a raw token hash but NO magic_link_id
    const svc = getServiceRoleClient();
    const { requestId } = await seedApprovalRequest(COMPANY_ID);
    const { generateRawToken, hashToken } = await import("@/lib/platform/invitations");
    const legacyRaw = generateRawToken();
    const legacyHash = hashToken(legacyRaw);

    await svc.from("social_approval_recipients").insert({
      approval_request_id: requestId,
      email: "legacy@ml-test.example.com",
      token_hash: legacyHash,
      // magic_link_id intentionally null (legacy row)
    });

    const resolved = await resolveRecipientByToken(legacyRaw);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.data.recipient.email).toBe("legacy@ml-test.example.com");
  });
});

describe("back-compat HARD RULE: magic_links row present → verdict is final", () => {
  it("an expired magic_links row is NOT resolvable even if token_hash still on recipient", async () => {
    const { requestId } = await seedApprovalRequest(COMPANY_ID);
    const addResult = await addRecipient({
      approvalRequestId: requestId,
      companyId: COMPANY_ID,
      email: "expired-ml@ml-test.example.com",
    });
    expect(addResult.ok).toBe(true);
    if (!addResult.ok) return;

    // Expire the magic link
    const svc = getServiceRoleClient();
    const { data: rec } = await svc
      .from("social_approval_recipients")
      .select("magic_link_id")
      .eq("email", "expired-ml@ml-test.example.com")
      .single();
    await svc
      .from("magic_links")
      .update({ expires_at: new Date(Date.now() - 5000).toISOString() })
      .eq("id", rec!.magic_link_id!);

    // Must NOT fall through to the legacy 14-day token_hash lookup
    const resolved = await resolveRecipientByToken(addResult.data.rawToken);
    expect(resolved.ok).toBe(false);
    // The token_hash is still on social_approval_recipients but the verdict is expired
    if (!resolved.ok) {
      expect(resolved.error.code).not.toBe(undefined);
    }
  });
});
