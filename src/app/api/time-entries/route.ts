import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensureMemberProject } from "@/lib/memberProjects";
import { normaliseWorkType } from "@/lib/workType";
import { hasWorkType } from "@/lib/schemaSupport";

function toCamel(row: any) {
  return {
    id: row.id,
    userId: row.user_id,
    user: row.profiles
      ? { id: row.profiles.id, name: row.profiles.name, avatarUrl: row.profiles.avatar_url, role: row.profiles.role }
      : undefined,
    project: row.project,
    workType: normaliseWorkType(row.work_type),
    phase: row.phase,
    date: row.date,
    durationMinutes: row.duration_minutes,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function GET(req: NextRequest) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const userId = searchParams.get("userId");
  const project = searchParams.get("project");

  let query = supabase
    .from("time_entries")
    .select("*, profiles(id, name, avatar_url, role)")
    .order("date", { ascending: false })
    .order("created_at", { ascending: false });

  if (from) query = query.gte("date", from);
  if (to) query = query.lte("date", to);
  if (userId) query = query.eq("user_id", userId);
  if (project) query = query.eq("project", project);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ entries: data.map(toCamel) });
}

export async function POST(req: NextRequest) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { userId, project, phase, date, durationMinutes, note } = body;
  const workType = normaliseWorkType(body.workType);

  // See the same guard in /api/updates: project work keeps working before
  // migration 040, and only an actual task is refused, with a reason.
  const workTypeReady = await hasWorkType(supabase);
  if (workType === "task" && !workTypeReady) {
    return NextResponse.json(
      { error: "Tasks aren't set up yet — run migration 040 in Supabase." },
      { status: 400 }
    );
  }

  if (!project || !date || !durationMinutes) {
    return NextResponse.json(
      { error: `${workType === "task" ? "Task" : "Project"}, date, and duration are required.` },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("time_entries")
    .insert({
      user_id: userId || user.id,
      project,
      ...(workTypeReady ? { work_type: workType } : {}),
      phase: phase || "",
      date,
      duration_minutes: durationMinutes,
      note: note || "",
    })
    .select("*, profiles(id, name, avatar_url, role)")
    .single();

  if (error) {
    const status = error.code === "42501" ? 403 : 400;
    return NextResponse.json({ error: error.message }, { status });
  }

  // Only project work puts you on a project. A task has no team to join, and
  // creating a member_projects row for one would list it as a project.
  if (workType === "project") {
    await ensureMemberProject(supabase, data.user_id, project, "In Progress");
  }

  return NextResponse.json({ entry: toCamel(data) }, { status: 201 });
}
