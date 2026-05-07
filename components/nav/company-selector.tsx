"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";
import { NavIcon } from "@/components/ui/nav-icon";

type Company = {
  id: string;
  name: string;
  domain: string | null;
  is_opollo_internal: boolean;
};

interface CompanySelectorProps {
  isOpolloStaff: boolean;
  companyId: string | null;
  companyName: string | null;
}

export function CompanySelector({
  isOpolloStaff,
  companyId,
  companyName,
}: CompanySelectorProps) {
  const router = useRouter();
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companiesLoading, setCompaniesLoading] = useState(false);
  const [switching, setSwitching] = useState(false);
  const selectorRef = useRef<HTMLDivElement>(null);

  async function openSelector() {
    if (!isOpolloStaff) return;
    setSelectorOpen((v) => !v);
    if (companies.length === 0 && !companiesLoading) {
      setCompaniesLoading(true);
      try {
        const res = await fetch("/api/platform/companies/list");
        const json = (await res.json()) as {
          ok: boolean;
          data?: { companies: Company[] };
        };
        if (json.ok && json.data) setCompanies(json.data.companies);
      } finally {
        setCompaniesLoading(false);
      }
    }
  }

  async function selectCompany(id: string | null) {
    if (switching) return;
    setSwitching(true);
    setSelectorOpen(false);
    try {
      await fetch("/api/platform/companies/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company_id: id }),
      });
      router.refresh();
    } finally {
      setSwitching(false);
    }
  }

  if (!isOpolloStaff) {
    return (
      <div className="flex items-center gap-2 px-3 py-2">
        <NavIcon name="apartment" size={14} className="shrink-0 text-icon-dim" />
        <span className="truncate text-sm font-medium text-foreground">
          {companyName ?? "No company"}
        </span>
      </div>
    );
  }

  return (
    <div className="relative" ref={selectorRef}>
      <button
        type="button"
        onClick={openSelector}
        disabled={switching}
        aria-haspopup="listbox"
        aria-expanded={selectorOpen}
        aria-label={`Company: ${companyName ?? "None selected"}`}
        className="group flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-smooth hover:bg-nav-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-gr"
      >
        <NavIcon
          name="apartment"
          size={14}
          className="shrink-0 text-icon-dim group-hover:text-gr"
        />
        <span
          className={cn(
            "flex-1 truncate text-left font-medium",
            companyName ? "text-foreground" : "text-m2",
          )}
        >
          {switching ? "Switching…" : (companyName ?? "Select company")}
        </span>
        <NavIcon
          name="chevrons-expand-vertical"
          size={12}
          className="shrink-0 opacity-50"
        />
      </button>

      {selectorOpen && (
        <div
          className="absolute left-0 right-0 z-50 mt-1 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-xl"
          role="listbox"
          aria-label="Select company"
        >
          <button
            role="option"
            aria-selected={!companyId}
            type="button"
            onClick={() => selectCompany(null)}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-m3 transition-colors hover:bg-muted hover:text-foreground"
          >
            {!companyId ? (
              <NavIcon name="check" size={12} className="shrink-0 text-pk" />
            ) : (
              <span className="h-3 w-3 shrink-0" aria-hidden />
            )}
            <span className="italic">No company selected</span>
          </button>
          <div className="border-t border-border" />

          {companiesLoading ? (
            <p className="px-3 py-2 text-xs text-m3">Loading…</p>
          ) : companies.length === 0 ? (
            <p className="px-3 py-2 text-xs text-m3">No companies found.</p>
          ) : (
            <ul className="max-h-64 overflow-y-auto">
              {companies.map((c) => {
                const isSelected = c.id === companyId;
                return (
                  <li key={c.id}>
                    <button
                      role="option"
                      aria-selected={isSelected}
                      type="button"
                      onClick={() => selectCompany(c.id)}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted",
                        isSelected ? "text-pk" : "text-m2 hover:text-foreground",
                      )}
                    >
                      {isSelected ? (
                        <NavIcon name="check" size={14} className="shrink-0" />
                      ) : (
                        <span className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{c.name}</p>
                        {c.domain && (
                          <p className="truncate text-xs opacity-50">{c.domain}</p>
                        )}
                      </div>
                      {c.is_opollo_internal && (
                        <span className="shrink-0 rounded px-1 py-0.5 text-xs font-medium bg-gr/20 text-gr">
                          Internal
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
