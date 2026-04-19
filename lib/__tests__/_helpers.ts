import { getServiceRoleClient } from "@/lib/supabase";

// Test-only factories. Inserts happen via service-role supabase-js so they go
// through the exact PostgREST code path the lib code uses.

export async function seedSite(overrides?: {
  name?: string;
  wp_url?: string;
  prefix?: string;
}): Promise<{ id: string; prefix: string }> {
  const supabase = getServiceRoleClient();
  const prefix = overrides?.prefix ?? randomPrefix();
  const { data, error } = await supabase
    .from("sites")
    .insert({
      name: overrides?.name ?? `Test Site ${prefix}`,
      wp_url: overrides?.wp_url ?? `https://${prefix}.test`,
      prefix,
      status: "active",
    })
    .select("id,prefix")
    .single();
  if (error || !data) {
    throw new Error(`seedSite failed: ${error?.message ?? "no data"}`);
  }
  return { id: data.id as string, prefix: data.prefix as string };
}

export function randomPrefix(): string {
  // 2–4 lowercase alphanumerics — matches the CHECK constraint on sites.prefix.
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 4; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export function minimalComponentContentSchema() {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    required: ["headline"],
    properties: {
      headline: { type: "string", maxLength: 120 },
    },
  };
}

export function minimalComposition() {
  return [
    { component: "hero-centered", content_source: "brief.hero" },
    { component: "footer-default", content_source: "site_context.footer" },
  ];
}
