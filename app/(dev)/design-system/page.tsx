import { notFound } from "next/navigation";
import {
  LinkedInIcon,
  FacebookIcon,
  InstagramIcon,
  XIcon,
  GoogleBusinessIcon,
  PinterestIcon,
  TikTokIcon,
  YouTubeIcon,
} from "@/components/icons/social";
import {
  Sparkles,
  ImagePlus,
  Smile,
  Film,
  Link2,
  Tags,
  X,
  Check,
  Loader2,
  AlertCircle,
  AlertTriangle,
  Info,
  Search,
  Calendar,
  Clock,
  CalendarClock,
  ShieldCheck,
  MoreHorizontal,
  ChevronDown,
  ArrowUpRight,
  RefreshCw,
  Trash2,
  RotateCcw,
  Send,
  ThumbsUp,
  MessageCircle,
  Repeat2,
} from "lucide-react";

export default function DesignSystemPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return (
    <div
      style={{
        fontFamily: "var(--c3-font-body)",
        background: "var(--c3-canvas)",
        color: "var(--c3-ink)",
        minHeight: "100vh",
        padding: "48px 32px 96px",
      }}
    >
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ marginBottom: 64, paddingBottom: 32, borderBottom: "1px solid var(--c3-border)" }}>
          <p style={{ fontFamily: "var(--c3-font-mono)", fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--c3-ink-3)", marginBottom: 12 }}>
            DESIGN SYSTEM · COMPOSER V3
          </p>
          <h1 style={{ fontSize: 36, fontWeight: 600, letterSpacing: "-0.02em", marginBottom: 8 }}>
            Design System Reference
          </h1>
          <p style={{ fontSize: 15, color: "var(--c3-ink-3)", lineHeight: 1.55 }}>
            All v3 tokens, typography, components, and icons verified on this page. Dev-only — returns 404 in production.
          </p>
        </div>

        {/* Color swatches */}
        <Section title="Colors — Neutral scale">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 16 }}>
            {[
              { name: "--c3-canvas", hex: "#FAFAFA" },
              { name: "--c3-surface", hex: "#FFFFFF" },
              { name: "--c3-surface-2", hex: "#F4F4F5" },
              { name: "--c3-surface-3", hex: "#E9E9EB" },
              { name: "--c3-surface-4", hex: "#D4D4D8" },
              { name: "--c3-border", hex: "#E4E4E7" },
              { name: "--c3-border-2", hex: "#D4D4D8" },
              { name: "--c3-border-3", hex: "#A1A1AA" },
              { name: "--c3-ink", hex: "#0A0A0A" },
              { name: "--c3-ink-2", hex: "#27272A" },
              { name: "--c3-ink-3", hex: "#52525B" },
              { name: "--c3-ink-4", hex: "#71717A" },
              { name: "--c3-ink-5", hex: "#A1A1AA" },
            ].map(({ name, hex }) => (
              <Swatch key={name} name={name} hex={hex} />
            ))}
          </div>
        </Section>

        <Section title="Colors — Brand (Electric Emerald)">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 16 }}>
            {[
              { name: "--c3-brand-50", hex: "#ECFDF5" },
              { name: "--c3-brand-100", hex: "#D1FAE5" },
              { name: "--c3-brand-200", hex: "#A7F3D0" },
              { name: "--c3-brand-300", hex: "#6EE7B7" },
              { name: "--c3-brand-400", hex: "#34D399" },
              { name: "--c3-brand-500 PRIMARY", hex: "#00BF66" },
              { name: "--c3-brand-600", hex: "#00A659" },
              { name: "--c3-brand-700", hex: "#008A4A" },
              { name: "--c3-brand-800", hex: "#006D3B" },
              { name: "--c3-brand-900", hex: "#054F2D" },
            ].map(({ name, hex }) => (
              <Swatch key={name} name={name} hex={hex} />
            ))}
          </div>
        </Section>

        <Section title="Colors — Semantic">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
            {[
              { name: "success-bg", hex: "#ECFDF5" },
              { name: "warning-bg", hex: "#FFFBEB" },
              { name: "danger-bg", hex: "#FEF2F2" },
              { name: "info-bg", hex: "#EFF6FF" },
              { name: "success-line", hex: "#00BF66" },
              { name: "warning-line", hex: "#F59E0B" },
              { name: "danger-line", hex: "#DC2626" },
              { name: "info-line", hex: "#3B82F6" },
            ].map(({ name, hex }) => (
              <Swatch key={name} name={name} hex={hex} />
            ))}
          </div>
        </Section>

        {/* Typography */}
        <Section title="Typography — Geist (display + body)">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[
              { size: "36px / 700", weight: 700, label: "2xl — Page heading", fontSize: 36 },
              { size: "22px / 600", weight: 600, label: "xl — Modal title", fontSize: 22 },
              { size: "18px / 600", weight: 600, label: "lg — Section title", fontSize: 18 },
              { size: "16px / 400", weight: 400, label: "md — Preview content", fontSize: 16 },
              { size: "15px / 400", weight: 400, label: "base — Primary body", fontSize: 15 },
              { size: "13px / 500", weight: 500, label: "sm — Secondary UI, labels", fontSize: 13 },
              { size: "11px / 500", weight: 500, label: "xs — Metadata, badges", fontSize: 11 },
            ].map(({ size, weight, label, fontSize }) => (
              <div key={label} style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
                <span style={{ fontFamily: "var(--c3-font-mono)", fontSize: 10, color: "var(--c3-ink-4)", width: 100, flexShrink: 0 }}>{size}</span>
                <span style={{ fontFamily: "var(--c3-font-body)", fontSize, fontWeight: weight }}>
                  {label} — The quick brown fox jumps over the lazy dog.
                </span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Typography — Geist Mono (trace IDs, char counts, UTM)">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span data-testid="c3-font-mono-sample" style={{ fontFamily: "var(--c3-font-mono)", fontSize: 11, color: "var(--c3-ink-3)", letterSpacing: "0.04em" }}>
              trace_id: 01HRK3J2VBXY7Q8MWZNT6PSFD
            </span>
            <span style={{ fontFamily: "var(--c3-font-mono)", fontSize: 11, color: "var(--c3-ink-3)" }}>
              280 / 280 chars — X limit
            </span>
            <span style={{ fontFamily: "var(--c3-font-mono)", fontSize: 11.5, color: "var(--c3-ink-2)" }}>
              https://example.com/?<span style={{ color: "var(--c3-brand-700)" }}>utm_source</span>=<span style={{ color: "#1E40AF" }}>linkedin</span>&amp;<span style={{ color: "var(--c3-brand-700)" }}>utm_campaign</span>=<span style={{ color: "#1E40AF" }}>spring-2026</span>
            </span>
          </div>
        </Section>

        {/* Buttons */}
        <Section title="Buttons">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
            <Btn variant="primary">Post now</Btn>
            <Btn variant="primary" disabled>Post now (disabled)</Btn>
            <Btn variant="secondary">Save draft</Btn>
            <Btn variant="secondary" disabled>Save draft (disabled)</Btn>
            <Btn variant="ghost">Cancel</Btn>
            <Btn variant="danger">Delete</Btn>
            <Btn variant="primary" size="sm">Small</Btn>
            <Btn variant="primary" size="lg">Large</Btn>
          </div>
        </Section>

        {/* Profile chips */}
        <Section title="Profile Chips">
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <ProfileChip platform="linkedin" name="Acme Corp" handle="@acme" selected={false} />
            <ProfileChip platform="facebook" name="Acme Corp" handle="@acme" selected />
            <ProfileChip platform="instagram" name="acme_official" handle="@acme_official" selected={false} />
            <ProfileChip platform="x" name="Acme" handle="@acmecorp" selected={false} />
            <ProfileChip platform="gbp" name="Acme Inc" handle="Google Business" selected={false} />
          </div>
        </Section>

        {/* Toasts */}
        <Section title="Toasts">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Toast type="default" title="Draft saved" desc="Your changes are saved automatically." />
            <Toast type="success" title="Post scheduled" desc="Your post will go live on May 26 at 9:00 AM." />
            <Toast type="error" title="Upload failed" desc="File exceeds 8MB. Please try a smaller image." traceId="01HRK-ERR-UPLOAD" />
          </div>
        </Section>

        {/* Icons — Lucide */}
        <Section title="Icons — Lucide React (16px, strokeWidth 1.75)">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "center" }}>
            {[
              ["AI assistant", <Sparkles key="sp" size={16} strokeWidth={1.75} />],
              ["Media upload", <ImagePlus key="ip" size={16} strokeWidth={1.75} />],
              ["Emoji picker", <Smile key="sm" size={16} strokeWidth={1.75} />],
              ["GIF picker", <Film key="fi" size={16} strokeWidth={1.75} />],
              ["Link preview", <Link2 key="l2" size={16} strokeWidth={1.75} />],
              ["UTM tags", <Tags key="tg" size={16} strokeWidth={1.75} />],
              ["Close", <X key="x" size={16} strokeWidth={1.75} />],
              ["Confirm", <Check key="ck" size={16} strokeWidth={1.75} />],
              ["Loading", <Loader2 key="ld" size={16} strokeWidth={1.75} />],
              ["Error", <AlertCircle key="ac" size={16} strokeWidth={1.75} />],
              ["Warning", <AlertTriangle key="at" size={16} strokeWidth={1.75} />],
              ["Info", <Info key="in" size={16} strokeWidth={1.75} />],
              ["Search", <Search key="sr" size={16} strokeWidth={1.75} />],
              ["Calendar", <Calendar key="ca" size={16} strokeWidth={1.75} />],
              ["Clock", <Clock key="cl" size={16} strokeWidth={1.75} />],
              ["Schedule", <CalendarClock key="cc" size={16} strokeWidth={1.75} />],
              ["Approval", <ShieldCheck key="sc" size={16} strokeWidth={1.75} />],
              ["More", <MoreHorizontal key="mh" size={16} strokeWidth={1.75} />],
              ["Expand", <ChevronDown key="cd" size={16} strokeWidth={1.75} />],
              ["External", <ArrowUpRight key="ar" size={16} strokeWidth={1.75} />],
              ["Refresh", <RefreshCw key="rw" size={16} strokeWidth={1.75} />],
              ["Delete", <Trash2 key="tr" size={16} strokeWidth={1.75} />],
              ["Undo", <RotateCcw key="rc" size={16} strokeWidth={1.75} />],
              ["Send", <Send key="sn" size={16} strokeWidth={1.75} />],
              ["Like", <ThumbsUp key="tu" size={16} strokeWidth={1.75} />],
              ["Comment", <MessageCircle key="mc" size={16} strokeWidth={1.75} />],
              ["Repost", <Repeat2 key="rp" size={16} strokeWidth={1.75} />],
            ].map(([label, icon]) => (
              <div key={label as string} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                <div style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--c3-surface)", border: "1px solid var(--c3-border)", borderRadius: "var(--c3-radius-md)", color: "var(--c3-ink-2)" }}>
                  {icon}
                </div>
                <span style={{ fontSize: 9, color: "var(--c3-ink-4)", fontFamily: "var(--c3-font-mono)", textAlign: "center" }}>{label as string}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* Icons — Brand */}
        <Section title="Icons — Social Platform Brand SVGs">
          <div data-testid="c3-brand-icons" style={{ display: "flex", flexWrap: "wrap", gap: 20, alignItems: "center" }}>
            {[
              ["LinkedIn", <LinkedInIcon key="li" size={32} />],
              ["Facebook", <FacebookIcon key="fb" size={32} />],
              ["Instagram", <InstagramIcon key="ig" size={32} />],
              ["X (Twitter)", <XIcon key="x" size={32} />],
              ["Google Business", <GoogleBusinessIcon key="gbp" size={32} />],
              ["Pinterest", <PinterestIcon key="pi" size={32} />],
              ["TikTok", <TikTokIcon key="tt" size={32} />],
              ["YouTube", <YouTubeIcon key="yt" size={32} />],
            ].map(([label, icon]) => (
              <div key={label as string} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                {icon}
                <span style={{ fontSize: 10, color: "var(--c3-ink-3)", fontFamily: "var(--c3-font-mono)" }}>{label as string}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* Motion tokens */}
        <Section title="Motion Tokens">
          <div data-testid="c3-motion-tokens" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
            {[
              { token: "--c3-duration-instant", value: "60ms", use: "Selection, color swap" },
              { token: "--c3-duration-fast", value: "120ms", use: "Hover, focus" },
              { token: "--c3-duration-base", value: "200ms", use: "Default transitions" },
              { token: "--c3-duration-slow", value: "320ms", use: "Modal reveal, panel slide" },
            ].map(({ token, value, use }) => (
              <div key={token} style={{ background: "var(--c3-surface)", border: "1px solid var(--c3-border)", borderRadius: "var(--c3-radius-lg)", padding: 16 }}>
                <div style={{ fontFamily: "var(--c3-font-mono)", fontSize: 10, color: "var(--c3-ink-3)", marginBottom: 4 }}>{token}</div>
                <div style={{ fontFamily: "var(--c3-font-mono)", fontSize: 16, fontWeight: 600, color: "var(--c3-brand-700)", marginBottom: 4 }}>{value}</div>
                <div style={{ fontSize: 12, color: "var(--c3-ink-4)" }}>{use}</div>
              </div>
            ))}
          </div>
        </Section>

        <div style={{ marginTop: 64, paddingTop: 32, borderTop: "1px solid var(--c3-border)" }}>
          <p style={{ fontFamily: "var(--c3-font-mono)", fontSize: 10, color: "var(--c3-ink-4)" }}>
            Composer v3 Design System · Opollo · {new Date().toISOString().split("T")[0]}
          </p>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 64 }}>
      <h2 style={{ fontFamily: "var(--c3-font-mono)", fontSize: 11, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--c3-ink-3)", marginBottom: 24 }}>
        {title}
      </h2>
      {children}
    </div>
  );
}

function Swatch({ name, hex }: { name: string; hex: string }) {
  return (
    <div data-testid={`c3-color-${name.replace(/[-\s]/g, "")}`} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ height: 48, borderRadius: "var(--c3-radius-md)", background: hex, border: "1px solid var(--c3-border-2)" }} />
      <div style={{ fontFamily: "var(--c3-font-mono)", fontSize: 9, color: "var(--c3-ink-3)" }}>{name}</div>
      <div style={{ fontFamily: "var(--c3-font-mono)", fontSize: 10, fontWeight: 500, color: "var(--c3-ink)" }}>{hex}</div>
    </div>
  );
}

function Btn({ children, variant = "primary", size = "md", disabled }: {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
}) {
  const heights: Record<string, number> = { sm: 26, md: 32, lg: 40 };
  const paddings: Record<string, string> = { sm: "0 10px", md: "0 14px", lg: "0 18px" };
  const fontSizes: Record<string, number> = { sm: 12, md: 13, lg: 14 };
  const styles: Record<string, React.CSSProperties> = {
    primary: { background: "var(--c3-ink)", color: "#fff", border: "1px solid transparent" },
    secondary: { background: "var(--c3-surface)", color: "var(--c3-ink)", border: "1px solid var(--c3-border)" },
    ghost: { background: "transparent", color: "var(--c3-ink-2)", border: "1px solid transparent" },
    danger: { background: "var(--c3-danger-line)", color: "#fff", border: "1px solid transparent" },
  };

  return (
    <button
      type="button"
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        height: heights[size],
        padding: paddings[size],
        borderRadius: "var(--c3-radius-md)",
        fontSize: fontSizes[size],
        fontWeight: 500,
        fontFamily: "var(--c3-font-body)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "all 120ms var(--c3-ease-out)",
        letterSpacing: "-0.005em",
        ...styles[variant],
      }}
    >
      {children}
    </button>
  );
}

function ProfileChip({
  platform,
  name,
  handle,
  selected,
}: {
  platform: "linkedin" | "facebook" | "instagram" | "x" | "gbp";
  name: string;
  handle: string;
  selected: boolean;
}) {
  const PlatformIcon = {
    linkedin: LinkedInIcon,
    facebook: FacebookIcon,
    instagram: InstagramIcon,
    x: XIcon,
    gbp: GoogleBusinessIcon,
  }[platform];

  const initials = name.slice(0, 2).toUpperCase();
  const colors: Record<string, string> = {
    linkedin: "#0A66C2", facebook: "#1877F2", instagram: "#E4405F", x: "#000", gbp: "#4285F4",
  };

  return (
    <div
      data-testid={`c3-profile-chip-${platform}`}
      role="checkbox"
      aria-checked={selected}
      aria-label={`Post to ${name} on ${platform}`}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 12,
        height: 56,
        padding: selected ? "7px 15px 7px 7px" : "8px 16px 8px 8px",
        background: selected ? "#ECFDF5" : "var(--c3-surface)",
        border: selected ? "2px solid var(--c3-brand-500)" : "1px solid var(--c3-border)",
        borderRadius: "var(--c3-radius-lg)",
        minWidth: 200,
        cursor: "pointer",
        transition: "all 60ms var(--c3-ease-out)",
      }}
    >
      {/* Avatar */}
      <div style={{ position: "relative", width: 40, height: 40, flexShrink: 0 }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: "50%",
            background: colors[platform],
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontSize: 13,
            fontWeight: 600,
            fontFamily: "var(--c3-font-body)",
          }}
        >
          {initials}
        </div>
        {/* Platform overlay */}
        <div
          style={{
            position: "absolute",
            bottom: -2,
            right: -2,
            width: 18,
            height: 18,
            borderRadius: "50%",
            background: "var(--c3-surface)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 0 0 2px var(--c3-surface)",
          }}
        >
          <PlatformIcon size={14} />
        </div>
      </div>

      {/* Info */}
      <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0, overflow: "hidden" }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: "var(--c3-ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
        <span style={{ fontSize: 11, color: "var(--c3-ink-3)", fontFamily: "var(--c3-font-mono)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{handle}</span>
      </div>

      {/* Check */}
      {selected && (
        <div
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: "var(--c3-brand-500)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
          }}
        >
          <Check size={10} strokeWidth={2.5} />
        </div>
      )}
    </div>
  );
}

function Toast({ type, title, desc, traceId }: {
  type: "default" | "success" | "error";
  title: string;
  desc: string;
  traceId?: string;
}) {
  const bgs: Record<string, string> = {
    default: "var(--c3-ink)",
    success: "var(--c3-brand-500)",
    error: "var(--c3-danger-line)",
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "12px 14px",
        background: bgs[type],
        color: "#fff",
        borderRadius: "var(--c3-radius-md)",
        maxWidth: 360,
        boxShadow: "var(--c3-shadow-lg)",
      }}
    >
      <div style={{ flexShrink: 0, paddingTop: 1, color: "#fff" }}>
        {type === "success" && <Check size={16} strokeWidth={2} />}
        {type === "error" && <AlertCircle size={16} strokeWidth={1.75} />}
        {type === "default" && <Info size={16} strokeWidth={1.75} />}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.3 }}>{title}</div>
        <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2, lineHeight: 1.4 }}>{desc}</div>
        {traceId && (
          <div style={{ fontFamily: "var(--c3-font-mono)", fontSize: 10.5, opacity: 0.6, marginTop: 6 }}>
            trace_id: {traceId}
          </div>
        )}
      </div>
    </div>
  );
}
