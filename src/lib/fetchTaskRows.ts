import type { SupabaseClient } from "@supabase/supabase-js";
import type { TaskRow } from "@/components/tasks/TasksView";
import { hasTasksTable } from "@/lib/schemaSupport";

/**
 * Everything logged as a task, rolled up per task name.
 *
 * The mirror image of the projects list: the same two tables, aggregated the
 * same way, over exactly the rows the projects list filters out. Callers must
 * check `hasWorkType` first — before migration 040 there is no column to filter
 * on and nothing can be a task.
 */
export async function fetchTaskRows(supabase: SupabaseClient): Promise<TaskRow[]> {
  // Declared tasks (migration 041) come first, so one created but not yet worked
  // on still appears — exactly as a project created via "New project" shows up
  // in the projects list before anyone logs against it.
  const declared = (await hasTasksTable(supabase))
    ? (await supabase.from("tasks").select("name, description")).data ?? []
    : [];

  const [{ data: updates }, { data: timeEntries }] = await Promise.all([
    supabase
      .from("daily_updates")
      .select("id, project, date, update, status, user_id, profiles(id, name, avatar_url)")
      .eq("work_type", "task")
      .order("date", { ascending: false }),
    supabase
      .from("time_entries")
      .select("id, project, date, duration_minutes, user_id, profiles(id, name, avatar_url)")
      .eq("work_type", "task")
      .order("date", { ascending: false }),
  ]);

  interface Person {
    id: string;
    name: string;
    avatarUrl: string | null;
  }

  const tasks = new Map<
    string,
    {
      description: string | null;
      status: string | null;
      people: Map<string, Person>;
      totalMinutes: number;
      updateCount: number;
      entryCount: number;
      lastActivity: string;
      latestNote: string | null;
    }
  >();

  function get(name: string) {
    if (!tasks.has(name)) {
      tasks.set(name, {
        description: null,
        status: null,
        people: new Map(),
        totalMinutes: 0,
        updateCount: 0,
        entryCount: 0,
        lastActivity: "",
        latestNote: null,
      });
    }
    return tasks.get(name)!;
  }

  for (const t of declared) {
    get(t.name as string).description = (t.description as string | null) ?? null;
  }

  function addPerson(entry: ReturnType<typeof get>, row: { user_id: string; profiles: unknown }) {
    const p = row.profiles as { name?: string; avatar_url?: string | null } | null;
    if (!p?.name) return;
    entry.people.set(row.user_id, { id: row.user_id, name: p.name, avatarUrl: p.avatar_url ?? null });
  }

  // Both queries come back newest-first, so the first row seen for a task is its
  // most recent — no date comparison needed to find the latest note.
  for (const u of updates || []) {
    const entry = get(u.project as string);
    entry.updateCount += 1;
    addPerson(entry, u as { user_id: string; profiles: unknown });
    const date = u.date as string;
    if (date > entry.lastActivity) entry.lastActivity = date;
    if (entry.latestNote === null && u.update) entry.latestNote = u.update as string;
    // Newest-first, so the first status seen is the current one — the same rule
    // the projects list uses when a project has no settings row.
    if (entry.status === null && u.status) entry.status = u.status as string;
  }

  for (const t of timeEntries || []) {
    const entry = get(t.project as string);
    entry.entryCount += 1;
    entry.totalMinutes += (t.duration_minutes as number) || 0;
    addPerson(entry, t as { user_id: string; profiles: unknown });
    const date = t.date as string;
    if (date > entry.lastActivity) entry.lastActivity = date;
  }

  return Array.from(tasks.entries())
    .map(([name, d]) => ({
      name,
      description: d.description,
      // A task declared but not yet worked on has no update to take a status
      // from, so it reads as not started — same as such a project would.
      status: d.status || "Not Started",
      people: Array.from(d.people.values()),
      totalMinutes: d.totalMinutes,
      updateCount: d.updateCount,
      entryCount: d.entryCount,
      lastActivity: d.lastActivity || null,
      latestNote: d.latestNote,
    }))
    .sort((a, b) => (b.lastActivity || "").localeCompare(a.lastActivity || ""));
}
