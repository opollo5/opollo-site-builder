"use client";

import { useState, type FormEvent } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

// AUTH-FOUNDATION P1.2 — Dev-only client form for /admin/email-test.
// Result panel reads back the SendGrid X-Message-Id on success or the
// typed error code/message on failure.

type Result =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "ok"; messageId: string }
  | { kind: "err"; code: string; message: string };

export function EmailTestForm() {
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState(
    "Opollo SendGrid wrapper smoke test",
  );
  const [body, setBody] = useState(
    "If you're reading this, the SendGrid wrapper, base template, and email_log audit are working end-to-end.",
  );
  const [result, setResult] = useState<Result>({ kind: "idle" });

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setResult({ kind: "sending" });
    try {
      const res = await fetch("/api/admin/email-test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: to.trim(), subject, body }),
      });
      const payload = (await res.json().catch(() => null)) as
        | { ok: true; messageId: string }
        | { ok: false; error: { code: string; message: string } }
        | null;
      if (payload?.ok) {
        setResult({ kind: "ok", messageId: payload.messageId });
      } else {
        setResult({
          kind: "err",
          code: payload?.ok === false ? payload.error.code : "UNKNOWN",
          message:
            payload?.ok === false
              ? payload.error.message
              : `HTTP ${res.status}`,
        });
      }
    } catch (err) {
      setResult({
        kind: "err",
        code: "NETWORK",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const sending = result.kind === "sending";

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="email-test-to" className="block text-sm font-medium">
          To
        </label>
        <Input
          id="email-test-to"
          type="email"
          required
          value={to}
          onChange={(e) => setTo(e.target.value)}
          disabled={sending}
          placeholder="hi@opollo.com"
          className="mt-1"
          data-testid="email-test-to"
        />
      </div>
      <div>
        <label
          htmlFor="email-test-subject"
          className="block text-sm font-medium"
        >
          Subject
        </label>
        <Input
          id="email-test-subject"
          required
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          disabled={sending}
          maxLength={200}
          className="mt-1"
          data-testid="email-test-subject"
        />
      </div>
      <div>
        <label htmlFor="email-test-body" className="block text-sm font-medium">
          Body (plaintext)
        </label>
        <Textarea
          id="email-test-body"
          required
          value={body}
          onChange={(e) => setBody(e.target.value)}
          disabled={sending}
          rows={6}
          className="mt-1"
          data-testid="email-test-body"
        />
      </div>

      {result.kind === "ok" && (
        <Alert data-testid="email-test-success">
          Sent. SendGrid message id:{" "}
          <code className="font-mono text-sm">{result.messageId}</code>
        </Alert>
      )}
      {result.kind === "err" && (
        <Alert variant="destructive" data-testid="email-test-error">
          <strong>{result.code}</strong> — {result.message}
        </Alert>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={sending} data-testid="email-test-submit">
          {sending ? "Sending…" : "Send test email"}
        </Button>
      </div>
    </form>
  );
}
