import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { ACCESS_LEVEL_ORDER } from "@/lib/accessLevels";
import type { AccessLevel } from "@/types";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Only the super admin may change access levels. RLS also enforces this at
  // the row level, but we gate here for a clear error and to guard the
  // self-demotion case below.
  const { data: caller } = await supabase
    .from("profiles")
    .select("access_level")
    .eq("id", user.id)
    .single();
  if (caller?.access_level !== "super_admin") {
    return NextResponse.json({ error: "Only the super admin can change access levels." }, { status: 403 });
  }

  const body = await req.json();
  const accessLevel = body.accessLevel as AccessLevel | undefined;
  if (!accessLevel || !ACCESS_LEVEL_ORDER.includes(accessLevel)) {
    return NextResponse.json({ error: "Invalid access level." }, { status: 400 });
  }

  if (params.id === user.id && accessLevel !== "super_admin") {
    return NextResponse.json(
      { error: "You can't lower your own access level — you'd lock yourself out." },
      { status: 400 }
    );
  }

  // is_admin is kept in sync automatically by the sync_profiles_is_admin
  // trigger (migration 012), so we only need to set access_level.
  const { data: updated, error } = await supabase
    .from("profiles")
    .update({ access_level: accessLevel })
    .eq("id", params.id)
    .select("id, access_level")
    .single();

  if (error || !updated) {
    return NextResponse.json({ error: error?.message || "Failed to update access level." }, { status: 400 });
  }

  return NextResponse.json({ id: updated.id, accessLevel: updated.access_level });
}
