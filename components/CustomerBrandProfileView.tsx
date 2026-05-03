import Link from "next/link";

import { Eyebrow, H1, Lead } from "@/components/ui/typography";
import {
  type BrandProfile,
  brandTierDescription,
  brandTierLabel,
  getBrandTier,
} from "@/lib/platform/brand";
import type { PlatformCompany } from "@/lib/platform/companies";

// P-Brand-1a — read-only customer view of the active brand profile.
// Edit form lands in P-Brand-1b; this slice ships the surface so
// operators can confirm what's stored and we can wire it into the rest
// of the platform UI (sidebar link, completion banners on /company,
// etc.) without waiting for the form.
//
// Empty state: brand may legitimately be null (customer companies start
// without a profile — only the Opollo internal company is seeded). Show
// a "Get started" prompt rather than rendering an empty card.

type Props = {
  company: PlatformCompany;
  brand: BrandProfile | null;
};

export function CustomerBrandProfileView({ company, brand }: Props) {
  const tier = getBrandTier(brand);
  const tierLabel = brandTierLabel(tier);
  const tierDescription = brandTierDescription(tier);

  return (
    <div className="space-y-8">
      <header>
        <H1>Brand profile</H1>
        <Lead className="mt-1">
          How <strong>{company.name}</strong> looks, sounds, and behaves
          across every Opollo product.
        </Lead>
      </header>

      {brand === null ? (
        <EmptyState />
      ) : (
        <>
          <TierCard
            tier={tierLabel}
            description={tierDescription}
            version={brand.version}
            updatedAt={brand.updated_at}
            safeMode={brand.safe_mode}
          />
          <VisualIdentityCard brand={brand} />
          <ToneOfVoiceCard brand={brand} />
          <ContentGuardrailsCard brand={brand} />
          <OperationalDefaultsCard brand={brand} />
        </>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <section className="rounded-lg border border-dashed bg-muted/20 p-8 text-center">
      <h2 className="text-lg font-semibold">No brand profile yet</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Set up your brand so we can tailor every post, page, and image
        we generate to look and sound like you.
      </p>
      <p className="mt-4 text-sm text-muted-foreground">
        The brand editor lands in the next slice. For now, ask Opollo
        support to bootstrap your profile, or wait for the editor to
        ship.
      </p>
    </section>
  );
}

function TierCard({
  tier,
  description,
  version,
  updatedAt,
  safeMode,
}: {
  tier: string;
  description: string;
  version: number;
  updatedAt: string;
  safeMode: boolean;
}) {
  return (
    <section
      className="rounded-lg border bg-card p-4"
      aria-labelledby="brand-tier-heading"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <Eyebrow id="brand-tier-heading">Setup</Eyebrow>
          <h2 className="mt-1 text-base font-semibold">{tier}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="text-right text-sm text-muted-foreground">
          <div>Version {version}</div>
          <div>Updated {formatDate(updatedAt)}</div>
          {safeMode ? (
            <div className="mt-1 inline-flex rounded-md bg-amber-100 px-2 py-0.5 text-sm font-medium text-amber-900">
              Safe mode on
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function VisualIdentityCard({ brand }: { brand: BrandProfile }) {
  return (
    <section
      className="rounded-lg border bg-card"
      aria-labelledby="brand-visual-heading"
    >
      <header className="border-b px-4 py-3">
        <h2 id="brand-visual-heading" className="text-base font-semibold">
          Visual identity
        </h2>
      </header>
      <div className="grid gap-6 p-4 md:grid-cols-2">
        <Field label="Primary colour">
          <ColourSwatch value={brand.primary_colour} />
        </Field>
        <Field label="Secondary colour">
          <ColourSwatch value={brand.secondary_colour} />
        </Field>
        <Field label="Accent colour">
          <ColourSwatch value={brand.accent_colour} />
        </Field>
        <Field label="Heading font">
          <Value value={brand.heading_font} />
        </Field>
        <Field label="Body font">
          <Value value={brand.body_font} />
        </Field>
        <Field label="Logos">
          <LogoList
            primary={brand.logo_primary_url}
            dark={brand.logo_dark_url}
            light={brand.logo_light_url}
            icon={brand.logo_icon_url}
          />
        </Field>
      </div>
    </section>
  );
}

function ToneOfVoiceCard({ brand }: { brand: BrandProfile }) {
  return (
    <section
      className="rounded-lg border bg-card"
      aria-labelledby="brand-tone-heading"
    >
      <header className="border-b px-4 py-3">
        <h2 id="brand-tone-heading" className="text-base font-semibold">
          Tone of voice
        </h2>
      </header>
      <div className="grid gap-6 p-4 md:grid-cols-2">
        <Field label="Formality">
          <Value value={formatEnum(brand.formality)} />
        </Field>
        <Field label="Point of view">
          <Value value={formatEnum(brand.point_of_view)} />
        </Field>
        <Field label="Personality traits">
          <TagList values={brand.personality_traits} />
        </Field>
        <Field label="Voice examples">
          <TagList values={brand.voice_examples} />
        </Field>
        <Field label="Preferred vocabulary">
          <TagList values={brand.preferred_vocabulary} />
        </Field>
        <Field label="Avoided terms">
          <TagList values={brand.avoided_terms} />
        </Field>
      </div>
    </section>
  );
}

function ContentGuardrailsCard({ brand }: { brand: BrandProfile }) {
  return (
    <section
      className="rounded-lg border bg-card"
      aria-labelledby="brand-content-heading"
    >
      <header className="border-b px-4 py-3">
        <h2 id="brand-content-heading" className="text-base font-semibold">
          Content guardrails
        </h2>
      </header>
      <div className="grid gap-6 p-4 md:grid-cols-2">
        <Field label="Industry">
          <Value value={brand.industry} />
        </Field>
        <Field label="Focus topics">
          <TagList values={brand.focus_topics} />
        </Field>
        <Field label="Avoided topics">
          <TagList values={brand.avoided_topics} />
        </Field>
        <Field label="Content restrictions">
          <TagList values={brand.content_restrictions} />
        </Field>
      </div>
    </section>
  );
}

function OperationalDefaultsCard({ brand }: { brand: BrandProfile }) {
  return (
    <section
      className="rounded-lg border bg-card"
      aria-labelledby="brand-ops-heading"
    >
      <header className="border-b px-4 py-3">
        <h2 id="brand-ops-heading" className="text-base font-semibold">
          Operational defaults
        </h2>
      </header>
      <div className="grid gap-6 p-4 md:grid-cols-2">
        <Field label="Approval required by default">
          <Value value={brand.default_approval_required ? "Yes" : "No"} />
        </Field>
        <Field label="Approval rule">
          <Value value={formatEnum(brand.default_approval_rule)} />
        </Field>
        <Field label="Hashtag strategy">
          <Value value={formatEnum(brand.hashtag_strategy)} />
        </Field>
        <Field label="Max post length">
          <Value value={formatEnum(brand.max_post_length)} />
        </Field>
      </div>
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Eyebrow>{label}</Eyebrow>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function Value({ value }: { value: string | null | undefined }) {
  if (!value) {
    return <span className="text-sm text-muted-foreground italic">Not set</span>;
  }
  return <span className="text-sm">{value}</span>;
}

function ColourSwatch({ value }: { value: string | null }) {
  if (!value) return <Value value={null} />;
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden
        className="inline-block h-6 w-6 rounded-md border"
        style={{ backgroundColor: value }}
      />
      <span className="text-sm font-mono">{value}</span>
    </div>
  );
}

function TagList({ values }: { values: string[] }) {
  if (values.length === 0) return <Value value={null} />;
  return (
    <div className="flex flex-wrap gap-1">
      {values.map((v) => (
        <span
          key={v}
          className="inline-flex rounded-md bg-muted px-2 py-0.5 text-sm"
        >
          {v}
        </span>
      ))}
    </div>
  );
}

function LogoList({
  primary,
  dark,
  light,
  icon,
}: {
  primary: string | null;
  dark: string | null;
  light: string | null;
  icon: string | null;
}) {
  const variants: Array<{ label: string; url: string | null }> = [
    { label: "Primary", url: primary },
    { label: "Dark", url: dark },
    { label: "Light", url: light },
    { label: "Icon", url: icon },
  ];
  const present = variants.filter((v) => v.url);
  if (present.length === 0) return <Value value={null} />;
  return (
    <ul className="space-y-1 text-sm">
      {present.map((v) => (
        <li key={v.label}>
          <span className="font-medium">{v.label}: </span>
          <Link
            href={v.url ?? "#"}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline underline-offset-2"
          >
            View
          </Link>
        </li>
      ))}
    </ul>
  );
}

function formatEnum(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
