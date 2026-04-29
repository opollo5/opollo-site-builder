"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function NewClientForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [email, setEmail] = useState("");
  const [budget, setBudget] = useState(50);
  const [hostingMode, setHostingMode] = useState<
    "opollo_subdomain" | "opollo_cname" | "client_slice"
  >("opollo_subdomain");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/optimiser/clients", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          client_slug: slug,
          primary_contact_email: email || undefined,
          llm_monthly_budget_usd: Number(budget),
          hosting_mode: hostingMode,
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error?.message ?? "Create failed.");
        return;
      }
      router.push(`/optimiser/onboarding/${json.data.client.id}`);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
      <div className="space-y-2">
        <label className="block text-sm font-medium">Display name</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="space-y-2">
        <label className="block text-sm font-medium">Slug</label>
        <Input
          value={slug}
          onChange={(e) =>
            setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
          }
          required
          minLength={2}
          maxLength={41}
          placeholder="planet6"
        />
      </div>
      <div className="space-y-2">
        <label className="block text-sm font-medium">
          Primary contact email (optional)
        </label>
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <label className="block text-sm font-medium">Monthly LLM budget (USD)</label>
        <Input
          type="number"
          min={0}
          value={budget}
          onChange={(e) => setBudget(Number(e.target.value))}
        />
      </div>
      <div className="space-y-2 md:col-span-2">
        <label className="block text-sm font-medium">Hosting mode</label>
        <div className="flex flex-wrap gap-3 text-sm">
          {[
            { v: "opollo_subdomain", label: "Opollo subdomain (default)" },
            { v: "opollo_cname", label: "Branded CNAME" },
            { v: "client_slice", label: "Client WordPress slice" },
          ].map((opt) => (
            <label
              key={opt.v}
              className={`cursor-pointer rounded-md border px-3 py-2 ${
                hostingMode === opt.v ? "border-primary bg-primary/5" : "border-border"
              }`}
            >
              <input
                type="radio"
                name="hosting_mode"
                value={opt.v}
                checked={hostingMode === opt.v}
                onChange={() =>
                  setHostingMode(
                    opt.v as
                      | "opollo_subdomain"
                      | "opollo_cname"
                      | "client_slice",
                  )
                }
                className="mr-2"
              />
              {opt.label}
            </label>
          ))}
        </div>
      </div>
      {error && (
        <div className="md:col-span-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
          {error}
        </div>
      )}
      <div className="md:col-span-2">
        <Button type="submit" disabled={submitting}>
          {submitting ? "Creating…" : "Create client"}
        </Button>
      </div>
    </form>
  );
}
