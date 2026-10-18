import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";

// "Clients" are simply profiles at the admin access level — real login
// accounts, reusing the same auth.users + profiles pattern as every other
// team member, distinguished only by access_level = 'admin'.
function toCamel(row: any) {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    email: row.email,
    avatarUrl: row.avatar_url,
  };
}

export async function GET() {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id, name, role, email, avatar_url")
    .eq("access_level", "client")
    .order("name");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ clients: (data || []).map(toCamel) });
}

// Client accounts are created through POST /api/users at the admin tier —
// the same path Add Member uses, with a server-generated password. There was a
// POST here that took a caller-supplied one; two provisioning paths meant two
// sets of rules to keep in step, so it's gone.
