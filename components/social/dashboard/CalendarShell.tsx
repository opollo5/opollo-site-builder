"use client";

import * as React from "react";
import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import { CalendarCell } from "./CalendarCell";
import { DayDetail } from "./DayDetail";
import { MonthCalendar } from "@/components/social/calendar/MonthCalendar";
import { PostChip } from "./PostChip";
import { FilterBar } from "./FilterBar";
import { useCalendarView } from "@/hooks/use-calendar-view";
import { Callout } from "@/components/ui/callout";
import { ComposerOverlay } from "@/components/social/composer/ComposerOverlay";
import { BulkScheduleModal } from "./BulkScheduleModal";
import { PostAnalyticsModal } from "./PostAnalyticsModal";
import { useComposerState } from "@/hooks/use-composer-state";
import type { CalendarPost, Connection } from "@/lib/social/types";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function postsForDate(posts: CalendarPost[], date: Date): CalendarPost[] {
  const key = isoDate(date);
  return posts.filter((p) => {
    const at = p.scheduled_at ?? p.published_at;
    return at ? at.slice(0, 10) === key : false;
  });
}

interface CalendarShellProps {
  companyId: string;
  hasConnections: boolean;
  availableConnections: Connection[];
}

export function CalendarShell({ companyId, hasConnections, availableConnections }: CalendarShellProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // ── State ─────────────────────────────────────────────────────────────────
  const today = new Date();
  const [currentMonth, setCurrentMonth] = React.useState(
    new Date(today.getFullYear(), today.getMonth(), 1),
  );
  const [selectedDate, setSelectedDate] = React.useState<Date>(today);
  const [viewMode, setViewMode] = React.useState<"month" | "timeline">("month");
  const [calloutDismissed, setCalloutDismissed] = React.useState(false);
  const [bulkOpen, setBulkOpen] = React.useState(false);
  const [analyticsPostId, setAnalyticsPostId] = React.useState<string | null>(null);
  const [activeDragPost, setActiveDragPost] = React.useState<CalendarPost | null>(null);

  // Profile filter from URL
  const profileIdsParam = searchParams.get("profiles") ?? "";
  const profileFilter = React.useMemo(
    () => profileIdsParam ? profileIdsParam.split(",").filter(Boolean) : [],
    [profileIdsParam],
  );

  function setProfileFilter(ids: string[]) {
    const params = new URLSearchParams(searchParams.toString());
    if (ids.length > 0) params.set("profiles", ids.join(","));
    else params.delete("profiles");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  // Calendar data range = full month (+/- buffer for grid cells)
  const from = isoDate(startOfMonth(currentMonth));
  const to = isoDate(endOfMonth(currentMonth));
  const { posts, isLoading, mutate } = useCalendarView(companyId, from, to, profileFilter);

  // Composer state
  const { composerState, openComposer, discardChanges } = useComposerState();

  // DnD
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveDragPost(null);
    if (!over || active.id === over.id) return;

    const postId = active.id as string;
    const newDateStr = over.id as string;
    const post = posts.find((p) => p.id === postId);
    if (!post) return;

    const oldAt = post.scheduled_at ?? post.published_at;
    const timeComponent = oldAt ? oldAt.slice(11) : "09:00:00Z";
    const newScheduledAt = `${newDateStr}T${timeComponent}`;

    // Optimistic update
    const optimistic = posts.map((p) =>
      p.id === postId ? { ...p, scheduled_at: newScheduledAt } : p,
    );
    void mutate({ posts: optimistic, range: { from, to } }, false);

    try {
      const res = await fetch(`/api/platform/social/drafts/${postId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduled_at: newScheduledAt }),
      });
      if (!res.ok) throw new Error(`PATCH failed ${res.status}`);
    } catch {
      // Revert optimistic update
      void mutate();
    }
  }

  async function handleDelete(id: string) {
    try {
      await fetch(`/api/platform/social/drafts/${id}`, { method: "DELETE" });
      void mutate();
    } catch {
      // ignore
    }
  }

  function handleReschedule(id: string) {
    const post = posts.find((p) => p.id === id);
    if (post?.scheduled_at) {
      openComposer({ prefilledDate: new Date(post.scheduled_at) });
    }
  }

  function handleClickPost(post: CalendarPost) {
    if (post.state === "published") {
      setAnalyticsPostId(post.id);
    } else {
      const params = new URLSearchParams(searchParams.toString());
      params.set("compose", post.id);
      router.push(`${pathname}?${params.toString()}`);
    }
  }

  const selectedDayPosts = postsForDate(posts, selectedDate);

  return (
    <div className="flex flex-1 flex-col overflow-hidden" data-testid="calendar-shell">
      {/* Filter bar */}
      <FilterBar
        profileFilter={profileFilter}
        onProfileFilterChange={setProfileFilter}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        availableConnections={availableConnections}
        onNewPost={() => openComposer()}
        onBulkUpload={() => setBulkOpen(true)}
      />

      {/* Empty-state callout */}
      {!hasConnections && !calloutDismissed && (
        <div className="px-4 pt-3" data-testid="empty-state-callout">
          <Callout
            variant="helpful"
            icon={
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M9 21h6v-1H9v1zm3-19a7 7 0 0 0-4 12.74V17a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2.26A7 7 0 0 0 12 2z" />
              </svg>
            }
            title="Connect a Social Profile to Continue"
            body="Connect at least one social profile to start scheduling posts."
            cta={{ label: "Add Profile", onClick: () => router.push("/company/social/connections") }}
            onDismiss={() => setCalloutDismissed(true)}
          />
        </div>
      )}

      {viewMode === "month" ? (
        <DndContext
          sensors={sensors}
          onDragStart={({ active }) => {
            const p = posts.find((post) => post.id === active.id);
            setActiveDragPost(p ?? null);
          }}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActiveDragPost(null)}
        >
          <div className="flex flex-1 overflow-hidden">
            {/* Calendar grid — MonthCalendar owns layout/nav; CalendarCell provides DnD */}
            <div className="flex flex-1 flex-col overflow-auto p-4">
              <MonthCalendar
                context="page"
                companyId={companyId}
                year={currentMonth.getFullYear()}
                month={currentMonth.getMonth()}
                onNavigate={(y, m) => {
                  setCurrentMonth(new Date(y, m, 1));
                }}
                showTodayButton
                profileFilter={profileFilter}
                selectedDate={selectedDate}
                onDateSelect={(d) => setSelectedDate(d)}
                onClickPost={handleClickPost}
                renderDay={(date, dayPosts, meta) => (
                  <CalendarCell
                    date={date}
                    posts={dayPosts}
                    isSelected={meta.isSelected}
                    isPast={meta.isPast}
                    isOtherMonth={meta.isOtherMonth}
                    isToday={meta.isToday}
                    onClick={() => setSelectedDate(date)}
                    onAdd={() => {
                      setSelectedDate(date);
                      openComposer({ prefilledDate: date });
                    }}
                    onClickPost={handleClickPost}
                  />
                )}
              />
            </div>

            {/* Day detail panel */}
            <DayDetail
              date={selectedDate}
              posts={selectedDayPosts}
              onPostClick={handleClickPost}
              onDelete={handleDelete}
              onReschedule={handleReschedule}
              onAddPost={() => openComposer({ prefilledDate: selectedDate })}
              className="w-72 shrink-0"
            />
          </div>

          {/* Drag overlay — shows a ghost chip while dragging */}
          <DragOverlay>
            {activeDragPost && (
              <div className="pointer-events-none opacity-80">
                <PostChip post={activeDragPost} />
              </div>
            )}
          </DragOverlay>
        </DndContext>
      ) : (
        // ── Timeline view ──────────────────────────────────────────────────
        <TimelineView
          posts={posts}
          from={from}
          to={to}
          isLoading={isLoading}
          onPostClick={handleClickPost}
          onDelete={handleDelete}
          onAddPost={() => openComposer()}
        />
      )}

      {/* Post analytics modal */}
      <PostAnalyticsModal
        open={analyticsPostId !== null}
        onClose={() => setAnalyticsPostId(null)}
        draftId={analyticsPostId ?? ""}
        onScheduleAgain={(draft) => {
          openComposer({
            initialDraft: {
              content: draft.content,
              media_urls: draft.media_urls,
              target_profile_ids: draft.target_profiles.map((p) => p.profile_id),
              platform_variants: draft.platform_variants,
              approval_required: false,
            },
          });
        }}
        onDelete={(id) => {
          void handleDelete(id);
        }}
      />

      {/* Bulk CSV upload modal */}
      <BulkScheduleModal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        onSuccess={(_batchId, _count) => {
          setBulkOpen(false);
          void mutate();
        }}
      />

      {/* Composer overlay */}
      <ComposerOverlay
        open={composerState.open}
        onClose={discardChanges}
        initialDraft={composerState.draft}
        prefilledDate={composerState.prefilledDate}
        companyId={companyId}
        availableConnections={availableConnections}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Simple Timeline view — chronological list of all posts in the month range
// ---------------------------------------------------------------------------

function TimelineView({
  posts,
  from,
  to,
  isLoading,
  onPostClick,
  onDelete,
  onAddPost,
}: {
  posts: CalendarPost[];
  from: string;
  to: string;
  isLoading: boolean;
  onPostClick: (post: CalendarPost) => void;
  onDelete: (id: string) => void;
  onAddPost: () => void;
}) {
  void from; void to;

  const sorted = [...posts].sort((a, b) => {
    const aAt = a.scheduled_at ?? a.published_at ?? "";
    const bAt = b.scheduled_at ?? b.published_at ?? "";
    return aAt.localeCompare(bAt);
  });

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-auto p-4" data-testid="timeline-view">
      {isLoading && <p className="text-xs text-muted-foreground animate-pulse">Loading…</p>}
      {!isLoading && sorted.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="text-sm text-muted-foreground">No posts this month.</p>
          <button
            type="button"
            onClick={onAddPost}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            New post
          </button>
        </div>
      )}
      {sorted.map((post) => {
        const at = post.scheduled_at ?? post.published_at;
        const label = at
          ? new Date(at).toLocaleString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })
          : "Unscheduled";

        return (
          <div
            key={post.id}
            className="flex items-start gap-3 rounded-lg border border-border bg-card p-3 hover:shadow-sm transition-shadow cursor-pointer"
            onClick={() => onPostClick(post)}
            data-testid="timeline-post-row"
          >
            <span className="mt-0.5 w-36 shrink-0 text-xs text-muted-foreground">{label}</span>
            <p className="flex-1 text-sm text-foreground line-clamp-2">{post.content_excerpt}</p>
            <button
              type="button"
              aria-label="Delete"
              onClick={(e) => { e.stopPropagation(); onDelete(post.id); }}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-destructive"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
