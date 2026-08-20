import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { compareByRole } from "@/lib/utils";

interface ProfileRow {
  id: string;
  name: string;
  avatar_url: string | null;
  role: string;
  bio: string | null;
  skills: string | null;
  github_url: string | null;
  is_admin: boolean;
  invited_at?: string | null;
  signed_in_at?: string | null;
}

export async function GET(req: NextRequest) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Client stakeholders (the admin tier) are normally excluded — they don't log
  // updates, so they'd be noise in the Team list and the engineer pickers. But
  // they do get assigned to projects, so `?all=1` includes them for the
  // project-team picker.
  const includeClients = new URL(req.url).searchParams.get("all") === "1";

  // Everything this route feeds is a picker or a filter: assign a project, log
  // an update for someone, filter by engineer. Somebody who has been invited
  // but never signed in can't be any of those things yet, so they're excluded —
  // otherwise you could assign work to an account nobody has opened. They're
  // still listed on the Team page's Pending tab and on Access Levels, which is
  // where chasing them belongs.
  const BASE = "id, name, avatar_url, role, bio, skills, github_url, is_admin";

  function build(columns: string) {
    let q = supabase.from("profiles").select(columns);
    if (!includeClients) q = q.neq("access_level", "client");
    return q;
  }

  // invited_at/signed_in_at arrive with migration 018; without them nobody can
  // be pending, so fall back to the base columns rather than failing.
  let { data: profiles, error } = await build(`${BASE}, invited_at, signed_in_at`);
  if (error) {
    ({ data: profiles, error } = await build(BASE));
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // No update rows here. This route used to read *every* row of daily_updates,
  // sort it, and attach each person's five most recent — and nothing consumed
  // them: everything this endpoint feeds is a picker or a filter, which needs
  // id/name/avatar/role. The one screen that shows a member's updates is the
  // profile page, which loads them from /api/members/[id]. So this was a
  // full-table read, growing with every update logged, on an endpoint that most
  // pages in the app call on mount.
  //
  // MemberItem.updates stays optional on the type for that other route's sake.

  // Cast through unknown: the column list is chosen at run time (see the
  // fallback above), so supabase-js can't infer the row shape from it.
  const members = (profiles as unknown as ProfileRow[])
    .filter((p) => !(p.invited_at && !p.signed_in_at))
    .map((p) => ({
      id: p.id,
      name: p.name,
      avatarUrl: p.avatar_url,
      role: p.role,
      bio: p.bio,
      skills: p.skills,
      githubUrl: p.github_url,
    }))
    .sort(compareByRole);

  return NextResponse.json({ members });
}

// Account creation lives in POST /api/users, which is tier-aware (admins may
// create admin/user accounts, the super admin any tier) and returns the
// generated password once. This route used to have its own near-identical
// super-admin-only POST; two endpoints provisioning accounts by slightly
// different rules is a trap, so it was consolidated.
