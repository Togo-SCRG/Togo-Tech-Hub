import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { capabilitiesFor } from "@/lib/permissions";
import type { AccessLevel } from "@/types";
import { ensureMemberProject } from "@/lib/memberProjects";
import { notify } from "@/lib/notifications";
import { syncProjectStatus } from "@/lib/syncProjectStatus";
import { normaliseWorkType } from "@/lib/workType";
import { hasWorkType } from "@/lib/schemaSupport";

function toCamel(row: any) {
  return {
    id: row.id,
    userId: row.user_id,
    user: row.profiles
      ? { id: row.profiles.id, name: row.profiles.name, avatarUrl: row.profiles.avatar_url, role: row.profiles.role }
      : undefined,
    date: row.date,
    project: row.project,
    workType: normaliseWorkType(row.work_type),
    update: row.update,
    whatsLeft: row.whats_left,
    timeline: row.timeline,
    blockers: row.blockers,
    status: row.status,
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
  const date = searchParams.get("date");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  // A tier without "see everyone's tasks" only ever receives their own —
  // enforced here, not just hidden in the UI, so the rows never leave the
  // server. Driven by the permission matrix, so the super admin can change who
  // gets team-wide visibility without a code change.
  const { data: callerProfile } = await supabase
    .from("profiles")
    .select("access_level")
    .eq("id", user.id)
    .single();
  const caps = await capabilitiesFor(supabase, callerProfile?.access_level as AccessLevel, user.id);
  const seesEveryone = caps.includes("tracker.view.all");

  let query = supabase
    .from("daily_updates")
    .select("*, profiles(id, name, avatar_url, role)")
    // Both descending: newest day first, and within a day the most recently
    // logged first. created_at was ascending, which sent a just-saved update to
    // the bottom of today's rows instead of the top — every update on a given
    // day shares the same `date`, so this tiebreak is the only thing deciding
    // where a new one lands.
    .order("date", { ascending: false })
    .order("created_at", { ascending: false });

  if (!seesEveryone) {
    query = query.eq("user_id", user.id);
  }

  if (date) {
    query = query.eq("date", date);
  } else {
    if (from) query = query.gte("date", from);
    if (to) query = query.lte("date", to);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ updates: data.map(toCamel) });
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
  const { userId, date, project, update, whatsLeft, timeline, blockers, status } = body;
  const workType = normaliseWorkType(body.workType);
  const isTaskEntry = workType === "task";

  // Before migration 040 the column doesn't exist. Logging normal project work
  // must keep working regardless — only an actual task is refused, and it says
  // why rather than failing on a raw Postgres error.
  const workTypeReady = await hasWorkType(supabase);
  if (isTaskEntry && !workTypeReady) {
    return NextResponse.json(
      { error: "Tasks aren't set up yet — run migration 040 in Supabase." },
      { status: 400 }
    );
  }

  if (!project || !date) {
    return NextResponse.json(
      { error: `${isTaskEntry ? "Task" : "Project"} and date are required.` },
      { status: 400 }
    );
  }

  // Projects aren't a table — typing a name nobody has used before in the log
  // form creates one just as surely as the New Project button does, so it gets
  // the same announcement. Checked before the insert, or the row we're about to
  // write would make every project look pre-existing. Tasks announce nothing:
  // "Meetings" is not a new project and nobody needs telling about it.
  const projectExisted = isTaskEntry ? true : await projectAlreadyExists(supabase, project);

  const { data, error } = await supabase
    .from("daily_updates")
    .insert({
      user_id: userId || user.id,
      date,
      project,
      ...(workTypeReady ? { work_type: workType } : {}),
      update: update || "",
      whats_left: whatsLeft || "",
      timeline: timeline || "",
      blockers: blockers || "",
      status: status || "In Progress",
    })
    .select("*, profiles(id, name, avatar_url, role)")
    .single();

  if (error) {
    const status = error.code === "42501" ? 403 : 400;
    return NextResponse.json({ error: error.message }, { status });
  }

  // Both of these are project bookkeeping, and a task is not a project: it has
  // no team to join and no status of its own to carry. Running either would put
  // the task in the projects list, which is the whole thing tasks exist to avoid.
  if (!isTaskEntry) {
    await ensureMemberProject(supabase, data.user_id, project, status || "In Progress");

    // The form's status field is the *project's* status, so it lands on the
    // project too. After ensureMemberProject, because logging an update is what
    // makes the author a member — which is what the status trigger checks.
    await syncProjectStatus(supabase, project, status || "In Progress");
  }

  if (!projectExisted) {
    const { data: everyone } = await supabase.from("profiles").select("id");
    await notify(supabase, {
      // The author is skipped by notify() itself — they know what they just did.
      userIds: (everyone || []).map((p) => p.id as string),
      actorId: user.id,
      type: "project_created",
      project,
    });
  }

  return NextResponse.json({ update: toCamel(data) }, { status: 201 });
}

/**
 * Whether anything in the app already refers to this project name.
 *
 * A project "exists" if any of the four tables that can name one has a row for
 * it — the same union the project list is built from. Checking only
 * project_settings would announce a project every time someone logged a second
 * update against one that had never been given an overview.
 */
async function projectAlreadyExists(
  supabase: ReturnType<typeof createClient>,
  project: string
): Promise<boolean> {
  const [settings, updates, entries, assignments] = await Promise.all([
    supabase.from("project_settings").select("project").eq("project", project).limit(1),
    supabase.from("daily_updates").select("project").eq("project", project).limit(1),
    supabase.from("time_entries").select("project").eq("project", project).limit(1),
    supabase.from("member_projects").select("project").eq("project", project).limit(1),
  ]);
  return [settings, updates, entries, assignments].some((r) => (r.data?.length ?? 0) > 0);
}
