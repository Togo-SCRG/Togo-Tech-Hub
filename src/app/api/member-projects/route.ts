import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { notify } from "@/lib/notifications";

function toCamel(row: any, projectStatus?: string | null) {
  return {
    id: row.id,
    userId: row.user_id,
    project: row.project,
    status: row.status,
    // The project's status, not this person's. The profile shows one status per
    // project card and it should be the project's — a card reading "Not Started"
    // for a project that's In Progress everywhere else was just wrong.
    projectStatus: projectStatus ?? null,
    role: row.role,
    partnerIds: row.partner_ids || [],
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
  const userId = searchParams.get("userId");

  let query = supabase.from("member_projects").select("*").order("created_at", { ascending: false });
  if (userId) query = query.eq("user_id", userId);

  // project_settings is small (one row per project) and independent of the rows
  // above, so it rides along concurrently rather than adding a round trip.
  const [{ data, error }, { data: settings }] = await Promise.all([
    query,
    supabase.from("project_settings").select("project, status"),
  ]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const statusByProject = new Map((settings || []).map((s) => [s.project, s.status]));

  return NextResponse.json({
    projects: data.map((row) => toCamel(row, statusByProject.get(row.project))),
  });
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
  const { userId, project, status, role, partnerIds } = body;

  if (!project) {
    return NextResponse.json({ error: "Project is required." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("member_projects")
    .insert({
      user_id: userId || user.id,
      project,
      status: status || "In Progress",
      role: role || "",
      partner_ids: partnerIds || [],
    })
    .select("*")
    .single();

  if (error) {
    const statusCode = error.code === "42501" ? 403 : 400;
    return NextResponse.json({ error: error.message }, { status: statusCode });
  }

  // Tell them they've been put on it. Skipped automatically when someone adds
  // themselves, and best-effort so it can't fail the assignment.
  await notify(supabase, {
    userIds: [data.user_id],
    actorId: user.id,
    type: "project_assigned",
    project: data.project,
    role: data.role,
  });

  return NextResponse.json({ project: toCamel(data) }, { status: 201 });
}
