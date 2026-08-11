"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Clock, GripVertical, ListTodo, SearchX, Trash2, X, Zap } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Checkbox } from "@/components/ui/Checkbox";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { Select } from "@/components/ui/Input";
import { SearchInput } from "@/components/ui/SearchInput";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { FilterPills } from "@/components/ui/FilterPills";
import { EmptyState } from "@/components/ui/EmptyState";
import { ViewToggle } from "@/components/ui/ViewToggle";
import { ColumnsMenu } from "@/components/ui/ColumnsMenu";
import { SortableHeader } from "@/components/ui/SortableHeader";
import { Pagination } from "@/components/ui/Pagination";
import { cn, formatDateShort, formatMinutes } from "@/lib/utils";
import { usePagination } from "@/lib/usePagination";
import { useSort } from "@/lib/useSort";
import { useViewMode } from "@/lib/useViewMode";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { useColumns } from "@/lib/useColumns";
import { useDragReorder } from "@/lib/useDragReorder";
import { TEN_ROWS_PY3 } from "@/lib/tableHeights";

export interface TaskRow {
  name: string;
  /** Written when the task was created. Null for one that only exists because
   *  work was logged against the name. Shown on the task's page, not in the list. */
  description: string | null;
  /** From the most recent update's "Task status" — a task has no settings row. */
  status: string;
  people: { id: string; name: string; avatarUrl: string | null }[];
  totalMinutes: number;
  updateCount: number;
  entryCount: number;
  lastActivity: string | null;
  /** Most recent update text, as a one-line reminder of what the task involves. */
  latestNote: string | null;
}

type SortKey = "name" | "people" | "time" | "entries" | "activity" | "status";

/**
 * Same shape, and the same width strategy, as the projects table: the name
 * column takes no width so it absorbs whatever's left over, and the data
 * columns are fixed. That's what keeps the row spread across the full container
 * rather than bunched at one end.
 *
 * `whitespace-nowrap` is the one addition — "Total time" and "Last activity"
 * were wrapping onto two lines and doubling the header's height. White-space is
 * inherited, so setting it on the `th` covers the sort button inside it.
 */
const ALL_COLUMNS: { key: SortKey; label: string; className?: string }[] = [
  { key: "name", label: "Task", className: "whitespace-nowrap" },
  { key: "people", label: "People", className: "w-40 whitespace-nowrap" },
  { key: "time", label: "Total time", className: "w-28 whitespace-nowrap" },
  { key: "entries", label: "Entries", className: "w-32 whitespace-nowrap" },
  { key: "activity", label: "Last activity", className: "w-32 whitespace-nowrap" },
  { key: "status", label: "Status", className: "w-32 whitespace-nowrap" },
];

/** "Task" is the row's identity, so it isn't offered as hideable. */
const TOGGLEABLE_COLUMNS = ALL_COLUMNS.filter((c) => c.key !== "name");

/**
 * The same pills as the projects list. A task's status comes from its most
 * recent update — the "Task status" field on the log form — rather than from a
 * settings row, which is the only difference.
 */
const STATUS_PILLS: { label: string; value: string }[] = [
  { label: "All", value: "all" },
  { label: "Completed", value: "Completed" },
  { label: "In progress", value: "In Progress" },
  { label: "Review", value: "Review" },
  { label: "On hold", value: "On Hold" },
  { label: "Blocked", value: "Blocked" },
];

/**
 * The tasks list — the Projects list's counterpart, and deliberately built the
 * same way: search, a person filter, card and table views, sortable columns and
 * pagination all behave identically, so switching tabs doesn't mean relearning
 * the page.
 *
 * What it doesn't carry is status, timeline, blockers and hour caps. Not having
 * those is what makes something a task, so showing empty columns for them would
 * contradict the description at the top.
 */
export function TasksView({
  tasks,
  onCreateTask,
  canDelete = false,
}: {
  tasks: TaskRow[];
  /** Opens the create-task modal. Owned by the tabs wrapper, same as New project. */
  onCreateTask?: () => void;
  /** `project.delete` — deleting a task takes its logged work with it. */
  canDelete?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const { view, setView } = useViewMode("tasks-view");
  const { currentUser } = useCurrentUser();
  const { visible: columnVisibility, isVisible, toggle: toggleColumn } = useColumns("tasks");
  const [search, setSearch] = useState("");
  const [personFilter, setPersonFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [scope, setScope] = useState<"all" | "mine">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Everyone who appears on a task, for the filter.
  const people = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of tasks) for (const p of t.people) map.set(p.id, p.name);
    return [...map.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [tasks]);

  function isMine(t: TaskRow) {
    return !!currentUser && t.people.some((p) => p.id === currentUser.id);
  }

  const term = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      tasks.filter((t) => {
        if (scope === "mine" && !isMine(t)) return false;
        if (statusFilter !== "all" && t.status !== statusFilter) return false;
        if (personFilter !== "all" && !t.people.some((p) => p.id === personFilter)) return false;
        if (!term) return true;
        return (
          t.name.toLowerCase().includes(term) ||
          t.people.some((p) => p.name.toLowerCase().includes(term)) ||
          (t.latestNote || "").toLowerCase().includes(term)
        );
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks, term, personFilter, statusFilter, scope, currentUser?.id]
  );

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: tasks.length };
    for (const pill of STATUS_PILLS) {
      if (pill.value === "all") continue;
      counts[pill.value] = tasks.filter((t) => t.status === pill.value).length;
    }
    return counts;
  }, [tasks]);

  const scopeCounts = useMemo(
    () => ({ all: tasks.length, mine: tasks.filter(isMine).length }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks, currentUser?.id]
  );

  const { sorted, sort, toggle } = useSort<TaskRow, SortKey>(filtered, {
    name: (t) => t.name,
    people: (t) => t.people.length,
    time: (t) => t.totalMinutes,
    entries: (t) => t.entryCount + t.updateCount,
    activity: (t) => t.lastActivity,
    status: (t) => t.status,
  });

  // Manual order, like the projects table — a local display preference only, and
  // only available when no column sort is overriding it.
  const reorderable = sort.key === null;
  const { ordered, dragHandleProps, dropTargetProps, draggedId } = useDragReorder(
    sorted,
    (t) => t.name,
    "tasks-order"
  );

  const { page, setPage, pageSize, setPageSize, totalPages, totalItems, paged } = usePagination(
    reorderable ? ordered : sorted
  );

  const allOnPageSelected = paged.length > 0 && paged.every((t) => selected.has(t.name));
  const someOnPageSelected = paged.some((t) => selected.has(t.name)) && !allOnPageSelected;

  function toggleRow(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleAllOnPage() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) paged.forEach((t) => next.delete(t.name));
      else paged.forEach((t) => next.add(t.name));
      return next;
    });
  }

  async function handleBulkDelete() {
    const names = [...selected];
    setDeleting(true);
    const res = await fetch("/api/tasks", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ names }),
    });
    const data = await res.json().catch(() => ({}));
    setDeleting(false);
    setDeleteOpen(false);

    if (res.ok) {
      setSelected(new Set());
      toast.success(`${names.length} ${names.length === 1 ? "task" : "tasks"} deleted.`);
      router.refresh();
    } else {
      toast.error(data.error || "Couldn't delete those tasks. Please try again.");
    }
  }

  const totalMinutes = filtered.reduce((sum, t) => sum + t.totalMinutes, 0);
  const hasActiveFilters = !!term || personFilter !== "all" || statusFilter !== "all" || scope !== "all";

  function clearFilters() {
    setSearch("");
    setPersonFilter("all");
    setStatusFilter("all");
    setScope("all");
  }

  const columns = ALL_COLUMNS.filter((c) => c.key === "name" || isVisible(c.key));

  /** "3 time · 2 updates" — a task accumulates two different kinds of record. */
  function entriesLabel(t: TaskRow) {
    const parts: string[] = [];
    if (t.entryCount > 0) parts.push(`${t.entryCount} time`);
    if (t.updateCount > 0) parts.push(`${t.updateCount} update${t.updateCount === 1 ? "" : "s"}`);
    return parts.length > 0 ? parts.join(" · ") : "—";
  }

  return (
    <div className="space-y-4">
      {/* The explanation earns its place: the obvious question about a list of
          "Meetings" and "Onboarding" is why they aren't in Projects, and the tab
          it sits behind can't answer that on its own. No heading — the tab is
          the heading. */}
      {/* Full width, no stat block: the counts were already on the tab and in
          the table's own header strip, and squeezing them alongside pushed this
          from two lines to three. */}
      <div className="rounded-md border border-togo-border bg-togo-surface px-4 py-2.5">
        <p className="text-xs leading-relaxed text-togo-muted">
          <ListTodo size={13} className="mr-1.5 inline-block shrink-0 -translate-y-px text-togo-blue" />
          <span className="font-semibold text-togo-white">Tasks are work that can&apos;t be called a project</span> —
          often a one-time thing. Meetings, onboarding, support, admin and one-off requests belong here. Their hours
          still count towards tracked time, but they never appear under Projects.
        </p>
      </div>

      {/* Two toolbar rows, laid out exactly as the Projects tab: filter pills
          above, then scope tabs + search + person filter. */}
      {tasks.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <FilterPills
              pills={STATUS_PILLS}
              value={statusFilter}
              onChange={setStatusFilter}
              counts={statusCounts}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {currentUser && (
              <SegmentedTabs
                label="Task scope"
                value={scope}
                onChange={(v) => setScope(v as "all" | "mine")}
                tabs={[
                  { label: "All tasks", value: "all", count: scopeCounts.all },
                  { label: "My tasks", value: "mine", count: scopeCounts.mine },
                ]}
              />
            )}
            <SearchInput
              value={search}
              onChange={setSearch}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setSearch("");
                  e.currentTarget.blur();
                }
              }}
              placeholder="Search tasks..."
            />
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="flex items-center gap-1 text-xs font-medium text-togo-muted transition-colors hover:text-togo-blue"
              >
                <X size={14} /> Clear filters
              </button>
            )}

            <Select
              value={personFilter}
              onChange={(e) => setPersonFilter(e.target.value)}
              className="ml-auto w-auto"
              aria-label="Filter by person"
            >
              <option value="all">All people</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
        </>
      )}

      {filtered.length === 0 ? (
        tasks.length === 0 ? (
          <EmptyState
            icon={Zap}
            title="No tasks yet"
            description="Meetings, onboarding, support and other one-off work. Log one here, or switch any time entry or daily update from Project to Task."
            action={
              onCreateTask ? (
                <Button size="sm" onClick={onCreateTask}>
                  + New task
                </Button>
              ) : undefined
            }
          />
        ) : (
          <EmptyState
            icon={SearchX}
            title="No tasks match those filters"
            description="Try a different search, or clear the filters to see everything."
          />
        )
      ) : (
        <div className="overflow-hidden rounded-md border border-togo-border bg-togo-surface">
          {/* Selection bar, same as the projects table's. */}
          {canDelete && selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-togo-border bg-togo-blue/[0.06] px-4 py-2.5">
              <span className="tnum text-xs font-semibold text-togo-white">{selected.size} selected</span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setDeleteOpen(true)}
                className="border-[var(--status-blocked-fg)] text-[var(--status-blocked-fg)] hover:bg-[var(--status-blocked-bg)]"
              >
                <Trash2 size={13} /> Delete
              </Button>
              <button
                onClick={() => setSelected(new Set())}
                className="ml-auto flex items-center gap-1 text-xs font-medium text-togo-muted transition-colors hover:text-togo-blue"
              >
                <X size={14} /> Clear selection
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-2 gap-y-2 border-b border-togo-border px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-2 text-xs text-togo-faint">
              <span className="tnum">
                <span className="font-semibold text-togo-muted">{filtered.length}</span>
                {filtered.length === 1 ? " task" : " tasks"}
                {filtered.length !== tasks.length && ` of ${tasks.length}`}
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
              <ViewToggle value={view} onChange={setView} />
              {view === "table" && (
                <ColumnsMenu columns={TOGGLEABLE_COLUMNS} visible={columnVisibility} onToggle={toggleColumn} />
              )}
            </div>
          </div>

          {view === "card" ? (
            <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {paged.map((t) => (
                <Link
                  key={t.name}
                  href={`/tasks/${encodeURIComponent(t.name)}`}
                  className="card-hover flex flex-col gap-3 rounded-md border border-togo-border bg-togo-surface p-4 hover:border-togo-blue"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="truncate font-bold text-togo-white" title={t.name}>
                      {t.name}
                    </div>
                    {/* Status badge, same position a project card carries one. */}
                    <StatusBadge status={t.status} />
                  </div>

                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-togo-faint">{entriesLabel(t)}</span>
                    <span className="tnum flex items-center gap-1 font-semibold text-togo-blue">
                      <Clock size={10} />
                      {t.totalMinutes > 0 ? formatMinutes(t.totalMinutes) : "—"}
                    </span>
                  </div>

                  <div className="mt-auto flex items-center justify-between pt-0.5">
                    <div className="flex items-center -space-x-2">
                      {t.people.slice(0, 5).map((p) => (
                        <Avatar
                          key={p.id}
                          name={p.name}
                          avatarUrl={p.avatarUrl}
                          size="sm"
                          title={p.name}
                          className="!h-6 !w-6 ring-2 ring-togo-surface !text-[10px]"
                        />
                      ))}
                      {t.people.length > 5 && (
                        <span className="ml-3 text-[10px] text-togo-faint">+{t.people.length - 5}</span>
                      )}
                      {t.people.length === 0 && <span className="text-[10px] text-togo-faint">Nobody yet</span>}
                    </div>
                    <span className="tnum text-[10px] text-togo-faint">
                      {t.lastActivity ? formatDateShort(t.lastActivity) : "—"}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className={`overflow-x-auto ${TEN_ROWS_PY3}`}>
              <table className="w-full min-w-[640px] text-sm">
                {/* Sticky, like the projects table: the header stays put while a
                    full page of ten rows scrolls under it. */}
                <thead className="sticky top-0 z-10 bg-togo-surface">
                  <tr className="border-b border-togo-border text-left">
                    {canDelete && (
                      <th scope="col" className="w-8 px-2 py-3">
                        <Checkbox
                          checked={allOnPageSelected}
                          indeterminate={someOnPageSelected}
                          onChange={toggleAllOnPage}
                          label="Select all tasks on this page"
                        />
                      </th>
                    )}
                    <th scope="col" className="w-8 px-2 py-3">
                      <span className="sr-only">Reorder</span>
                    </th>
                    {columns.map((c) => (
                      <SortableHeader
                        key={c.key}
                        label={c.label}
                        active={sort.key === c.key}
                        direction={sort.direction}
                        onClick={() => toggle(c.key)}
                        className={c.className}
                      />
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-togo-border">
                  {paged.map((t) => (
                    <tr
                      key={t.name}
                      {...(reorderable ? dropTargetProps(t.name) : {})}
                      className={cn(
                        "transition-colors hover:bg-[var(--togo-hover)]",
                        draggedId === t.name && "opacity-40"
                      )}
                    >
                      {canDelete && (
                        <td className="px-2 py-3">
                          <Checkbox
                            checked={selected.has(t.name)}
                            onChange={() => toggleRow(t.name)}
                            label={`Select ${t.name}`}
                          />
                        </td>
                      )}
                      <td className="px-2 py-3">
                        {reorderable ? (
                          <span
                            {...dragHandleProps(t.name)}
                            title="Drag to reorder"
                            className="inline-flex cursor-grab text-togo-faint transition-colors hover:text-togo-muted active:cursor-grabbing"
                          >
                            <GripVertical size={14} />
                          </span>
                        ) : (
                          <span
                            title="Clear the column sort to reorder rows manually"
                            className="inline-flex text-togo-border"
                          >
                            <GripVertical size={14} />
                          </span>
                        )}
                      </td>
                      {/* Name only — the description lives on the task's own
                          page, where there's room for it. In a row it pushed the
                          line height around and made the table read as two
                          different densities. */}
                      <td className="px-4 py-3">
                        <Link
                          href={`/tasks/${encodeURIComponent(t.name)}`}
                          className="font-semibold text-togo-white transition-colors hover:text-togo-blue"
                        >
                          {t.name}
                        </Link>
                      </td>
                      {isVisible("people") && (
                        <td className="px-4 py-3">
                          {t.people.length > 0 ? (
                            <div className="flex items-center -space-x-2">
                              {t.people.slice(0, 5).map((p) => (
                                <Avatar
                                  key={p.id}
                                  name={p.name}
                                  avatarUrl={p.avatarUrl}
                                  size="sm"
                                  title={p.name}
                                  className="ring-2 ring-togo-surface"
                                />
                              ))}
                              {t.people.length > 5 && (
                                <span className="ml-3 text-xs text-togo-faint">+{t.people.length - 5}</span>
                              )}
                            </div>
                          ) : (
                            <span className="text-togo-faint">—</span>
                          )}
                        </td>
                      )}
                      {isVisible("time") && (
                        <td className="tnum whitespace-nowrap px-4 py-3 font-semibold text-togo-blue">
                          {t.totalMinutes > 0 ? (
                            formatMinutes(t.totalMinutes)
                          ) : (
                            <span className="text-togo-faint">—</span>
                          )}
                        </td>
                      )}
                      {isVisible("entries") && (
                        <td className="whitespace-nowrap px-4 py-3 text-togo-muted">
                          {t.entryCount + t.updateCount > 0 ? (
                            entriesLabel(t)
                          ) : (
                            <span className="text-togo-faint">—</span>
                          )}
                        </td>
                      )}
                      {isVisible("activity") && (
                        <td className="tnum whitespace-nowrap px-4 py-3 text-togo-muted">
                          {t.lastActivity ? (
                            formatDateShort(t.lastActivity)
                          ) : (
                            <span className="text-togo-faint">—</span>
                          )}
                        </td>
                      )}
                      {isVisible("status") && (
                        <td className="px-4 py-3">
                          <StatusBadge status={t.status} />
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
        open={deleteOpen}
        title={`Delete ${selected.size} ${selected.size === 1 ? "task" : "tasks"}`}
        description={`This permanently removes ${
          selected.size === 1 ? `“${[...selected][0]}”` : `${selected.size} tasks`
        } and every time entry and update logged against ${
          selected.size === 1 ? "it" : "them"
        }. This can't be undone.`}
        confirmLabel="Delete"
        danger
        loading={deleting}
        onConfirm={handleBulkDelete}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  );
}
