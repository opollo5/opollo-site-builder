import { redirect } from "next/navigation";

// CLAUDE-ASSUMPTION (PR 1.1): This stub exists so AddProfileDropdown links
// are routable. The real connect flow is popup-based; the connections page
// manages the OAuth popup via POST /api/platform/social/connections/connect.
export default function ConnectPlatformPage() {
  redirect("/company/social/connections");
}
