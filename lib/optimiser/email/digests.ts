import "server-only";

import { getServiceRoleClient } from "@/lib/supabase";
import { logger } from "@/lib/logger";

import { escapeHtml, sendEmail } from "./send";

// ---------------------------------------------------------------------------
// Email cadence (spec §9.11).
//
// Two cadences:
//   - critical_issues: every Monday (default) / twice weekly for clients
//     within the 30-day onboarded window
//   - full_proposals: fortnightly Mondays / weekly within 30-day window
//
// The cron handler /api/cron/optimiser-email-digest runs daily and
// decides which kind of digest to send for which client based on:
//   - day of week
//   - client.onboarded_at age
//   - last digest sent (Slice 6 doesn't track per-recipient send
//     history; idempotency comes from "send only on the right day").
//
// Phase 1 ships both digests; the email body is HTML + plain-text.
// Recipients = primary_contact_email on opt_clients (Phase 1.5 will
// add per-staff routing).
// ---------------------------------------------------------------------------

export type DigestKind = "critical" | "proposals";

export type DigestDecision = {
  client_id: string;
  client_name: string;
  recipient: string;
  kind: DigestKind;
  /** Reason this client landed on this kind today (for telemetry). */
  reason: string;
};

export async function planDigests(
  now: Date = new Date(),
): Promise<DigestDecision[]> {
  const supabase = getServiceRoleClient();
  const { data: clients, error } = await supabase
    .from("opt_clients")
    .select("id, name, primary_contact_email, onboarded_at")
    .is("deleted_at", null)
    .not("onboarded_at", "is", null);
  if (error) {
    throw new Error(`planDigests: ${error.message}`);
  }

  const out: DigestDecision[] = [];
  const dayOfWeek = now.getUTCDay(); // 0=Sun, 1=Mon, ...
  const isoWeek = isoWeekNumber(now);
  const isMonday = dayOfWeek === 1;
  const isThursday = dayOfWeek === 4;

  for (const c of clients ?? []) {
    if (!c.primary_contact_email) continue;
    const onboardedAt = new Date(c.onboarded_at as string);
    const ageDays = Math.floor(
      (now.getTime() - onboardedAt.getTime()) / (24 * 60 * 60 * 1000),
    );
    const accelerated = ageDays <= 30;

    // Critical digest:
    //   accelerated → Mondays + Thursdays
    //   default     → Mondays only
    if (isMonday || (accelerated && isThursday)) {
      out.push({
        client_id: c.id as string,
        client_name: c.name as string,
        recipient: c.primary_contact_email as string,
        kind: "critical",
        reason: accelerated
          ? `accelerated 30d (age ${ageDays}d) ${isMonday ? "monday" : "thursday"}`
          : "monday",
      });
    }
    // Proposals digest:
    //   accelerated → every Monday
    //   default     → every other Monday (even ISO weeks)
    if (isMonday) {
      const send =
        accelerated || isoWeek % 2 === 0;
      if (send) {
        out.push({
          client_id: c.id as string,
          client_name: c.name as string,
          recipient: c.primary_contact_email as string,
          kind: "proposals",
          reason: accelerated
            ? `accelerated 30d (age ${ageDays}d) weekly`
            : `fortnight (week ${isoWeek})`,
        });
      }
    }
  }
  return out;
}

export type DigestSendResult = {
  client_id: string;
  kind: DigestKind;
  ok: boolean;
  error?: string;
};

export async function sendDigest(
  decision: DigestDecision,
  now: Date = new Date(),
): Promise<DigestSendResult> {
  try {
    if (decision.kind === "critical") {
      const html = await buildCriticalHtml(decision, now);
      const text = await buildCriticalText(decision, now);
      const subject = await buildCriticalSubject(decision, now);
      const r = await sendEmail({
        to: decision.recipient,
        subject,
        html,
        text,
        category: "optimiser.critical_issues",
      });
      return {
        client_id: decision.client_id,
        kind: decision.kind,
        ok: r.ok,
        error: r.error,
      };
    }
    const html = await buildProposalsHtml(decision, now);
    const text = await buildProposalsText(decision, now);
    const subject = await buildProposalsSubject(decision, now);
    const r = await sendEmail({
      to: decision.recipient,
      subject,
      html,
      text,
      category: "optimiser.proposals_digest",
    });
    return {
      client_id: decision.client_id,
      kind: decision.kind,
      ok: r.ok,
      error: r.error,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("optimiser.email.digest_failed", {
      client_id: decision.client_id,
      kind: decision.kind,
      error: message,
    });
    return {
      client_id: decision.client_id,
      kind: decision.kind,
      ok: false,
      error: message,
    };
  }
}

// ---------------------------------------------------------------------------
// Critical-issues digest body
// ---------------------------------------------------------------------------

type CriticalContent = {
  active_alerts: Array<{ url: string; alerts: string[] }>;
  unhealthy_transitions: Array<{ url: string; from: string; to: string; at: string }>;
  stale_ingestion: Array<{ source: string; last_synced_at: string | null; status: string }>;
  auto_reverted: Array<{ proposal_id: string; reason: string; at: string }>;
};

async function gatherCritical(clientId: string): Promise<CriticalContent> {
  const supabase = getServiceRoleClient();
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 7);
  const sinceIso = since.toISOString();

  const [alertsRes, transitionsRes, staleRes, revertedRes] = await Promise.all([
    supabase
      .from("opt_landing_pages")
      .select("url, active_technical_alerts")
      .eq("client_id", clientId)
      .eq("managed", true)
      .is("deleted_at", null),
    supabase
      .from("opt_change_log")
      .select("landing_page_id, details, created_at")
      .eq("client_id", clientId)
      .eq("event", "page_state_transition")
      .gte("created_at", sinceIso),
    supabase
      .from("opt_client_credentials")
      .select("source, last_synced_at, status")
      .eq("client_id", clientId)
      .neq("status", "connected"),
    supabase
      .from("opt_proposals")
      .select("id, status, updated_at, change_set")
      .eq("client_id", clientId)
      .eq("status", "applied_then_reverted")
      .gte("updated_at", sinceIso),
  ]);

  const active_alerts =
    (alertsRes.data ?? [])
      .filter(
        (p) =>
          Array.isArray(p.active_technical_alerts) &&
          (p.active_technical_alerts as unknown[]).length > 0,
      )
      .map((p) => ({
        url: p.url as string,
        alerts: (p.active_technical_alerts as string[]) ?? [],
      }));

  const transitionPageIds = new Set(
    (transitionsRes.data ?? []).map((t) => t.landing_page_id as string),
  );
  const { data: transitionPages } = transitionPageIds.size
    ? await supabase
        .from("opt_landing_pages")
        .select("id, url")
        .in("id", [...transitionPageIds])
    : { data: [] as Array<{ id: string; url: string }> };
  const urlByPageId = new Map(
    (transitionPages ?? []).map((p) => [p.id as string, p.url as string]),
  );
  const unhealthy_transitions =
    (transitionsRes.data ?? [])
      .filter((t) => {
        const det = (t.details ?? {}) as { from?: string; to?: string };
        return det.from === "healthy" && det.to !== "healthy";
      })
      .map((t) => ({
        url:
          urlByPageId.get(t.landing_page_id as string) ??
          (t.landing_page_id as string),
        from: ((t.details ?? {}) as { from?: string }).from ?? "?",
        to: ((t.details ?? {}) as { to?: string }).to ?? "?",
        at: t.created_at as string,
      }));

  const fiveDaysAgo = new Date();
  fiveDaysAgo.setUTCDate(fiveDaysAgo.getUTCDate() - 5);
  const stale_ingestion =
    (staleRes.data ?? [])
      .filter((c) => {
        const ts = c.last_synced_at
          ? new Date(c.last_synced_at as string).getTime()
          : 0;
        return ts < fiveDaysAgo.getTime();
      })
      .map((c) => ({
        source: c.source as string,
        last_synced_at: (c.last_synced_at as string | null) ?? null,
        status: c.status as string,
      }));

  const auto_reverted =
    (revertedRes.data ?? []).map((p) => ({
      proposal_id: p.id as string,
      reason: ((p.change_set ?? {}) as { rollback_reason?: string }).rollback_reason ?? "regression",
      at: p.updated_at as string,
    }));

  return {
    active_alerts,
    unhealthy_transitions,
    stale_ingestion,
    auto_reverted,
  };
}

async function buildCriticalSubject(
  decision: DigestDecision,
  now: Date,
): Promise<string> {
  const c = await gatherCritical(decision.client_id);
  const total =
    c.active_alerts.length +
    c.unhealthy_transitions.length +
    c.stale_ingestion.length +
    c.auto_reverted.length;
  const datePart = now.toISOString().slice(0, 10);
  return `[Optimiser] ${decision.client_name} — ${total} critical issue${total === 1 ? "" : "s"} (${datePart})`;
}

async function buildCriticalText(
  decision: DigestDecision,
  _now: Date,
): Promise<string> {
  void _now;
  const c = await gatherCritical(decision.client_id);
  const lines: string[] = [];
  lines.push(`Optimiser critical-issues digest — ${decision.client_name}`);
  lines.push("");
  if (c.active_alerts.length > 0) {
    lines.push(`Active technical alerts (${c.active_alerts.length}):`);
    for (const a of c.active_alerts) {
      lines.push(`  - ${a.url}: ${a.alerts.join(", ")}`);
    }
    lines.push("");
  }
  if (c.unhealthy_transitions.length > 0) {
    lines.push(`Pages that left healthy state (${c.unhealthy_transitions.length}):`);
    for (const t of c.unhealthy_transitions) {
      lines.push(`  - ${t.url}: healthy → ${t.to} at ${t.at}`);
    }
    lines.push("");
  }
  if (c.stale_ingestion.length > 0) {
    lines.push(`Data ingestion failures (${c.stale_ingestion.length}):`);
    for (const s of c.stale_ingestion) {
      lines.push(
        `  - ${s.source}: status=${s.status}, last_synced=${s.last_synced_at ?? "never"}`,
      );
    }
    lines.push("");
  }
  if (c.auto_reverted.length > 0) {
    lines.push(`Auto-reverted rollouts (${c.auto_reverted.length}):`);
    for (const r of c.auto_reverted) {
      lines.push(`  - ${r.proposal_id}: ${r.reason} at ${r.at}`);
    }
    lines.push("");
  }
  if (lines.length <= 2) {
    lines.push("Nothing critical this week. ✅");
  }
  return lines.join("\n");
}

async function buildCriticalHtml(
  decision: DigestDecision,
  now: Date,
): Promise<string> {
  const c = await gatherCritical(decision.client_id);
  const sections: string[] = [];
  if (c.active_alerts.length > 0) {
    sections.push(
      `<h2>Active technical alerts (${c.active_alerts.length})</h2><ul>${c.active_alerts
        .map(
          (a) =>
            `<li><code>${escapeHtml(a.url)}</code>: ${a.alerts.map((x) => escapeHtml(x)).join(", ")}</li>`,
        )
        .join("")}</ul>`,
    );
  }
  if (c.unhealthy_transitions.length > 0) {
    sections.push(
      `<h2>Pages that left healthy state (${c.unhealthy_transitions.length})</h2><ul>${c.unhealthy_transitions
        .map(
          (t) =>
            `<li><code>${escapeHtml(t.url)}</code>: healthy → ${escapeHtml(t.to)} at ${escapeHtml(t.at)}</li>`,
        )
        .join("")}</ul>`,
    );
  }
  if (c.stale_ingestion.length > 0) {
    sections.push(
      `<h2>Data ingestion failures (${c.stale_ingestion.length})</h2><ul>${c.stale_ingestion
        .map(
          (s) =>
            `<li>${escapeHtml(s.source)}: status=${escapeHtml(s.status)}, last sync ${escapeHtml(s.last_synced_at ?? "never")}</li>`,
        )
        .join("")}</ul>`,
    );
  }
  if (c.auto_reverted.length > 0) {
    sections.push(
      `<h2>Auto-reverted rollouts (${c.auto_reverted.length})</h2><ul>${c.auto_reverted
        .map(
          (r) =>
            `<li>${escapeHtml(r.proposal_id)}: ${escapeHtml(r.reason)} at ${escapeHtml(r.at)}</li>`,
        )
        .join("")}</ul>`,
    );
  }
  if (sections.length === 0) {
    sections.push(`<p>Nothing critical this week. ✅</p>`);
  }
  return `<!doctype html><html><body style="font-family: -apple-system,Segoe UI,Roboto,sans-serif">
<h1>Optimiser critical-issues — ${escapeHtml(decision.client_name)}</h1>
<p style="color:#666">${escapeHtml(now.toUTCString())}</p>
${sections.join("\n")}
</body></html>`;
}

// ---------------------------------------------------------------------------
// Proposals digest body
// ---------------------------------------------------------------------------

type ProposalsContent = {
  pending: Array<{ id: string; headline: string; priority_score: number; risk_level: string; expires_at: string | null }>;
  new_recent: Array<{ id: string; headline: string; created_at: string; playbook: string | null }>;
  applied_recent: Array<{ id: string; headline: string; applied_at: string | null }>;
  expiring_soon: Array<{ id: string; headline: string; expires_at: string | null }>;
};

async function gatherProposals(clientId: string): Promise<ProposalsContent> {
  const supabase = getServiceRoleClient();
  const twoWeeksAgo = new Date();
  twoWeeksAgo.setUTCDate(twoWeeksAgo.getUTCDate() - 14);
  const twoDaysFromExpiry = new Date();
  twoDaysFromExpiry.setUTCDate(twoDaysFromExpiry.getUTCDate() + 2);

  const [pendingRes, newRes, appliedRes, expiringRes] = await Promise.all([
    supabase
      .from("opt_proposals")
      .select("id, headline, priority_score, risk_level, expires_at")
      .eq("client_id", clientId)
      .eq("status", "pending")
      .is("deleted_at", null)
      .order("priority_score", { ascending: false })
      .limit(30),
    supabase
      .from("opt_proposals")
      .select("id, headline, created_at, triggering_playbook_id")
      .eq("client_id", clientId)
      .gte("created_at", twoWeeksAgo.toISOString())
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("opt_proposals")
      .select("id, headline, applied_at")
      .eq("client_id", clientId)
      .in("status", ["applied", "applied_promoted"])
      .gte("applied_at", twoWeeksAgo.toISOString())
      .is("deleted_at", null)
      .order("applied_at", { ascending: false })
      .limit(20),
    supabase
      .from("opt_proposals")
      .select("id, headline, expires_at")
      .eq("client_id", clientId)
      .eq("status", "pending")
      .lte("expires_at", twoDaysFromExpiry.toISOString())
      .is("deleted_at", null)
      .order("expires_at", { ascending: true })
      .limit(20),
  ]);

  return {
    pending: (pendingRes.data ?? []).map((p) => ({
      id: p.id as string,
      headline: p.headline as string,
      priority_score: p.priority_score as number,
      risk_level: p.risk_level as string,
      expires_at: (p.expires_at as string | null) ?? null,
    })),
    new_recent: (newRes.data ?? []).map((p) => ({
      id: p.id as string,
      headline: p.headline as string,
      created_at: p.created_at as string,
      playbook: (p.triggering_playbook_id as string | null) ?? null,
    })),
    applied_recent: (appliedRes.data ?? []).map((p) => ({
      id: p.id as string,
      headline: p.headline as string,
      applied_at: (p.applied_at as string | null) ?? null,
    })),
    expiring_soon: (expiringRes.data ?? []).map((p) => ({
      id: p.id as string,
      headline: p.headline as string,
      expires_at: (p.expires_at as string | null) ?? null,
    })),
  };
}

async function buildProposalsSubject(
  decision: DigestDecision,
  now: Date,
): Promise<string> {
  const c = await gatherProposals(decision.client_id);
  return `[Optimiser] ${decision.client_name} — ${c.pending.length} pending, ${c.new_recent.length} new (${now.toISOString().slice(0, 10)})`;
}

async function buildProposalsText(
  decision: DigestDecision,
  _now: Date,
): Promise<string> {
  void _now;
  const c = await gatherProposals(decision.client_id);
  const lines: string[] = [];
  lines.push(`Optimiser proposals digest — ${decision.client_name}`);
  lines.push("");
  lines.push(`Pending (${c.pending.length}):`);
  for (const p of c.pending.slice(0, 10)) {
    lines.push(
      `  - ${p.headline} [${p.risk_level}] priority ${p.priority_score.toFixed(2)} expires ${p.expires_at ?? "—"}`,
    );
  }
  lines.push("");
  lines.push(`New in past 2 weeks (${c.new_recent.length})`);
  lines.push(`Applied in past 2 weeks (${c.applied_recent.length})`);
  if (c.expiring_soon.length > 0) {
    lines.push("");
    lines.push(`Expiring within 2 days (${c.expiring_soon.length}):`);
    for (const p of c.expiring_soon) {
      lines.push(`  - ${p.headline} (expires ${p.expires_at ?? "—"})`);
    }
  }
  return lines.join("\n");
}

async function buildProposalsHtml(
  decision: DigestDecision,
  now: Date,
): Promise<string> {
  const c = await gatherProposals(decision.client_id);
  const pendingList = c.pending
    .slice(0, 15)
    .map(
      (p) =>
        `<li><strong>${escapeHtml(p.headline)}</strong> <span style="color:#666">— ${escapeHtml(p.risk_level)}, priority ${p.priority_score.toFixed(2)}, expires ${escapeHtml(p.expires_at ?? "—")}</span></li>`,
    )
    .join("");
  const expiringList = c.expiring_soon
    .map(
      (p) =>
        `<li>${escapeHtml(p.headline)} <span style="color:#666">(expires ${escapeHtml(p.expires_at ?? "—")})</span></li>`,
    )
    .join("");
  return `<!doctype html><html><body style="font-family: -apple-system,Segoe UI,Roboto,sans-serif">
<h1>Optimiser proposals — ${escapeHtml(decision.client_name)}</h1>
<p style="color:#666">${escapeHtml(now.toUTCString())}</p>
<h2>Pending (${c.pending.length})</h2>
<ol>${pendingList}</ol>
<p>New in past 2 weeks: ${c.new_recent.length}. Applied: ${c.applied_recent.length}.</p>
${
  c.expiring_soon.length > 0
    ? `<h2>Expiring within 2 days</h2><ul>${expiringList}</ul>`
    : ""
}
</body></html>`;
}

// ISO 8601 week number (Monday-based).
function isoWeekNumber(d: Date): number {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(
    (((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7,
  );
}
