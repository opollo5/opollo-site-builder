"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TryAutoImportPanel } from "@/components/optimiser/TryAutoImportPanel";
import type { ConnectorStatus } from "@/lib/optimiser/connector-status";
import type { OptClient } from "@/lib/optimiser/clients";

type StepId = "client" | "ads" | "clarity" | "ga4" | "pages";

const STEPS: Array<{ id: StepId; label: string; description: string }> = [
  { id: "client", label: "Client details", description: "Name, contact, budget." },
  { id: "ads", label: "Connect Google Ads", description: "OAuth + customer id." },
  { id: "clarity", label: "Install Microsoft Clarity", description: "Snippet + verify." },
  { id: "ga4", label: "Connect GA4", description: "OAuth + property id." },
  { id: "pages", label: "Identify landing pages", description: "Bulk select managed pages." },
];

export function OnboardingWizard({
  client,
  connectors: initialConnectors,
}: {
  client: OptClient;
  connectors: ConnectorStatus[];
}) {
  const search = useSearchParams();
  const router = useRouter();
  const initialStep = (search.get("step") as StepId | null) ?? deriveStep(client, initialConnectors);
  const [currentStep, setCurrentStep] = useState<StepId>(initialStep);
  const [connectors, setConnectors] = useState(initialConnectors);
  const [status, setStatus] = useState<{ message: string; tone: "info" | "ok" | "warn" | "err" } | null>(null);

  const oauthError = search.get("error");
  useEffect(() => {
    if (oauthError) {
      setStatus({
        message: oauthErrorCopy(oauthError),
        tone: "err",
      });
    }
  }, [oauthError]);

  async function refreshConnectors() {
    const res = await fetch(`/api/optimiser/clients/${client.id}`, {
      cache: "no-store",
    });
    const json = await res.json();
    if (json.ok) setConnectors(json.data.connectors);
  }

  const stepStatus = useMemo(() => deriveStepStatus(client, connectors), [client, connectors]);

  return (
    <div className="grid gap-6 md:grid-cols-[260px_1fr]">
      <aside className="space-y-1">
        <ol className="space-y-1">
          {STEPS.map((step, idx) => {
            const state = stepStatus[step.id];
            const active = currentStep === step.id;
            return (
              <li key={step.id}>
                <button
                  type="button"
                  onClick={() => setCurrentStep(step.id)}
                  className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                    active
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {idx + 1}. {step.label}
                    </span>
                    <StatusDot state={state} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {step.description}
                  </p>
                </button>
              </li>
            );
          })}
        </ol>
      </aside>
      <section className="space-y-4">
        {status && (
          <div
            className={`rounded-md border px-3 py-2 text-sm ${
              status.tone === "err"
                ? "border-red-200 bg-red-50 text-red-900"
                : status.tone === "warn"
                  ? "border-amber-200 bg-amber-50 text-amber-900"
                  : status.tone === "ok"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                    : "border-blue-200 bg-blue-50 text-blue-900"
            }`}
          >
            {status.message}
          </div>
        )}
        {currentStep === "client" && (
          <ClientDetailsStep client={client} setStatus={setStatus} onSaved={refreshConnectors} />
        )}
        {currentStep === "ads" && (
          <AdsStep
            client={client}
            connector={connectors.find((c) => c.source === "google_ads")!}
            setStatus={setStatus}
            onChange={refreshConnectors}
          />
        )}
        {currentStep === "clarity" && (
          <ClarityStep
            client={client}
            connector={connectors.find((c) => c.source === "clarity")!}
            setStatus={setStatus}
            onChange={refreshConnectors}
          />
        )}
        {currentStep === "ga4" && (
          <Ga4Step
            client={client}
            connector={connectors.find((c) => c.source === "ga4")!}
            setStatus={setStatus}
            onChange={refreshConnectors}
          />
        )}
        {currentStep === "pages" && (
          <PagesStep
            client={client}
            stepStatus={stepStatus}
            setStatus={setStatus}
            onComplete={() => {
              router.push("/optimiser");
            }}
          />
        )}
      </section>
    </div>
  );
}

type StepStatus = "incomplete" | "ready" | "verified";

function deriveStep(client: OptClient, connectors: ConnectorStatus[]): StepId {
  if (!client.onboarded_at) {
    if (!connectors.find((c) => c.source === "google_ads")?.connected) return "ads";
    if (!connectors.find((c) => c.source === "clarity")?.connected) return "clarity";
    if (!connectors.find((c) => c.source === "ga4")?.connected) return "ga4";
    return "pages";
  }
  return "client";
}

function deriveStepStatus(
  client: OptClient,
  connectors: ConnectorStatus[],
): Record<StepId, StepStatus> {
  const cs = (s: string) => connectors.find((c) => c.source === s);
  return {
    client: client.name && client.client_slug ? "verified" : "incomplete",
    ads: cs("google_ads")?.connected ? "verified" : "incomplete",
    clarity: cs("clarity")?.connected ? "verified" : "incomplete",
    ga4: cs("ga4")?.connected ? "verified" : "incomplete",
    pages: client.onboarded_at ? "verified" : "incomplete",
  };
}

function StatusDot({ state }: { state: StepStatus }) {
  const cls =
    state === "verified"
      ? "bg-emerald-500"
      : state === "ready"
        ? "bg-amber-400"
        : "bg-muted";
  return <span aria-hidden className={`size-2 rounded-full ${cls}`} />;
}

function ClientDetailsStep({
  client,
  setStatus,
  onSaved,
}: {
  client: OptClient;
  setStatus: (s: { message: string; tone: "info" | "ok" | "warn" | "err" } | null) => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(client.name);
  const [email, setEmail] = useState(client.primary_contact_email ?? "");
  const [budget, setBudget] = useState(client.llm_monthly_budget_usd);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/optimiser/clients/${client.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          primary_contact_email: email || null,
          llm_monthly_budget_usd: Number(budget),
        }),
      });
      const json = await res.json();
      if (json.ok) {
        setStatus({ message: "Saved.", tone: "ok" });
        onSaved();
      } else {
        setStatus({ message: json.error?.message ?? "Save failed.", tone: "err" });
      }
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-6">
      <h2 className="text-lg font-medium">Client details</h2>
      <div className="space-y-2">
        <label className="block text-sm font-medium">Display name</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="space-y-2">
        <label className="block text-sm font-medium">Primary contact email</label>
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <label className="block text-sm font-medium">
          Monthly LLM budget (USD)
        </label>
        <Input
          type="number"
          min={0}
          value={budget}
          onChange={(e) => setBudget(Number(e.target.value))}
        />
        <p className="text-xs text-muted-foreground">
          Soft warning at 75%, hard cutoff at 100%. Default: $50.
        </p>
      </div>
      <Button onClick={save} disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}

function AdsStep({
  client,
  connector,
  setStatus,
  onChange,
}: {
  client: OptClient;
  connector: ConnectorStatus;
  setStatus: (s: { message: string; tone: "info" | "ok" | "warn" | "err" } | null) => void;
  onChange: () => void;
}) {
  const [customerId, setCustomerId] = useState(connector.external_account_id ?? "");
  const [loginCustomerId, setLoginCustomerId] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [saving, setSaving] = useState(false);

  async function saveCustomer() {
    setSaving(true);
    try {
      const res = await fetch(
        `/api/optimiser/clients/${client.id}/ads-customer`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            customer_id: customerId,
            login_customer_id: loginCustomerId || undefined,
          }),
        },
      );
      const json = await res.json();
      if (json.ok) {
        setStatus({ message: "Customer id saved.", tone: "ok" });
        onChange();
      } else {
        setStatus({ message: json.error?.message ?? "Save failed.", tone: "err" });
      }
    } finally {
      setSaving(false);
    }
  }

  async function verify() {
    setVerifying(true);
    try {
      const res = await fetch(
        `/api/optimiser/clients/${client.id}/ads-customer`,
      );
      const json = await res.json();
      const r = json.data;
      if (r.ok) {
        setStatus({ message: "Verified — Ads is reporting active campaigns.", tone: "ok" });
      } else if (r.kind === "no_data") {
        setStatus({ message: r.message, tone: "warn" });
      } else if (r.kind === "auth") {
        setStatus({ message: r.message, tone: "err" });
      } else {
        setStatus({ message: r.message ?? "Verification failed.", tone: "err" });
      }
      onChange();
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-6">
      <h2 className="text-lg font-medium">Connect Google Ads</h2>
      <p className="text-sm text-muted-foreground">
        OAuth into the client&apos;s Google Ads account. Opollo&apos;s MCC developer
        token is used; the client signs in to authorise.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <a
          href={`/api/optimiser/oauth/ads/start?client_id=${client.id}`}
          className="inline-flex items-center rounded-md border border-primary bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {connector.connected ? "Re-connect" : "Sign in with Google"}
        </a>
        {connector.connected && (
          <span className="text-sm text-emerald-700">
            Connected {connector.last_synced_at ? `· last sync ${new Date(connector.last_synced_at).toLocaleString()}` : ""}
          </span>
        )}
      </div>
      <div className="space-y-2">
        <label className="block text-sm font-medium">Ads customer id</label>
        <Input
          placeholder="1234567890"
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value.replace(/[^0-9]/g, ""))}
        />
        <label className="block text-sm font-medium">
          Login customer id (MCC, optional)
        </label>
        <Input
          placeholder="0987654321"
          value={loginCustomerId}
          onChange={(e) => setLoginCustomerId(e.target.value.replace(/[^0-9]/g, ""))}
        />
        <div className="flex gap-2">
          <Button onClick={saveCustomer} disabled={saving || !customerId}>
            {saving ? "Saving…" : "Save customer id"}
          </Button>
          <Button onClick={verify} disabled={verifying || !customerId} variant="outline">
            {verifying ? "Verifying…" : "Verify"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ClarityStep({
  client,
  connector,
  setStatus,
  onChange,
}: {
  client: OptClient;
  connector: ConnectorStatus;
  setStatus: (s: { message: string; tone: "info" | "ok" | "warn" | "err" } | null) => void;
  onChange: () => void;
}) {
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const snippet = `<script type="text/javascript">
  (function(c,l,a,r,i,t,y){
    c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
    t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
    y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
  })(window, document, "clarity", "script", "${connector.external_account_label ?? "<your-clarity-project-id>"}");
</script>`;

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/optimiser/clients/${client.id}/clarity`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ api_token: token }),
      });
      const json = await res.json();
      if (json.ok) {
        setStatus({ message: "Token saved. Add the snippet then click Verify install.", tone: "ok" });
        onChange();
      } else {
        setStatus({ message: json.error?.message ?? "Save failed.", tone: "err" });
      }
    } finally {
      setSaving(false);
    }
  }
  async function verify() {
    setVerifying(true);
    try {
      const res = await fetch(`/api/optimiser/clients/${client.id}/clarity`);
      const json = await res.json();
      const r = json.data;
      if (r.ok) {
        setStatus({ message: "Clarity is reporting sessions.", tone: "ok" });
      } else if (r.kind === "no_data") {
        setStatus({ message: "Waiting for first Clarity session — add the snippet to the site.", tone: "warn" });
      } else {
        setStatus({ message: r.message ?? "Verification failed.", tone: "err" });
      }
      onChange();
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-6">
      <h2 className="text-lg font-medium">Install Microsoft Clarity</h2>
      <p className="text-sm text-muted-foreground">
        Paste the Clarity API token (project-level), and add the JS snippet to the
        client&apos;s site. The Verify button polls the API until at least one session
        is recorded.
      </p>
      <div className="space-y-2">
        <label className="block text-sm font-medium">Clarity API token</label>
        <Input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={connector.connected ? "(token saved — leave blank to keep)" : ""}
        />
        <div className="flex gap-2">
          <Button onClick={save} disabled={saving || !token}>
            {saving ? "Saving…" : "Save token"}
          </Button>
          <Button onClick={verify} disabled={verifying} variant="outline">
            {verifying ? "Verifying…" : "Verify install"}
          </Button>
        </div>
      </div>
      <div>
        <p className="text-sm font-medium">JS snippet</p>
        <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">
{snippet}
        </pre>
      </div>
    </div>
  );
}

function Ga4Step({
  client,
  connector,
  setStatus,
  onChange,
}: {
  client: OptClient;
  connector: ConnectorStatus;
  setStatus: (s: { message: string; tone: "info" | "ok" | "warn" | "err" } | null) => void;
  onChange: () => void;
}) {
  const [propertyId, setPropertyId] = useState(connector.external_account_id ?? "");
  const [baseUrl, setBaseUrl] = useState(connector.external_account_label ?? "");
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/optimiser/clients/${client.id}/ga4-property`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          property_id: propertyId,
          base_url: baseUrl || undefined,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        setStatus({ message: "Saved.", tone: "ok" });
        onChange();
      } else {
        setStatus({ message: json.error?.message ?? "Save failed.", tone: "err" });
      }
    } finally {
      setSaving(false);
    }
  }
  async function verify() {
    setVerifying(true);
    try {
      const res = await fetch(`/api/optimiser/clients/${client.id}/ga4-property`);
      const json = await res.json();
      const r = json.data;
      if (r.ok) {
        const noGoals = (r.evidence?.conversions_seen ?? 0) === 0;
        setStatus({
          message: noGoals
            ? "GA4 reporting sessions, but no conversions configured. Engine will use traffic + behaviour signals only."
            : "GA4 verified.",
          tone: noGoals ? "warn" : "ok",
        });
      } else {
        setStatus({ message: r.message ?? "Verification failed.", tone: "err" });
      }
      onChange();
    } finally {
      setVerifying(false);
    }
  }
  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-6">
      <h2 className="text-lg font-medium">Connect GA4</h2>
      <p className="text-sm text-muted-foreground">
        OAuth into the client&apos;s GA4 account, then pick which property maps to
        the Ads landing-page domain.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <a
          href={`/api/optimiser/oauth/ga4/start?client_id=${client.id}`}
          className="inline-flex items-center rounded-md border border-primary bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {connector.connected ? "Re-connect" : "Sign in with Google"}
        </a>
      </div>
      <div className="space-y-2">
        <label className="block text-sm font-medium">GA4 property id</label>
        <Input
          placeholder="123456789"
          value={propertyId}
          onChange={(e) => setPropertyId(e.target.value.replace(/[^0-9]/g, ""))}
        />
        <label className="block text-sm font-medium">
          Site base URL (used to resolve GA pagePaths to full URLs)
        </label>
        <Input
          placeholder="https://www.example.com"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
        />
        <div className="flex gap-2">
          <Button onClick={save} disabled={saving || !propertyId}>
            {saving ? "Saving…" : "Save property"}
          </Button>
          <Button onClick={verify} disabled={verifying || !propertyId} variant="outline">
            {verifying ? "Verifying…" : "Verify"}
          </Button>
        </div>
      </div>
    </div>
  );
}

type PagesStepProps = {
  client: OptClient;
  stepStatus: Record<StepId, StepStatus>;
  setStatus: (s: { message: string; tone: "info" | "ok" | "warn" | "err" } | null) => void;
  onComplete: () => void;
};

function PagesStep({ client, stepStatus, setStatus, onComplete }: PagesStepProps) {
  const allPriorReady =
    stepStatus.client === "verified" &&
    stepStatus.ads === "verified" &&
    stepStatus.clarity === "verified" &&
    stepStatus.ga4 === "verified";
  const [pages, setPages] = useState<
    Array<{ id: string; url: string; spend_30d_usd_cents: number; sessions_30d: number; managed: boolean }>
  >([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [manualUrl, setManualUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);

  useEffect(() => {
    if (!allPriorReady) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allPriorReady]);

  async function load() {
    const res = await fetch(`/api/optimiser/clients/${client.id}/landing-pages`, { cache: "no-store" });
    const json = await res.json();
    if (json.ok) {
      setPages(json.data.pages);
      const next: Record<string, boolean> = {};
      for (const p of json.data.pages) {
        next[p.id] = p.managed || p.spend_30d_usd_cents > 100 * 100;
      }
      setSelected(next);
    }
  }

  async function addPage() {
    if (!manualUrl) return;
    setAdding(true);
    try {
      const res = await fetch(`/api/optimiser/clients/${client.id}/landing-pages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: manualUrl }),
      });
      const json = await res.json();
      if (json.ok) {
        setManualUrl("");
        await load();
        setStatus({ message: "Page added.", tone: "ok" });
      } else {
        setStatus({ message: json.error?.message ?? "Add failed.", tone: "err" });
      }
    } finally {
      setAdding(false);
    }
  }

  async function saveSelections() {
    setSaving(true);
    try {
      const managed = Object.entries(selected)
        .filter(([, v]) => v)
        .map(([k]) => k);
      const unmanaged = Object.entries(selected)
        .filter(([, v]) => !v)
        .map(([k]) => k);
      const res = await fetch(`/api/optimiser/clients/${client.id}/landing-pages`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ managed, unmanaged }),
      });
      const json = await res.json();
      if (json.ok) {
        setStatus({ message: `Saved (${json.data.managed_updated + json.data.unmanaged_updated} pages updated).`, tone: "ok" });
      } else {
        setStatus({ message: json.error?.message ?? "Save failed.", tone: "err" });
      }
    } finally {
      setSaving(false);
    }
  }

  async function complete() {
    setCompleting(true);
    try {
      const res = await fetch(`/api/optimiser/clients/${client.id}/onboarded`, {
        method: "POST",
      });
      const json = await res.json();
      if (json.ok) {
        setStatus({ message: "Onboarding complete.", tone: "ok" });
        onComplete();
      } else {
        setStatus({ message: json.error?.message ?? "Complete failed.", tone: "err" });
      }
    } finally {
      setCompleting(false);
    }
  }

  if (!allPriorReady) {
    return (
      <div className="rounded-lg border border-border bg-muted/40 p-6 text-sm text-muted-foreground">
        Complete the previous steps before identifying landing pages.
      </div>
    );
  }
  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-6">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-medium">Identify landing pages</h2>
        <Button onClick={complete} disabled={completing}>
          {completing ? "Completing…" : "Mark onboarding complete"}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Pages with &gt; $100/month Ads spend are pre-checked. Adjust freely.
      </p>
      <div className="rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left">
            <tr>
              <th className="px-3 py-2"> </th>
              <th className="px-3 py-2">URL</th>
              <th className="px-3 py-2 text-right">Spend (30d)</th>
              <th className="px-3 py-2 text-right">Sessions (30d)</th>
            </tr>
          </thead>
          <tbody>
            {pages.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                  No pages yet. Run a sync or add manually below.
                </td>
              </tr>
            )}
            {pages.map((p) => (
              <tr key={p.id} className="border-t border-border">
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={!!selected[p.id]}
                    onChange={(e) =>
                      setSelected((s) => ({ ...s, [p.id]: e.target.checked }))
                    }
                  />
                </td>
                <td className="px-3 py-2 font-mono text-xs">{p.url}</td>
                <td className="px-3 py-2 text-right">
                  ${(p.spend_30d_usd_cents / 100).toFixed(0)}
                </td>
                <td className="px-3 py-2 text-right">{p.sessions_30d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2">
        <Input
          placeholder="https://www.example.com/landing-page"
          value={manualUrl}
          onChange={(e) => setManualUrl(e.target.value)}
        />
        <Button onClick={addPage} disabled={adding || !manualUrl}>
          {adding ? "Adding…" : "Add page manually"}
        </Button>
      </div>
      <Button onClick={saveSelections} disabled={saving} variant="outline">
        {saving ? "Saving…" : "Save selections"}
      </Button>
      <TryAutoImportPanel clientId={client.id} />
    </div>
  );
}

function oauthErrorCopy(error: string): string {
  switch (error) {
    case "ads_oauth_aborted":
    case "ga4_oauth_aborted":
      return "Sign-in cancelled. Try again to connect.";
    case "ads_oauth_not_configured":
      return "Ads OAuth env not provisioned. Contact ops to set GOOGLE_ADS_CLIENT_ID / _SECRET / _DEVELOPER_TOKEN.";
    case "ga4_oauth_not_configured":
      return "GA4 OAuth env not provisioned. Contact ops to set GA4_CLIENT_ID / _SECRET.";
    case "ads_oauth_exchange_failed":
    case "ga4_oauth_exchange_failed":
      return "Token exchange failed. Try again; if it persists check the OAuth client config.";
    case "ads_oauth_invalid_state":
    case "ga4_oauth_invalid_state":
      return "OAuth state expired or tampered. Restart the connection.";
    case "ads_oauth_persist_failed":
    case "ga4_oauth_persist_failed":
      return "Couldn't save the connection. Try again.";
    default:
      return error;
  }
}
