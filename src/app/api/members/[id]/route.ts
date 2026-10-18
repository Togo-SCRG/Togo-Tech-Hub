import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { capabilitiesFor } from "@/lib/permissions";
import type { AccessLevel } from "@/types";

function toCamelUpdate(row: any) {
  return {
    id: row.id,
    userId: row.user_id,
    date: row.date,
    project: row.project,
    update: row.update,
    whatsLeft: row.whats_left,
    timeline: row.timeline,
    blockers: row.blockers,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const BASE_COLUMNS = "id, name, email, avatar_url, role, access_level, bio, skills, github_url";

  let { data: profile, error } = await supabase
    .from("profiles")
    .select(`${BASE_COLUMNS}, phone`)
    .eq("id", params.id)
    .single();

  // `phone` arrives with migration 017. Selecting a column that doesn't exist
  // fails the whole query, which would 404 every profile on a database where
  // the migration hasn't been run yet — so fall back to the columns that are
  // definitely there rather than making the deploy order matter.
  if (error?.code === "42703") {
    ({ data: profile, error } = await supabase
      .from("profiles")
      .select(BASE_COLUMNS)
      .eq("id", params.id)
      .single());
  }

  if (error || !profile) {
    return NextResponse.json({ error: "Member not found." }, { status: 404 });
  }

  const { data: updates } = await supabase
    .from("daily_updates")
    .select("*")
    .eq("user_id", params.id)
    .order("date", { ascending: false });

  return NextResponse.json({
    member: {
      id: profile.id,
      name: profile.name,
      email: profile.email,
      phone: "phone" in profile ? profile.phone : null,
      avatarUrl: profile.avatar_url,
      role: profile.role,
      accessLevel: profile.access_level,
      bio: profile.bio,
      skills: profile.skills,
      githubUrl: profile.github_url,
      updates: (updates || []).map(toCamelUpdate),
    },
  });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { name, role, bio, skills, githubUrl, avatarUrl, phone, email } = body;

  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name;
  if (role !== undefined) data.role = role;
  if (bio !== undefined) data.bio = bio;
  if (skills !== undefined) data.skills = skills;
  if (githubUrl !== undefined) data.github_url = githubUrl;
  if (avatarUrl !== undefined) data.avatar_url = avatarUrl;
  if (phone !== undefined) data.phone = phone;

  // An email change has to touch auth.users as well as profiles. profiles.email
  // is only ever populated from auth at signup (handle_new_user, migration 001)
  // with no sync trigger after that — writing just the profile row would leave
  // the address shown on the page different from the one the person signs in
  // with, and nothing would surface the mismatch.
  if (email !== undefined) {
    const nextEmail = String(email).trim().toLowerCase();

    const { data: existing } = await supabase
      .from("profiles")
      .select("email")
      .eq("id", params.id)
      .single();
    const currentEmail = (existing?.email || "").toLowerCase();

    if (nextEmail !== currentEmail) {
      if (!nextEmail) {
        return NextResponse.json({ error: "Email can't be empty." }, { status: 400 });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
        return NextResponse.json({ error: "That doesn't look like a valid email address." }, { status: 400 });
      }

      // Changing a sign-in address is consequential, so mirror the profile RLS
      // rule explicitly: your own account, or the super admin acting on anyone.
      const { data: caller } = await supabase
        .from("profiles")
        .select("access_level")
        .eq("id", user.id)
        .single();
      const isSelf = user.id === params.id;
      if (!isSelf && caller?.access_level !== "super_admin") {
        return NextResponse.json({ error: "Only the super admin can change someone else's email." }, { status: 403 });
      }

      // Service role, because the REST API never exposes auth.users writes to
      // the authenticated role. email_confirm keeps the account usable straight
      // away rather than locking the person out pending a confirmation click.
      const admin = createAdminClient();
      const { error: authError } = await admin.auth.admin.updateUserById(params.id, {
        email: nextEmail,
        email_confirm: true,
      });

      if (authError) {
        const duplicate = /already|registered|exists/i.test(authError.message);
        return NextResponse.json(
          { error: duplicate ? "Another account already uses that email." : authError.message },
          { status: 400 }
        );
      }

      data.email = nextEmail;
    }
  }

  const UPDATED_COLUMNS = "id, name, email, avatar_url, role, bio, skills, github_url";

  let { data: updated, error } = await supabase
    .from("profiles")
    .update(data)
    .eq("id", params.id)
    .select(`${UPDATED_COLUMNS}, phone`)
    .single();

  // Same migration-017 tolerance as the read path above: drop `phone` and
  // retry rather than failing the whole save on an older database.
  if (error?.code === "42703") {
    delete data.phone;
    ({ data: updated, error } = await supabase
      .from("profiles")
      .update(data)
      .eq("id", params.id)
      .select(UPDATED_COLUMNS)
      .single());
  }

  if (error || !updated) {
    return NextResponse.json({ error: "You can only edit your own profile." }, { status: 403 });
  }

  return NextResponse.json({
    member: {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      phone: "phone" in updated ? updated.phone : null,
      avatarUrl: updated.avatar_url,
      role: updated.role,
      bio: updated.bio,
      skills: updated.skills,
      githubUrl: updated.github_url,
    },
  });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Checked against the permission matrix, not is_admin: as of migration 035
  // deleting accounts isn't an admin default, and this route uses the
  // service-role client below — so RLS won't catch it if this check doesn't.
  const { data: callerProfile } = await supabase
    .from("profiles")
    .select("access_level")
    .eq("id", user.id)
    .single();
  const caps = await capabilitiesFor(supabase, callerProfile?.access_level as AccessLevel, user.id);
  if (!caps.includes("member.delete")) {
    return NextResponse.json({ error: "You don't have permission to delete accounts." }, { status: 403 });
  }

  if (params.id === user.id) {
    return NextResponse.json({ error: "You can't delete your own account." }, { status: 400 });
  }

  // Deleting the auth user cascades to profiles (and from there to
  // daily_updates, time_entries, and member_projects via their FKs) —
  // no service-role bypass needed for those, just for this auth.users
  // deletion itself, which the REST API never exposes to anon/authenticated
  // roles.
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(params.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
