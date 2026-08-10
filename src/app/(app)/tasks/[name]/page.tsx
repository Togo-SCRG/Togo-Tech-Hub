import { notFound } from "next/navigation";
import { Zap } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { BackButton } from "@/components/layout/BackButton";
import { Avatar } from "@/components/ui/Avatar";
import { PhaseBadge } from "@/components/timetracker/PhaseBadge";
import { TaskDescription } from "@/components/tasks/TaskDescription";
import { ProjectActivityFeed, type ActivityEvent } from "@/components/projects/ProjectActivityFeed";
import { hasTasksTable, hasWorkType } from "@/lib/schemaSupport";
import { formatDateShort, formatMinutes } from "@/lib/utils";

/**
 * One task, in the shape of the project page minus everything a task doesn't
 * have — no status, timeline, hour cap, blockers, PRD or team roster.
 *
 * What's left is what a task actually accumulates: a description, the hours
 * logged against it, and who logged them.
 */
export default async function TaskDetailPage({ params }: { params: { name: string } }) {
  const taskName = decodeURIComponent(params.name);
  const supabase = createClient();

  // Before migration 040 nothing can be a task, so no task page can resolve.
  if (!(await hasWorkType(supabase))) notFound();

  const [{ data: updates }, { data: timeEntries }, declared] = await Promise.all([
    supabase
      .from("daily_updates")
      .select("id, update, status, date, created_at, user_id, profiles(name, avatar_url)")
      .eq("project", taskName)
      .eq("work_type", "task")
      .order("date", { ascending: false }),
    supabase
      .from("time_entries")
      .select("id, duration_minutes, date, phase, note, created_at, user_id, profiles(name, avatar_url)")
      .eq("project", taskName)
      .eq("work_type", "task")
      .order("date", { ascending: false }),
    (await hasTasksTable(supabase))
      ? supabase.from("tasks").select("name, description").eq("name", taskName).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const allUpdates = updates || [];
  const allEntries = timeEntries || [];

  // A task is "real" if it was declared or anything was logged against it — the
  // same union rule the projects page uses.
  if (!declared?.data && allUpdates.length === 0 && allEntries.length === 0) {
    notFound();
  }

  const people = new Map<string, { name: string; avatarUrl: string | null; minutes: number }>();
  function seen(userId: string, profile: unknown, minutes: number) {
    const p = profile as { name?: string; avatar_url?: string | null } | null;
    const existing = people.get(userId);
    if (existing) {
      existing.minutes += minutes;
      return;
    }
    people.set(userId, { name: p?.name || "Someone", avatarUrl: p?.avatar_url ?? null, minutes });
  }
  for (const u of allUpdates) seen(u.user_id as string, u.profiles, 0);
  for (const t of allEntries) seen(t.user_id as string, t.profiles, (t.duration_minutes as number) || 0);

  const totalMinutes = allEntries.reduce((sum, t) => sum + ((t.duration_minutes as number) || 0), 0);
  const peopleList = [...people.values()].sort((a, b) => b.minutes - a.minutes);

  const ACTIVITY_LIMIT = 25;
  const activityEvents: ActivityEvent[] = [
    ...allUpdates.map((u) => ({
      id: u.id as string,
      kind: "update" as const,
      userName: (u.profiles as unknown as { name?: string } | null)?.name || "Someone",
      date: u.date as string,
      at: (u.created_at as string) || (u.date as string),
      status: u.status as string,
      text: (u.update as string) || null,
    })),
    ...allEntries.map((t) => ({
      id: t.id as string,
      kind: "time" as const,
      userName: (t.profiles as unknown as { name?: string } | null)?.name || "Someone",
      date: t.date as string,
      at: (t.created_at as string) || (t.date as string),
      minutes: t.duration_minutes as number,
      phase: (t.phase as string) || null,
      text: (t.note as string) || null,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const lastActivity = activityEvents[0]?.date ?? null;

  const headerStats: { label: string; value: string }[] = [
    { label: "Total hours", value: totalMinutes > 0 ? formatMinutes(totalMinutes) : "0h" },
    { label: "People", value: `${peopleList.length} ${peopleList.length === 1 ? "person" : "people"}` },
    { label: "Entries", value: String(allEntries.length) },
    { label: "Updates", value: String(allUpdates.length) },
    { label: "Last activity", value: lastActivity ? formatDateShort(lastActivity) : "—" },
  ];

  return (
    <div className="w-full">
      <BackButton label="Back to tasks" fallbackHref="/projects" />

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-4">
          <header className="rounded-md border border-togo-border bg-togo-surface p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h1 className="text-xl font-extrabold text-togo-white">
                <span className="text-togo-muted">Task: </span>
                {taskName}
              </h1>
              {/* Says plainly what kind of thing this is, since the page looks
                  much like a project's. */}
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-togo-border bg-togo-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-togo-muted">
                <Zap size={10} /> Not a project
              </span>
            </div>

            <dl className="mt-4 flex flex-wrap items-stretch gap-x-6 gap-y-3 border-t border-togo-border pt-3">
              {headerStats.map((s, i) => (
                <div key={s.label} className={i > 0 ? "border-l border-togo-border pl-6" : undefined}>
                  <dt className="text-[10px] uppercase tracking-wider text-togo-faint">{s.label}</dt>
                  <dd className="tnum mt-0.5 text-sm font-bold text-togo-white">{s.value}</dd>
                </div>
              ))}
            </dl>
          </header>

          <TaskDescription taskName={taskName} initialDescription={declared?.data?.description ?? ""} />

          <section className="overflow-hidden rounded-md border border-togo-border bg-togo-surface">
            <div className="flex items-center gap-2 border-b border-togo-border px-4 py-3">
              <h2 className="text-sm font-bold text-togo-white">Time logged</h2>
              <span className="tnum rounded bg-togo-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-togo-muted">
                {allEntries.length}
              </span>
              {totalMinutes > 0 && (
                <span className="tnum ml-auto text-xs text-togo-faint">{formatMinutes(totalMinutes)}</span>
              )}
            </div>

            {allEntries.length === 0 ? (
              <p className="px-4 py-5 text-xs text-togo-muted">
                No time logged yet. Track time against this task from Daily Updates or the timer.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px] text-sm">
                  <thead>
                    <tr className="border-b border-togo-border text-left">
                      <th scope="col" className="section-label whitespace-nowrap px-4 py-3">
                        Name
                      </th>
                      <th scope="col" className="section-label whitespace-nowrap px-4 py-3">
                        Date
                      </th>
                      <th scope="col" className="section-label whitespace-nowrap px-4 py-3">
                        Duration
                      </th>
                      <th scope="col" className="section-label whitespace-nowrap px-4 py-3">
                        Phase
                      </th>
                      <th scope="col" className="section-label px-4 py-3">
                        What Was Done
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-togo-border">
                    {allEntries.map((t) => {
                      const author = t.profiles as unknown as {
                        name?: string;
                        avatar_url?: string | null;
                      } | null;
                      return (
                        <tr key={t.id as string} className="transition-colors hover:bg-[var(--togo-hover)]">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2 whitespace-nowrap">
                              <Avatar name={author?.name || "?"} avatarUrl={author?.avatar_url ?? null} size="sm" />
                              <span className="font-semibold text-togo-white">{author?.name || "Someone"}</span>
                            </div>
                          </td>
                          <td className="tnum whitespace-nowrap px-4 py-3 text-togo-muted">
                            {formatDateShort(t.date as string)}
                          </td>
                          <td className="tnum whitespace-nowrap px-4 py-3 font-semibold text-togo-blue">
                            {formatMinutes((t.duration_minutes as number) || 0)}
                          </td>
                          <td className="px-4 py-3">
                            <PhaseBadge phase={(t.phase as string) || ""} />
                          </td>
                          <td className="max-w-xs px-4 py-3 text-togo-muted">
                            {t.note ? (
                              <span className="line-clamp-3" title={t.note as string}>
                                {t.note as string}
                              </span>
                            ) : (
                              <span className="text-togo-faint">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20">
          <section className="overflow-hidden rounded-md border border-togo-border bg-togo-surface">
            <div className="flex items-center gap-2 border-b border-togo-border px-4 py-3">
              <h2 className="text-sm font-bold text-togo-white">People</h2>
              <span className="tnum rounded bg-togo-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-togo-muted">
                {peopleList.length}
              </span>
            </div>
            {peopleList.length === 0 ? (
              <p className="px-4 py-5 text-xs text-togo-muted">
                Nobody has logged against this task yet.
              </p>
            ) : (
              <ul className="divide-y divide-togo-border">
                {peopleList.map((p) => (
                  <li key={p.name} className="flex items-center gap-2.5 px-4 py-2.5">
                    <Avatar name={p.name} avatarUrl={p.avatarUrl} size="sm" className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-togo-white">{p.name}</span>
                    {p.minutes > 0 && (
                      <span className="tnum shrink-0 text-[10px] text-togo-faint">{formatMinutes(p.minutes)}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <ProjectActivityFeed
            events={activityEvents.slice(0, ACTIVITY_LIMIT)}
            total={activityEvents.length}
            subject="task"
          />
        </aside>
      </div>
    </div>
  );
}
