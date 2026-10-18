"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IntentLink } from "@/components/ui/IntentLink";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarDays, Check, FolderPlus, GripVertical, SearchX, Timer, Trash2, X } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Select } from "@/components/ui/Input";
import { SearchInput } from "@/components/ui/SearchInput";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterPills } from "@/components/ui/FilterPills";
import { ViewToggle } from "@/components/ui/ViewToggle";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { SortableHeader } from "@/components/ui/SortableHeader";
import { LinkListCell } from "@/components/ui/LinkListCell";
import type { ProposalLinks } from "@/types";
import { Pagination } from "@/components/ui/Pagination";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { PopoverPortal } from "@/components/ui/PopoverPortal";
import { Checkbox } from "@/components/ui/Checkbox";
import { DatePicker, formatPickedDate } from "@/components/ui/DatePicker";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { ColumnsMenu } from "@/components/ui/ColumnsMenu";
import { cn, formatMinutes, statusHex, STATUS_OPTIONS } from "@/lib/utils";
import { usePagination } from "@/lib/usePagination";
import { useDragReorder } from "@/lib/useDragReorder";
import { useSort } from "@/lib/useSort";
import { useHotkeys } from "@/lib/useHotkeys";
import { useViewMode } from "@/lib/useViewMode";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { useColumns } from "@/lib/useColumns";
import { can } from "@/lib/capabilities";
import { isTimelineOverdue } from "@/lib/timeline";
import { TEN_ROWS_PY3 } from "@/lib/tableHeights";

const STATUS_PILLS: { label: string; value: string }[] = [
  { label: "All", value: "all" },
  { label: "Completed", value: "Completed" },
  { label: "In progress", value: "In Progress" },
  { label: "Review", value: "Review" },
  { label: "On hold", value: "On Hold" },
  { label: "Blocked", value: "Blocked" },
];

interface Participant {
  userId: string;
  name: string;
  avatarUrl: string | null;
  status: string;
}

interface ProjectSummary {
  name: string;
  participants: Participant[];
  totalMinutes: number;
  /** Unresolved blockers on this project. */
  blockerCount: number;
  /** When anything last happened on the project (ISO timestamp) — including its creation — or null. */
  lastActivity: string | null;
  /** Free-text target date, e.g. "End of Q3". */
  timeline: string | null;
  weeklyHourCap: number | null;
  status: string;
}

type SortKey = "name" | "team" | "time" | "blockers" | "timeline" | "status";

// The list's natural order, before any column-header sort. "Most recent" is the
// default because the projects people open this page for are the live ones;
// A–Z is for finding one by name, and "Custom" is the drag-to-reorder order.
type OrderMode = "recent" | "name" | "custom";
const ORDER_MODES: { value: OrderMode; label: string }[] = [
  { value: "recent", label: "Most recent" },
  { value: "name", label: "Name (A–Z)" },
  { value: "custom", label: "Custom order" },
];
const ORDER_MODE_KEY = "projects-order-mode";

export function ProjectsView({
  projects,
  links,
  members,
  onCreateProject,
}: {
  projects: ProjectSummary[];
  /** Client-portal and system links per project, from its notes (050). */
  links: Record<string, ProposalLinks>;
  members: { id: string; name: string }[];
  /**
   * Opens the create-project modal, which lives in the tabs wrapper — the
   * button sits in the tab row so it can become "New task" on the other tab.
   * Still triggered from here by the empty state and the `n` hotkey.
   */
  onCreateProject?: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const { view, setView, toggleView } = useViewMode("projects-view");
  const [orderMode, setOrderMode] = useState<OrderMode>("recent");
  const [engineerFilter, setEngineerFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<"all" | "mine">("all");
  const { currentUser } = useCurrentUser();
  const searchRef = useRef<HTMLInputElement>(null);
  const { visible: columnVisibility, isVisible, toggle: toggleColumn } = useColumns("projects");
  const canCreate = can(currentUser?.capabilities, "project.create");
  // Bulk editing is offered to anyone who could do the same thing one row at a
  // time — the capabilities below decide which buttons appear, so a tier that
  // can't delete simply doesn't get a Delete button.
  //
  // The one extra rule is for plain users: they can only change status and
  // timeline on projects they're on (the database enforces that per row), so
  // showing checkboxes on "All projects" would invite selecting rows that then
  // fail. Restricting them to the My projects tab means everything they can tick
  // is something they can actually change.
  const restrictedToOwnProjects = !!currentUser && !currentUser.isAdmin && !currentUser.isClient;
  const bulkCapable =
    can(currentUser?.capabilities, "project.status.edit") ||
    can(currentUser?.capabilities, "project.timeline.edit") ||
    can(currentUser?.capabilities, "project.delete");
  const canBulk = bulkCapable && (!restrictedToOwnProjects || scope === "mine");
  const canBulkDelete = canBulk && can(currentUser?.capabilities, "project.delete");
  const canBulkStatus = canBulk && can(currentUser?.capabilities, "project.status.edit");
  const canBulkTimeline = canBulk && can(currentUser?.capabilities, "project.timeline.edit");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkTimelineOpen, setBulkTimelineOpen] = useState(false);
  const [bulkPickerOpen, setBulkPickerOpen] = useState(false);
  const [bulkTimeline, setBulkTimeline] = useState("");
  const bulkTimelineRef = useRef<HTMLDivElement>(null);

  // There's no scheduler in this app, so opening the projects list is what
  // raises overdue notices. Fire-and-forget: the sweep dedupes server-side, and
  // a failure here shouldn't affect the page.
  useEffect(() => {
    fetch("/api/projects/overdue-check", { method: "POST" }).catch(() => {});
  }, []);

  // Read after mount, like the view mode, so server and client render the same
  // markup first.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(ORDER_MODE_KEY);
      if (ORDER_MODES.some((m) => m.value === stored)) setOrderMode(stored as OrderMode);
    } catch {
      // Storage blocked — "Most recent" for this visit.
    }
  }, []);

  useHotkeys({
    "/": () => searchRef.current?.focus(),
    v: () => toggleView(),
    n: () => {
      if (canCreate) onCreateProject?.();
    },
  });

  const hasActiveFilters =
    engineerFilter !== "all" || statusFilter !== "all" || search.trim() !== "" || scope !== "all";

  function clearFilters() {
    setEngineerFilter("all");
    setStatusFilter("all");
    setSearch("");
    setScope("all");
  }

  const isMine = useCallback(
    (p: ProjectSummary) => !!currentUser && p.participants.some((x) => x.userId === currentUser.id),
    [currentUser]
  );

  // Tab counts ignore every other filter — they say how many projects exist in
  // each scope, not how many survive the current search.
  const scopeCounts = useMemo(
    () => ({ all: projects.length, mine: projects.filter(isMine).length }),
    [projects, isMine]
  );

  // Counts exclude the status filter itself so each pill reflects what it
  // would show under the current search/engineer selection.
  const statusCounts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = projects.filter((p) => {
      if (scope === "mine" && !isMine(p)) return false;
      if (engineerFilter !== "all" && !p.participants.some((x) => x.userId === engineerFilter)) return false;
      if (q && !p.name.toLowerCase().includes(q)) return false;
      return true;
    });
    const counts: Record<string, number> = { all: base.length };
    for (const pill of STATUS_PILLS) {
      if (pill.value !== "all") counts[pill.value] = base.filter((p) => p.status === pill.value).length;
    }
    return counts;
  }, [projects, engineerFilter, search, scope, isMine]);

  const filteredProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects.filter((p) => {
      if (scope === "mine" && !isMine(p)) return false;
      if (engineerFilter !== "all" && !p.participants.some((x) => x.userId === engineerFilter)) return false;
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (q && !p.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [projects, engineerFilter, statusFilter, search, scope, isMine]);

  // Drop any selection that's no longer on screen. Keeping it would mean a
  // bulk delete acting on rows the current filters have hidden — and for a plain
  // user leaving the My projects tab, the checkboxes disappear entirely, so the
  // selection has to go with them.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      if (!canBulk) return new Set();
      const visible = new Set(filteredProjects.map((p) => p.name));
      const next = new Set([...prev].filter((n) => visible.has(n)));
      return next.size === prev.size ? prev : next;
    });
  }, [filteredProjects, canBulk]);

  const { ordered: orderedProjects, dragHandleProps, dropTargetProps, draggedId } = useDragReorder(
    filteredProjects,
    (p) => p.name,
    `projects-order:${currentUser?.id ?? "anon"}`
  );

  // Newest activity first, to the moment — so a project created just now is at
  // the top. Projects arrive A–Z, so the stable sort leaves exact ties (and
  // ones with no activity at all, which go last) in alphabetical order.
  const recentProjects = useMemo(
    () =>
      [...filteredProjects].sort((a, b) => {
        if (a.lastActivity === b.lastActivity) return 0;
        if (!a.lastActivity) return 1;
        if (!b.lastActivity) return -1;
        return a.lastActivity < b.lastActivity ? 1 : -1;
      }),
    [filteredProjects]
  );

  const baseProjects =
    orderMode === "custom" ? orderedProjects : orderMode === "recent" ? recentProjects : filteredProjects;

  const { sorted: sortedProjects, sort, toggle, clear: clearSort } = useSort<ProjectSummary, SortKey>(baseProjects, {
    name: (p) => p.name,
    team: (p) => p.participants.length,
    time: (p) => p.totalMinutes,
    blockers: (p) => p.blockerCount,
    timeline: (p) => p.timeline || "",
    status: (p) => p.status,
  });

  const {
    page,
    setPage,
    pageSize,
    setPageSize,
    totalPages,
    totalItems,
    paged: pagedProjects,
  } = usePagination(sortedProjects);

  const totalMinutes = useMemo(
    () => filteredProjects.reduce((sum, p) => sum + p.totalMinutes, 0),
    [filteredProjects]
  );

  // Re-sorting changes what "the top" means, so jump back to the first page.
  function handleToggleSort(key: SortKey) {
    toggle(key);
    setPage(1);
  }

  // Picking an order is a request to see that order, so it also drops any
  // column sort that would otherwise keep overriding it.
  function changeOrderMode(next: OrderMode) {
    setOrderMode(next);
    clearSort();
    setPage(1);
    try {
      localStorage.setItem(ORDER_MODE_KEY, next);
    } catch {
      // Not remembered across visits, but applied for this one.
    }
  }

  // Drag-to-reorder only makes sense in the custom order — a column sort or one
  // of the automatic orders would override it, so the handles are inert then.
  const reorderable = orderMode === "custom" && sort.key === null;

  function cancelBulkTimeline() {
    setBulkTimelineOpen(false);
    setBulkPickerOpen(false);
    setBulkTimeline("");
  }

  function applyBulkTimeline() {
    const timeline = bulkTimeline.trim();
    if (!timeline) return;
    cancelBulkTimeline();
    runBulk("Set the timeline on", (name) =>
      fetch("/api/project-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: name, timeline }),
      })
    );
  }

  function toggleRow(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  /**
   * Select-all covers the rows *on screen*, not every match — ticking a box and
   * silently including 40 rows on other pages is how people delete things they
   * didn't mean to.
   */
  const pageNames = pagedProjects.map((p) => p.name);
  const allOnPageSelected = pageNames.length > 0 && pageNames.every((n) => selected.has(n));
  const someOnPageSelected = pageNames.some((n) => selected.has(n));

  function toggleAllOnPage() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) pageNames.forEach((n) => next.delete(n));
      else pageNames.forEach((n) => next.add(n));
      return next;
    });
  }

  /** Runs one request per project. There's no bulk endpoint, and going through
   *  the per-project routes means every row is checked by the same policies and
   *  trigger as an individual edit. */
  async function runBulk(
    label: string,
    fn: (name: string) => Promise<Response>
  ) {
    const names = [...selected];
    setBulkBusy(true);
    const results = await Promise.all(
      names.map((name) => fn(name).then((res) => ({ name, ok: res.ok, res })).catch(() => ({ name, ok: false, res: null })))
    );
    setBulkBusy(false);

    const failed = results.filter((r) => !r.ok);
    if (failed.length === 0) {
      toast.success(`${label} ${names.length} project${names.length === 1 ? "" : "s"}.`);
    } else {
      // Naming the first failure is more use than "some failed" — usually
      // they've all hit the same permission or validation problem.
      const first = failed[0];
      const data = first.res ? await first.res.json().catch(() => ({})) : {};
      toast.error(
        `${label} ${results.length - failed.length} of ${results.length}. ${first.name}: ${
          data.error || "failed"
        }`
      );
    }
    setSelected(new Set());
    router.refresh();
  }

  const ALL_COLUMNS: { key: SortKey; label: string; className?: string }[] = [
    { key: "name", label: "Project" },
    { key: "team", label: "Assigned To" },
    { key: "time", label: "Total Time", className: "w-32" },
    { key: "blockers", label: "Blockers", className: "w-28" },
    { key: "timeline", label: "Timeline", className: "w-36" },
    { key: "status", label: "Status", className: "w-32" },
  ];
  // "Project" is the row's identity, so it isn't offered as hideable.
  // The two link columns aren't sortable, so they sit outside ALL_COLUMNS, but
  // they hide and show from the same Columns menu. They follow the project's
  // name: they're how you get into it.
  const TOGGLEABLE = [
    { key: "portal", label: "Client portal" },
    { key: "system", label: "System links" },
    ...ALL_COLUMNS.filter((c) => c.key !== "name"),
  ];
  const columns = ALL_COLUMNS.filter((c) => c.key === "name" || isVisible(c.key));
  const showPortal = isVisible("portal");
  const showSystem = isVisible("system");

  return (
    <div className="space-y-4">
      {/* Primary toolbar — status pills. "New project" used to sit at this row's
          right; it's in the tab row now, so it can read "New task" on the other
          tab instead of two buttons competing. */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterPills pills={STATUS_PILLS} value={statusFilter} onChange={setStatusFilter} counts={statusCounts} />
      </div>

      {/* Utility row — scope tabs + search + clear */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Only shown when signed in: "My projects" has no meaning otherwise. */}
        {currentUser && (
          <SegmentedTabs
            label="Project scope"
            value={scope}
            onChange={(v) => {
              setScope(v as "all" | "mine");
              setPage(1);
            }}
            tabs={[
              { label: "All projects", value: "all", count: scopeCounts.all },
              { label: "My projects", value: "mine", count: scopeCounts.mine },
            ]}
          />
        )}
        <SearchInput
          ref={searchRef}
          value={search}
          onChange={setSearch}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setSearch("");
              e.currentTarget.blur();
            }
          }}
          placeholder="Search projects..."
        />
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="flex items-center gap-1 text-xs font-medium text-togo-muted transition-colors hover:text-togo-blue"
          >
            <X size={14} /> Clear filters
          </button>
        )}

        {/* Sits under "New project" so the two right-hand columns line up. */}
        <Select
          value={engineerFilter}
          onChange={(e) => setEngineerFilter(e.target.value)}
          className="ml-auto w-auto"
          aria-label="Filter by engineer"
        >
          <option value="all">All engineers</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
      </div>

      {filteredProjects.length === 0 ? (
        projects.length === 0 ? (
          <EmptyState
            icon={FolderPlus}
            title="No projects yet"
            description="Projects appear here automatically once someone logs an update or tracks time against one — or create one now to assign a team and set an hour cap."
            action={
              canCreate && onCreateProject ? (
                <Button size="sm" onClick={onCreateProject}>
                  + New project
                </Button>
              ) : undefined
            }
          />
        ) : (
          <EmptyState
            icon={SearchX}
            title="No projects match those filters"
            description={
              search.trim()
                ? `Nothing matches “${search.trim()}”. Try a shorter search term.`
                : "Try a different status or engineer."
            }
            action={
              <Button size="sm" variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          />
        )
      ) : (
        /* One panel owns the results: the counts and the table controls in the
           header, rows in the middle, paging in the footer — so the controls
           stay attached to what they act on. */
        <div className="overflow-hidden rounded-md border border-togo-border bg-togo-surface">
          {canBulk && selected.size > 0 && (
            /* Sits above the table rather than floating over it: the actions
               apply to rows you can see, and a floating bar covers them. */
            <div className="flex flex-wrap items-center gap-2 border-b border-togo-blue/30 bg-togo-blue/[0.06] px-4 py-2.5">
              <span className="tnum text-xs font-semibold text-togo-blue">
                {selected.size} selected
              </span>

              {canBulkStatus && (
                <Select
                  value=""
                  disabled={bulkBusy}
                  onChange={(e) => {
                    const status = e.target.value;
                    if (!status) return;
                    runBulk("Updated the status of", (name) =>
                      fetch("/api/project-settings", {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ project: name, status }),
                      })
                    );
                  }}
                  aria-label="Set status for the selected projects"
                  className="h-8 w-auto py-1 text-xs"
                >
                  <option value="">Set status…</option>
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              )}

              {canBulkTimeline &&
                (bulkTimelineOpen ? (
                  /* The same inline editor as a project's own timeline field:
                     one text box, a calendar button that opens the picker on
                     demand, then tick to apply. The previous version stacked a
                     text box, an always-open calendar and its own buttons into a
                     popover, which put two sets of Cancel/OK on screen at once. */
                  <div ref={bulkTimelineRef} className="relative flex items-center gap-1.5">
                    <Input
                      value={bulkTimeline}
                      onChange={(e) => setBulkTimeline(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          applyBulkTimeline();
                        }
                        if (e.key === "Escape") cancelBulkTimeline();
                      }}
                      placeholder="e.g. End of Q3, or pick a date"
                      autoFocus
                      className="h-8 w-56 py-1 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => setBulkPickerOpen((o) => !o)}
                      aria-expanded={bulkPickerOpen}
                      title="Pick a date"
                      aria-label="Pick a date"
                      className="rounded p-1 text-togo-faint transition-colors hover:text-togo-blue"
                    >
                      <CalendarDays size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={applyBulkTimeline}
                      disabled={bulkBusy || !bulkTimeline.trim()}
                      title={`Set the timeline on ${selected.size} project${selected.size === 1 ? "" : "s"}`}
                      aria-label="Apply timeline"
                      className="rounded p-1 text-togo-blue transition-colors hover:bg-togo-blue/10 disabled:opacity-40"
                    >
                      <Check size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={cancelBulkTimeline}
                      disabled={bulkBusy}
                      title="Cancel"
                      aria-label="Cancel"
                      className="rounded p-1 text-togo-faint transition-colors hover:text-togo-muted"
                    >
                      <X size={14} />
                    </button>

                    {/* Portaled: the results panel is `overflow-hidden`, so an
                        absolutely-positioned calendar is clipped at its bottom
                        edge whenever the table is shorter than the picker. */}
                    <PopoverPortal
                      anchorRef={bulkTimelineRef}
                      open={bulkPickerOpen}
                      onClose={() => setBulkPickerOpen(false)}
                      width={280}
                      height={400}
                    >
                      <DatePicker
                        onSelect={(date) => {
                          setBulkTimeline(formatPickedDate(date));
                          setBulkPickerOpen(false);
                        }}
                        onCancel={() => setBulkPickerOpen(false)}
                      />
                    </PopoverPortal>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={bulkBusy}
                    onClick={() => setBulkTimelineOpen(true)}
                  >
                    <CalendarDays size={14} /> Set timeline
                  </Button>
                ))}

              {canBulkDelete && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={bulkBusy}
                  onClick={() => setBulkDeleteOpen(true)}
                  className="border-[var(--status-blocked-fg)] text-[var(--status-blocked-fg)] hover:bg-[var(--status-blocked-bg)]"
                >
                  <Trash2 size={14} /> Delete
                </Button>
              )}

              <button
                type="button"
                onClick={() => setSelected(new Set())}
                disabled={bulkBusy}
                className="ml-auto flex items-center gap-1 text-xs font-medium text-togo-muted transition-colors hover:text-togo-blue"
              >
                <X size={14} /> Clear selection
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-2 gap-y-2 border-b border-togo-border px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-2 text-xs text-togo-faint">
              <span className="tnum">
                <span className="font-semibold text-togo-muted">{filteredProjects.length}</span>
                {filteredProjects.length === 1 ? " project" : " projects"}
                {filteredProjects.length !== projects.length && ` of ${projects.length}`}
              </span>
              {totalMinutes > 0 && (
                <>
                  <span aria-hidden>·</span>
                  <span className="tnum">
                    <span className="font-semibold text-togo-muted">{formatMinutes(totalMinutes)}</span> tracked
                  </span>
                </>
              )}
            </div>

            <div className="ml-auto flex items-center gap-2">
              <Select
                value={orderMode}
                onChange={(e) => changeOrderMode(e.target.value as OrderMode)}
                aria-label="Order projects by"
                title="Order projects by"
                className="w-auto"
              >
                {ORDER_MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </Select>
              <ViewToggle value={view} onChange={setView} />
              {view === "table" && (
                <ColumnsMenu columns={TOGGLEABLE} visible={columnVisibility} onToggle={toggleColumn} />
              )}
            </div>
          </div>

          {view === "card" ? (
        <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {pagedProjects.map(({ name, participants, totalMinutes: projectMinutes, blockerCount, weeklyHourCap, status }) => {
            const hours = projectMinutes / 60;
            const capPct = weeklyHourCap ? Math.min(100, (hours / weeklyHourCap) * 100) : 0;
            const overCap = weeklyHourCap ? hours > weeklyHourCap : false;
            return (
              <IntentLink
                key={name}
                href={`/projects/${encodeURIComponent(name)}`}
                className="card-hover flex flex-col gap-3 rounded-md border border-togo-border bg-togo-surface p-4 hover:border-togo-blue"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="truncate font-bold text-togo-white" title={name}>
                    {name}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {blockerCount > 0 && (
                      <span
                        title={`${blockerCount} unresolved ${blockerCount === 1 ? "blocker" : "blockers"}`}
                        className="inline-flex items-center gap-1 rounded-full border border-[var(--status-blocked-border)] bg-[var(--status-blocked-bg)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--status-blocked-fg)]"
                      >
                        <AlertTriangle size={9} /> {blockerCount}
                      </span>
                    )}
                    <StatusBadge status={status} />
                  </div>
                </div>

                <div>
                  <div className="mb-1.5 flex justify-between text-[10px]">
                    <span className="text-togo-faint">Hours</span>
                    <span className={cn("tnum", overCap ? "font-semibold text-[var(--status-blocked-fg)]" : "text-togo-muted")}>
                      {hours < 10 ? hours.toFixed(1) : Math.round(hours)}h
                      {weeklyHourCap ? ` / ${weeklyHourCap}h cap` : ""}
                    </span>
                  </div>
                  {weeklyHourCap ? (
                    <ProgressBar
                      value={capPct}
                      overCap={overCap}
                      label={`${Math.round(capPct)}% of the ${weeklyHourCap} hour weekly cap`}
                      className="h-1"
                    />
                  ) : (
                    <ProgressBar
                      value={100}
                      color={statusHex(status)}
                      label={`Status: ${status}`}
                      className="h-1 opacity-40"
                    />
                  )}
                </div>

                <div className="mt-auto flex items-center justify-between pt-0.5">
                  <div className="flex items-center -space-x-2">
                    {participants.slice(0, 5).map((p) => (
                      <Avatar
                        key={p.userId}
                        name={p.name}
                        avatarUrl={p.avatarUrl}
                        size="sm"
                        title={p.name}
                        className="!h-6 !w-6 ring-2 ring-togo-surface !text-[10px]"
                      />
                    ))}
                    {participants.length > 5 && (
                      <span className="ml-3 text-[10px] text-togo-faint">+{participants.length - 5}</span>
                    )}
                    {participants.length === 0 && <span className="text-[10px] text-togo-faint">No members yet</span>}
                  </div>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      router.push(`/projects/${encodeURIComponent(name)}`);
                    }}
                    title={`Track time on ${name}`}
                    className="flex items-center gap-1 rounded border border-togo-blue/30 bg-togo-blue/10 px-2 py-1 text-[11px] text-togo-blue transition-colors hover:bg-togo-blue/20"
                  >
                    <Timer size={12} /> Timer
                  </button>
                </div>
              </IntentLink>
            );
          })}
        </div>
          ) : (
            <div className={`overflow-x-auto ${TEN_ROWS_PY3}`}>
          <table className={cn("w-full text-sm", showPortal || showSystem ? "min-w-[1000px]" : "min-w-[640px]")}>
            <thead className="sticky top-0 z-10 bg-togo-surface">
              <tr className="border-b border-togo-border text-left">
                {canBulk && (
                  <th scope="col" className="w-8 px-2 py-3">
                    <Checkbox
                      checked={allOnPageSelected}
                      indeterminate={someOnPageSelected}
                      onChange={toggleAllOnPage}
                      label="Select all projects on this page"
                    />
                  </th>
                )}
                <th scope="col" className="w-8 px-2 py-3">
                  <span className="sr-only">Reorder</span>
                </th>
                {columns.map((c) => (
                  <Fragment key={c.key}>
                    <SortableHeader
                      label={c.label}
                      active={sort.key === c.key}
                      direction={sort.direction}
                      onClick={() => handleToggleSort(c.key)}
                      className={c.className}
                    />
                    {c.key === "name" && showPortal && (
                      <th scope="col" className="section-label w-48 whitespace-nowrap px-4 py-2.5">
                        Client portal
                      </th>
                    )}
                    {c.key === "name" && showSystem && (
                      <th scope="col" className="section-label w-48 whitespace-nowrap px-4 py-2.5">
                        System links
                      </th>
                    )}
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-togo-border">
              {pagedProjects.map(({ name, participants, totalMinutes: projectMinutes, blockerCount, timeline, status }) => (
                <tr
                  key={name}
                  {...(reorderable ? dropTargetProps(name) : {})}
                  className={cn(
                    "transition-colors hover:bg-[var(--togo-hover)]",
                    draggedId === name && "opacity-40"
                  )}
                >
                  {canBulk && (
                    <td className="px-2 py-3">
                      <Checkbox
                        checked={selected.has(name)}
                        onChange={() => toggleRow(name)}
                        label={`Select ${name}`}
                      />
                    </td>
                  )}
                  <td className="px-2 py-3">
                    {reorderable ? (
                      <span
                        {...dragHandleProps(name)}
                        title="Drag to reorder"
                        className="inline-flex cursor-grab text-togo-faint transition-colors hover:text-togo-muted active:cursor-grabbing"
                      >
                        <GripVertical size={14} />
                      </span>
                    ) : (
                      <span
                        title={
                          orderMode === "custom"
                            ? "Clear the column sort to reorder rows manually"
                            : "Switch to Custom order to reorder rows manually"
                        }
                        className="inline-flex text-togo-border"
                      >
                        <GripVertical size={14} />
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <IntentLink
                      href={`/projects/${encodeURIComponent(name)}`}
                      className="font-semibold text-togo-white transition-colors hover:text-togo-blue"
                    >
                      {name}
                    </IntentLink>
                  </td>
                  {showPortal && (
                    <td className="px-4 py-3">
                      <LinkListCell hrefs={links[name]?.portal} kind="portal" moreHref={`/projects/${encodeURIComponent(name)}`} />
                    </td>
                  )}
                  {showSystem && (
                    <td className="px-4 py-3">
                      <LinkListCell hrefs={links[name]?.system} kind="system" moreHref={`/projects/${encodeURIComponent(name)}`} />
                    </td>
                  )}
                  {isVisible("team") && (
                    <td className="px-4 py-3">
                      {participants.length > 0 ? (
                        <div className="flex items-center -space-x-2">
                          {participants.slice(0, 5).map((p) => (
                            <Avatar
                              key={p.userId}
                              name={p.name}
                              avatarUrl={p.avatarUrl}
                              size="sm"
                              title={p.name}
                              className="ring-2 ring-togo-surface"
                            />
                          ))}
                          {participants.length > 5 && (
                            <span className="ml-3 text-xs text-togo-faint">+{participants.length - 5}</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-togo-faint">—</span>
                      )}
                    </td>
                  )}
                  {isVisible("time") && (
                    <td className="tnum whitespace-nowrap px-4 py-3 font-semibold text-togo-blue">
                      {projectMinutes > 0 ? formatMinutes(projectMinutes) : <span className="text-togo-faint">—</span>}
                    </td>
                  )}
                  {isVisible("blockers") && (
                    <td className="whitespace-nowrap px-4 py-3">
                      {blockerCount > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-[var(--status-blocked-border)] bg-[var(--status-blocked-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--status-blocked-fg)]">
                          <AlertTriangle size={10} /> {blockerCount}
                        </span>
                      ) : (
                        <span className="text-togo-faint">—</span>
                      )}
                    </td>
                  )}
                  {isVisible("timeline") && (
                    <td
                      className={
                        isTimelineOverdue(timeline, status)
                          ? "px-4 py-3 text-xs font-semibold text-[var(--status-blocked-fg)]"
                          : "px-4 py-3 text-xs text-togo-muted"
                      }
                      title={isTimelineOverdue(timeline, status) ? "Overdue" : undefined}
                    >
                      {timeline || <span className="text-togo-faint">—</span>}
                    </td>
                  )}
                  {isVisible("status") && (
                    <td className="px-4 py-3">
                      <StatusBadge status={status} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
            </div>
          )}

          <Pagination
            page={page}
            totalPages={totalPages}
            totalItems={totalItems}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            className="border-t border-togo-border px-4 py-3"
          />
        </div>
      )}

      <ConfirmDialog
        open={bulkDeleteOpen}
        title={`Delete ${selected.size} project${selected.size === 1 ? "" : "s"}`}
        description={`This permanently removes every update, time entry and assignment for ${
          selected.size === 1 ? [...selected][0] : `${selected.size} projects`
        }. This can't be undone.`}
        confirmLabel="Delete"
        danger
        loading={bulkBusy}
        onConfirm={async () => {
          setBulkDeleteOpen(false);
          await runBulk("Deleted", (name) =>
            fetch(`/api/projects/${encodeURIComponent(name)}`, { method: "DELETE" })
          );
        }}
        onCancel={() => setBulkDeleteOpen(false)}
      />
    </div>
  );
}
