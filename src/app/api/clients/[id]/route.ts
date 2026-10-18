import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

function toCamel(row: any) {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    email: row.email,
    avatarUrl: row.avatar_url,
  };
}

async function requireSuperAdminAndClient(supabase: ReturnType<typeof createClient>, clientId: string) {
  const user = await getAuthUser(supabase);
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const { data: callerProfile } = await supabase.from("profiles").select("access_level").eq("id", user.id).single();
  if (callerProfile?.access_level !== "super_admin") {
    return { error: NextResponse.json({ error: "Only the super admin can manage clients." }, { status: 403 }) };
  }

  const { data: target } = await supabase.from("profiles").select("access_level").eq("id", clientId).single();
  if (target?.access_level !== "client") {
    return { error: NextResponse.json({ error: "Client not found." }, { status: 404 }) };
  }

  return { error: null };
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { error: authError } = await requireSuperAdminAndClient(supabase, params.id);
  if (authError) return authError;

  const body = await req.json();
  const { name, role } = body as { name?: string; role?: string };

  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name.trim();
  if (role !== undefined) data.role = role.trim();

  const { data: updated, error } = await supabase
    .from("profiles")
    .update(data)
    .eq("id", params.id)
    .select("id, name, role, email, avatar_url")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ client: toCamel(updated) });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { error: authError } = await requireSuperAdminAndClient(supabase, params.id);
  if (authError) return authError;

  // Deleting the auth user cascades to their profile (and anything else FK'd
  // to it) — the REST API never exposes auth.users deletion to anon/
  // authenticated roles, so this needs the service-role client.
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(params.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
