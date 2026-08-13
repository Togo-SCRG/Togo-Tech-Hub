import { createClient } from "@/lib/supabase/server";
import { ProjectsTabs } from "@/components/projects/ProjectsTabs";
import { fetchTaskRows } from "@/lib/fetchTaskRows";
import { fetchProjectBlockers } from "@/lib/projectBlockers";
import { isRealBlocker } from "@/lib/blockers";
import { hasWorkType, onlyProjectWork } from "@/lib/schemaSupport";

interface Participant {
  userId: string;
  name: string;
  avatarUrl: string | null;
  status: string;
}

export default async function ProjectsPage() {
  const supabase = createClient();

  const workTypeReady = await hasWorkType(supabase);

  const [
    { data: memberProjects },
    { data: dailyUpdates },
    { data: timeEntries },
    { data: profiles },
    { data: projectSettings },
    standaloneBlockers,
  ] = await Promise.all([
      supabase.from("member_projects").select("*, profiles(id, name, avatar_url, role)"),
      // Project work only. A task ("Meetings", "Support") is logged in these
      // same tables but is not a project, so it must not appear in this list or
      // contribute hours to one. Skipped when migration 040 hasn't run — there
      // are no tasks to exclude yet.
      // Named columns, not `*`: this reads every update ever logged, and the
      // update/whats_left/timeline text it was also pulling is never used here.
      onlyProjectWork(
        supabase
          .from("daily_updates")
          .select("project, date, status, blockers, user_id, profiles(id, name, avatar_url, role)"),
        workTypeReady
      ).order("date", { ascending: false }),
      onlyProjectWork(
        supabase.from("time_entries").select("project, duration_minutes"),
        workTypeReady
      ),
      supabase
        .from("profiles")
        .select("id, name, invited_at, signed_in_at")
        .neq("access_level", "client")
        .order("name"),
      supabase.from("project_settings").select("project, status, timeline, weekly_hour_cap"),
      // Blockers raised against a project directly (migration 038), so the
      // per-project count matches what the project page shows.
      fetchProjectBlockers(supabase),
    ]);

  const settingsByProject = new Map((projectSettings || []).map((p) => [p.project, p]));

  const projects = new Map<
    string,
    {
      participants: Map<string, Participant>;
      totalMinutes: number;
      lastActivity: string | null;
      blockerCount: number;
    }
  >();

  function getProject(name: string) {
    if (!projects.has(name)) {
      projects.set(name, { participants: new Map(), totalMinutes: 0, lastActivity: null, blockerCount: 0 });
    }
    return projects.get(name)!;
  }

  // A project can exist with no assignees/updates/time yet (freshly created
  // via "Create Project") — make sure it still shows up in the hub.
  for (const ps of projectSettings || []) {
    getProject(ps.project);
  }

  // Standalone blockers count towards the same badge as the ones carried on a
  // daily update below — the card shows "how much is held up", not where it was
  // written down.
  for (const b of standaloneBlockers) {
    getProject(b.project).blockerCount += 1;
  }

  // member_projects is the source of truth for status/role when present.
  for (const mp of memberProjects || []) {
    const entry = getProject(mp.project);
    if (mp.profiles) {
      entry.participants.set(mp.user_id, {
        userId: mp.user_id,
        name: mp.profiles.name,
        avatarUrl: mp.profiles.avatar_url,
        status: mp.status,
      });
    }
  }

  // Daily updates fill in participants/status for projects nobody has
  // explicitly added to "My Projects" yet, and drive last-activity date.
  for (const u of dailyUpdates || []) {
    const entry = getProject(u.project);
    if (!entry.lastActivity || u.date > entry.lastActivity) {
      entry.lastActivity = u.date;
    }
    // Unresolved blockers — the same definition the project detail page and the
    // dashboard use, and the same thing the Resolve button clears. Placeholders
    // ("N/A", "None", "Done") don't count.
    if (isRealBlocker(u.blockers)) entry.blockerCount += 1;
    // The embedded row's inferred type depends on the select shape, so it's read
    // through one narrow cast rather than trusted.
    const author = u.profiles as unknown as { name?: string; avatar_url?: string | null } | null;
    if (!entry.participants.has(u.user_id) && author?.name) {
      entry.participants.set(u.user_id, {
        userId: u.user_id,
        name: author.name,
        avatarUrl: author.avatar_url ?? null,
        status: u.status,
      });
    }
  }

  for (const t of timeEntries || []) {
    const entry = getProject(t.project);
    entry.totalMinutes += t.duration_minutes;
  }

  const sortedProjects = Array.from(projects.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, data]) => {
      const participants = Array.from(data.participants.values());
      const settings = settingsByProject.get(name);
      return {
        name,
        participants,
        totalMinutes: data.totalMinutes,
        blockerCount: data.blockerCount,
        timeline: settings?.timeline ?? null,
        weeklyHourCap: settings?.weekly_hour_cap ?? null,
        status: settings?.status || participants[0]?.status || "Not Started",
      };
    });

  // Feeds the engineer filter, so pending accounts are left out for the same
  // reason /api/members leaves them out: nobody has opened those accounts, so
  // there's no work to filter to. Filtered in JS rather than in the query
  // because invited_at/signed_in_at only exist once migration 018 has run — if
  // the select above failed on those columns, `profiles` is null and the
  // fallback re-reads just the two columns that always exist.
  let people = (profiles ?? null) as { id: string; name: string; invited_at?: string | null; signed_in_at?: string | null }[] | null;
  if (!people) {
    const { data } = await supabase
      .from("profiles")
      .select("id, name")
      .neq("access_level", "client")
      .order("name");
    people = data ?? [];
  }
  const members = people.filter((p) => !(p.invited_at && !p.signed_in_at));

  // The other half of the same two tables: the rows the queries above filtered
  // out. Empty before migration 040, where nothing can be a task yet.
  const tasks = workTypeReady ? await fetchTaskRows(supabase) : [];

  return <ProjectsTabs projects={sortedProjects} members={members} tasks={tasks} />;
}
