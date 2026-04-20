import { describe, it, expect } from "vitest";
import { Client } from "pg";
import { getServiceRoleClient } from "@/lib/supabase";
import { seedAuthUser, setFirstAdminEmail } from "./_auth-helpers";

// ---------------------------------------------------------------------------
// M2a — auth.users ↔ opollo_users link, signup trigger, email sync,
// cascade delete, auth_role() helper.
//
// Tests run against the real local Supabase stack (same harness as every
// other lib test). Each test starts with a clean slate — _setup.ts
// TRUNCATEs auth.users + opollo_users + opollo_config in beforeEach.
// ---------------------------------------------------------------------------

const DB_URL =
  process.env.SUPABASE_DB_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

async function readOpolloUser(id: string): Promise<{
  id: string;
  email: string;
  role: string;
} | null> {
  const supabase = getServiceRoleClient();
  const { data, error } = await supabase
    .from("opollo_users")
    .select("id, email, role")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`readOpolloUser: ${error.message}`);
  return data;
}

describe("M2a: handle_new_auth_user trigger", () => {
  it("auto-creates an opollo_users row with role='viewer' by default", async () => {
    const user = await seedAuthUser();
    const row = await readOpolloUser(user.id);
    expect(row).not.toBeNull();
    expect(row?.email).toBe(user.email);
    expect(row?.role).toBe("viewer");
  });

  it("promotes to 'admin' when email matches opollo_config.first_admin_email", async () => {
    await setFirstAdminEmail("boss@opollo.test");
    // seedAuthUser with no role= override lets the trigger's decision stand.
    // Tracked for cleanup via the helper's internal Set.
    const user = await seedAuthUser({ email: "boss@opollo.test" });
    const row = await readOpolloUser(user.id);
    expect(row?.role).toBe("admin");
  });

  it("leaves non-matching emails as 'viewer' even when first_admin_email is set", async () => {
    await setFirstAdminEmail("boss@opollo.test");
    const user = await seedAuthUser({ email: "intern@opollo.test" });
    const row = await readOpolloUser(user.id);
    expect(row?.role).toBe("viewer");
  });
});

describe("M2a: handle_auth_user_email_update trigger", () => {
  it("syncs opollo_users.email when auth.users.email changes", async () => {
    const user = await seedAuthUser({ email: "old@opollo.test" });

    const supabase = getServiceRoleClient();
    const { error } = await supabase.auth.admin.updateUserById(user.id, {
      email: "new@opollo.test",
      email_confirm: true,
    });
    if (error) throw new Error(error.message);

    const row = await readOpolloUser(user.id);
    expect(row?.email).toBe("new@opollo.test");
  });

  it("does not fire when an unrelated field updates", async () => {
    const user = await seedAuthUser({ email: "stable@opollo.test" });
    const supabase = getServiceRoleClient();
    // Trigger updates by changing user_metadata, which isn't the email.
    // opollo_users.email should remain untouched.
    const { error } = await supabase.auth.admin.updateUserById(user.id, {
      user_metadata: { anything: "changed" },
    });
    if (error) throw new Error(error.message);
    const row = await readOpolloUser(user.id);
    expect(row?.email).toBe("stable@opollo.test");
  });
});

describe("M2a: FK cascade from auth.users → opollo_users", () => {
  it("deleting an auth.users row cascades to opollo_users", async () => {
    const user = await seedAuthUser();
    const before = await readOpolloUser(user.id);
    expect(before).not.toBeNull();

    const supabase = getServiceRoleClient();
    const { error } = await supabase.auth.admin.deleteUser(user.id);
    if (error) throw new Error(error.message);

    const after = await readOpolloUser(user.id);
    expect(after).toBeNull();
  });
});

describe("M2a: public.auth_role() helper", () => {
  // auth_role() reads auth.uid() from the JWT claim. The service-role
  // client doesn't populate a JWT 'sub' claim, so we reach past it and
  // use a direct pg connection where we can SET LOCAL the claim to
  // simulate an authenticated session.
  it("returns the user's role when called as that user", async () => {
    const user = await seedAuthUser({ role: "operator" });
    const pg = new Client({ connectionString: DB_URL });
    await pg.connect();
    try {
      await pg.query("BEGIN");
      // request.jwt.claim.sub is the legacy setting name postgres + Supabase
      // both honour. The newer request.jwt.claims JSONB form is also valid
      // but this is simpler from psql.
      await pg.query(`SET LOCAL "request.jwt.claim.sub" = '${user.id}'`);
      const res = await pg.query("SELECT public.auth_role() AS role");
      expect(res.rows[0].role).toBe("operator");
      await pg.query("COMMIT");
    } finally {
      await pg.end();
    }
  });

  it("returns NULL when no session is attached", async () => {
    const pg = new Client({ connectionString: DB_URL });
    await pg.connect();
    try {
      const res = await pg.query("SELECT public.auth_role() AS role");
      expect(res.rows[0].role).toBeNull();
    } finally {
      await pg.end();
    }
  });

  it("returns NULL when the JWT sub does not match any opollo_users row", async () => {
    const pg = new Client({ connectionString: DB_URL });
    await pg.connect();
    try {
      await pg.query("BEGIN");
      await pg.query(
        `SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000000'`,
      );
      const res = await pg.query("SELECT public.auth_role() AS role");
      expect(res.rows[0].role).toBeNull();
      await pg.query("COMMIT");
    } finally {
      await pg.end();
    }
  });
});

describe("M2a: opollo_config RLS", () => {
  it("allows service-role read/write", async () => {
    await setFirstAdminEmail("test@opollo.test");
    const supabase = getServiceRoleClient();
    const { data, error } = await supabase
      .from("opollo_config")
      .select("key, value")
      .eq("key", "first_admin_email")
      .single();
    expect(error).toBeNull();
    expect(data?.value).toBe("test@opollo.test");
  });
});
