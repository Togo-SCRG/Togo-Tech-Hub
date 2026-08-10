import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hasTasksTable, hasWorkType } from "@/lib/schemaSupport";

/**
 * Create a task up front — the counterpart to POST /api/projects.
 *
 * A task can also come into existence by logging work against a new name, the
 * same way a project can. This is for the other case: setting one up, and
 * writing down what it's for, before any hours exist.
 */
export async function POST(req: NextRequest) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await hasTasksTable(supabase))) {
    return NextResponse.json(
      { error: "Tasks aren't set up yet — run migration 041 in Supabase." },
      { status: 400 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";

  if (!name) {
    return NextResponse.json({ error: "Task name is required." }, { status: 400 });
  }
  if (name.length > 120) {
    return NextResponse.json({ error: "That name is too long (120 characters max)." }, { status: 400 });
  }

  // Refuse a name already in use as a project. The two live in the same `project`
  // column on the logged rows, so sharing a name would make the two impossible to
  // tell apart in any report.
  const [{ data: settingsClash }, { data: taskClash }] = await Promise.all([
    supabase.from("project_settings").select("project").ilike("project", name).limit(1),
    supabase.from("tasks").select("name").ilike("name", name).limit(1),
  ]);
  if (settingsClash && settingsClash.length > 0) {
    return NextResponse.json(
      { error: `“${name}” is already a project. Pick a different name.` },
      { status: 409 }
    );
  }
  if (taskClash && taskClash.length > 0) {
    return NextResponse.json({ error: `A task called “${name}” already exists.` }, { status: 409 });
  }

  const { data, error } = await supabase
    .from("tasks")
    .insert({ name, description: description || null, created_by: user.id })
    .select("name, description")
    .single();

  if (error) {
    const denied = error.code === "42501";
    return NextResponse.json(
      { error: denied ? "You don't have permission to create a task." : error.message },
      { status: denied ? 403 : 400 }
    );
  }

  return NextResponse.json({ task: { name: data.name, description: data.description } }, { status: 201 });
}

/**
 * Delete tasks, and everything logged against them.
 *
 * The same shape as deleting a project: the row that names it, plus its updates
 * and time entries. Scoped to `work_type = 'task'` so a project sharing the name
 * is never touched.
 */
export async function DELETE(req: NextRequest) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const names: string[] = Array.isArray(body.names)
    ? Array.from(new Set(body.names.filter((n: unknown): n is string => typeof n === "string" && !!n.trim())))
    : [];

  if (names.length === 0) {
    return NextResponse.json({ error: "Select at least one task." }, { status: 400 });
  }

  const workTypeReady = await hasWorkType(supabase);
  if (workTypeReady) {
    const [updates, entries] = await Promise.all([
      supabase.from("daily_updates").delete().in("project", names).eq("work_type", "task"),
      supabase.from("time_entries").delete().in("project", names).eq("work_type", "task"),
    ]);
    const failed = [updates, entries].find((r) => r.error);
    if (failed?.error) {
      const denied = failed.error.code === "42501";
      return NextResponse.json(
        { error: denied ? "You don't have permission to delete this work." : failed.error.message },
        { status: denied ? 403 : 400 }
      );
    }
  }

  // Last, and tolerated if the table isn't there — a task that only ever existed
  // as logged rows has nothing here to remove.
  if (await hasTasksTable(supabase)) {
    const { error } = await supabase.from("tasks").delete().in("name", names);
    if (error) {
      const denied = error.code === "42501";
      return NextResponse.json(
        { error: denied ? "You don't have permission to delete a task." : error.message },
        { status: denied ? 403 : 400 }
      );
    }
  }

  return NextResponse.json({ ok: true, deleted: names.length });
}
