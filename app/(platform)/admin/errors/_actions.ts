"use server";

import { revalidatePath } from "next/cache";

import { checkAdminAccess } from "@/lib/admin-gate";
import { getServiceRoleClient } from "@/lib/supabase";

export async function resolveClientError(id: string): Promise<void> {
  const access = await checkAdminAccess({ requiredRoles: ["super_admin", "admin"] });
  if (access.kind === "redirect") return;

  const db = getServiceRoleClient();
  await db
    .from("client_errors")
    .update({ resolved_at: new Date().toISOString() })
    .eq("id", id);

  revalidatePath("/admin/errors");
}
