import Link from "next/link";

import { NavIcon } from "@/components/ui/nav-icon";

// Spec 03 §2 — Blog-styling calibration banner.
//
// Renders on /admin/sites/[id], /admin/sites/[id]/posts, and
// /admin/sites/[id]/briefs/[brief_id]/run when:
//   - site_mode === 'copy_existing'
//   - content_type='post' is in scope (the run page only triggers for
//     post-mode briefs; the posts list and site detail render this
//     unconditionally for copy_existing sites without calibration)
//   - extracted_design.blog_styling is null OR has zero source_blog_urls
//
// Non-dismissible per the spec — generated blog posts on a
// non-calibrated copy_existing site produce visibly wrong markup, so
// hiding the banner locally would silently degrade output. The link
// target carries ?focus=blog-styling so the wizard auto-expands the
// blog-styling section on landing.

export function BlogStyleCalibrationBanner({ siteId }: { siteId: string }) {
  return (
    <div
      className="mb-4 flex flex-wrap items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm"
      role="status"
      data-testid="blog-style-calibration-banner"
    >
      <NavIcon
        name="warning"
        size={16}
        className="mt-0.5 shrink-0 text-warning"
      />
      <div className="min-w-0 flex-1">
        <p className="font-medium">Blog styling not calibrated</p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          This site is in &quot;copy existing&quot; mode, but we haven&apos;t
          learned how its blog posts are styled yet. Generated blog
          posts may not match your site&apos;s design.
        </p>
        <Link
          href={`/admin/sites/${siteId}/setup/extract?focus=blog-styling`}
          className="mt-2 inline-block text-sm font-medium underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
          data-testid="blog-style-calibration-banner-cta"
        >
          Calibrate blog styling →
        </Link>
      </div>
    </div>
  );
}
