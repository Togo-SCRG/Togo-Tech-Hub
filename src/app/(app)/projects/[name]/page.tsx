import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { BackButton } from "@/components/layout/BackButton";
import { ProjectTimeSection } from "@/components/timetracker/ProjectTimeSection";
import { ProjectTotalLogged } from "@/components/timetracker/ProjectTotalLogged";
import { ProjectWeeklyCap } from "@/components/timetracker/ProjectWeeklyCap";
import { ProjectTeamSection } from "@/components/projects/ProjectTeamSection";
import { ProjectDocs } from "@/components/projects/ProjectDocs";
import { ProjectSideNotes } from "@/components/projects/ProjectSideNotes";
import { ProjectStatusBadge } from "@/components/projects/ProjectStatusBadge";
import { ProjectNameField } from "@/components/projects/ProjectNameField";
import { ProjectTimelineField } from "@/components/projects/ProjectTimelineField";
import { ProjectBlockers } from "@/components/projects/ProjectBlockers";
import { ProjectActivityFeed, type ActivityEvent } from "@/components/projects/ProjectActivityFeed";
import { DeleteProjectButton } from "@/components/projects/DeleteProjectButton";
import { formatDateShort, formatMinutes, getWeekRange } from "@/lib/utils";
import { fetchProjectBlockers } from "@/lib/projectBlockers";
import { isRealBlocker } from "@/lib/blockers";
import { hasWorkType, onlyProjectWork } from "@/lib/schemaSupport";

export default async function ProjectDetailPage({ params }: { params: { name: string } }) {
  const projectName = decodeURIComponent(params.name);
  const supabase = createClient();

  // Needed to decide whether the viewer may edit the timeline — the same rule
  // the database enforces. Cached from the layout's lookup, so it costs nothing.
  const viewerId = (await getCurrentUser())?.id ?? null;

  // Migration 040 may not have run yet, in which case there's no work_type to
  // filter on and every row is project work — which is what it was before 040.
  const workTypeReady = await hasWorkType(supabase);

  const [
    { data: memberProjects },
    { data: dailyUpdates },
    { data: timeEntries },
    { data: projectSettings },
    standaloneBlockers,
  ] = await Promise.all([
      supabase
        .from("member_projects")
        .select("*, profiles(id, name, avatar_url, role)")
        .eq("project", projectName),
      // work_type filters throughout: a task can share a name with a project
      // without being one, and its rows must not appear on the project's page,
      // its team, its hours or its activity feed.
      onlyProjectWork(
        supabase
          .from("daily_updates")
          .select("*, profiles(id, name, avatar_url, role)")
          .eq("project", projectName),
        workTypeReady
      ).order("date", { ascending: false }),
      // Joined to profiles and carrying phase/note so the activity feed can
      // show "Ed logged 2h on Dev" alongside the daily updates.
      onlyProjectWork(
        supabase
          .from("time_entries")
          .select("id, user_id, duration_minutes, date, phase, note, created_at, profiles(name)")
          .eq("project", projectName),
        workTypeReady
      ).order("date", { ascending: false }),
      // Overview/PRD/cap are selected here too so those sections render with
      // their real content on first paint instead of fetching it again
      // client-side and shifting the layout when it lands.
      supabase
        .from("project_settings")
        // `*`, not a column list: naming side_note here made the whole select
        // fail before migration 039 was run, so the page rendered with no
        // overview, no timeline and no cap — none of which were missing.
        .select("*")
        .eq("project", projectName)
        .maybeSingle(),
      // Blockers raised against the project itself, rather than carried on a
      // daily update. Tolerates migration 038 not having been run yet.
      fetchProjectBlockers(supabase, projectName),
    ]);

  // Mirror the projects-list inclusion logic: a project is "real" if it
  // shows up in ANY of the four sources the hub lists it from. time_entries
  // was previously omitted here, so a project with only logged time (no
  // assignees/updates/settings) appeared in the list but 404'd on open.
  const hasAnyData =
    (memberProjects && memberProjects.length > 0) ||
    (dailyUpdates && dailyUpdates.length > 0) ||
    (timeEntries && timeEntries.length > 0) ||
    !!projectSettings;
  if (!hasAnyData) {
    notFound();
  }

  const minutesByUser = new Map<string, number>();
  for (const t of timeEntries || []) {
    minutesByUser.set(t.user_id, (minutesByUser.get(t.user_id) || 0) + t.duration_minutes);
  }
  const totalMinutes = Array.from(minutesByUser.values()).reduce((sum, m) => sum + m, 0);

  const weekRange = getWeekRange(new Date());
  const weekMinutes = (timeEntries || [])
    .filter((t) => t.date >= weekRange.from && t.date <= weekRange.to)
    .reduce((sum, t) => sum + t.duration_minutes, 0);

  // Build one row per participant, preferring member_projects (has
  // role/co-developers) and falling back to whoever's logged an update.
  // Only rows backed by an actual member_projects entry (memberProjectId
  // set) can be "removed" — a fallback row is just inferred from daily
  // updates, so there's nothing discrete to delete.
  const participants = new Map<
    string,
    {
      userId: string;
      memberProjectId: string | null;
      name: string;
      avatarUrl: string | null;
      role: string | null;
      status: string;
      partnerIds: string[];
    }
  >();

  for (const mp of memberProjects || []) {
    if (!mp.profiles) continue;
    participants.set(mp.user_id, {
      userId: mp.user_id,
      memberProjectId: mp.id,
      name: mp.profiles.name,
      avatarUrl: mp.profiles.avatar_url,
      role: mp.role,
      status: mp.status,
      partnerIds: mp.partner_ids || [],
    });
  }
  for (const u of dailyUpdates || []) {
    if (participants.has(u.user_id) || !u.profiles) continue;
    participants.set(u.user_id, {
      userId: u.user_id,
      memberProjectId: null,
      name: u.profiles.name,
      avatarUrl: u.profiles.avatar_url,
      role: null,
      status: u.status,
      partnerIds: [],
    });
  }

  const participantList = Array.from(participants.values());

  // Two sources, one list: blockers raised against the project directly, and
  // blockers reported as part of somebody's daily update. They render
  // identically — `source` is what tells the edit and resolve buttons which
  // endpoint a given row belongs to.
  const blockers = [
    ...standaloneBlockers.map((b) => ({
      id: b.id,
      userName: b.userName,
      avatarUrl: b.avatarUrl,
      blockers: b.blockers,
      date: b.date,
      source: b.source,
    })),
    ...(dailyUpdates || [])
      // isRealBlocker, not just non-empty: "N/A" and "None" are answers to the
      // question, not things holding the project up.
      .filter((u) => isRealBlocker(u.blockers))
      .map((u) => ({
        id: u.id as string,
        userName: u.profiles?.name || "Unknown",
        avatarUrl: u.profiles?.avatar_url ?? null,
        blockers: u.blockers as string,
        date: u.date as string,
        source: "update" as const,
      })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  const allUpdates = dailyUpdates || [];
  const allTimeEntries = timeEntries || [];

  // One history stream from two tables. Rendering every event would mean
  // hundreds of rows on a long-running project, so cap it and report the total.
  const ACTIVITY_LIMIT = 25;
  const activityEvents: ActivityEvent[] = [
    ...allUpdates.map((u) => ({
      id: u.id as string,
      kind: "update" as const,
      userName: u.profiles?.name || "Someone",
      date: u.date as string,
      at: (u.created_at as string) || (u.date as string),
      status: u.status as string,
      text: (u.update as string) || (u.blockers as string) || null,
    })),
    ...allTimeEntries.map((t) => ({
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

  const projectStatus = projectSettings?.status || "Not Started";
  const viewerIsProjectMember = participantList.some((p) => p.userId === viewerId);
  const lastActivity = activityEvents[0]?.date ?? null;

  const headerStats: { label: string; value: string }[] = [
    { label: "Total hours", value: totalMinutes > 0 ? formatMinutes(totalMinutes) : "0h" },
    {
      label: "Team",
      value: `${participantList.length} ${participantList.length === 1 ? "person" : "people"}`,
    },
    { label: "Updates", value: String(allUpdates.length) },
    { label: "Last activity", value: lastActivity ? formatDateShort(lastActivity) : "—" },
  ];

  return (
    <div className="w-full">
      <BackButton label="Back to projects" fallbackHref="/projects" />

      {/* Wide main column with a sidebar for the roster and history, so the
          page reads as a dashboard rather than one long scroll. */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-4">
          <header className="rounded-md border border-togo-border bg-togo-surface p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <ProjectNameField projectName={projectName} isProjectMember={viewerIsProjectMember} />
              <ProjectStatusBadge
                projectName={projectName}
                initialStatus={projectStatus}
                isProjectMember={viewerIsProjectMember}
              />
            </div>

            <dl className="mt-4 flex flex-wrap items-stretch gap-x-6 gap-y-3 border-t border-togo-border pt-3">
              {headerStats.map((s, i) => (
                <div key={s.label} className={i > 0 ? "border-l border-togo-border pl-6" : undefined}>
                  <dt className="text-[10px] uppercase tracking-wider text-togo-faint">{s.label}</dt>
                  <dd className="tnum mt-0.5 text-sm font-bold text-togo-white">{s.value}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-3 border-t border-togo-border pt-3">
              <ProjectTimelineField
                projectName={projectName}
                initialTimeline={projectSettings?.timeline ?? ""}
                status={projectStatus}
                isProjectMember={viewerIsProjectMember}
              />
            </div>
          </header>

          <ProjectDocs
            projectName={projectName}
            initialOverview={projectSettings?.overview ?? ""}
            initialPrd={projectSettings?.prd ?? ""}
            isProjectMember={viewerIsProjectMember}
          />

          {/* In the main column rather than the 300px sidebar: bulleted notes
              need the width to stay readable. */}
          <ProjectSideNotes
            projectName={projectName}
            initialNote={projectSettings?.side_note ?? ""}
            isProjectMember={viewerIsProjectMember}
          />

          {/* Metrics row: what's been spent, this week's pace, and anything stuck. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <ProjectTotalLogged projectName={projectName} totalMinutes={totalMinutes} />

            <ProjectWeeklyCap
              projectName={projectName}
              weekMinutes={weekMinutes}
              initialWeeklyHourCap={projectSettings?.weekly_hour_cap ?? null}
            />

            <ProjectBlockers
              projectName={projectName}
              blockers={blockers}
              isProjectMember={viewerIsProjectMember}
            />
          </div>

          <ProjectTimeSection projectName={projectName} isProjectMember={viewerIsProjectMember} />

          <DeleteProjectButton projectName={projectName} />
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20">
          <ProjectTeamSection
            participants={participantList}
            minutesByUser={Object.fromEntries(minutesByUser)}
            totalMinutes={totalMinutes}
            projectName={projectName}
          />

          <ProjectActivityFeed events={activityEvents.slice(0, ACTIVITY_LIMIT)} total={activityEvents.length} />
        </aside>
      </div>
    </div>
  );
}
