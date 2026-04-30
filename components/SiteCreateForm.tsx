"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, Info, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// AUTH-FOUNDATION P2.2 — Single-page guided form for /admin/sites/new.
//
// Behaviour:
//   - Four fields: name, wp_url, wp_user, wp_app_password.
//   - "Test connection" button POSTs to /api/sites/test-connection.
//     Result panel shows the WP display name + roles on success or
//     the typed error message on failure.
//   - Save is disabled until a successful test passes for the current
//     credential set. ANY field change invalidates the test (the
//     `lastTestedKey` snapshot must match the current field values
//     for the success state to apply).
//   - On save: POST /api/sites/register, sonner success toast, redirect
//     to /admin/sites/[id].

interface FormState {
  name: string;
  wp_url: string;
  wp_user: string;
  wp_app_password: string;
}

const INITIAL_STATE: FormState = {
  name: "",
  wp_url: "",
  wp_user: "",
  wp_app_password: "",
};

type TestResult =
  | { kind: "idle" }
  | { kind: "testing" }
  | {
      kind: "ok";
      // Snapshot of the credential set that was tested. The Save button
      // checks this matches the current form before enabling.
      key: string;
      user: { display_name: string; username: string; roles: string[] };
    }
  | { kind: "err"; code: string; message: string; key: string };

function credentialsKey(state: FormState): string {
  // Keys the credentials that matter for the WP test. Name doesn't
  // — the operator can change "name" after a successful test without
  // re-testing the connection.
  return [state.wp_url.trim(), state.wp_user.trim(), state.wp_app_password]
    .map((s) => s.replace(/\s+/g, "")) // mirror server's whitespace strip
    .join("|");
}

function normaliseUrl(input: string): string {
  return input.trim().replace(/\/+$/, "");
}

export function SiteCreateForm() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(INITIAL_STATE);
  const [showPassword, setShowPassword] = useState(false);
  const [testResult, setTestResult] = useState<TestResult>({ kind: "idle" });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  // The Save button enables only when the last successful test
  // matches the current credential set. Any edit invalidates.
  const currentKey = credentialsKey(form);
  const testPassedForCurrent =
    testResult.kind === "ok" && testResult.key === currentKey;

  const canTest =
    !submitting &&
    testResult.kind !== "testing" &&
    form.wp_url.trim().length > 0 &&
    form.wp_user.trim().length > 0 &&
    form.wp_app_password.replace(/\s+/g, "").length > 0;

  const canSave =
    !submitting &&
    testResult.kind !== "testing" &&
    testPassedForCurrent &&
    form.name.trim().length > 0;

  async function runTest() {
    setTestResult({ kind: "testing" });
    try {
      const res = await fetch("/api/sites/test-connection", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: normaliseUrl(form.wp_url),
          username: form.wp_user.trim(),
          app_password: form.wp_app_password,
        }),
      });
      const payload = (await res.json().catch(() => null)) as
        | {
            ok: true;
            user: { display_name: string; username: string; roles: string[] };
          }
        | { ok: false; error: { code: string; message: string } }
        | null;
      const key = credentialsKey(form);
      if (payload?.ok) {
        setTestResult({ kind: "ok", key, user: payload.user });
      } else {
        setTestResult({
          kind: "err",
          code: payload?.ok === false ? payload.error.code : "UNKNOWN",
          message:
            payload?.ok === false
              ? payload.error.message
              : `Test request failed (HTTP ${res.status}).`,
          key,
        });
      }
    } catch (err) {
      setTestResult({
        kind: "err",
        code: "NETWORK",
        message: err instanceof Error ? err.message : String(err),
        key: credentialsKey(form),
      });
    }
  }

  async function handleSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSave) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/sites/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          wp_url: normaliseUrl(form.wp_url),
          wp_user: form.wp_user.trim(),
          wp_app_password: form.wp_app_password.replace(/\s+/g, ""),
        }),
      });
      const payload = (await res.json().catch(() => null)) as
        | { ok: true; data: { id: string } }
        | { ok: false; error: { code: string; message: string } }
        | null;
      if (payload?.ok) {
        toast.success("Site connected", {
          description: `${form.name} is ready. Open it from the sites list.`,
        });
        router.push(`/admin/sites/${payload.data.id}`);
        return;
      }
      const message =
        payload?.ok === false
          ? payload.error.message
          : `Save failed (HTTP ${res.status}).`;
      setSubmitError(message);
    } catch (err) {
      setSubmitError(
        `Network error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-4">
      <div>
        <label htmlFor="site-name" className="block text-sm font-medium">
          Site name
        </label>
        <Input
          id="site-name"
          required
          maxLength={100}
          value={form.name}
          onChange={(e) => setField("name", e.target.value)}
          disabled={submitting}
          placeholder="Client display label"
          className="mt-1"
          data-testid="site-name"
        />
      </div>

      <div>
        <label htmlFor="site-wp-url" className="block text-sm font-medium">
          WordPress URL
        </label>
        <Input
          id="site-wp-url"
          required
          type="url"
          inputMode="url"
          value={form.wp_url}
          onChange={(e) => setField("wp_url", e.target.value)}
          disabled={submitting}
          placeholder="https://example.com"
          className="mt-1"
          data-testid="site-wp-url"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Full origin including <code className="font-mono">https://</code>.
          Trailing slash is stripped automatically.
        </p>
      </div>

      <div>
        <label htmlFor="site-wp-user" className="block text-sm font-medium">
          WordPress username
        </label>
        <Input
          id="site-wp-user"
          required
          maxLength={100}
          value={form.wp_user}
          onChange={(e) => setField("wp_user", e.target.value)}
          disabled={submitting}
          autoComplete="off"
          className="mt-1"
          data-testid="site-wp-user"
        />
      </div>

      <div>
        <label htmlFor="site-wp-password" className="block text-sm font-medium">
          WordPress Application Password
        </label>
        <div className="relative mt-1">
          <Input
            id="site-wp-password"
            required
            type={showPassword ? "text" : "password"}
            value={form.wp_app_password}
            onChange={(e) => setField("wp_app_password", e.target.value)}
            disabled={submitting}
            autoComplete="off"
            className="pr-16 font-mono text-sm"
            data-testid="site-wp-password"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded-sm px-1"
            tabIndex={-1}
          >
            {showPassword ? "hide" : "show"}
          </button>
        </div>
        <p className="mt-1 text-xs font-semibold text-foreground">
          This is NOT your WordPress login password.
        </p>
        <ApplicationPasswordHelp />
        <p className="mt-2 text-xs text-muted-foreground">
          You need an Administrator or Editor account. Subscriber or
          Contributor accounts will fail the connection test.
        </p>
      </div>

      <div className="rounded-md border bg-muted/30 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Connection test</p>
            <p className="text-xs text-muted-foreground">
              Required before saving. Re-runs after any URL / username /
              password edit.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void runTest()}
            disabled={!canTest}
            data-testid="site-test-connection"
          >
            {testResult.kind === "testing" ? (
              <>
                <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
                Testing…
              </>
            ) : (
              "Test connection"
            )}
          </Button>
        </div>
        <TestResultPanel result={testResult} matchesCurrent={testPassedForCurrent} />
      </div>

      {submitError && (
        <Alert variant="destructive" data-testid="site-create-error">
          {submitError}
        </Alert>
      )}

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push("/admin/sites")}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={!canSave} data-testid="site-create-save">
          {submitting ? "Saving…" : "Save site"}
        </Button>
      </div>
    </form>
  );
}

function TestResultPanel({
  result,
  matchesCurrent,
}: {
  result: TestResult;
  matchesCurrent: boolean;
}) {
  if (result.kind === "idle") return null;
  if (result.kind === "testing") return null;

  if (result.kind === "ok") {
    return (
      <div
        className={cn(
          "mt-3 rounded-md border p-3 text-sm",
          matchesCurrent
            ? "border-success/40 bg-success/10 text-success"
            : "border-warning/40 bg-warning/10 text-warning",
        )}
        data-testid="site-test-result"
        data-matches-current={matchesCurrent ? "true" : "false"}
      >
        <div className="flex items-start gap-2">
          <CheckCircle2
            aria-hidden
            className={cn(
              "h-4 w-4 shrink-0",
              matchesCurrent ? "text-success" : "text-warning",
            )}
          />
          <div className="min-w-0">
            <p className="font-medium">
              {matchesCurrent
                ? `Connected as ${result.user.display_name}`
                : "Credentials changed since last successful test"}
            </p>
            <p className="mt-0.5 text-xs">
              {matchesCurrent
                ? `WordPress username: ${result.user.username}. Roles: ${
                    result.user.roles.join(", ") || "(none)"
                  }`
                : "Re-run the test before saving."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
      role="alert"
      data-testid="site-test-result"
    >
      <p className="font-medium">{result.code}</p>
      <p className="mt-0.5 text-xs">{result.message}</p>
    </div>
  );
}

function ApplicationPasswordHelp() {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded-sm"
        aria-expanded={open}
        aria-controls="app-password-help-body"
        data-testid="site-wp-password-help-toggle"
      >
        {open ? (
          <ChevronDown aria-hidden className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight aria-hidden className="h-3.5 w-3.5" />
        )}
        <Info aria-hidden className="h-3.5 w-3.5" />
        <span>How do I get this?</span>
      </button>
      {open && (
        <ol
          id="app-password-help-body"
          className="mt-2 list-decimal space-y-1 rounded-md border bg-muted/30 p-3 pl-6 text-xs text-muted-foreground"
          data-testid="site-wp-password-help-body"
        >
          <li>Log in to WordPress Admin</li>
          <li>
            Go to Users → Profile (or Users → All Users → edit your admin
            account)
          </li>
          <li>Scroll down to &quot;Application Passwords&quot;</li>
          <li>Type &quot;Opollo Site Builder&quot; in the name field</li>
          <li>Click &quot;Add New Application Password&quot;</li>
          <li>
            Copy the password shown — it appears only once (24 characters
            with spaces)
          </li>
          <li>
            Paste it here exactly as shown — spaces are fine, the system
            strips them
          </li>
        </ol>
      )}
    </div>
  );
}
