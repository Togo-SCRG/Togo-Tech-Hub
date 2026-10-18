import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { MIGRATION_045_MISSING, isProposalsMissing } from "@/lib/proposals";
import type { ProposalAccessEntry } from "@/types";

/**
 * Who can see or manage Proposals. Super admin only, all three handlers — the
 * proposal_access policies (migration 045) say the same, so this check is for
 * the error message, not the enforcement.
 *
 * The real tier is read directly rather than through getCurrentUser(): during
 * a "View as" preview that reports the previewed tier.
 */
async function requireSuperAdmin(supabase: ReturnType<typeof createClient>) {
  const user = await getAuthUser(supabase);
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const { data: me } = await supabase.from("profiles").select("access_level").eq("id", user.id).single();
  if (me?.access_level !== "super_admin") {
    return { error: NextResponse.json({ error: "Only the super admin can manage who sees proposals." }, { status: 403 }) };
  }
  return { error: null };
}

export async function GET() {
  const supabase = createClient();
  const { error: denied } = await requireSuperAdmin(supabase);
  if (denied) return denied;

  // Two foreign keys to profiles (the person and who granted it), so the join
  // names the one it means.
  const { data, error } = await supabase
    .from("proposal_access")
    .select("user_id, role, profiles!proposal_access_user_id_fkey(name, avatar_url)")
    .order("granted_at", { ascending: true });

  if (error) {
    if (isProposalsMissing(error)) return NextResponse.json({ error: MIGRATION_045_MISSING, available: false }, { status: 400 });
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const entries: ProposalAccessEntry[] = (data || []).map((row) => {
    const person = row.profiles as unknown as { name?: string; avatar_url?: string | null } | null;
    return {
      userId: row.user_id as string,
      name: person?.name || "Unknown",
      avatarUrl: person?.avatar_url ?? null,
      role: row.role === "manager" ? "manager" : "viewer",
    };
  });

  return NextResponse.json({ entries });
}

/** Grant access, or change someone's role: `{ userId, role: "viewer" | "manager" }`. */
export async function PUT(req: NextRequest) {
  const supabase = createClient();
  const { error: denied } = await requireSuperAdmin(supabase);
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const userId = typeof body.userId === "string" ? body.userId : "";
  const role = body.role === "manager" || body.role === "viewer" ? body.role : null;
  if (!userId || !role) {
    return NextResponse.json({ error: "Choose a person and whether they can view or manage." }, { status: 400 });
  }

  const { data: target } = await supabase.from("profiles").select("access_level").eq("id", userId).maybeSingle();
  if (!target) {
    return NextResponse.json({ error: "That person no longer exists." }, { status: 404 });
  }
  // Stored and then ignored would be misleading: a super admin is always a manager.
  if (target.access_level === "super_admin") {
    return NextResponse.json({ error: "The super admin always has full access to proposals." }, { status: 400 });
  }

  const { error } = await supabase
    .from("proposal_access")
    .upsert({ user_id: userId, role, granted_at: new Date().toISOString() }, { onConflict: "user_id" });

  if (error) {
    if (isProposalsMissing(error)) return NextResponse.json({ error: MIGRATION_045_MISSING }, { status: 400 });
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ userId, role });
}

/** Revoke access: `?userId=`. */
export async function DELETE(req: NextRequest) {
  const supabase = createClient();
  const { error: denied } = await requireSuperAdmin(supabase);
  if (denied) return denied;

  const userId = new URL(req.url).searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "userId is required." }, { status: 400 });
  }

  const { error } = await supabase.from("proposal_access").delete().eq("user_id", userId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
