import { permanentRedirect } from "next/navigation";

// 308 permanent redirect — /admin/posts/new is superseded by the rail-based
// SiteSelector pattern. /admin/posts is now the entry point.
export default function PostsNewRedirect() {
  permanentRedirect("/admin/posts");
}
