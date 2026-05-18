"use client";

import useSWR from "swr";
import type { CalendarPost } from "@/lib/social/types";

interface CalendarViewData {
  posts: CalendarPost[];
  range: { from: string; to: string };
}

interface CalendarViewResponse {
  ok: boolean;
  data: CalendarViewData;
}

async function fetchCalendarView(url: string): Promise<CalendarViewData> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`calendar-view fetch failed: ${res.status}`);
  const json = (await res.json()) as CalendarViewResponse;
  return json.data;
}

function buildUrl(companyId: string, from: string, to: string, profileIds: string[]): string {
  const params = new URLSearchParams({ company_id: companyId, from, to });
  if (profileIds.length > 0) params.set("profile_ids", profileIds.join(","));
  return `/api/platform/social/drafts/calendar-view?${params.toString()}`;
}

export function useCalendarView(
  companyId: string,
  from: string,
  to: string,
  profileIds: string[] = [],
) {
  const url = companyId ? buildUrl(companyId, from, to, profileIds) : null;
  const { data, error, isLoading, mutate } = useSWR<CalendarViewData>(url, fetchCalendarView, {
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
  });

  return {
    posts: data?.posts ?? [],
    isLoading,
    isError: !!error,
    mutate,
  };
}
