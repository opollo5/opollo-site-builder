import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Fragment } from "react";

import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Badge } from "@/components/ui/badge";
import { H1 } from "@/components/ui/typography";
import { EditImageMetadataButton } from "@/components/EditImageMetadataButton";
import { ImageArchiveButton } from "@/components/ImageArchiveButton";
import { checkAdminAccess } from "@/lib/admin-gate";
import { deliveryUrl } from "@/lib/cloudflare-images";
import { getImage } from "@/lib/image-library";
import { formatRelativeTime } from "@/lib/utils";

// ---------------------------------------------------------------------------
// /admin/images/[id] — M5-2.
//
// Per-image detail view. Full metadata, multi-variant preview (public
// + thumbnail + if configured, additional named variants), the
// `image_usage` list showing every WP site this image has been
// mirrored to, and the `image_metadata` k/v pane for EXIF / licensing /
// model-info rows.
//
// Back-link preserves the caller's list-state query params so a
// return-to-list after inspection lands the operator on the exact
// same filter / page they came from. The params ride as a single
// opaque `?from=` blob so we don't have to parse-and-re-emit each
// filter dimension.
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RawSearchParams = {
  [key: string]: string | string[] | undefined;
};

function resolveBackHref(raw: RawSearchParams): string {
  const from = typeof raw.from === "string" ? raw.from : null;
  if (!from) return "/admin/images";
  // Accept only relative /admin/images paths to defend against open-redirect
  // style abuse of the `from` parameter.
  if (!from.startsWith("/admin/images")) return "/admin/images";
  return from;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "numeric",
    });
  } catch {
    return iso;
  }
}

function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function usageStateBadge(state: string) {
  const tone: "success" | "neutral" | "error" =
    state === "transferred"
      ? "success"
      : state === "failed"
        ? "error"
        : "neutral";
  return <Badge tone={tone}>{state.replace(/_/g, " ")}</Badge>;
}

function formatJsonValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 0);
  } catch {
    return String(value);
  }
}

export default async function AdminImageDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: RawSearchParams;
}) {
  const access = await checkAdminAccess({
    requiredRoles: ["admin", "operator"],
    insufficientRoleRedirectTo: "/admin/sites",
  });
  if (access.kind === "redirect") redirect(access.to);

  if (!UUID_RE.test(params.id)) notFound();

  const result = await getImage(params.id);
  if (!result.ok) {
    if (result.error.code === "NOT_FOUND") notFound();
    return (
      <div
        role="alert"
        className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
      >
        Failed to load image: {result.error.message}
      </div>
    );
  }

  const { image, usage, metadata } = result.data;
  const backHref = resolveBackHref(searchParams);

  const publicUrl = image.cloudflare_id
    ? deliveryUrl(image.cloudflare_id, "public")
    : null;
  const thumbUrl = image.cloudflare_id
    ? deliveryUrl(image.cloudflare_id, "thumbnail")
    : null;

  return (
    <>
      <Breadcrumbs
        crumbs={[
          { label: "Images", href: backHref },
          { label: image.caption?.slice(0, 60) ?? image.filename ?? image.id },
        ]}
      />

      <div className="mt-4 flex items-start justify-between gap-4">
        <div>
          <H1>
            {image.filename ?? "Untitled image"}
          </H1>
          <p className="text-sm text-muted-foreground">
            Imported {formatDate(image.created_at)}
            {image.deleted_at && (
              <>
                {" · "}
                <span className="text-destructive">
                  archived {formatRelativeTime(image.deleted_at)}
                </span>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {!image.deleted_at && (
            <EditImageMetadataButton
              image={{
                id: image.id,
                caption: image.caption,
                alt_text: image.alt_text,
                tags: image.tags,
                version_lock: image.version_lock,
              }}
            />
          )}
          <ImageArchiveButton
            image={{ id: image.id, deleted_at: image.deleted_at }}
          />
          <Link
            href={backHref}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ← Back to library
          </Link>
        </div>
      </div>

      <section className="mt-6 grid gap-6 md:grid-cols-[1fr_2fr]">
        <div className="flex flex-col gap-3">
          <div className="overflow-hidden rounded-md border bg-muted/30">
            {publicUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={publicUrl}
                alt={image.alt_text ?? image.filename ?? "Library image"}
                className="h-full w-full object-contain"
                data-testid="image-detail-preview"
              />
            ) : (
              <div className="flex h-64 w-full items-center justify-center text-sm text-muted-foreground">
                Preview unavailable (no Cloudflare id or delivery hash).
              </div>
            )}
          </div>
          {thumbUrl && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>Thumbnail:</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={thumbUrl}
                alt=""
                className="h-10 w-10 rounded object-cover"
              />
              <a
                href={thumbUrl}
                target="_blank"
                rel="noreferrer"
                className="hover:underline"
              >
                Open
              </a>
            </div>
          )}
        </div>

        <dl
          className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm"
          data-testid="image-detail-fields"
        >
          <dt className="text-muted-foreground">Caption</dt>
          <dd>
            {image.caption ?? (
              <span className="text-muted-foreground">(no caption yet)</span>
            )}
          </dd>
          <dt className="text-muted-foreground">Alt text</dt>
          <dd>
            {image.alt_text ?? (
              <span className="text-muted-foreground">(not set)</span>
            )}
          </dd>
          <dt className="text-muted-foreground">Tags</dt>
          <dd>
            {image.tags.length === 0 ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              <div className="flex flex-wrap gap-1">
                {image.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded bg-muted px-2 py-0.5 text-xs"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </dd>
          <dt className="text-muted-foreground">Source</dt>
          <dd className="capitalize">
            {image.source}
            {image.source_ref && (
              <span className="ml-2 text-xs text-muted-foreground">
                ({image.source_ref})
              </span>
            )}
          </dd>
          <dt className="text-muted-foreground">Dimensions</dt>
          <dd>
            {image.width_px && image.height_px
              ? `${image.width_px}×${image.height_px} px`
              : "—"}
          </dd>
          <dt className="text-muted-foreground">File size</dt>
          <dd>{formatBytes(image.bytes)}</dd>
        </dl>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold">
          Used on sites{" "}
          <span className="text-xs text-muted-foreground">
            ({usage.length})
          </span>
        </h2>
        <p className="text-xs text-muted-foreground">
          Every WP site this image has been mirrored to via the publish pipeline.
        </p>
        <div className="mt-3" data-testid="image-usage-list">
          {usage.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              Not yet used on any site.
            </div>
          ) : (
            <div className="overflow-hidden rounded-md border">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2 font-medium">Site</th>
                    <th className="px-4 py-2 font-medium">State</th>
                    <th className="px-4 py-2 font-medium">WP media</th>
                    <th className="px-4 py-2 font-medium">Transferred</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.map((u) => (
                    <tr
                      key={u.id}
                      className="border-b last:border-b-0"
                      data-site-id={u.site_id}
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/sites/${u.site_id}`}
                          className="font-medium hover:underline"
                        >
                          {u.site_name}
                        </Link>
                        {u.wp_url && (
                          <div className="text-xs text-muted-foreground">
                            {u.wp_url}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">{usageStateBadge(u.state)}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {u.wp_media_id !== null ? (
                          u.wp_source_url ? (
                            <a
                              href={u.wp_source_url}
                              target="_blank"
                              rel="noreferrer"
                              className="hover:underline"
                            >
                              #{u.wp_media_id}
                            </a>
                          ) : (
                            `#${u.wp_media_id}`
                          )
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {u.transferred_at
                          ? formatRelativeTime(u.transferred_at)
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold">
          Additional metadata{" "}
          <span className="text-xs text-muted-foreground">
            ({metadata.length})
          </span>
        </h2>
        <p className="text-xs text-muted-foreground">
          EXIF, licensing notes, model info, and any other per-image attributes
          tracked outside the main row.
        </p>
        <div className="mt-3" data-testid="image-metadata-list">
          {metadata.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              No additional metadata.
            </div>
          ) : (
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 rounded-md border p-4 text-sm">
              {metadata.map((m) => (
                <Fragment key={m.key}>
                  <dt className="font-mono text-xs text-muted-foreground">
                    {m.key}
                  </dt>
                  <dd className="break-all font-mono text-xs">
                    {formatJsonValue(m.value_jsonb)}
                  </dd>
                </Fragment>
              ))}
            </dl>
          )}
        </div>
      </section>
    </>
  );
}
