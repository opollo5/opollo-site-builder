import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { hashToken } from "@/lib/platform/invitations";
import {
  createViewerLink,
  listViewerLinks,
  resolveViewerLink,
  revokeViewerLink,
} from "@/lib/platform/social/viewer-links";
import { getServiceRoleClient } from "@/lib/supabase";

import { seedAuthUser, type SeededAuthUser } from "./_auth-helpers";

// ---------------------------------------------------------------------------
// S1-15 — viewer-links lib (create / list / resolve / revoke).
// ---------------------------------------------------------------------------

const COMPANY_A_ID = "abcdef00-0000-0000-0000-aaaaaaaa4444";
const COMPANY_B_ID = "abcdef00-0000-0000-0000-bbbbbbbb4444";

describe("lib/platform/social/viewer-links", () => {
  let creator: SeededAuthUser;

  beforeAll(async () => {
    creator = await seedAuthUser({
      email: "s1-15-creator@opollo.test",
      persistent: true,
    });
  });

  beforeEach(async () => {
    const svc = getServiceRoleClient();

    const companies = await svc
      .from("platform_companies")
      .insert([
        {
          id: COMPANY_A_ID,
          name: "Acme Co",
          slug: "s1-15-acme",
          domain: "s1-15-acme.test",
          is_opollo_internal: false,
          timezone: "Australia/Melbourne",
          approval_default_rule: "any_one",
        },
        {
          id: COMPANY_B_ID,
          name: "Beta Inc",
          slug: "s1-15-beta",
          domain: "s1-15-beta.test",
          is_opollo_internal: false,
          timezone: "Australia/Melbourne",
          approval_default_rule: "any_one",
        },
      ])
      .select("id");
    if (companies.error) {
      throw new Error(
        `seed companies: ${companies.error.code ?? "?"} ${companies.error.message}`,
      );
    }

    const user = await svc
      .from("platform_users")
      .insert({
        id: creator.id,
        email: creator.email,
        full_name: "Creator",
        is_opollo_staff: false,
      })
      .select("id");
    if (user.error) {
      throw new Error(
        `seed creator: ${user.error.code ?? "?"} ${user.error.message}`,
      );
    }
  });

  afterAll(async () => {
    const svc = getServiceRoleClient();
    if (creator) await svc.auth.admin.deleteUser(creator.id);
  });

  describe("createViewerLink", () => {
    it("happy path — returns row + raw token; only the hash hits disk", async () => {
      const result = await createViewerLink({
        companyId: COMPANY_A_ID,
        recipientEmail: "Client@External.Test",
        recipientName: "Client Co",
        createdBy: creator.id,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.rawToken).toMatch(/^[0-9a-f]{64}$/);
      expect(result.data.link.recipient_email).toBe("client@external.test");
      expect(result.data.link.recipient_name).toBe("Client Co");
      expect(result.data.link.created_by).toBe(creator.id);

      const svc = getServiceRoleClient();
      const row = await svc
        .from("social_viewer_links")
        .select("token_hash")
        .eq("id", result.data.link.id)
        .single();
      expect(row.error).toBeNull();
      expect(row.data?.token_hash).toBe(hashToken(result.data.rawToken));
      expect(row.data?.token_hash).not.toBe(result.data.rawToken);
    });

    it("rejects past expires_at", async () => {
      const result = await createViewerLink({
        companyId: COMPANY_A_ID,
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        createdBy: creator.id,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION_FAILED");
    });

    it("normalises email + treats whitespace-only name as null", async () => {
      const result = await createViewerLink({
        companyId: COMPANY_A_ID,
        recipientEmail: "  MIXED@example.test  ",
        recipientName: "   ",
        createdBy: creator.id,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.link.recipient_email).toBe("mixed@example.test");
      expect(result.data.link.recipient_name).toBeNull();
    });
  });

  describe("listViewerLinks", () => {
    it("returns active links by default; includeInactive surfaces revoked + expired", async () => {
      const svc = getServiceRoleClient();

      // Active.
      const active = await createViewerLink({
        companyId: COMPANY_A_ID,
        recipientEmail: "active@external.test",
        createdBy: creator.id,
      });
      expect(active.ok).toBe(true);
      if (!active.ok) return;

      // Revoked.
      const revoked = await createViewerLink({
        companyId: COMPANY_A_ID,
        recipientEmail: "revoked@external.test",
        createdBy: creator.id,
      });
      expect(revoked.ok).toBe(true);
      if (!revoked.ok) return;
      await svc
        .from("social_viewer_links")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", revoked.data.link.id);

      // Expired.
      await svc.from("social_viewer_links").insert({
        company_id: COMPANY_A_ID,
        token_hash: "0".repeat(64),
        expires_at: new Date(Date.now() - 1000).toISOString(),
        created_by: creator.id,
      });

      const activeOnly = await listViewerLinks({ companyId: COMPANY_A_ID });
      expect(activeOnly.ok).toBe(true);
      if (!activeOnly.ok) return;
      expect(activeOnly.data.links.length).toBe(1);
      expect(activeOnly.data.links[0]?.recipient_email).toBe(
        "active@external.test",
      );

      const all = await listViewerLinks({
        companyId: COMPANY_A_ID,
        includeInactive: true,
      });
      expect(all.ok).toBe(true);
      if (!all.ok) return;
      expect(all.data.links.length).toBe(3);
    });

    it("isolates company A from company B", async () => {
      await createViewerLink({
        companyId: COMPANY_A_ID,
        recipientEmail: "a@external.test",
        createdBy: creator.id,
      });
      await createViewerLink({
        companyId: COMPANY_B_ID,
        recipientEmail: "b@external.test",
        createdBy: creator.id,
      });

      const aResult = await listViewerLinks({ companyId: COMPANY_A_ID });
      const bResult = await listViewerLinks({ companyId: COMPANY_B_ID });
      expect(aResult.ok && bResult.ok).toBe(true);
      if (!aResult.ok || !bResult.ok) return;
      expect(aResult.data.links.length).toBe(1);
      expect(bResult.data.links.length).toBe(1);
      expect(aResult.data.links[0]?.recipient_email).toBe("a@external.test");
      expect(bResult.data.links[0]?.recipient_email).toBe("b@external.test");
    });
  });

  describe("resolveViewerLink", () => {
    it("happy path — returns link + company on a valid token", async () => {
      const created = await createViewerLink({
        companyId: COMPANY_A_ID,
        recipientEmail: "viewer@external.test",
        createdBy: creator.id,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const resolved = await resolveViewerLink(created.data.rawToken);
      expect(resolved.ok).toBe(true);
      if (!resolved.ok) return;
      expect(resolved.data.company.name).toBe("Acme Co");
      expect(resolved.data.link.id).toBe(created.data.link.id);
    });

    it("returns NOT_FOUND for a malformed token", async () => {
      const resolved = await resolveViewerLink("not-a-token");
      expect(resolved.ok).toBe(false);
      if (resolved.ok) return;
      expect(resolved.error.code).toBe("NOT_FOUND");
    });

    it("returns NOT_FOUND for a phantom token", async () => {
      const resolved = await resolveViewerLink("0".repeat(64));
      expect(resolved.ok).toBe(false);
      if (resolved.ok) return;
      expect(resolved.error.code).toBe("NOT_FOUND");
    });

    it("returns NOT_FOUND when revoked", async () => {
      const created = await createViewerLink({
        companyId: COMPANY_A_ID,
        createdBy: creator.id,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const svc = getServiceRoleClient();
      await svc
        .from("social_viewer_links")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", created.data.link.id);

      const resolved = await resolveViewerLink(created.data.rawToken);
      expect(resolved.ok).toBe(false);
      if (resolved.ok) return;
      expect(resolved.error.code).toBe("NOT_FOUND");
    });

    it("returns NOT_FOUND when expired", async () => {
      const svc = getServiceRoleClient();
      const created = await createViewerLink({
        companyId: COMPANY_A_ID,
        createdBy: creator.id,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // Stamp expiry into the past after the fact.
      await svc
        .from("social_viewer_links")
        .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
        .eq("id", created.data.link.id);

      const resolved = await resolveViewerLink(created.data.rawToken);
      expect(resolved.ok).toBe(false);
      if (resolved.ok) return;
      expect(resolved.error.code).toBe("NOT_FOUND");
    });
  });

  describe("revokeViewerLink", () => {
    it("happy path — sets revoked_at; second revoke returns INVALID_STATE", async () => {
      const created = await createViewerLink({
        companyId: COMPANY_A_ID,
        createdBy: creator.id,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const first = await revokeViewerLink({
        linkId: created.data.link.id,
        companyId: COMPANY_A_ID,
      });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      expect(first.data.revoked_at).not.toBeNull();

      const second = await revokeViewerLink({
        linkId: created.data.link.id,
        companyId: COMPANY_A_ID,
      });
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.error.code).toBe("INVALID_STATE");
    });

    it("returns NOT_FOUND for cross-company access", async () => {
      const created = await createViewerLink({
        companyId: COMPANY_A_ID,
        createdBy: creator.id,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = await revokeViewerLink({
        linkId: created.data.link.id,
        companyId: COMPANY_B_ID,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("NOT_FOUND");
    });
  });
});
