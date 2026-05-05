"use client";

import { useEffect, useRef, useState } from "react";

import type { InAppNotification } from "@/lib/platform/notifications";

// ---------------------------------------------------------------------------
// S1-29 — notification bell for the social section nav.
//
// Polls for unread count on mount (and every 60 s). On click, expands
// a dropdown with the 20 latest notifications and marks all as read.
// ---------------------------------------------------------------------------

type BellData = {
  notifications: InAppNotification[];
  unreadCount: number;
};

type Props = {
  companyId: string;
};

const POLL_INTERVAL_MS = 60_000;

export function NotificationBell({ companyId }: Props) {
  const [data, setData] = useState<BellData | null>(null);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  async function fetchData() {
    try {
      const res = await fetch(
        `/api/platform/notifications?company_id=${encodeURIComponent(companyId)}`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const json = (await res.json()) as { ok: boolean; data: BellData };
      if (json.ok) setData(json.data);
    } catch {
      // non-blocking; bell just stays empty
    }
  }

  useEffect(() => {
    void fetchData();
    const id = setInterval(() => void fetchData(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  // Close dropdown on outside click.
  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [open]);

  async function handleOpen() {
    if (!open) {
      setOpen(true);
      if (data && data.unreadCount > 0) {
        // Optimistically clear badge.
        setData((prev) => prev ? { ...prev, unreadCount: 0 } : prev);
        try {
          await fetch(
            `/api/platform/notifications?company_id=${encodeURIComponent(companyId)}`,
            { method: "PATCH" },
          );
        } catch {
          // best-effort
        }
        await fetchData();
      }
    } else {
      setOpen(false);
    }
  }

  const unread = data?.unreadCount ?? 0;

  return (
    <div ref={containerRef} className="relative ml-auto">
      <button
        type="button"
        onClick={() => void handleOpen()}
        aria-label={unread > 0 ? `${unread} unread notifications` : "Notifications"}
        className="relative flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted"
        data-testid="notification-bell"
      >
        {/* Simple bell SVG */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span
            className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground"
            aria-hidden="true"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-10 z-50 w-80 rounded-lg border bg-popover shadow-lg"
          role="dialog"
          aria-label="Notifications"
          data-testid="notification-dropdown"
        >
          <div className="border-b px-4 py-2.5">
            <p className="text-sm font-semibold">Notifications</p>
          </div>
          <ul className="max-h-96 overflow-y-auto divide-y" data-testid="notification-list">
            {!data || data.notifications.length === 0 ? (
              <li className="px-4 py-6 text-center text-sm text-muted-foreground">
                No notifications yet.
              </li>
            ) : (
              data.notifications.map((n) => (
                <li key={n.id}>
                  {n.action_url ? (
                    <a
                      href={n.action_url}
                      className="block px-4 py-3 hover:bg-muted"
                      onClick={() => setOpen(false)}
                      data-testid={`notification-item-${n.id}`}
                    >
                      <NotificationRow n={n} />
                    </a>
                  ) : (
                    <div
                      className="px-4 py-3"
                      data-testid={`notification-item-${n.id}`}
                    >
                      <NotificationRow n={n} />
                    </div>
                  )}
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function NotificationRow({ n }: { n: InAppNotification }) {
  return (
    <>
      <p className={`text-sm font-medium ${n.read_at ? "text-muted-foreground" : ""}`}>
        {n.title}
      </p>
      {n.body && (
        <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{n.body}</p>
      )}
      <p className="mt-1 text-xs text-muted-foreground/70">
        {new Date(n.created_at).toLocaleString("en-AU", {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </p>
    </>
  );
}
