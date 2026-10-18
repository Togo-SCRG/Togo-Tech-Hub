import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { CAPABILITIES } from "@/lib/capabilities";

/**
 * Per-person exceptions to the tier matrix.
 *
 * Three states per capability, which is the whole point: a row with
 * `allowed: false` is a deny that beats a tier grant, and no row at all means
 * "inherit the tier". A DELETE clears back to inherit.
 */
export async function GET(req: NextRequest) {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = new URL(req.url).searchParams.get("userId");

  let query = supabase.from("permission_overrides").select("user_id, capability, allowed");
  if (userId) query = query.eq("user_id", userId);

  const { data, error } = await query;
  if (error) {
    // The table only exists once migration 033 has run.
    return NextResponse.json({ overrides: {}, counts: {}, available: false });
  }

  // Keyed for the UI: "userId:capability" -> boolean.
  const overrides: Record<string, boolean> = {};
  // How many exceptions each person has, so the picker can show it without a
  // second request.
  const counts: Record<string, number> = {};
  for (const row of data || []) {
    overrides[`${row.user_id}:${row.capability}`] = row.allowed;
    counts[row.user_id as string] = (counts[row.user_id as string] || 0) + 1;
  }

  return NextResponse.json({ overrides, counts, available: true });
}

/** Set or clear one person's override for one capability. Super admin only. */
export async function PATCH(req: NextRequest) {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: caller } = await supabase.from("profiles").select("access_level").eq("id", user.id).single();
  if (caller?.access_level !== "super_admin") {
    return NextResponse.json({ error: "Only the super admin can change permissions." }, { status: 403 });
  }

  const body = await req.json();
  const { userId, capability, allowed } = body as {
    userId?: string;
    capability?: string;
    /** null clears the override, so the person inherits their tier again. */
    allowed?: boolean | null;
  };

  if (!userId) {
    return NextResponse.json({ error: "userId is required." }, { status: 400 });
  }
  if (!capability || !CAPABILITIES.some((c) => c.key === capability)) {
    return NextResponse.json({ error: "Unknown capability." }, { status: 400 });
  }

  const { data: target } = await supabase.from("profiles").select("access_level").eq("id", userId).single();
  if (!target) {
    return NextResponse.json({ error: "That person no longer exists." }, { status: 404 });
  }
  // A super admin already holds everything unconditionally, so an override on
  // one would be stored and then ignored — misleading rather than harmless.
  if (target.access_level === "super_admin") {
    return NextResponse.json(
      { error: "The super admin always holds every permission — overrides don't apply." },
      { status: 400 }
    );
  }

  if (allowed === null || allowed === undefined) {
    const { error } = await supabase
      .from("permission_overrides")
      .delete()
      .eq("user_id", userId)
      .eq("capability", capability);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ userId, capability, allowed: null });
  }

  if (typeof allowed !== "boolean") {
    return NextResponse.json({ error: "allowed must be true, false, or null." }, { status: 400 });
  }

  const { error } = await supabase.from("permission_overrides").upsert(
    {
      user_id: userId,
      capability,
      allowed,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    },
    { onConflict: "user_id,capability" }
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ userId, capability, allowed });
}
