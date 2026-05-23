"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { VOICE_TONE_LABELS, type VoiceTone } from "@/lib/cap/voice-tone-labels";
import type { CapVoiceProfile } from "@/lib/cap/voice-profiles";
import type { CapSubscription, CapTier, CapStatus } from "@/lib/cap/subscriptions";

type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

interface Props {
  companyId: string;
  initialSubscription: CapSubscription | null;
  initialVoiceProfiles: CapVoiceProfile[];
}

const TIER_LABELS: Record<CapTier, string> = {
  starter: "Starter",
  growth: "Growth",
  agency: "Agency",
};

const STATUS_BADGE_TONE: Record<CapStatus, "success" | "info" | "warning" | "error" | "neutral"> = {
  trial: "info",
  active: "success",
  paused: "warning",
  cancelled: "error",
};

const TONES = Object.entries(VOICE_TONE_LABELS) as [VoiceTone, string][];

const EMPTY_PROFILE_FORM = {
  name: "",
  tone: "professional-friendly" as VoiceTone,
  industry: "",
  targetAudience: "",
  bannedWords: "",
  onBrandPhrases: "",
  referencePosts: "",
};

export function CapSubscriptionPanel({ companyId, initialSubscription, initialVoiceProfiles }: Props) {
  const [subscription, setSubscription] = useState<CapSubscription | null>(initialSubscription);
  const [voiceProfiles, setVoiceProfiles] = useState<CapVoiceProfile[]>(initialVoiceProfiles);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showActivateForm, setShowActivateForm] = useState(false);
  const [showProfileForm, setShowProfileForm] = useState(false);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [profileForm, setProfileForm] = useState(EMPTY_PROFILE_FORM);
  const [newTier, setNewTier] = useState<CapTier>("starter");
  const [newStatus, setNewStatus] = useState<CapStatus>("trial");
  const [newCap, setNewCap] = useState("200");
  const [objectiveTemplate, setObjectiveTemplate] = useState(
    initialSubscription?.monthly_objective_template ?? "",
  );
  const [savingTemplate, setSavingTemplate] = useState(false);

  async function handleActivate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await fetch("/api/platform/cap/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company_id: companyId,
        tier: newTier,
        status: newStatus,
        monthly_cost_cap_usd: parseFloat(newCap) || 200,
      }),
    });
    const json = (await res.json()) as ApiResponse<CapSubscription>;
    setBusy(false);
    if (!res.ok || !json.ok) {
      setError(!json.ok ? json.error.message : "Failed to activate CAP.");
      return;
    }
    setSubscription(json.data);
    setShowActivateForm(false);
  }

  async function handleSaveObjectiveTemplate(e: React.FormEvent) {
    e.preventDefault();
    if (!subscription) return;
    setError(null);
    setSavingTemplate(true);
    const res = await fetch(`/api/platform/cap/subscriptions/${subscription.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ monthly_objective_template: objectiveTemplate.trim() || null }),
    });
    const json = (await res.json()) as ApiResponse<CapSubscription>;
    setSavingTemplate(false);
    if (!res.ok || !json.ok) {
      setError(!json.ok ? json.error.message : "Failed to save objective template.");
      return;
    }
    setSubscription(json.data);
  }

  function startEditProfile(profile: CapVoiceProfile) {
    setEditingProfileId(profile.id);
    setProfileForm({
      name: profile.name,
      tone: profile.tone,
      industry: profile.industry,
      targetAudience: profile.target_audience,
      bannedWords: profile.banned_words.join(", "),
      onBrandPhrases: profile.on_brand_phrases.join(", "),
      referencePosts: profile.reference_posts.join("\n"),
    });
    setShowProfileForm(true);
  }

  function resetProfileForm() {
    setEditingProfileId(null);
    setProfileForm(EMPTY_PROFILE_FORM);
    setShowProfileForm(false);
  }

  function splitCSV(val: string): string[] {
    return val.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  }

  async function handleProfileSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!subscription) return;
    setError(null);
    setBusy(true);

    const payload = {
      name: profileForm.name.trim(),
      tone: profileForm.tone,
      industry: profileForm.industry.trim(),
      target_audience: profileForm.targetAudience.trim(),
      banned_words: splitCSV(profileForm.bannedWords),
      on_brand_phrases: splitCSV(profileForm.onBrandPhrases),
      reference_posts: splitCSV(profileForm.referencePosts),
    };

    let res: Response;
    if (editingProfileId) {
      res = await fetch(
        `/api/platform/cap/subscriptions/${subscription.id}/voice-profiles/${editingProfileId}`,
        { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
      );
    } else {
      res = await fetch(`/api/platform/cap/subscriptions/${subscription.id}/voice-profiles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, is_default: voiceProfiles.length === 0 }),
      });
    }

    const json = (await res.json()) as ApiResponse<CapVoiceProfile>;
    setBusy(false);

    if (!res.ok || !json.ok) {
      setError(!json.ok ? json.error.message : "Failed to save voice profile.");
      return;
    }

    if (editingProfileId) {
      setVoiceProfiles((prev) =>
        prev.map((p) => (p.id === editingProfileId ? { ...p, ...payload, banned_words: splitCSV(profileForm.bannedWords), on_brand_phrases: splitCSV(profileForm.onBrandPhrases), reference_posts: splitCSV(profileForm.referencePosts) } : p)),
      );
    } else {
      setVoiceProfiles((prev) => [...prev, json.data]);
    }

    resetProfileForm();
  }

  async function handleDeleteProfile(profileId: string) {
    if (!subscription) return;
    if (!confirm("Delete this voice profile?")) return;
    setError(null);
    setBusy(true);
    const res = await fetch(
      `/api/platform/cap/subscriptions/${subscription.id}/voice-profiles/${profileId}`,
      { method: "DELETE" },
    );
    setBusy(false);
    if (!res.ok) {
      setError("Failed to delete voice profile.");
      return;
    }
    setVoiceProfiles((prev) => prev.filter((p) => p.id !== profileId));
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
          {error}
        </div>
      )}

      {/* Subscription status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>CAP Subscription</span>
            {subscription && (
              <Badge tone={STATUS_BADGE_TONE[subscription.status]}>
                {subscription.status.charAt(0).toUpperCase() + subscription.status.slice(1)}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {subscription ? (
            <div className="space-y-4">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
                <dt className="text-muted-foreground">Tier</dt>
                <dd className="font-medium">{TIER_LABELS[subscription.tier]}</dd>
                <dt className="text-muted-foreground">Monthly cap</dt>
                <dd className="font-medium">${subscription.monthly_cost_cap_usd.toFixed(2)}</dd>
                <dt className="text-muted-foreground">Approval required</dt>
                <dd className="font-medium">{subscription.approval_required ? "Yes" : "No"}</dd>
                <dt className="text-muted-foreground">Subscription ID</dt>
                <dd className="font-mono text-xs">{subscription.id}</dd>
              </dl>
              <form onSubmit={handleSaveObjectiveTemplate} className="space-y-2 border-t pt-4">
                <div className="space-y-1">
                  <label htmlFor="cap-objective" className="text-sm font-medium">
                    Default monthly objective template
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Used when monthly campaigns auto-generate. You can override per-campaign. Be
                    specific: describe the goal, audience, and tone in one sentence.
                  </p>
                </div>
                <Textarea
                  id="cap-objective"
                  placeholder="e.g. Drive LinkedIn engagement and inbound leads for our Managed IT Services team targeting SMB IT managers in the Pacific Northwest."
                  rows={3}
                  maxLength={500}
                  value={objectiveTemplate}
                  onChange={(e) => setObjectiveTemplate(e.target.value)}
                  data-testid="cap-objective-template"
                />
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{objectiveTemplate.length}/500</span>
                  <Button type="submit" size="sm" disabled={savingTemplate}>
                    {savingTemplate ? "Saving…" : "Save template"}
                  </Button>
                </div>
              </form>
            </div>
          ) : showActivateForm ? (
            <form onSubmit={handleActivate} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <label htmlFor="cap-tier" className="text-sm font-medium">Tier</label>
                  <select
                    id="cap-tier"
                    value={newTier}
                    onChange={(e) => setNewTier(e.target.value as CapTier)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    {(Object.keys(TIER_LABELS) as CapTier[]).map((t) => (
                      <option key={t} value={t}>{TIER_LABELS[t]}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label htmlFor="cap-status" className="text-sm font-medium">Status</label>
                  <select
                    id="cap-status"
                    value={newStatus}
                    onChange={(e) => setNewStatus(e.target.value as CapStatus)}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    {(["trial", "active"] as CapStatus[]).map((s) => (
                      <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label htmlFor="cap-cost" className="text-sm font-medium">Monthly cap (USD)</label>
                  <Input
                    id="cap-cost"
                    type="number"
                    min="0"
                    step="0.01"
                    value={newCap}
                    onChange={(e) => setNewCap(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={busy}>Enable CAP</Button>
                <Button type="button" variant="ghost" onClick={() => setShowActivateForm(false)}>Cancel</Button>
              </div>
            </form>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                CAP is not enabled for this company. Enable it to start generating automated LinkedIn content.
              </p>
              <Button onClick={() => setShowActivateForm(true)}>Enable CAP</Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Missing template warning */}
      {subscription && !subscription.monthly_objective_template && (
        <div
          className="rounded-md border border-warning-border bg-warning-bg p-3 text-sm text-warning-fg"
          role="alert"
          data-testid="cap-missing-template-warning"
        >
          <span className="font-medium">Monthly objective template not set.</span>{" "}
          Auto-generation will skip this company until a template is saved above.
        </div>
      )}

      {/* Voice profiles */}
      {subscription && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span>Voice Profiles</span>
              <Button size="sm" onClick={() => { resetProfileForm(); setShowProfileForm(true); }}>
                Add profile
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {voiceProfiles.length === 0 && !showProfileForm && (
              <p className="text-sm text-muted-foreground">
                No voice profiles yet. Add one to enable content generation.
              </p>
            )}

            {voiceProfiles.map((profile) => (
              <div key={profile.id} className="rounded-md border p-4 text-sm space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    {profile.name}
                    {profile.is_default && (
                      <Badge tone="neutral" className="ml-2 text-xs">Default</Badge>
                    )}
                  </span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => startEditProfile(profile)}>Edit</Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => void handleDeleteProfile(profile.id)}
                      disabled={busy}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
                <p className="text-muted-foreground">
                  {VOICE_TONE_LABELS[profile.tone]} · {profile.industry} · {profile.target_audience}
                </p>
              </div>
            ))}

            {showProfileForm && (
              <form onSubmit={handleProfileSubmit} className="rounded-md border p-4 space-y-4">
                <h3 className="font-medium text-sm">
                  {editingProfileId ? "Edit voice profile" : "New voice profile"}
                </h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label htmlFor="vp-name" className="text-sm font-medium">Name</label>
                    <Input
                      id="vp-name"
                      placeholder="e.g. Acme IT — LinkedIn"
                      value={profileForm.name}
                      onChange={(e) => setProfileForm((f) => ({ ...f, name: e.target.value }))}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="vp-tone" className="text-sm font-medium">Tone</label>
                    <select
                      id="vp-tone"
                      value={profileForm.tone}
                      onChange={(e) => setProfileForm((f) => ({ ...f, tone: e.target.value as VoiceTone }))}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      {TONES.map(([v, label]) => (
                        <option key={v} value={v}>{label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="vp-industry" className="text-sm font-medium">Industry</label>
                    <Input
                      id="vp-industry"
                      placeholder="e.g. Managed IT Services"
                      value={profileForm.industry}
                      onChange={(e) => setProfileForm((f) => ({ ...f, industry: e.target.value }))}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="vp-audience" className="text-sm font-medium">Target audience</label>
                    <Input
                      id="vp-audience"
                      placeholder="e.g. SMB IT managers and decision-makers"
                      value={profileForm.targetAudience}
                      onChange={(e) => setProfileForm((f) => ({ ...f, targetAudience: e.target.value }))}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="vp-banned" className="text-sm font-medium">Banned words (comma-separated)</label>
                    <Input
                      id="vp-banned"
                      placeholder="synergy, leverage, paradigm"
                      value={profileForm.bannedWords}
                      onChange={(e) => setProfileForm((f) => ({ ...f, bannedWords: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="vp-onbrand" className="text-sm font-medium">On-brand phrases (comma-separated)</label>
                    <Input
                      id="vp-onbrand"
                      placeholder="peace of mind, proactive support"
                      value={profileForm.onBrandPhrases}
                      onChange={(e) => setProfileForm((f) => ({ ...f, onBrandPhrases: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label htmlFor="vp-refs" className="text-sm font-medium">Reference posts (one per line)</label>
                  <Textarea
                    id="vp-refs"
                    placeholder="Paste example LinkedIn posts here, one per line…"
                    rows={4}
                    value={profileForm.referencePosts}
                    onChange={(e) => setProfileForm((f) => ({ ...f, referencePosts: e.target.value }))}
                  />
                </div>
                <div className="flex gap-2">
                  <Button type="submit" disabled={busy}>
                    {editingProfileId ? "Save changes" : "Create profile"}
                  </Button>
                  <Button type="button" variant="ghost" onClick={resetProfileForm}>Cancel</Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
