"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { CheckCircle2, HelpCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// AUTH-FOUNDATION P2.3 — Edit form for /admin/sites/[id]/edit.
//
// Mirrors SiteCreateForm's layout but with edit-mode semantics:
//   - Pre-seeds name, wp_url, wp_user from the site record.
//   - Password field shows the "••••••••• (unchanged)" placeholder
//     and is NOT pre-filled (we never send the encrypted password
//     down). passwordTouched tracks whether the operator entered a
//     new value.
//   - Test connection has two modes:
//       a. Operator hasn't changed url/user/password → test STORED
//          credentials via POST { site_id }.
//       b. Operator changed any of url/user/password → test EXPLICIT
//          credentials via POST { url, username, app_password }.
//          Requires a non-empty password input (the stored password
//          is bound to the old credential set).
//   - Save: PATCH /api/sites/[id] with only the fields that changed.
//     Empty password = no rotation; new password = re-encrypts.

interface ExistingSite {
  id: string;
  name: string;
  wp_url: string;
  wp_user: string;
}

interface FormState {
  name: string;
  wp_url: string;
  wp_user: string;
  wp_app_password: string;
  passwordTouched: boolean;
}

type TestResult =
  | { kind: "idle" }
  | { kind: "testing" }
  | {
      kind: "ok";
      key: string;
      user: { display_name: string; username: string; roles: string[] };
    }
  | { kind: "err"; code: string; message: string; key: string };

function explicitMode(form: FormState, existing: ExistingSite): boolean {
  return (
    form.passwordTouched ||
    form.wp_url.trim() !== existing.wp_url ||
    form.wp_user.trim() !== existing.wp_user
  );
}

function explicitKey(form: FormState): string {
  return [form.wp_url.trim(), form.wp_user.trim(), form.wp_app_password]
    .map((s) => s.replace(/\s+/g, ""))
    .join("|");
}

function normaliseUrl(input: string): string {
  return input.trim().replace(/\/+$/, "");
}

export function SiteEditForm({
  site,
  hasStoredCredentials,
}: {
  site: ExistingSite;
  hasStoredCredentials: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>({
    name: site.name,
    wp_url: site.wp_url,
    wp_user: site.wp_user,
    wp_app_password: "",
    passwordTouched: false,
  });
  const [showPassword, setShowPassword] = useState(false);
  const [testResult, setTestResult] = useState<TestResult>({ kind: "idle" });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const isExplicit = explicitMode(form, site);
  const currentExplicitKey = explicitKey(form);

  // In stored-credentials mode the test result key is `stored:<id>`.
  // In explicit mode it's the credential triple. Save reads the same.
  const testPassedForCurrent =
    testResult.kind === "ok" &&
    (isExplicit
      ? testResult.key === currentExplicitKey
      : testResult.key === `stored:${site.id}`);

  const explicitTestable =
    isExplicit &&
    form.wp_url.trim().length > 0 &&
    form.wp_user.trim().length > 0 &&
    form.wp_app_password.replace(/\s+/g, "").length > 0;

  const canTest =
    !submitting &&
    testResult.kind !== "testing" &&
    (isExplicit ? explicitTestable : hasStoredCredentials);

  const nameChanged = form.name.trim() !== site.name;
  const anythingChanged =
    nameChanged ||
    form.wp_url.trim() !== site.wp_url ||
    form.wp_user.trim() !== site.wp_user ||
    form.passwordTouched;

  // Save gating:
  //   - If no creds changed (only name and/or wp_url) → no test
  //     required. PATCH happens with the basics only.
  //   - If creds changed (url/user/password) → require a passing test
  //     for the current explicit credential set.
  const credsChanged =
    form.wp_url.trim() !== site.wp_url ||
    form.wp_user.trim() !== site.wp_user ||
    form.passwordTouched;
  const canSave =
    !submitting &&
    testResult.kind !== "testing" &&
    anythingChanged &&
    form.name.trim().length > 0 &&
    (!credsChanged || testPassedForCurrent);

  async function runTest() {
    setTestResult({ kind: "testing" });
    try {
      const body: Record<string, unknown> = isExplicit
        ? {
            url: normaliseUrl(form.wp_url),
            username: form.wp_user.trim(),
            app_password: form.wp_app_password,
          }
        : { site_id: site.id };
      const res = await fetch("/api/sites/test-connection", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await res.json().catch(() => null)) as
        | {
            ok: true;
            user: { display_name: string; username: string; roles: string[] };
          }
        | { ok: false; error: { code: string; message: string } }
        | null;
      const key = isExplicit ? currentExplicitKey : `stored:${site.id}`;
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
        key: isExplicit ? currentExplicitKey : `stored:${site.id}`,
      });
    }
  }

  async function handleSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSave) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const patch: Record<string, string> = {};
      if (form.name.trim() !== site.name) patch.name = form.name.trim();
      if (form.wp_url.trim() !== site.wp_url) {
        patch.wp_url = normaliseUrl(form.wp_url);
      }
      if (form.wp_user.trim() !== site.wp_user) patch.wp_user = form.wp_user.trim();
      if (form.passwordTouched) patch.wp_app_password = form.wp_app_password;

      const res = await fetch(
        `/api/sites/${encodeURIComponent(site.id)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        },
      );
      const payload = (await res.json().catch(() => null)) as
        | { ok: true }
        | { ok: false; error: { code: string; message: string } }
        | null;
      if (payload?.ok) {
        toast.success("Site updated", {
          description: form.passwordTouched
            ? "Credentials rotated."
            : "Changes saved.",
        });
        router.push(`/admin/sites/${site.id}`);
        router.refresh();
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
        <label htmlFor="edit-site-name" className="block text-sm font-medium">
          Site name
        </label>
        <Input
          id="edit-site-name"
          required
          maxLength={100}
          value={form.name}
          onChange={(e) => setField("name", e.target.value)}
          disabled={submitting}
          className="mt-1"
          data-testid="site-name"
        />
      </div>

      <div>
        <label htmlFor="edit-site-wp-url" className="block text-sm font-medium">
          WordPress URL
        </label>
        <Input
          id="edit-site-wp-url"
          required
          type="url"
          inputMode="url"
          value={form.wp_url}
          onChange={(e) => setField("wp_url", e.target.value)}
          disabled={submitting}
          className="mt-1"
          data-testid="site-wp-url"
        />
      </div>

      <div>
        <label
          htmlFor="edit-site-wp-user"
          className="block text-sm font-medium"
        >
          WordPress username
        </label>
        <Input
          id="edit-site-wp-user"
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
        <label
          htmlFor="edit-site-wp-password"
          className="flex items-center gap-1 text-sm font-medium"
        >
          WordPress Application Password
          <ApplicationPasswordTooltip />
        </label>
        <div className="relative mt-1">
          <Input
            id="edit-site-wp-password"
            type={showPassword ? "text" : "password"}
            value={form.wp_app_password}
            placeholder={
              hasStoredCredentials
                ? "••••••••• (unchanged)"
                : "Enter Application Password"
            }
            onChange={(e) =>
              setForm((prev) => ({
                ...prev,
                wp_app_password: e.target.value,
                passwordTouched: true,
              }))
            }
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
        <p className="mt-1 text-xs text-muted-foreground">
          {form.passwordTouched
            ? "Submitting saves this new Application Password."
            : "Leave empty to keep the stored Application Password."}
        </p>
      </div>

      <div className="rounded-md border bg-muted/30 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Connection test</p>
            <p className="text-xs text-muted-foreground">
              {isExplicit
                ? "Tests the credentials in the form."
                : hasStoredCredentials
                  ? "Tests the stored credentials. Required before saving credential changes."
                  : "No stored credentials yet — provide a username + password to test."}
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
        <TestResultPanel
          result={testResult}
          matchesCurrent={testPassedForCurrent}
        />
      </div>

      {submitError && (
        <Alert variant="destructive" data-testid="site-edit-error">
          {submitError}
        </Alert>
      )}

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push(`/admin/sites/${site.id}`)}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={!canSave} data-testid="site-edit-save">
          {submitting ? "Saving…" : "Save changes"}
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
      <p className="font-medium">Connection test failed</p>
      <p className="mt-0.5 text-xs">{result.message}</p>
    </div>
  );
}

function ApplicationPasswordTooltip() {
  return (
    <span
      className="group relative inline-flex"
      tabIndex={0}
      aria-label="Where to generate a WordPress Application Password"
    >
      <HelpCircle
        aria-hidden
        className="h-3.5 w-3.5 text-muted-foreground transition-smooth group-hover:text-foreground group-focus:text-foreground"
      />
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-5 z-10 w-72 -translate-x-1/2 rounded-md border bg-popover p-3 text-xs text-popover-foreground opacity-0 shadow-lg transition-smooth group-hover:opacity-100 group-focus:opacity-100"
      >
        Generate at{" "}
        <strong>wp-admin → Users → Profile → Application Passwords</strong>.
        Name it &quot;Opollo Site Builder&quot;. Paste the generated token
        here — <strong>not</strong> your WordPress login password.
        Application Passwords are 24 characters with spaces; the system
        strips them.
      </span>
    </span>
  );
}
