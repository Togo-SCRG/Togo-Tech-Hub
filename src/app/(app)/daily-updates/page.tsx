"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ClipboardList, Download, Keyboard, SearchX, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DateRangePicker } from "@/components/ui/DateRangePicker";
import { Select } from "@/components/ui/Input";
import { SearchInput } from "@/components/ui/SearchInput";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterPills } from "@/components/ui/FilterPills";
import { ViewToggle } from "@/components/ui/ViewToggle";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { ShortcutsModal } from "@/components/ui/ShortcutsModal";
import { Kbd } from "@/components/ui/Kbd";
import { useToast } from "@/components/ui/Toast";
import { TableView, TRACKER_TOGGLEABLE, type TrackerSortKey } from "@/components/tracker/TableView";
import { CardView } from "@/components/tracker/CardView";
import { UpdateModal } from "@/components/tracker/UpdateModal";
import { UpdateDetailModal } from "@/components/tracker/UpdateDetailModal";
import { can } from "@/lib/capabilities";
import { Pagination } from "@/components/ui/Pagination";
import { ColumnsMenu } from "@/components/ui/ColumnsMenu";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { cn, toDateInputValue, formatDateShort, formatMinutes, getWeekRange } from "@/lib/utils";
import { downloadExcel } from "@/lib/exportExcel";
import { usePagination } from "@/lib/usePagination";
import { useHotkeys } from "@/lib/useHotkeys";
import { useSort } from "@/lib/useSort";
import { useViewMode } from "@/lib/useViewMode";
import { useColumns } from "@/lib/useColumns";
import { fetchJson, peekJson } from "@/lib/jsonCache";
import type { CurrentUser, DailyUpdateItem, MemberItem } from "@/types";

type MeResponse = { user: CurrentUser | null };
type MembersResponse = { members: MemberItem[] };
type ProjectsResponse = { projects?: string[]; tasks?: string[] };
type UpdatesResponse = { updates: DailyUpdateItem[] };
type EntriesResponse = { entries: { userId: string; project: string; date: string; durationMinutes: number }[] };

const ME_URL = "/api/auth/me";
const MEMBERS_URL = "/api/members";
const PROJECTS_URL = "/api/projects";
const updatesUrl = (from: string, to: string) => `/api/updates?from=${from}&to=${to}`;
const entriesUrl = (from: string, to: string) => `/api/time-entries?from=${from}&to=${to}`;

// Minutes per (user, project) within the selected date range — these entries
// are fetched for the same from/to as the updates, so this is "hours this
// person logged on this project in the visible range". Previously keyed on the
// exact date too, which only matched when time was logged on the same day as
// the update, leaving Hrs empty almost always.
function minutesByUserProject(entries: EntriesResponse["entries"]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const e of entries) {
    const key = `${e.userId}|${e.project}`;
    map[key] = (map[key] || 0) + e.durationMinutes;
  }
  return map;
}

// A tier without "see everyone's tasks" is pinned to their own work. The server
// enforces the same thing, so this only decides the default the filter opens on.
function defaultEngineerFilter(user: CurrentUser | null | undefined): string {
  return user && !can(user.capabilities, "tracker.view.all") ? user.id : "all";
}

const STATUS_PILLS: { label: string; value: string }[] = [
  { label: "All", value: "all" },
  { label: "Completed", value: "Completed" },
  { label: "In progress", value: "In Progress" },
  { label: "Review", value: "Review" },
  { label: "On hold", value: "On Hold" },
  { label: "Blocked", value: "Blocked" },
];

type DatePreset = "today" | "week" | "month" | "custom";

function presetRange(preset: Exclude<DatePreset, "custom">): { from: string; to: string } {
  const now = new Date();
  if (preset === "today") {
    const today = toDateInputValue(now);
    return { from: today, to: today };
  }
  if (preset === "week") return getWeekRange(now);
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return { from: toDateInputValue(first), to: toDateInputValue(last) };
}

export default function TrackerPage() {
  const toast = useToast();
  const searchParams = useSearchParams();
  const today = toDateInputValue(new Date());
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [datePreset, setDatePreset] = useState<DatePreset>("today");
  const { view, setView, toggleView } = useViewMode("tracker-view");
  // A return visit starts from what the last one loaded (see lib/jsonCache), so
  // the page draws at once instead of behind a skeleton; the fetches below then
  // bring it up to date. A first visit has nothing cached and loads as before.
  const [cachedAtMount] = useState(() => ({
    me: peekJson<MeResponse>(ME_URL),
    members: peekJson<MembersResponse>(MEMBERS_URL),
    projects: peekJson<ProjectsResponse>(PROJECTS_URL),
    updates: peekJson<UpdatesResponse>(updatesUrl(today, today)),
    entries: peekJson<EntriesResponse>(entriesUrl(today, today)),
  }));
  const [updates, setUpdates] = useState<DailyUpdateItem[]>(cachedAtMount.updates?.updates ?? []);
  const [minutesByKey, setMinutesByKey] = useState<Record<string, number>>(() =>
    cachedAtMount.entries ? minutesByUserProject(cachedAtMount.entries.entries) : {}
  );
  const [members, setMembers] = useState<MemberItem[]>(cachedAtMount.members?.members ?? []);
  const [projectNames, setProjectNames] = useState<string[]>(cachedAtMount.projects?.projects ?? []);
  const [taskNames, setTaskNames] = useState<string[]>(cachedAtMount.projects?.tasks ?? []);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(cachedAtMount.me?.user ?? null);
  const [loading, setLoading] = useState(!(cachedAtMount.me && cachedAtMount.members && cachedAtMount.projects));
  const [refreshing, setRefreshing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [editingUpdate, setEditingUpdate] = useState<DailyUpdateItem | null>(null);
  const [viewingUpdate, setViewingUpdate] = useState<DailyUpdateItem | null>(null);
  const [modalMode, setModalMode] = useState<"log" | "add">("log");
  const [engineerFilter, setEngineerFilter] = useState(() => defaultEngineerFilter(cachedAtMount.me?.user));
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const { visible: columnVisibility, isVisible, toggle: toggleColumn } = useColumns("tracker");
  const [deleteTarget, setDeleteTarget] = useState<DailyUpdateItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadUpdates = useCallback(async () => {
    // A range visited earlier this session shows at once while it refreshes.
    const cachedUpdates = peekJson<UpdatesResponse>(updatesUrl(dateFrom, dateTo));
    const cachedEntries = peekJson<EntriesResponse>(entriesUrl(dateFrom, dateTo));
    if (cachedUpdates) setUpdates(cachedUpdates.updates);
    if (cachedEntries) setMinutesByKey(minutesByUserProject(cachedEntries.entries));

    setRefreshing(true);
    const [updatesData, entriesData] = await Promise.all([
      fetchJson<UpdatesResponse>(updatesUrl(dateFrom, dateTo)),
      fetchJson<EntriesResponse>(entriesUrl(dateFrom, dateTo)),
    ]);
    if (updatesData) setUpdates(updatesData.updates);
    if (entriesData) setMinutesByKey(minutesByUserProject(entriesData.entries));
    setRefreshing(false);
  }, [dateFrom, dateTo]);

  useEffect(() => {
    async function init() {
      const [meData, membersData, projectsData] = await Promise.all([
        fetchJson<MeResponse>(ME_URL),
        fetchJson<MembersResponse>(MEMBERS_URL),
        fetchJson<ProjectsResponse>(PROJECTS_URL),
      ]);
      if (meData) {
        setCurrentUser(meData.user);
        // Only when the filter wasn't already set from the cached user — by now
        // the viewer may have picked a different engineer themselves.
        if (!cachedAtMount.me) setEngineerFilter(defaultEngineerFilter(meData.user));
      }
      if (membersData) setMembers(membersData.members);
      if (projectsData) {
        setProjectNames(projectsData.projects || []);
        setTaskNames(projectsData.tasks || []);
      }
      setLoading(false);
    }
    init();
  }, [cachedAtMount]);

  useEffect(() => {
    loadUpdates();
  }, [loadUpdates]);

  useEffect(() => {
    if (searchParams.get("logUpdate") && currentUser) {
      openLog();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser]);

  function applyPreset(preset: Exclude<DatePreset, "custom">) {
    const { from, to } = presetRange(preset);
    setDateFrom(from);
    setDateTo(to);
    setDatePreset(preset);
  }

  function openLog() {
    setEditingUpdate(null);
    setModalMode("log");
    setModalOpen(true);
  }

  function openAdd() {
    setEditingUpdate(null);
    setModalMode("add");
    setModalOpen(true);
  }

  /**
   * One entry point for opening a row: the editor when the viewer may change
   * it, a read-only detail view otherwise. Keeps the decision here rather than
   * making the table know about permissions.
   */
  function openRow(u: DailyUpdateItem) {
    if (canEdit(u)) {
      setEditingUpdate(u);
      setModalOpen(true);
    } else {
      setViewingUpdate(u);
    }
  }

  function canEdit(u: DailyUpdateItem) {
    if (!can(currentUser?.capabilities, "work.update.log")) return false;
    // Your own row always; anyone else's only with the separate permission.
    return u.userId === currentUser?.id || can(currentUser?.capabilities, "work.update.others");
  }

  async function handleStatusChange(u: DailyUpdateItem, status: string) {
    setUpdates((prev) => prev.map((item) => (item.id === u.id ? { ...item, status } : item)));
    const res = await fetch(`/api/updates/${u.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      toast.error("Failed to update status. Please try again.");
      loadUpdates();
    }
  }

  useHotkeys(
    {
      "/": () => searchRef.current?.focus(),
      // Always the own-update form: "n" is the everyday action, and logging for
      // someone else is a deliberate second choice.
      n: () => {
        if (can(currentUser?.capabilities, "work.update.log")) openLog();
      },
      t: () => applyPreset("today"),
      w: () => applyPreset("week"),
      v: () => toggleView(),
      "?": () => setShortcutsOpen(true),
    },
    !loading
  );

  // Counts ignore the status filter itself, so each pill always shows how many
  // updates that status *would* return under the current search/engineer.
  const statusCounts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = updates.filter((u) => {
      if (engineerFilter !== "all" && u.userId !== engineerFilter) return false;
      if (q && !`${u.user.name} ${u.project} ${u.update || ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
    const counts: Record<string, number> = { all: base.length };
    for (const pill of STATUS_PILLS) {
      if (pill.value !== "all") counts[pill.value] = base.filter((u) => u.status === pill.value).length;
    }
    return counts;
  }, [updates, engineerFilter, search]);

  const filteredUpdates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return updates.filter((u) => {
      if (engineerFilter !== "all" && u.userId !== engineerFilter) return false;
      if (statusFilter !== "all" && u.status !== statusFilter) return false;
      if (q) {
        const haystack = `${u.user.name} ${u.project} ${u.update || ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [updates, engineerFilter, statusFilter, search]);

  // Total logged time across whatever is currently in view.
  const totalMinutesInView = useMemo(() => {
    const seen = new Set<string>();
    let total = 0;
    for (const u of filteredUpdates) {
      const key = `${u.userId}|${u.project}`;
      if (seen.has(key)) continue;
      seen.add(key);
      total += minutesByKey[key] || 0;
    }
    return total;
  }, [filteredUpdates, minutesByKey]);

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const res = await fetch(`/api/updates/${deleteTarget.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Update deleted.");
      setUpdates((prev) => prev.filter((u) => u.id !== deleteTarget.id));
      setDeleteTarget(null);
    } else {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error || "Failed to delete that update.");
    }
    setDeleting(false);
  }

  // Sort the whole filtered set before paginating, so column sorts reorder
  // every matching update rather than just the page you happen to be on.
  const { sorted: sortedUpdates, sort, toggle } = useSort<DailyUpdateItem, TrackerSortKey>(filteredUpdates, {
    task: (u) => u.update || "",
    project: (u) => u.project,
    engineer: (u) => u.user.name,
    status: (u) => u.status,
    date: (u) => u.date,
    blockers: (u) => u.blockers || "",
  });

  const {
    page,
    setPage,
    pageSize,
    setPageSize,
    totalPages,
    totalItems,
    paged: pagedUpdates,
  } = usePagination(sortedUpdates);

  // Re-sorting changes what "the top" means, so jump back to the first page.
  function handleToggleSort(key: TrackerSortKey) {
    toggle(key);
    setPage(1);
  }

  // The date range counts as a filter too. It didn't, so narrowing to a custom
  // range or switching to This Week left no way back to the default except
  // clicking Today — and no indication that a filter was even applied.
  //
  // "Today" is the default the page opens on, so only a different preset or a
  // custom range is a filter. The engineer selection deliberately isn't
  // included: a plain user is pinned to their own work, which would leave Clear
  // filters permanently on screen with nothing to clear.
  const dateFiltered = datePreset !== "today";
  const hasFilters = search.trim() !== "" || statusFilter !== "all" || dateFiltered;

  function clearFilters() {
    setSearch("");
    setStatusFilter("all");
    applyPreset("today");
  }

  async function handleExport() {
    const header = ["Name", "Project", "Update", "What's Left To Do", "Concerns/Blockers", "Status", "Date"];
    const rows = filteredUpdates.map((u) => [
      u.user.name,
      u.project,
      u.update || "",
      u.whatsLeft || "",
      u.blockers || "",
      u.status,
      formatDateShort(u.date),
    ]);
    await downloadExcel(`daily-updates_${dateFrom}_to_${dateTo}.xlsx`, "Daily Updates", header, rows);
  }

  if (loading || !currentUser) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap gap-1.5">
          {STATUS_PILLS.map((p) => (
            <div key={p.value} className="h-8 w-24 animate-pulse rounded-md bg-togo-surface-2" />
          ))}
        </div>
        <SkeletonTable rows={8} label="Loading updates" />
      </div>
    );
  }

  const rangeLabel =
    dateFrom === dateTo ? formatDateShort(dateFrom) : `${formatDateShort(dateFrom)} – ${formatDateShort(dateTo)}`;

  const canLogOwn = can(currentUser.capabilities, "work.update.log");
  const canLogOthers = canLogOwn && can(currentUser.capabilities, "work.update.others");
  // Admins and the super admin only — is_admin covers exactly those two. A
  // client can still see everyone's work through the engineer dropdown; they
  // just don't get the extra row, so their toolbar stays as it was.
  const showScopeTabs = currentUser.isAdmin;

  // The scope tabs and the engineer dropdown drive the same filter, so the tabs
  // are derived from it rather than held separately — picking a specific person
  // in the dropdown leaves neither tab active, which is honest.
  const scope = engineerFilter === "all" ? "all" : engineerFilter === currentUser.id ? "mine" : "other";
  const myTaskCount = updates.filter((u) => u.userId === currentUser.id).length;

  // Rendered in one of two places depending on the layout below, so it's built
  // once here rather than duplicated — the ref means there must only ever be
  // one of them on the page.
  const searchInput = (
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
      placeholder="Search updates, projects, people..."
    />
  );

  return (
    <div className="space-y-4">
      {/* Primary toolbar — status pills + engineer / view / log */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterPills pills={STATUS_PILLS} value={statusFilter} onChange={setStatusFilter} counts={statusCounts} />

        <div className="ml-auto flex items-center gap-2">
          {/* Two separate buttons rather than one that behaves differently
              depending on your tier: "Log update" is always your own work, and
              logging for someone else is an explicit, separately-permissioned
              action rather than a hidden mode of the same button. */}
          {canLogOwn && (
            <>
              {canLogOthers && (
                <Button size="sm" variant="secondary" onClick={openAdd}>
                  <UserPlus size={14} /> Log member update
                </Button>
              )}
              <Button size="sm" onClick={openLog}>
                + Log update
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Utility row — date presets + range, engineer, view, export.
          For admins the search box moves to a row of its own below, next to the
          scope tabs; everyone else keeps it here, leading this row as before. */}
      <div className="flex flex-wrap items-center gap-2">
        {!showScopeTabs && searchInput}

        <div className="flex items-center rounded-md border border-togo-border bg-togo-surface-2 p-1">
          {(["today", "week", "month"] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => applyPreset(p)}
              aria-pressed={datePreset === p}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                datePreset === p ? "bg-togo-blue text-white" : "text-togo-muted hover:text-togo-white"
              )}
            >
              {p === "today" ? "Today" : p === "week" ? "This week" : "This month"}
            </button>
          ))}
        </div>

        <DateRangePicker
          from={dateFrom}
          to={dateTo}
          onApply={(from, to) => {
            setDateFrom(from);
            setDateTo(to);
            setDatePreset("custom");
          }}
        />

        {hasFilters && (
          <button
            onClick={clearFilters}
            className="flex items-center gap-1 text-xs font-medium text-togo-muted transition-colors hover:text-togo-blue"
          >
            <X size={14} /> Clear filters
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
          {can(currentUser.capabilities, "tracker.view.all") && (
            <Select
              value={engineerFilter}
              onChange={(e) => setEngineerFilter(e.target.value)}
              className="w-auto"
              aria-label="Filter by engineer"
            >
              <option value="all">All engineers</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          )}
          <ViewToggle value={view} onChange={setView} />
          <button
            onClick={() => setShortcutsOpen(true)}
            title="Keyboard shortcuts"
            aria-label="Keyboard shortcuts"
            className="hidden items-center gap-1.5 rounded-md border border-togo-border px-2 py-1.5 text-togo-faint transition-colors hover:border-togo-border-strong hover:text-togo-muted sm:flex"
          >
            <Keyboard size={14} />
            <Kbd>?</Kbd>
          </button>
        </div>
      </div>

      {showScopeTabs && (
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedTabs
            label="Update scope"
            value={scope}
            onChange={(v) => {
              setEngineerFilter(v === "mine" ? currentUser.id : "all");
              setPage(1);
            }}
            tabs={[
              { label: "All updates", value: "all", count: updates.length },
              { label: "My updates", value: "mine", count: myTaskCount },
            ]}
          />
          {searchInput}
        </div>
      )}

      {filteredUpdates.length === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={SearchX}
            title="Nothing matches those filters"
            description={
              search.trim()
                ? `No updates in ${rangeLabel} match “${search.trim()}”. Try a different term or widen the date range.`
                : statusFilter !== "all"
                ? `No ${statusFilter.toLowerCase()} updates in ${rangeLabel}. Try another status or widen the date range.`
                : // Only the date range is narrowing things — saying "no all
                  // updates" (which this used to) reads as broken.
                  `No updates logged in ${rangeLabel}. Try a wider date range.`
            }
            action={
              <Button size="sm" variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={ClipboardList}
            title={`No updates logged for ${rangeLabel}`}
            description="Log what you worked on to keep the team's tracker current, or widen the date range to see earlier work."
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                {canLogOwn && (
                  <Button size="sm" onClick={openLog}>
                    + Log update
                  </Button>
                )}
                <Button size="sm" variant="secondary" onClick={() => applyPreset("week")}>
                  View this week
                </Button>
              </div>
            }
          />
        )
      ) : (
        /* One panel owns the results: what you're looking at and the table
           actions in the header, the rows in the middle, paging in the footer.
           Keeps the table controls attached to the table they act on. */
        <div className="overflow-hidden rounded-md border border-togo-border bg-togo-surface">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-2 border-b border-togo-border px-4 py-3">
            <div className={cn("flex flex-wrap items-center gap-x-2 text-xs text-togo-faint transition-opacity", refreshing && "opacity-50")}>
              <span className="tnum">
                <span className="font-semibold text-togo-muted">{filteredUpdates.length}</span>
                {filteredUpdates.length === 1 ? " update" : " updates"}
                {filteredUpdates.length !== updates.length && ` of ${updates.length}`}
              </span>
              <span aria-hidden>·</span>
              <span>{rangeLabel}</span>
              {totalMinutesInView > 0 && (
                <>
                  <span aria-hidden>·</span>
                  <span className="tnum">
                    <span className="font-semibold text-togo-muted">{formatMinutes(totalMinutesInView)}</span> logged
                  </span>
                </>
              )}
            </div>

            <div className="ml-auto flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={handleExport}
                disabled={filteredUpdates.length === 0}
                title="Export the filtered rows to Excel (.xlsx)"
              >
                <Download size={16} /> Export
              </Button>
              {view === "table" && (
                <ColumnsMenu columns={TRACKER_TOGGLEABLE} visible={columnVisibility} onToggle={toggleColumn} />
              )}
            </div>
          </div>

          {view === "table" ? (
            <TableView
              updates={pagedUpdates}
              onRowClick={openRow}
              onStatusChange={handleStatusChange}
              canEdit={canEdit}
              onDelete={setDeleteTarget}
              sort={sort}
              onToggleSort={handleToggleSort}
              isVisible={isVisible}
            />
          ) : (
            <div className="p-4">
              <CardView
                updates={pagedUpdates}
                onCardClick={openRow}
                onStatusChange={handleStatusChange}
                canEdit={canEdit}
              />
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

      <UpdateModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={loadUpdates}
        currentUser={currentUser}
        members={members}
        editingUpdate={editingUpdate}
        defaultDate={today}
        existingProjects={projectNames}
        existingTasks={taskNames}
        allowMemberPick={modalMode === "add" && canLogOthers}
      />

      <UpdateDetailModal
        open={!!viewingUpdate}
        onClose={() => setViewingUpdate(null)}
        update={viewingUpdate}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Update"
        description={`Permanently delete this ${
          deleteTarget ? `"${deleteTarget.project}" ` : ""
        }update? This can't be undone.`}
        confirmLabel="Delete"
        danger
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
