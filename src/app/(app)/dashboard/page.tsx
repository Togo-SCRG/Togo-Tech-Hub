import Link from "next/link";
import { AlertTriangle, ArrowRight, ClipboardList, Plus, Timer } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { STATUS_OPTIONS, statusHex } from "@/lib/utils";
import { fetchProjectBlockers } from "@/lib/projectBlockers";
import { isRealBlocker } from "@/lib/blockers";
import { hasWorkType, onlyProjectWork } from "@/lib/schemaSupport";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import { RecentUpdatesPanel, type RecentUpdateRow } from "@/components/dashboard/RecentUpdatesPanel";
import { ActiveProjectsPanel } from "@/components/dashboard/ActiveProjectsPanel";
import { StatCards, type StatCard, type StatIcon, type StatItem } from "@/components/dashboard/StatCards";

function hoursLabel(minutes: number): string {
  if (!minutes) return "—";
  return `${(minutes / 60).toFixed(1)}h`;
}

export default async function DashboardPage() {
  const supabase = createClient();
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);

  // One cached lookup instead of getUser + profile + permissions again: the
  // layout wrapping this page already resolved all three, so this is free.
  const viewer = await getCurrentUser();
  // Clients watch the team's work rather than adding to it, so the two
  // "log an update" calls to action don't apply to them.
  const canLogWork = !viewer?.isClient;

  // A plain user sees only their own work — the same rule /api/updates enforces.
  // Everything update-shaped on this page is scoped by it: the Updates tile, its
  // period counts, and the Recent updates panel.
  const seesEveryone = (viewer?.capabilities || []).includes("tracker.view.all");
  const ownId = viewer?.id ?? "";

  const workTypeReady = await hasWorkType(supabase);

  const [
    { data: todayUpdates },
    { data: recentUpdates },
    { data: allUpdates },
    { data: timeEntries },
    { data: projectSettings },
    { data: openBlockers },
    standaloneBlockers,
  ] = await Promise.all([
    // project/update/author as well as the status: the stat cards open a list of
    // what's behind each number, which a bare count can't provide.
    supabase
      .from("daily_updates")
      .select("id, status, user_id, project, update, profiles(name)")
      .eq("date", todayStr),
    supabase
      .from("daily_updates")
      .select("*, profiles(id, name, avatar_url, role)")
      .order("created_at", { ascending: false })
      .limit(50),
    // Project work only: this drives the project rollup behind "Total projects"
    // and the six status tiles, and a task has no status of its own to count.
    onlyProjectWork(
      supabase.from("daily_updates").select("project, status, date"),
      workTypeReady
    ).order("date", { ascending: false }),
    // Deliberately NOT filtered: an hour in a meeting is still an hour tracked,
    // so it belongs in today's total and in the Hrs column.
    supabase.from("time_entries").select("project, user_id, date, duration_minutes"),
    supabase.from("project_settings").select("project, status, weekly_hour_cap"),
    // Outstanding blockers, every project, every date — deliberately not
    // date-scoped like the three stats above. A blocker raised last week is
    // still blocking, so counting only today's reported "1 blocked task" while
    // listing older ones underneath.
    //
    // Matched on non-empty `blockers` text rather than status = 'Blocked',
    // because clearing that text is exactly what the Resolve button does — so
    // this is the same set the project pages show and the same set that shrinks
    // when someone resolves one.
    onlyProjectWork(
      supabase
        .from("daily_updates")
        .select("id, project, blockers, date, profiles(name)")
        .not("blockers", "is", null)
        .neq("blockers", ""),
      workTypeReady
    ).order("date", { ascending: false }),
    // Blockers raised against a project directly (migration 038). Counted in the
    // same tile as the ones above — from the dashboard's point of view a blocker
    // is a blocker, whichever way it was raised.
    fetchProjectBlockers(supabase),
  ]);

  const today = todayUpdates || [];
  const todayVisible = today.filter((u) => seesEveryone || u.user_id === ownId);
  const total = todayVisible.length;
  // The SQL filter only excludes empty text; isRealBlocker also drops the
  // placeholders people type ("N/A", "None", "Done"), which were marking
  // projects as held up and inflating this tile.
  //
  // Standalone project blockers are folded in and shaped to match, so everything
  // downstream — the count, the tile's list, the banner — reads one array.
  const blockers = [
    ...standaloneBlockers.map((b) => ({
      id: b.id,
      project: b.project,
      blockers: b.blockers,
      date: b.date,
      profiles: { name: b.userName },
    })),
    ...(openBlockers || []).filter((b) => isRealBlocker(b.blockers as string | null)),
  ].sort((a, b) => (b.date as string).localeCompare(a.date as string));
  const blocked = blockers.length;
  const blockedProjectCount = new Set(blockers.map((b) => b.project as string)).size;

  // Minutes per (user, project). This was keyed on (user, project, *date*),
  // which only matched when someone logged time on a project on the exact day
  // they also wrote the update — so the Hrs column was almost always "—" even
  // for projects with hours against them. Dropping the date makes it "what this
  // person has logged on this project", which is what the column reads as.
  const minutesByKey = new Map<string, number>();
  let totalMinutesToday = 0;
  for (const t of timeEntries || []) {
    const key = `${t.user_id}|${t.project}`;
    minutesByKey.set(key, (minutesByKey.get(key) || 0) + t.duration_minutes);
    if (t.date === todayStr) totalMinutesToday += t.duration_minutes;
  }

  // Active projects: canonical status from project_settings when set,
  // otherwise the latest daily-update status. Most-recently-active first.
  const settingsByProject = new Map((projectSettings || []).map((p) => [p.project, p]));
  const projectAgg = new Map<string, { status: string; lastActivity: string }>();
  for (const u of allUpdates || []) {
    if (!projectAgg.has(u.project)) projectAgg.set(u.project, { status: u.status, lastActivity: u.date });
  }
  for (const ps of projectSettings || []) {
    if (!projectAgg.has(ps.project)) projectAgg.set(ps.project, { status: ps.status || "Not Started", lastActivity: "" });
  }
  const activeProjects = Array.from(projectAgg.entries())
    .map(([name, d]) => ({ name, status: settingsByProject.get(name)?.status || d.status, lastActivity: d.lastActivity }))
    .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));

  // Every status gets a card, generated from STATUS_OPTIONS rather than listed
  // by hand — adding a status (Review, recently) should show up here without
  // anyone remembering to come back and add a tile.
  //
  // These count *projects*, using each project's own status: a project
  // half-finished for a week is one in-progress project, however many updates
  // were logged against it.
  const projectItems = (list: typeof activeProjects): StatItem[] =>
    list.map((p) => ({ id: p.name, project: p.name, status: p.status, date: p.lastActivity || undefined }));

  const STATUS_ICON: Record<string, StatIcon> = {
    "Not Started": "not-started",
    "In Progress": "progress",
    Review: "review",
    Completed: "completed",
    "On Hold": "hold",
    Blocked: "blocked",
  };

  const statusCards: StatCard[] = STATUS_OPTIONS.map((status) => {
    const matching = activeProjects.filter((p) => p.status === status);
    return {
      key: `status-${status}`,
      label: status,
      value: matching.length,
      color: statusHex(status),
      icon: STATUS_ICON[status] ?? "updates",
      note: `${matching.length} ${status.toLowerCase()} project${matching.length === 1 ? "" : "s"}`,
      items: projectItems(matching),
      kind: "projects" as const,
      emptyLabel: `No ${status.toLowerCase()} projects`,
      detail: `Projects whose status is ${status}.`,
    };
  });

  // Scoped for a plain user: their dashboard shows their own updates, not the
  // team's. The rows were already fetched unfiltered for the counts above, so
  // this is a filter rather than a second query.
  const visibleRecent = (recentUpdates || []).filter((u) => seesEveryone || u.user_id === ownId);

  const statCards: StatCard[] = [
    {
      // The status tiles that follow each count one slice of this number, so it
      // reads as their total. Openable by everyone: unlike the update list this
      // replaced, the project list isn't scoped to the viewer.
      key: "total-projects",
      label: "Total projects",
      value: activeProjects.length,
      color: "var(--togo-white)",
      icon: "projects",
      note: `${activeProjects.length} project${activeProjects.length === 1 ? "" : "s"} in the hub`,
      items: projectItems(activeProjects),
      kind: "projects",
      emptyLabel: "No projects yet",
      detail: "Every project in the hub, newest activity first.",
    },
    ...statusCards,
    {
      // Distinct from the "Blocked" card above: that counts projects whose
      // status is Blocked, this counts individual unresolved blockers, which a
      // project can have several of while sitting at any status.
      key: "blockers",
      label: "Blockers",
      value: blocked,
      color: statusHex("Blocked"),
      icon: "blockers",
      note:
        blocked > 0
          ? `Across ${blockedProjectCount} project${blockedProjectCount === 1 ? "" : "s"}`
          : "None outstanding",
      items: blockers.map((b) => ({
        id: b.id as string,
        project: b.project as string,
        text: (b.blockers as string) ?? null,
        authorName: (b.profiles as { name?: string } | null)?.name || "Someone",
        date: b.date as string,
      })),
      kind: "blockers",
      emptyLabel: "No blockers — nothing is held up",
      detail: "Every unresolved blocker and the project it's holding up — not just today's.",
    },
  ];




  const recentUpdateRows: RecentUpdateRow[] = visibleRecent.map((u) => ({
    id: u.id,
    project: u.project,
    update: u.update,
    status: u.status,
    authorName: u.profiles?.name ?? null,
    authorAvatarUrl: u.profiles?.avatar_url ?? null,
    hours: hoursLabel(minutesByKey.get(`${u.user_id}|${u.project}`) || 0),
  }));

  return (
    <div className="space-y-4">
      {/* Primary actions sit at the top — they were previously below the fold. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-xs text-togo-faint">
          {total > 0 ? (
            <span className="tnum">
              <span className="font-semibold text-togo-muted">{total}</span> update{total === 1 ? "" : "s"} logged today
              {totalMinutesToday > 0 && (
                <>
                  {" · "}
                  <span className="font-semibold text-togo-muted">{(totalMinutesToday / 60).toFixed(1)}h</span> tracked
                </>
              )}
            </span>
          ) : (
            "Nothing logged today yet."
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Link href="/projects">
            <Button variant="secondary" size="sm">
              <Timer size={14} /> Track time
            </Button>
          </Link>
          {canLogWork && (
            <Link href="/daily-updates?logUpdate=1">
              <Button size="sm">
                <Plus size={14} /> Log update
              </Button>
            </Link>
          )}
        </div>
      </div>

      {/* Blocked work is the one thing that needs chasing — surface it up front. */}
      {blocked > 0 && (
        <Link
          href="/daily-updates"
          className="flex items-start gap-2.5 rounded-md border border-[var(--status-blocked-border)] bg-[var(--status-blocked-bg)] px-4 py-3 transition-opacity hover:opacity-90"
        >
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[var(--status-blocked-fg)]" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[var(--status-blocked-fg)]">
              {blocked} blocked {blocked === 1 ? "task needs" : "tasks need"} attention
            </p>
            {blockers.length > 0 && (
              <p className="mt-0.5 truncate text-xs text-togo-muted">
                {blockers
                  .slice(0, 2)
                  .map((b) => `${b.project}: ${(b.blockers as string).trim()}`)
                  .join(" · ")}
                {blockers.length > 2 && ` · +${blockers.length - 2} more`}
              </p>
            )}
          </div>
          <ArrowRight size={14} className="mt-0.5 shrink-0 text-[var(--status-blocked-fg)]" />
        </Link>
      )}

      <StatCards cards={statCards} />

      {/* The sidebar column was 320px, which squeezed each "Active projects"
          row into name + bar + % + badge with nothing to spare, and truncated
          the activity lines. 400px gives both room without starving the
          updates table, which keeps ~740px at max-w-6xl. */}
      {/* items-start: each column is as tall as its own content. Without it the
          grid stretched both to match, which padded dead space below whichever
          panel was shorter — the two lists count different things, so they're
          rarely the same length. */}
      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-[1fr_400px]">
        {/* Recent updates */}
        <div className="rounded-md border border-togo-border bg-togo-surface">
          <div className="flex items-center justify-between border-b border-togo-border px-4 py-2.5">
            <span className="text-xs font-medium text-togo-muted">Recent updates</span>
            <Link
              href="/daily-updates"
              className="flex items-center gap-1 text-[11px] text-togo-faint transition-colors hover:text-togo-blue"
            >
              View all <ArrowRight size={11} />
            </Link>
          </div>

          {!recentUpdates || recentUpdates.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="No updates logged yet"
              description="Once the team starts logging daily updates, the most recent ones show up here."
              action={
                canLogWork ? (
                  <Link href="/daily-updates?logUpdate=1">
                    <Button size="sm">
                      <Plus size={14} /> Log the first update
                    </Button>
                  </Link>
                ) : undefined
              }
              className="border-0 bg-transparent"
            />
          ) : (
            <RecentUpdatesPanel rows={recentUpdateRows} />
          )}
        </div>

        {/* Right column. Both panels now page at 10 rows, so the two columns end
            level without either being stretched to match the other. */}
        <ActiveProjectsPanel projects={activeProjects.map((p) => ({ name: p.name, status: p.status }))} />
      </div>
    </div>
  );
}
