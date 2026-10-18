import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser } from "@/lib/auth";

/**
 * Raise a blocker against a project.
 *
 * Deliberately does NOT write a daily_updates row. Doing that was the old
 * behaviour and it made "Add blocker" post a phantom update that showed up in
 * the tracker, Daily Updates and the author's activity feed. A blocker is
 * project state, not a report of work done.
 *
 * Permission is enforced by the RLS policy from migration 038 (hold
 * `blocker.manage`, and either `project.manage.all` or be on the project), so a
 * denial arrives as a 42501 to pass through rather than being re-checked here.
 */
export async function POST(req: NextRequest) {
  const supabase = createClient();

  const user = await getAuthUser(supabase);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const project = typeof body.project === "string" ? body.project.trim() : "";
  const blocker = typeof body.blocker === "string" ? body.blocker.trim() : "";

  if (!project) {
    return NextResponse.json({ error: "project is required." }, { status: 400 });
  }
  if (!blocker) {
    return NextResponse.json({ error: "Blocker text is required." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("project_blockers")
    .insert({ project, user_id: user.id, blocker })
    .select("id, project, blocker, created_at, profiles(name, avatar_url)")
    .single();

  if (error) {
    if (error.code === "42P01" || /project_blockers/i.test(error.message)) {
      return NextResponse.json(
        { error: "Blockers aren't set up yet — run migration 038 in Supabase." },
        { status: 400 }
      );
    }
    const denied = error.code === "42501";
    return NextResponse.json(
      { error: denied ? "You don't have permission to raise a blocker on this project." : error.message },
      { status: denied ? 403 : 400 }
    );
  }

  const author = data.profiles as unknown as { name?: string; avatar_url?: string | null } | null;
  return NextResponse.json({
    blocker: {
      id: data.id,
      project: data.project,
      blockers: data.blocker,
      userName: author?.name || "You",
      avatarUrl: author?.avatar_url ?? null,
      date: (data.created_at as string).slice(0, 10),
      source: "project" as const,
    },
  });
}
