import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { notify } from "@/lib/notifications";
import { hasWorkType } from "@/lib/schemaSupport";

// Distinct project names across every place a project can be named, so
// pickers (e.g. the update/timer/project-assignment forms) can suggest
// existing projects while still letting the user type a brand new one.
//
// Also returns the distinct *task* names, from the same two logging tables —
// tasks are named the same free-text way, so the same picker serves both. They
// are kept in a separate list rather than merged: a task is never a project, and
// anything that assigns, renames or reports on projects must not see them.
export async function GET() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  type LogRow = { project: string; work_type?: string };

  /**
   * The names already used on logged work.
   *
   * Preferred source is the view from migration 043, which does the DISTINCT in
   * Postgres and returns a few dozen rows. Until that migration has been run,
   * this falls back to what it used to do — read the `project` column of both
   * log tables in full and distinct them here. Correct either way; the fallback
   * is just the slow one, and it stops being used once 043 lands.
   */
  const loggedNames = async (): Promise<LogRow[]> => {
    const { data: directory, error } = await supabase
      .from("project_name_directory")
      .select("project, work_type");
    if (!error) return (directory || []) as LogRow[];

    // `work_type` only exists after migration 040; asking for it before then
    // makes the whole select fail, which would empty every project picker in the
    // app. Two literal selects rather than one built from a variable — the
    // Supabase client parses the column list at the type level, so it can't be
    // dynamic.
    const workTypeReady = await hasWorkType(supabase);
    const scan = async (table: "daily_updates" | "time_entries"): Promise<LogRow[]> => {
      const { data } = workTypeReady
        ? await supabase.from(table).select("project, work_type")
        : await supabase.from(table).select("project");
      return (data || []) as LogRow[];
    };
    const [updates, entries] = await Promise.all([scan("daily_updates"), scan("time_entries")]);
    return [...updates, ...entries];
  };

  const [logged, { data: memberProjects }, { data: projectSettings }] = await Promise.all([
    loggedNames(),
    supabase.from("member_projects").select("project"),
    supabase.from("project_settings").select("project"),
  ]);

  const names = new Set<string>();
  const taskNames = new Set<string>();

  for (const row of logged) {
    // `work_type` is undefined until migration 040 runs; treat that as project
    // work, which is what every existing row is.
    if (row.work_type === "task") taskNames.add(row.project);
    else names.add(row.project);
  }
  for (const row of [...(memberProjects || []), ...(projectSettings || [])]) {
    names.add(row.project);
  }

  const byName = (a: string, b: string) => a.localeCompare(b);
  return NextResponse.json({
    projects: Array.from(names).sort(byName),
    tasks: Array.from(taskNames).sort(byName),
  });
}

// "Create a new project": sets the project's overview/PRD/timeline in
// project_settings and creates a member_projects row for each assigned member
// (each sees the others as co-developers). Projects aren't a real table, so
// this is really "seed the metadata + assignments that make a project show up
// meaningfully in the hub." Open to any signed-in member.
export async function POST(req: NextRequest) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Open to every signed-in member (migration 026 era) — the RLS policies for
  // project_settings and member_projects already allow it, and starting a
  // project shouldn't need an admin any more than documenting one does.
  const body = await req.json();
  const { project, overview, prd, timeline, memberIds } = body as {
    project?: string;
    overview?: string;
    prd?: string;
    timeline?: string;
    memberIds?: string[];
  };

  const name = project?.trim();
  if (!name) {
    return NextResponse.json({ error: "Project title is required." }, { status: 400 });
  }

  // Checked before the upsert below creates the row. This endpoint is also
  // re-run to add assignees to an existing project, and announcing "new project"
  // every time someone saved one would be noise.
  const { data: priorSettings } = await supabase
    .from("project_settings")
    .select("project")
    .eq("project", name)
    .maybeSingle();
  const isNewProject = !priorSettings;

  const { error: settingsError } = await supabase
    .from("project_settings")
    .upsert(
      { project: name, overview: overview || null, prd: prd || null, timeline: timeline || null },
      { onConflict: "project" }
    );

  if (settingsError) {
    return NextResponse.json({ error: settingsError.message }, { status: 400 });
  }

  const assignees = Array.from(new Set(memberIds || []));
  const notifiedAsAssignee = new Set<string>();

  if (assignees.length > 0) {
    const rows = assignees.map((memberId) => ({
      user_id: memberId,
      project: name,
      status: "Not Started",
      role: "",
      partner_ids: assignees.filter((id) => id !== memberId),
    }));

    // ignoreDuplicates: true so re-running this for an existing project
    // (e.g. assigning more people later) only inserts the missing
    // assignees, instead of resetting an already-set role/status back to
    // the defaults for people already on the project.
    //
    // The select() matters for notifications: ON CONFLICT DO NOTHING only
    // returns rows it actually inserted, so this is exactly the set of people
    // newly added. Notifying `assignees` instead would re-notify everyone
    // already on the project every time it's saved.
    const { data: inserted, error: assignError } = await supabase
      .from("member_projects")
      .upsert(rows, { onConflict: "user_id,project", ignoreDuplicates: true })
      .select("user_id");

    if (assignError) {
      return NextResponse.json({ error: assignError.message }, { status: 400 });
    }

    const newlyAssigned = (inserted || []).map((r) => r.user_id as string);
    newlyAssigned.forEach((id) => notifiedAsAssignee.add(id));

    await notify(supabase, {
      userIds: newlyAssigned,
      actorId: user.id,
      type: "project_assigned",
      project: name,
    });
  }

  // A brand-new project is announced to the whole team. Anyone already told
  // they were assigned is skipped — "you're on this" is the more useful of the
  // two messages, and nobody should get both. notify() drops the creator.
  if (isNewProject) {
    const { data: everyone } = await supabase.from("profiles").select("id");
    await notify(supabase, {
      userIds: (everyone || []).map((p) => p.id as string).filter((id) => !notifiedAsAssignee.has(id)),
      actorId: user.id,
      type: "project_created",
      project: name,
    });
  }

  return NextResponse.json({ ok: true, project: name });
}
