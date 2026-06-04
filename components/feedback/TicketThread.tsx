"use client";

import { useCallback, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { FeedbackTicketComment } from "@/lib/feedback/types";

type Props = {
  ticketId: string;
  comments: FeedbackTicketComment[];
  onCommentPosted?: (comment: FeedbackTicketComment) => void;
};

// ---------------------------------------------------------------------------
// TicketThread — shared two-way comment thread for admin + customer views.
//
// Staff (is_staff=true) comments render on the right; reporter comments on
// the left. The is_staff field is set server-side at insert — the client
// never supplies it.
//
// data-testid: ticket-thread (wrapper), ticket-reply (textarea)
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function TicketThread({ ticketId, comments: initial, onCommentPosted }: Props) {
  const [comments, setComments] = useState(initial);
  const [reply, setReply] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const post = useCallback(async () => {
    if (!reply.trim()) return;
    setPosting(true);
    setError(null);

    try {
      const resp = await fetch(`/api/feedback/tickets/${ticketId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: reply.trim() }),
      });

      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        setError(body?.error?.message ?? "Failed to post reply.");
        return;
      }

      const { data } = await resp.json();
      const newComment = data.comment as FeedbackTicketComment;
      setComments((prev) => [...prev, newComment]);
      setReply("");
      onCommentPosted?.(newComment);
    } catch {
      setError("An unexpected error occurred.");
    } finally {
      setPosting(false);
    }
  }, [reply, ticketId, onCommentPosted]);

  return (
    <div data-testid="ticket-thread" className="flex flex-col gap-4">
      {/* Thread messages */}
      <div className="flex flex-col gap-3">
        {comments.length === 0 && (
          <p className="text-sm text-gray-400 italic">No messages yet.</p>
        )}
        {comments.map((c) => (
          <div
            key={c.id}
            className={`flex ${c.is_staff ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] rounded-xl px-4 py-2 text-sm ${
                c.is_staff
                  ? "rounded-tr-none bg-emerald-600 text-white"
                  : "rounded-tl-none bg-gray-100 text-gray-900"
              }`}
            >
              <p className="whitespace-pre-wrap">{c.body}</p>
              <p
                className={`mt-1 text-xs ${
                  c.is_staff ? "text-emerald-100" : "text-gray-400"
                }`}
              >
                {c.is_staff ? "Opollo" : "Reporter"} · {formatDate(c.created_at)}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Reply composer */}
      <div className="flex flex-col gap-2">
        <Textarea
          data-testid="ticket-reply"
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder="Add a reply…"
          rows={3}
          maxLength={2000}
          className="resize-none text-sm"
        />
        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="flex justify-end">
          <Button
            size="sm"
            onClick={post}
            disabled={posting || !reply.trim()}
            className="bg-emerald-600 text-white hover:bg-emerald-700"
          >
            {posting ? "Sending…" : "Send reply"}
          </Button>
        </div>
      </div>
    </div>
  );
}
