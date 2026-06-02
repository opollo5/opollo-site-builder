import "server-only";

import { logger } from "@/lib/logger";
import { generateRawToken, hashToken } from "@/lib/platform/invitations";
import { getServiceRoleClient } from "@/lib/supabase";

import type {
  ConsumeResult,
  IssueInput,
  IssueResult,
  MagicLink,
  MagicLinkPurpose,
  ValidateResult,
} from "./types";
import { LINK_TTL_MS, SESSION_TTL_MS } from "./types";

// ---------------------------------------------------------------------------
// issue — create a new magic link row, return the raw token once.
// Caller is responsible for embedding the raw token in the email and
// never storing it; only the SHA-256 hash lands in the DB.
// ---------------------------------------------------------------------------
export async function issue(input: IssueInput): Promise<IssueResult> {
  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const ttl = input.ttlMs ?? LINK_TTL_MS[input.purpose];
  const expiresAt = new Date(Date.now() + ttl).toISOString();

  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("magic_links")
    .insert({
      purpose: input.purpose,
      token_hash: tokenHash,
      subject_type: input.subjectType ?? null,
      subject_id: input.subjectId ?? null,
      company_id: input.companyId ?? null,
      email: input.email ?? null,
      expires_at: expiresAt,
    })
    .select("*")
    .single();

  if (error || !data) {
    logger.error("magic_link.issue.failed", {
      err: error?.message,
      purpose: input.purpose,
    });
    throw new Error(`Failed to issue magic link: ${error?.message}`);
  }

  return { rawToken, link: data as MagicLink };
}

// ---------------------------------------------------------------------------
// validate — read-only session-aware check. Does NOT consume.
// Used by the decision API to confirm the session is still active before
// recording a decision (the page's consume() already ran on page-load).
// ---------------------------------------------------------------------------
export async function validate(rawToken: string): Promise<ValidateResult> {
  if (!rawToken || !/^[0-9a-f]{64}$/i.test(rawToken)) {
    return { valid: false, reason: "not_found" };
  }

  const tokenHash = hashToken(rawToken);
  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("magic_links")
    .select("*")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error) {
    logger.error("magic_link.validate.lookup_failed", { err: error.message });
    return { valid: false, reason: "not_found" };
  }
  if (!data) return { valid: false, reason: "not_found" };

  const link = data as MagicLink;
  if (link.revoked_at) return { valid: false, reason: "revoked" };

  const now = Date.now();

  if (link.consumed_at) {
    const sessionOk =
      link.session_expires_at &&
      new Date(link.session_expires_at).getTime() > now;
    if (!sessionOk) return { valid: false, reason: "session_expired" };
    return { valid: true, link, sessionActive: true };
  }

  if (new Date(link.expires_at).getTime() <= now) {
    return { valid: false, reason: "expired" };
  }

  return { valid: true, link, sessionActive: false };
}

// ---------------------------------------------------------------------------
// consume — first click establishes the session (sets consumed_at +
// session_expires_at). Idempotent within the session window: a reviewer
// who returns the same day gets { isNewConsumption: false } without
// error. Concurrent first-clicks are race-safe via the IS NULL guard.
// ---------------------------------------------------------------------------
export async function consume(rawToken: string): Promise<ConsumeResult> {
  if (!rawToken || !/^[0-9a-f]{64}$/i.test(rawToken)) {
    return { valid: false, reason: "not_found" };
  }

  const tokenHash = hashToken(rawToken);
  const svc = getServiceRoleClient();

  const { data: existing, error: lookupErr } = await svc
    .from("magic_links")
    .select("*")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (lookupErr) {
    logger.error("magic_link.consume.lookup_failed", { err: lookupErr.message });
    return { valid: false, reason: "not_found" };
  }
  if (!existing) return { valid: false, reason: "not_found" };

  const link = existing as MagicLink;
  if (link.revoked_at) return { valid: false, reason: "revoked" };

  const now = Date.now();

  // Already consumed — validate the session is still active (idempotent return)
  if (link.consumed_at) {
    const sessionOk =
      link.session_expires_at &&
      new Date(link.session_expires_at).getTime() > now;
    if (!sessionOk) return { valid: false, reason: "session_expired" };
    return { valid: true, link, isNewConsumption: false };
  }

  // Link expired before first click
  if (new Date(link.expires_at).getTime() <= now) {
    return { valid: false, reason: "expired" };
  }

  // First click: atomically consume with race guard (IS NULL check)
  const sessionTtl =
    SESSION_TTL_MS[link.purpose as MagicLinkPurpose] ?? 0;
  const consumedAt = new Date().toISOString();
  const sessionExpiresAt =
    sessionTtl > 0 ? new Date(now + sessionTtl).toISOString() : null;

  const { data: updated, error: updateErr } = await svc
    .from("magic_links")
    .update({ consumed_at: consumedAt, session_expires_at: sessionExpiresAt })
    .eq("id", link.id)
    .is("consumed_at", null)
    .select("*")
    .maybeSingle();

  if (updateErr) {
    logger.error("magic_link.consume.update_failed", { err: updateErr.message });
    return { valid: false, reason: "not_found" };
  }

  if (!updated) {
    // Race: concurrent request consumed first — re-fetch and return session state
    const { data: raced } = await svc
      .from("magic_links")
      .select("*")
      .eq("id", link.id)
      .single();
    if (!raced) return { valid: false, reason: "not_found" };
    const racedLink = raced as MagicLink;
    const sessionOk =
      racedLink.session_expires_at &&
      new Date(racedLink.session_expires_at).getTime() > now;
    if (!sessionOk) return { valid: false, reason: "session_expired" };
    return { valid: true, link: racedLink, isNewConsumption: false };
  }

  return { valid: true, link: updated as MagicLink, isNewConsumption: true };
}

// ---------------------------------------------------------------------------
// revoke — invalidate by link id or by subject reference.
// Idempotent: already-revoked links are unaffected.
// ---------------------------------------------------------------------------
export async function revoke(args: {
  linkId?: string;
  subjectType?: string;
  subjectId?: string;
}): Promise<{ ok: boolean; count: number }> {
  if (!args.linkId && !(args.subjectType && args.subjectId)) {
    return { ok: false, count: 0 };
  }

  const svc = getServiceRoleClient();
  const now = new Date().toISOString();

  if (args.linkId) {
    const { data, error } = await svc
      .from("magic_links")
      .update({ revoked_at: now })
      .eq("id", args.linkId)
      .is("revoked_at", null)
      .select("id");
    if (error) {
      logger.error("magic_link.revoke.by_id.failed", { err: error.message });
      return { ok: false, count: 0 };
    }
    return { ok: true, count: data?.length ?? 0 };
  }

  const { data, error } = await svc
    .from("magic_links")
    .update({ revoked_at: now })
    .eq("subject_type", args.subjectType!)
    .eq("subject_id", args.subjectId!)
    .is("revoked_at", null)
    .select("id");
  if (error) {
    logger.error("magic_link.revoke.by_subject.failed", { err: error.message });
    return { ok: false, count: 0 };
  }
  return { ok: true, count: data?.length ?? 0 };
}

// ---------------------------------------------------------------------------
// regenerate — revoke old link, issue a fresh one with regenerated_from set.
// This is the resend primitive that was missing (recon finding 5).
// The new link inherits purpose/subject/company/email from the original.
// ---------------------------------------------------------------------------
export async function regenerate(
  linkId: string,
  ttlMs?: number,
): Promise<IssueResult> {
  const svc = getServiceRoleClient();

  const { data: original, error: fetchErr } = await svc
    .from("magic_links")
    .select("*")
    .eq("id", linkId)
    .maybeSingle();

  if (fetchErr || !original) {
    throw new Error(`Magic link not found for regenerate: ${linkId}`);
  }

  const link = original as MagicLink;

  // Revoke the old link (idempotent if already revoked)
  await svc
    .from("magic_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", linkId)
    .is("revoked_at", null);

  // Issue fresh link pointing back at the original
  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const resolvedTtl = ttlMs ?? LINK_TTL_MS[link.purpose as MagicLinkPurpose];
  const expiresAt = new Date(Date.now() + resolvedTtl).toISOString();

  const { data: newLink, error: insertErr } = await svc
    .from("magic_links")
    .insert({
      purpose: link.purpose,
      token_hash: tokenHash,
      subject_type: link.subject_type,
      subject_id: link.subject_id,
      company_id: link.company_id,
      email: link.email,
      expires_at: expiresAt,
      regenerated_from: linkId,
    })
    .select("*")
    .single();

  if (insertErr || !newLink) {
    throw new Error(`Failed to regenerate magic link: ${insertErr?.message}`);
  }

  return { rawToken, link: newLink as MagicLink };
}

// Re-exported for callers that need to hash a raw token themselves
export { hashToken };
