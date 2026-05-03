import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import {
  createPostMaster,
  deletePostMaster,
  getPostMaster,
  listPostMasters,
  updatePostMaster,
} from "@/lib/platform/social/posts";
import { getServiceRoleClient } from "@/lib/supabase";

import { seedAuthUser, type SeededAuthUser } from "./_auth-helpers";

// ---------------------------------------------------------------------------
// S1-1: lib-layer tests for social_post_master CRUD.
//
// Same shape as platform-companies.test.ts: persistent auth users, fresh
// platform_* rows per test (truncate + reseed in beforeEach), service-role
// client throughout. Permission checks live at the route layer (canDo
// gate) and are tested separately when S1-2 lands.
// ---------------------------------------------------------------------------

const COMPANY_A_ID = "abcdef00-0000-0000-0000-aaaaaaaaaaaa";
const COMPANY_B_ID = "abcdef00-0000-0000-0000-bbbbbbbbbbbb";

describe("lib/platform/social/posts", () => {
  let creator: SeededAuthUser;

  beforeAll(async () => {
    creator = await seedAuthUser({
      email: "s1-1-creator@opollo.test",
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
          slug: "s1-1-acme",
          domain: "s1-1-acme.test",
          is_opollo_internal: false,
          timezone: "Australia/Melbourne",
        },
        {
          id: COMPANY_B_ID,
          name: "Beta Inc",
          slug: "s1-1-beta",
          domain: "s1-1-beta.test",
          is_opollo_internal: false,
          timezone: "Australia/Melbourne",
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

    const membership = await svc
      .from("platform_company_users")
      .insert({
        company_id: COMPANY_A_ID,
        user_id: creator.id,
        role: "editor",
      })
      .select("id");
    if (membership.error) {
      throw new Error(
        `seed membership: ${membership.error.code ?? "?"} ${membership.error.message}`,
      );
    }
  });

  afterAll(async () => {
    const svc = getServiceRoleClient();
    if (creator) await svc.auth.admin.deleteUser(creator.id);
  });

  describe("createPostMaster", () => {
    it("happy path — text-only post lands in state='draft'", async () => {
      const result = await createPostMaster({
        companyId: COMPANY_A_ID,
        masterText: "Hello world from Acme.",
        createdBy: creator.id,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.company_id).toBe(COMPANY_A_ID);
      expect(result.data.state).toBe("draft");
      expect(result.data.source_type).toBe("manual");
      expect(result.data.master_text).toBe("Hello world from Acme.");
      expect(result.data.link_url).toBeNull();
      expect(result.data.created_by).toBe(creator.id);
    });

    it("happy path — link-only post is allowed", async () => {
      const result = await createPostMaster({
        companyId: COMPANY_A_ID,
        linkUrl: "https://example.com/article",
        createdBy: creator.id,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.master_text).toBeNull();
      expect(result.data.link_url).toBe("https://example.com/article");
    });

    it("trims master_text + treats whitespace-only as null", async () => {
      const trimmed = await createPostMaster({
        companyId: COMPANY_A_ID,
        masterText: "  spaced  ",
        createdBy: creator.id,
      });
      expect(trimmed.ok).toBe(true);
      if (trimmed.ok) expect(trimmed.data.master_text).toBe("spaced");

      const empty = await createPostMaster({
        companyId: COMPANY_A_ID,
        masterText: "   ",
        linkUrl: "https://example.com/",
        createdBy: creator.id,
      });
      expect(empty.ok).toBe(true);
      if (empty.ok) expect(empty.data.master_text).toBeNull();
    });

    it("rejects empty post (no text and no link) with VALIDATION_FAILED", async () => {
      const result = await createPostMaster({
        companyId: COMPANY_A_ID,
        createdBy: creator.id,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION_FAILED");
    });

    it("rejects non-http(s) link_url with VALIDATION_FAILED", async () => {
      const result = await createPostMaster({
        companyId: COMPANY_A_ID,
        linkUrl: "javascript:alert(1)",
        createdBy: creator.id,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION_FAILED");
    });

    it("rejects unknown company_id with NOT_FOUND (FK violation)", async () => {
      const result = await createPostMaster({
        companyId: "00000000-0000-0000-0000-000000000999",
        masterText: "ghost company",
        createdBy: creator.id,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("NOT_FOUND");
    });

    it("rejects master_text exceeding the cap with VALIDATION_FAILED", async () => {
      const result = await createPostMaster({
        companyId: COMPANY_A_ID,
        masterText: "x".repeat(10_001),
        createdBy: creator.id,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("VALIDATION_FAILED");
    });
  });

  describe("listPostMasters", () => {
    it("returns rows for the queried company only", async () => {
      const a1 = await createPostMaster({
        companyId: COMPANY_A_ID,
        masterText: "A-1",
        createdBy: creator.id,
      });
      const a2 = await createPostMaster({
        companyId: COMPANY_A_ID,
        masterText: "A-2",
        createdBy: creator.id,
      });
      // B has no membership for the creator but the lib doesn't enforce
      // permissions — the route layer does. Insert directly to assert
      // scoping by company_id.
      const svc = getServiceRoleClient();
      await svc.from("social_post_master").insert({
        company_id: COMPANY_B_ID,
        master_text: "B-1",
        state: "draft",
        source_type: "manual",
      });
      expect(a1.ok && a2.ok).toBe(true);

      const result = await listPostMasters({ companyId: COMPANY_A_ID });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.posts.length).toBe(2);
      const texts = result.data.posts.map((p) => p.master_text).sort();
      expect(texts).toEqual(["A-1", "A-2"]);
    });

    it("filters by state when supplied", async () => {
      const draft = await createPostMaster({
        companyId: COMPANY_A_ID,
        masterText: "still drafting",
        createdBy: creator.id,
      });
      expect(draft.ok).toBe(true);
      if (!draft.ok) return;

      // Promote one row to 'approved' directly so the filter has
      // something to discriminate. The state-machine API will land
      // in a later slice; for now we exercise the column directly.
      const svc = getServiceRoleClient();
      const promoted = await svc
        .from("social_post_master")
        .insert({
          company_id: COMPANY_A_ID,
          master_text: "approved one",
          state: "approved",
          source_type: "manual",
        })
        .select("id")
        .single();
      expect(promoted.error).toBeNull();

      const drafts = await listPostMasters({
        companyId: COMPANY_A_ID,
        states: ["draft"],
      });
      expect(drafts.ok).toBe(true);
      if (!drafts.ok) return;
      expect(drafts.data.posts.every((p) => p.state === "draft")).toBe(true);
      expect(drafts.data.posts.length).toBe(1);

      const approved = await listPostMasters({
        companyId: COMPANY_A_ID,
        states: ["approved"],
      });
      expect(approved.ok).toBe(true);
      if (!approved.ok) return;
      expect(approved.data.posts.length).toBe(1);
      expect(approved.data.posts[0]?.state).toBe("approved");
    });

    it("returns empty array when company has no posts", async () => {
      const result = await listPostMasters({ companyId: COMPANY_A_ID });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.posts).toEqual([]);
    });

    it("respects limit + offset", async () => {
      for (let i = 0; i < 5; i++) {
        await createPostMaster({
          companyId: COMPANY_A_ID,
          masterText: `post ${i}`,
          createdBy: creator.id,
        });
      }
      const page1 = await listPostMasters({
        companyId: COMPANY_A_ID,
        limit: 2,
        offset: 0,
      });
      const page2 = await listPostMasters({
        companyId: COMPANY_A_ID,
        limit: 2,
        offset: 2,
      });
      expect(page1.ok && page2.ok).toBe(true);
      if (!page1.ok || !page2.ok) return;
      expect(page1.data.posts.length).toBe(2);
      expect(page2.data.posts.length).toBe(2);
      const ids = new Set([
        ...page1.data.posts.map((p) => p.id),
        ...page2.data.posts.map((p) => p.id),
      ]);
      expect(ids.size).toBe(4);
    });

    it("filters by q (case-insensitive ILIKE on master_text)", async () => {
      await createPostMaster({
        companyId: COMPANY_A_ID,
        masterText: "Hello LinkedIn world",
        createdBy: creator.id,
      });
      await createPostMaster({
        companyId: COMPANY_A_ID,
        masterText: "Facebook announcement post",
        createdBy: creator.id,
      });
      await createPostMaster({
        companyId: COMPANY_A_ID,
        masterText: "LINKEDIN exclusive content",
        createdBy: creator.id,
      });

      const result = await listPostMasters({
        companyId: COMPANY_A_ID,
        q: "linkedin",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.posts.length).toBe(2);
      result.data.posts.forEach((p) =>
        expect(p.master_text?.toLowerCase()).toContain("linkedin"),
      );
    });

    it("q with blank / whitespace-only term returns all posts", async () => {
      for (let i = 0; i < 3; i++) {
        await createPostMaster({
          companyId: COMPANY_A_ID,
          masterText: `post ${i}`,
          createdBy: creator.id,
        });
      }
      const result = await listPostMasters({
        companyId: COMPANY_A_ID,
        q: "   ",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.posts.length).toBe(3);
    });

    it("withCount returns accurate totalCount", async () => {
      for (let i = 0; i < 6; i++) {
        await createPostMaster({
          companyId: COMPANY_A_ID,
          masterText: `count post ${i}`,
          createdBy: creator.id,
        });
      }
      const page1 = await listPostMasters({
        companyId: COMPANY_A_ID,
        limit: 4,
        offset: 0,
        withCount: true,
      });
      expect(page1.ok).toBe(true);
      if (!page1.ok) return;
      expect(page1.data.posts.length).toBe(4);
      expect(page1.data.totalCount).toBe(6);
    });

    it("withCount + q counts only matching rows", async () => {
      await createPostMaster({
        companyId: COMPANY_A_ID,
        masterText: "match me please",
        createdBy: creator.id,
      });
      await createPostMaster({
        companyId: COMPANY_A_ID,
        masterText: "ignore this one",
        createdBy: creator.id,
      });
      await createPostMaster({
        companyId: COMPANY_A_ID,
        masterText: "match me also",
        createdBy: creator.id,
      });

      const result = await listPostMasters({
        companyId: COMPANY_A_ID,
        q: "match",
        withCount: true,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.posts.length).toBe(2);
      expect(result.data.totalCount).toBe(2);
    });
  });

  describe("getPostMaster", () => {
    it("returns the row when scoped to the right company", async () => {
      const created = await createPostMaster({
        companyId: COMPANY_A_ID,
        masterText: "fetch me",
        createdBy: creator.id,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = await getPostMaster({
        postId: created.data.id,
        companyId: COMPANY_A_ID,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.id).toBe(created.data.id);
      expect(result.data.master_text).toBe("fetch me");
    });

    it("returns NOT_FOUND for a row in a different company", async () => {
      const created = await createPostMaster({
        companyId: COMPANY_A_ID,
        masterText: "scoped",
        createdBy: creator.id,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = await getPostMaster({
        postId: created.data.id,
        companyId: COMPANY_B_ID,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("NOT_FOUND");
    });

    it("returns NOT_FOUND for a missing post id", async () => {
      const result = await getPostMaster({
        postId: "00000000-0000-0000-0000-000000000aaa",
        companyId: COMPANY_A_ID,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("NOT_FOUND");
    });
  });

  describe("updatePostMaster", () => {
    it("happy path — partial update of master_text on a draft", async () => {
      const created = await createPostMaster({
        companyId: COMPANY_A_ID,
        masterText: "initial",
        createdBy: creator.id,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const updated = await updatePostMaster({
        postId: created.data.id,
        companyId: COMPANY_A_ID,
        masterText: "edited",
      });
      expect(updated.ok).toBe(true);
      if (!updated.ok) return;
      expect(updated.data.master_text).toBe("edited");
      expect(updated.data.link_url).toBeNull();
      expect(updated.data.state).toBe("draft");
    });

    it("partial update leaves untouched fields unchanged", async () => {
      const created = await createPostMaster({
        companyId: COMPANY_A_ID,
        masterText: "keep me",
        linkUrl: "https://example.com/x",
        createdBy: creator.id,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const updated = await updatePostMaster({
        postId: created.data.id,
        companyId: COMPANY_A_ID,
        linkUrl: "https://example.com/y",
      });
      expect(updated.ok).toBe(true);
      if (!updated.ok) return;
      expect(updated.data.master_text).toBe("keep me");
      expect(updated.data.link_url).toBe("https://example.com/y");
    });

    it("rejects edit on non-draft post with INVALID_STATE", async () => {
      const created = await createPostMaster({
        companyId: COMPANY_A_ID,
        masterText: "submitted",
        createdBy: creator.id,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // Promote directly to 'pending_client_approval' (state machine
      // helper lands in a future slice; the test just needs a non-draft).
      const svc = getServiceRoleClient();
      await svc
        .from("social_post_master")
        .update({ state: "pending_client_approval" })
        .eq("id", created.data.id);

      const updated = await updatePostMaster({
        postId: created.data.id,
        companyId: COMPANY_A_ID,
        masterText: "should fail",
      });
      expect(updated.ok).toBe(false);
      if (updated.ok) return;
      expect(updated.error.code).toBe("INVALID_STATE");
    });

    it("rejects update that would clear both master_text and link_url", async () => {
      const created = await createPostMaster({
        companyId: COMPANY_A_ID,
        masterText: "the only field",
        createdBy: creator.id,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const updated = await updatePostMaster({
        postId: created.data.id,
        companyId: COMPANY_A_ID,
        masterText: null,
      });
      expect(updated.ok).toBe(false);
      if (updated.ok) return;
      expect(updated.error.code).toBe("VALIDATION_FAILED");
    });

    it("returns NOT_FOUND when post is in a different company", async () => {
      const created = await createPostMaster({
        companyId: COMPANY_A_ID,
        masterText: "scoped",
        createdBy: creator.id,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const updated = await updatePostMaster({
        postId: created.data.id,
        companyId: COMPANY_B_ID,
        masterText: "edited",
      });
      expect(updated.ok).toBe(false);
      if (updated.ok) return;
      expect(updated.error.code).toBe("NOT_FOUND");
    });

    it("rejects empty patch with VALIDATION_FAILED", async () => {
      const created = await createPostMaster({
        companyId: COMPANY_A_ID,
        masterText: "anything",
        createdBy: creator.id,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const updated = await updatePostMaster({
        postId: created.data.id,
        companyId: COMPANY_A_ID,
      });
      expect(updated.ok).toBe(false);
      if (updated.ok) return;
      expect(updated.error.code).toBe("VALIDATION_FAILED");
    });
  });

  describe("deletePostMaster", () => {
    it("happy path — deletes a draft", async () => {
      const created = await createPostMaster({
        companyId: COMPANY_A_ID,
        masterText: "delete me",
        createdBy: creator.id,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const deleted = await deletePostMaster({
        postId: created.data.id,
        companyId: COMPANY_A_ID,
      });
      expect(deleted.ok).toBe(true);

      const lookup = await getPostMaster({
        postId: created.data.id,
        companyId: COMPANY_A_ID,
      });
      expect(lookup.ok).toBe(false);
      if (lookup.ok) return;
      expect(lookup.error.code).toBe("NOT_FOUND");
    });

    it("rejects delete on non-draft with INVALID_STATE", async () => {
      const created = await createPostMaster({
        companyId: COMPANY_A_ID,
        masterText: "approved-soon",
        createdBy: creator.id,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const svc = getServiceRoleClient();
      await svc
        .from("social_post_master")
        .update({ state: "approved" })
        .eq("id", created.data.id);

      const deleted = await deletePostMaster({
        postId: created.data.id,
        companyId: COMPANY_A_ID,
      });
      expect(deleted.ok).toBe(false);
      if (deleted.ok) return;
      expect(deleted.error.code).toBe("INVALID_STATE");
    });

    it("returns NOT_FOUND across company boundary", async () => {
      const created = await createPostMaster({
        companyId: COMPANY_A_ID,
        masterText: "scoped",
        createdBy: creator.id,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const deleted = await deletePostMaster({
        postId: created.data.id,
        companyId: COMPANY_B_ID,
      });
      expect(deleted.ok).toBe(false);
      if (deleted.ok) return;
      expect(deleted.error.code).toBe("NOT_FOUND");
    });
  });
});
