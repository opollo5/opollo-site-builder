import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Read-only helper for the side-by-side import review surface.
//
// Given a brief_id, returns the import-mode brief_page (source HTML +
// import_source_url) plus the brief metadata + the most recent
// brief_run state. Side-by-side review uses this to render the cached
// snapshot, the live URL, and the brief-run progress link.
// ---------------------------------------------------------------------------

export interface ImportReviewData {
  brief: {
    id: string;
    site_id: string;
    title: string;
    status: string;
    created_at: string;
  };
  brief_page: {
    id: string;
    title: string;
    source_text: string;
    word_count: number;
    import_source_url: string | null;
  };
  brief_run: {
    id: string;
    status: string;
    created_at: string;
    started_at: string | null;
    completed_at: string | null;
  } | null;
}

export async function getImportDetails(
  briefId: string,
): Promise<ImportReviewData | null> {
  const supabase = getServiceRoleClient();
  const { data: brief } = await supabase
    .from("briefs")
    .select("id, site_id, title, status, created_at")
    .eq("id", briefId)
    .maybeSingle();
  if (!brief) return null;

  const { data: page } = await supabase
    .from("brief_pages")
    .select("id, title, source_text, word_count, import_source_url, mode")
    .eq("brief_id", briefId)
    .eq("mode", "import")
    .order("ordinal", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!page) return null;

  const { data: run } = await supabase
    .from("brief_runs")
    .select("id, status, created_at, started_at, completed_at")
    .eq("brief_id", briefId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    brief: {
      id: brief.id as string,
      site_id: brief.site_id as string,
      title: brief.title as string,
      status: brief.status as string,
      created_at: brief.created_at as string,
    },
    brief_page: {
      id: page.id as string,
      title: page.title as string,
      source_text: page.source_text as string,
      word_count: page.word_count as number,
      import_source_url: (page.import_source_url as string | null) ?? null,
    },
    brief_run: run
      ? {
          id: run.id as string,
          status: run.status as string,
          created_at: run.created_at as string,
          started_at: (run.started_at as string | null) ?? null,
          completed_at: (run.completed_at as string | null) ?? null,
        }
      : null,
  };
}
