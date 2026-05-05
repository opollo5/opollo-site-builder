import { describe, expect, it } from "vitest";
import {
  createPageJsonSchema,
  deletePageJsonSchema,
  getPageJsonSchema,
  listPagesJsonSchema,
  publishPageJsonSchema,
  searchImagesJsonSchema,
  updatePageJsonSchema,
  TEMPLATE_TYPES,
  PAGE_STATUSES,
  CHANGE_SCOPES,
} from "@/lib/tool-schemas";

// ---------------------------------------------------------------------------
// Parametric structural tests for every tool JSON schema (M15-6 #13).
//
// Each schema is the authoritative contract for what the Claude tool-use
// API sends to our route handlers. These tests verify:
//   1. The Anthropic tool-use envelope shape (name, description, input_schema)
//   2. Required fields match the documented contract
//   3. Property definitions have the expected type/enum/constraint values
//   4. Constants exported from the module stay in sync with the JSON schemas
// ---------------------------------------------------------------------------

describe("createPageJsonSchema", () => {
  it("has the correct name and input_schema.type", () => {
    expect(createPageJsonSchema.name).toBe("create_page");
    expect(createPageJsonSchema.input_schema.type).toBe("object");
  });

  it("has a non-empty description", () => {
    expect(createPageJsonSchema.description.length).toBeGreaterThan(10);
  });

  it("lists required fields correctly", () => {
    expect(createPageJsonSchema.input_schema.required).toEqual(
      expect.arrayContaining([
        "title",
        "slug",
        "content",
        "meta_description",
        "template_type",
        "ds_version",
      ]),
    );
    expect(createPageJsonSchema.input_schema.required).toHaveLength(6);
  });

  it("has all expected properties", () => {
    const props = createPageJsonSchema.input_schema.properties;
    expect(props).toHaveProperty("title");
    expect(props).toHaveProperty("slug");
    expect(props).toHaveProperty("content");
    expect(props).toHaveProperty("meta_description");
    expect(props).toHaveProperty("parent_slug");
    expect(props).toHaveProperty("template_type");
    expect(props).toHaveProperty("ds_version");
  });

  it("template_type enum matches TEMPLATE_TYPES constant", () => {
    const enumValues = (createPageJsonSchema.input_schema.properties.template_type as { enum: string[] }).enum;
    expect(enumValues).toEqual([...TEMPLATE_TYPES]);
  });

  it("content has minLength 200 matching Zod schema", () => {
    const content = createPageJsonSchema.input_schema.properties.content as { minLength: number };
    expect(content.minLength).toBe(200);
  });
});

describe("listPagesJsonSchema", () => {
  it("has the correct name and input_schema.type", () => {
    expect(listPagesJsonSchema.name).toBe("list_pages");
    expect(listPagesJsonSchema.input_schema.type).toBe("object");
  });

  it("has a non-empty description", () => {
    expect(listPagesJsonSchema.description.length).toBeGreaterThan(10);
  });

  it("has no required fields (all optional)", () => {
    expect(listPagesJsonSchema.input_schema.required).toEqual([]);
  });

  it("has all expected properties", () => {
    const props = listPagesJsonSchema.input_schema.properties;
    expect(props).toHaveProperty("status");
    expect(props).toHaveProperty("parent_slug");
    expect(props).toHaveProperty("search");
  });

  it("status enum matches PAGE_STATUSES constant", () => {
    const enumValues = (listPagesJsonSchema.input_schema.properties.status as { enum: string[] }).enum;
    expect(enumValues).toEqual([...PAGE_STATUSES]);
  });

  it("search has maxLength 200 matching Zod schema", () => {
    const search = listPagesJsonSchema.input_schema.properties.search as { maxLength: number };
    expect(search.maxLength).toBe(200);
  });
});

describe("getPageJsonSchema", () => {
  it("has the correct name and input_schema.type", () => {
    expect(getPageJsonSchema.name).toBe("get_page");
    expect(getPageJsonSchema.input_schema.type).toBe("object");
  });

  it("has a non-empty description", () => {
    expect(getPageJsonSchema.description.length).toBeGreaterThan(10);
  });

  it("requires page_id", () => {
    expect(getPageJsonSchema.input_schema.required).toEqual(["page_id"]);
  });

  it("page_id is integer with minimum 1", () => {
    const pageId = getPageJsonSchema.input_schema.properties.page_id as { type: string; minimum: number };
    expect(pageId.type).toBe("integer");
    expect(pageId.minimum).toBe(1);
  });
});

describe("updatePageJsonSchema", () => {
  it("has the correct name and input_schema.type", () => {
    expect(updatePageJsonSchema.name).toBe("update_page");
    expect(updatePageJsonSchema.input_schema.type).toBe("object");
  });

  it("has a non-empty description", () => {
    expect(updatePageJsonSchema.description.length).toBeGreaterThan(10);
  });

  it("requires page_id and change_scope", () => {
    expect(updatePageJsonSchema.input_schema.required).toEqual(
      expect.arrayContaining(["page_id", "change_scope"]),
    );
    expect(updatePageJsonSchema.input_schema.required).toHaveLength(2);
  });

  it("has all expected properties", () => {
    const props = updatePageJsonSchema.input_schema.properties;
    expect(props).toHaveProperty("page_id");
    expect(props).toHaveProperty("title");
    expect(props).toHaveProperty("content");
    expect(props).toHaveProperty("meta_description");
    expect(props).toHaveProperty("change_scope");
    expect(props).toHaveProperty("user_confirmed");
  });

  it("change_scope enum matches CHANGE_SCOPES constant", () => {
    const enumValues = (updatePageJsonSchema.input_schema.properties.change_scope as { enum: string[] }).enum;
    expect(enumValues).toEqual([...CHANGE_SCOPES]);
  });

  it("page_id is integer with minimum 1", () => {
    const pageId = updatePageJsonSchema.input_schema.properties.page_id as { type: string; minimum: number };
    expect(pageId.type).toBe("integer");
    expect(pageId.minimum).toBe(1);
  });
});

describe("publishPageJsonSchema", () => {
  it("has the correct name and input_schema.type", () => {
    expect(publishPageJsonSchema.name).toBe("publish_page");
    expect(publishPageJsonSchema.input_schema.type).toBe("object");
  });

  it("has a non-empty description", () => {
    expect(publishPageJsonSchema.description.length).toBeGreaterThan(10);
  });

  it("requires page_id", () => {
    expect(publishPageJsonSchema.input_schema.required).toEqual(["page_id"]);
  });

  it("page_id is integer with minimum 1", () => {
    const pageId = publishPageJsonSchema.input_schema.properties.page_id as { type: string; minimum: number };
    expect(pageId.type).toBe("integer");
    expect(pageId.minimum).toBe(1);
  });
});

describe("deletePageJsonSchema", () => {
  it("has the correct name and input_schema.type", () => {
    expect(deletePageJsonSchema.name).toBe("delete_page");
    expect(deletePageJsonSchema.input_schema.type).toBe("object");
  });

  it("has a non-empty description", () => {
    expect(deletePageJsonSchema.description.length).toBeGreaterThan(10);
  });

  it("requires page_id and user_confirmed", () => {
    expect(deletePageJsonSchema.input_schema.required).toEqual(
      expect.arrayContaining(["page_id", "user_confirmed"]),
    );
    expect(deletePageJsonSchema.input_schema.required).toHaveLength(2);
  });

  it("page_id is integer with minimum 1", () => {
    const pageId = deletePageJsonSchema.input_schema.properties.page_id as { type: string; minimum: number };
    expect(pageId.type).toBe("integer");
    expect(pageId.minimum).toBe(1);
  });

  it("user_confirmed has const: true — requires explicit confirmation", () => {
    const userConfirmed = deletePageJsonSchema.input_schema.properties.user_confirmed as { const: boolean };
    expect(userConfirmed.const).toBe(true);
  });
});

describe("searchImagesJsonSchema", () => {
  it("has the correct name and input_schema.type", () => {
    expect(searchImagesJsonSchema.name).toBe("search_images");
    expect(searchImagesJsonSchema.input_schema.type).toBe("object");
  });

  it("has a non-empty description", () => {
    expect(searchImagesJsonSchema.description.length).toBeGreaterThan(10);
  });

  it("has no required fields (all optional)", () => {
    expect(searchImagesJsonSchema.input_schema.required).toEqual([]);
  });

  it("has all expected properties", () => {
    const props = searchImagesJsonSchema.input_schema.properties;
    expect(props).toHaveProperty("query");
    expect(props).toHaveProperty("tags");
    expect(props).toHaveProperty("limit");
  });

  it("limit has minimum 1 and maximum matching SEARCH_IMAGES_MAX_LIMIT", async () => {
    const { SEARCH_IMAGES_MAX_LIMIT } = await import("@/lib/tool-schemas");
    const limit = searchImagesJsonSchema.input_schema.properties.limit as { minimum: number; maximum: number };
    expect(limit.minimum).toBe(1);
    expect(limit.maximum).toBe(SEARCH_IMAGES_MAX_LIMIT);
  });
});

describe("schema name uniqueness", () => {
  it("all 7 schemas have distinct names", () => {
    const schemas = [
      createPageJsonSchema,
      listPagesJsonSchema,
      getPageJsonSchema,
      updatePageJsonSchema,
      publishPageJsonSchema,
      deletePageJsonSchema,
      searchImagesJsonSchema,
    ];
    const names = schemas.map((s) => s.name);
    expect(new Set(names).size).toBe(schemas.length);
  });
});
