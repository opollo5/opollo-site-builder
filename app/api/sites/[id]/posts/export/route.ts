import { NextResponse, type NextRequest } from "next/server";
import { strToU8, zipSync } from "fflate";

import { requireAdminForApi } from "@/lib/admin-api-gate";
import { getServiceRoleClient } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PostRow = {
  id: string;
  title: string;
  slug: string;
  status: string;
  excerpt: string | null;
  generated_html: string | null;
  published_at: string | null;
  wp_post_id: number | null;
  metadata: Record<string, unknown> | null;
  // PostgREST returns a 1-element array for to-one embeds.
  image_library: { delivery_url: string }[] | null;
};

function yamlStr(value: unknown): string {
  if (value === null || value === undefined) return '""';
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const s = String(value);
  if (/[\n:"{}[\],&*?|>!%@`]/.test(s) || s.trim() !== s) {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return s;
}

function buildMarkdown(post: PostRow): string {
  const meta = post.metadata ?? {};
  const categories: unknown[] = Array.isArray(meta.wp_category_ids) ? meta.wp_category_ids : [];
  const newCats: unknown[] = Array.isArray(meta.wp_new_category_names) ? meta.wp_new_category_names : [];
  const tags: unknown[] = Array.isArray(meta.wp_tag_ids) ? meta.wp_tag_ids : [];
  const newTags: unknown[] = Array.isArray(meta.wp_new_tag_names) ? meta.wp_new_tag_names : [];
  const metaTitle =
    typeof meta.meta_title_override === "string" ? meta.meta_title_override : null;

  const lines: string[] = [
    "---",
    `title: ${yamlStr(post.title)}`,
    `slug: ${yamlStr(post.slug)}`,
    `status: ${yamlStr(post.status)}`,
  ];
  if (post.excerpt) lines.push(`excerpt: ${yamlStr(post.excerpt)}`);
  if (metaTitle) lines.push(`meta_title: ${yamlStr(metaTitle)}`);
  if (post.published_at) lines.push(`published_at: ${yamlStr(post.published_at)}`);
  if (post.wp_post_id) lines.push(`wp_post_id: ${post.wp_post_id}`);
  if (categories.length > 0) lines.push(`wp_category_ids: [${categories.join(", ")}]`);
  if (newCats.length > 0) lines.push(`wp_new_category_names: [${newCats.map((c) => yamlStr(c)).join(", ")}]`);
  if (tags.length > 0) lines.push(`wp_tag_ids: [${tags.join(", ")}]`);
  if (newTags.length > 0) lines.push(`wp_new_tag_names: [${newTags.map((t) => yamlStr(t)).join(", ")}]`);
  const imageUrl = Array.isArray(post.image_library) && post.image_library.length > 0
    ? post.image_library[0].delivery_url
    : null;
  if (imageUrl) lines.push(`featured_image_url: ${yamlStr(imageUrl)}`);
  lines.push("---", "");
  if (post.generated_html) {
    lines.push(post.generated_html, "");
  }
  return lines.join("\n");
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const gate = await requireAdminForApi({ roles: ["super_admin", "admin"] });
  if (gate.kind === "deny") return gate.response;

  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ ok: false, error: { code: "VALIDATION_FAILED", message: "Site id must be a UUID." } }, { status: 400 });
  }

  const svc = getServiceRoleClient();

  // Verify site exists and belongs to a readable context.
  const { data: site, error: siteErr } = await svc
    .from("sites")
    .select("id, name")
    .eq("id", params.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (siteErr || !site) {
    return NextResponse.json({ ok: false, error: { code: "NOT_FOUND", message: "Site not found." } }, { status: 404 });
  }

  // Fetch all non-deleted posts — no limit (export is a deliberate bulk op).
  const { data: posts, error: postsErr } = await svc
    .from("posts")
    .select("id, title, slug, status, excerpt, generated_html, published_at, wp_post_id, metadata, image_library(delivery_url)")
    .eq("site_id", params.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (postsErr) {
    return NextResponse.json({ ok: false, error: { code: "INTERNAL", message: "Failed to load posts." } }, { status: 500 });
  }

  const rows = (posts ?? []) as unknown as PostRow[];

  if (rows.length === 0) {
    return NextResponse.json({ ok: false, error: { code: "NOT_FOUND", message: "No posts to export." } }, { status: 404 });
  }

  // Build file map for fflate.
  const files: Record<string, Uint8Array> = {};
  const usedNames = new Set<string>();
  for (const post of rows) {
    let filename = `${post.slug || post.id}.md`;
    // Deduplicate in the (unlikely) event of duplicate slugs.
    if (usedNames.has(filename)) {
      filename = `${post.slug || post.id}-${post.id.slice(0, 8)}.md`;
    }
    usedNames.add(filename);
    files[filename] = strToU8(buildMarkdown(post));
  }

  const zipBytes = zipSync(files, { level: 6 });
  const zipBuffer = Buffer.from(zipBytes);
  const safeName = site.name.replace(/[^a-z0-9]/gi, "-").replace(/-+/g, "-").toLowerCase();
  const filename = `${safeName}-posts.zip`;

  return new NextResponse(zipBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(zipBuffer.byteLength),
    },
  });
}
