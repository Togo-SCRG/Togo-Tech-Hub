"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownUp, Play, Square, Download, Timer, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonTable } from "@/components/ui/Skeleton";
import { StartTimerModal } from "./StartTimerModal";
import { TimeEntryModal } from "./TimeEntryModal";
import { TimeImportModal } from "./TimeImportModal";
import { PhaseBadge } from "./PhaseBadge";
import { Pagination } from "@/components/ui/Pagination";
import { ColumnsMenu } from "@/components/ui/ColumnsMenu";
import { Section } from "@/components/ui/Section";
import { useActiveTimer } from "@/lib/useActiveTimer";
import { cn, formatDateShort, formatElapsed, formatMinutes, toDateInputValue } from "@/lib/utils";
import { downloadExcel } from "@/lib/exportExcel";
import { usePagination } from "@/lib/usePagination";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { can } from "@/lib/capabilities";
import { useColumns } from "@/lib/useColumns";
import { TEN_ROWS_PY3 } from "@/lib/tableHeights";
import type { MemberItem, TimeEntryItem } from "@/types";

export function ProjectTimeSection({ projectName,
  isProjectMember,
}: { projectName: string;
  /** On this project — assigned, or has logged an update or time against it. */
  isProjectMember: boolean;
}) {
  const { active, elapsedSeconds, saving: stopping, start, stop } = useActiveTimer();
  const { currentUser } = useCurrentUser();
  const [members, setMembers] = useState<MemberItem[]>([]);
  const [entries, setEntries] = useState<TimeEntryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [startModalOpen, setStartModalOpen] = useState(false);
  const [logModalOpen, setLogModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<TimeEntryItem | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [dataMenuOpen, setDataMenuOpen] = useState(false);
  const [deleting, setDeleting] = useState<TimeEntryItem | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const toast = useToast();
  const router = useRouter();
  const dataMenuRef = useRef<HTMLDivElement>(null);

  // Close the export/import menu on an outside click or Escape.
  useEffect(() => {
    if (!dataMenuOpen) return;
    function onOutside(e: MouseEvent) {
      if (dataMenuRef.current && !dataMenuRef.current.contains(e.target as Node)) setDataMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setDataMenuOpen(false);
    }
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, [dataMenuOpen]);
  const { visible: columnVisibility, isVisible, toggle: toggleColumn } = useColumns("project-time");

  // "Name" identifies the row, so it isn't offered as hideable.
  const TIME_COLUMNS = [
    { key: "date", label: "Date" },
    { key: "duration", label: "Duration" },
    { key: "phase", label: "Phase" },
    { key: "note", label: "What Was Done" },
  ];

  const loadEntries = useCallback(async () => {
    const res = await fetch(`/api/time-entries?project=${encodeURIComponent(projectName)}`);
    if (res.ok) {
      const data = await res.json();
      setEntries(data.entries);
    }
  }, [projectName]);

  useEffect(() => {
    async function init() {
      const membersRes = await fetch("/api/members");
      if (membersRes.ok) {
        const data = await membersRes.json();
        setMembers(data.members);
      }
      setLoading(false);
    }
    init();
  }, []);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  function canEdit(e: TimeEntryItem) {
    if (!can(currentUser?.capabilities, "work.time.track")) return false;
    return e.userId === currentUser?.id || can(currentUser?.capabilities, "work.update.others");
  }

  function openEdit(e: TimeEntryItem) {
    if (!canEdit(e)) return;
    setEditingEntry(e);
    setLogModalOpen(true);
  }

  async function handleDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    const res = await fetch(`/api/time-entries/${deleting.id}`, { method: "DELETE" });
    setDeleteBusy(false);
    if (res.ok) {
      setEntries((prev) => prev.filter((x) => x.id !== deleting.id));
      setDeleting(null);
      toast.success("Time entry deleted.");
      // The activity feed and totals beside this table are rendered on the server.
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      setDeleting(null);
      toast.error(data.error || "Couldn't delete that time entry.");
    }
  }

  function openLog() {
    setEditingEntry(null);
    setLogModalOpen(true);
  }

  async function handleExport() {
    const header = ["Name", "Date", "Duration", "Phase", "What Was Done"];
    const rows = entries.map((e) => [
      e.user.name,
      formatDateShort(e.date),
      formatMinutes(e.durationMinutes),
      e.phase || "",
      e.note || "",
    ]);
    await downloadExcel(`${projectName}_time_${toDateInputValue(new Date())}.xlsx`, "Time", header, rows);
  }

  const isTimingThisProject = active?.project === projectName;
  const {
    page,
    setPage,
    pageSize,
    setPageSize,
    totalPages,
    totalItems,
    paged: pagedEntries,
  } = usePagination(entries);

  const totalLogged = entries.reduce((sum, e) => sum + e.durationMinutes, 0);
  // Same rule as status and timeline: the capability, plus either "manage every
  // project" or being on this one. A tier without manage.all — a plain user — is
  // a viewer on projects they aren't part of.
  const caps = currentUser?.capabilities;
  const canLogWork =
    can(caps, "work.time.track") && (can(caps, "project.manage.all") || isProjectMember);

  return (
    <Section
      title="Time tracking & logs"
      icon={Timer}
      count={entries.length}
      action={
        <>
          {totalLogged > 0 && <span className="tnum text-xs text-togo-faint">{formatMinutes(totalLogged)}</span>}
          {/* Import is super admin only (and enforced again server-side): it
              writes rows on someone else's behalf in bulk, with dates and
              durations that never went through the normal form — a migration
              tool, not a day-to-day control.

              With both actions available they share one menu rather than sitting
              as two near-identical arrow icons; with only export available the
              menu would be a dropdown of one, so it stays a plain button. */}
          {currentUser?.isSuperAdmin ? (
            <div ref={dataMenuRef} className="relative">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDataMenuOpen((o) => !o)}
                aria-expanded={dataMenuOpen}
                aria-haspopup="menu"
                title="Export or import this time log"
                aria-label="Export or import"
              >
                <ArrowDownUp size={14} />
              </Button>

              {dataMenuOpen && (
                <div
                  role="menu"
                  className="animate-fade-in absolute right-0 z-40 mt-1.5 w-56 overflow-hidden rounded-md border border-togo-border bg-togo-surface shadow-[var(--shadow-modal)]"
                >
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      setDataMenuOpen(false);
                      handleExport();
                    }}
                    disabled={entries.length === 0}
                    className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-[var(--togo-hover)] disabled:opacity-40 disabled:hover:bg-transparent"
                  >
                    <Download size={14} className="mt-0.5 shrink-0 text-togo-blue" />
                    <span className="min-w-0">
                      <span className="block text-xs font-medium text-togo-white">Export to Excel</span>
                      <span className="block text-[10px] text-togo-faint">
                        {entries.length === 0
                          ? "Nothing logged yet"
                          : `${entries.length} ${entries.length === 1 ? "entry" : "entries"} as .xlsx`}
                      </span>
                    </span>
                  </button>

                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      setDataMenuOpen(false);
                      setImportModalOpen(true);
                    }}
                    className="flex w-full items-start gap-2.5 border-t border-togo-border px-3 py-2.5 text-left transition-colors hover:bg-[var(--togo-hover)]"
                  >
                    <Upload size={14} className="mt-0.5 shrink-0 text-togo-blue" />
                    <span className="min-w-0">
                      <span className="block text-xs font-medium text-togo-white">Import from spreadsheet</span>
                      <span className="block text-[10px] text-togo-faint">Map columns from .xlsx, .xls or .csv</span>
                    </span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleExport}
              disabled={entries.length === 0}
              title="Export these entries to Excel (.xlsx)"
              aria-label="Export to Excel"
            >
              <Download size={14} />
            </Button>
          )}
          {/* Clients read the time log; they don't add to it. Export stays —
              taking a copy of what's already there is still watching. */}
          {canLogWork && (
            <>
              <Button variant="secondary" size="sm" onClick={openLog}>
                Log manually
              </Button>
              {/* The timer is global — it keeps running across pages, so this
                  control reflects whichever project it's actually attached to. */}
              {active ? (
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => stop(loadEntries)}
                  disabled={stopping}
                  title={
                    isTimingThisProject
                      ? "Stop the timer and log the session here"
                      : `Running on “${active.project}” — stopping logs the time there, not here`
                  }
                >
                  <Square size={13} />
                  <span className="tabular-nums">{stopping ? "Saving..." : formatElapsed(elapsedSeconds)}</span>
                </Button>
              ) : (
                <Button size="sm" onClick={() => setStartModalOpen(true)}>
                  <Play size={13} /> Start timer
                </Button>
              )}
            </>
          )}
          {/* Last, at the very right — same position as on the other tables, so
              the control sits in a predictable place across the app. */}
          <ColumnsMenu columns={TIME_COLUMNS} visible={columnVisibility} onToggle={toggleColumn} />
        </>
      }
      bodyClassName="p-4 space-y-4"
    >
      {active && !isTimingThisProject && (
        <p className="rounded border border-[var(--status-hold-border)] bg-[var(--status-hold-bg)] px-3 py-2 text-xs text-[var(--status-hold-fg)]">
          The running timer belongs to &ldquo;{active.project}&rdquo;. Stopping it logs that time there, not against
          this project.
        </p>
      )}

      {loading ? (
        <SkeletonTable rows={4} label="Loading time entries" />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={Timer}
          title="No time logged yet"
          description="Start the timer while you work, or log a past session manually — logged time rolls up into the project's weekly cap."
          className="border-0 bg-transparent py-6"
        />
      ) : (
        <div
          className={`overflow-x-auto rounded-md border border-togo-border bg-togo-surface ${TEN_ROWS_PY3}`}
        >
          <table className="w-full min-w-[600px] text-sm">
            <thead className="sticky top-0 z-10 bg-togo-surface">
              <tr className="border-b border-togo-border text-left">
                <th scope="col" className="section-label whitespace-nowrap px-4 py-3">
                  Name
                </th>
                {TIME_COLUMNS.filter((c) => isVisible(c.key)).map((c) => (
                  <th key={c.key} scope="col" className="section-label whitespace-nowrap px-4 py-3">
                    {c.label}
                  </th>
                ))}
                <th scope="col" className="w-10 py-3 pl-1 pr-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-togo-border">
              {pagedEntries.map((e) => {
                const editable = canEdit(e);
                return (
                  <tr
                    key={e.id}
                    onClick={() => openEdit(e)}
                    onKeyDown={(ev) => {
                      if (editable && (ev.key === "Enter" || ev.key === " ")) {
                        ev.preventDefault();
                        openEdit(e);
                      }
                    }}
                    tabIndex={editable ? 0 : undefined}
                    role={editable ? "button" : undefined}
                    aria-label={editable ? `Edit ${formatMinutes(e.durationMinutes)} entry by ${e.user.name}` : undefined}
                    // Hover tracks the row under the cursor whether or not you
                    // can edit it — it's feedback about where you are, not an
                    // affordance. The pointer and focus ring stay conditional.
                    className={cn(
                      "transition-colors hover:bg-[var(--togo-hover)]",
                      editable &&
                        "cursor-pointer focus-visible:bg-[var(--togo-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-togo-blue"
                    )}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 whitespace-nowrap">
                        <Avatar name={e.user.name} avatarUrl={e.user.avatarUrl} size="sm" />
                        <span className="font-semibold text-togo-white">{e.user.name}</span>
                      </div>
                    </td>
                    {isVisible("date") && (
                      <td className="tnum whitespace-nowrap px-4 py-3 text-togo-muted">{formatDateShort(e.date)}</td>
                    )}
                    {isVisible("duration") && (
                      <td className="tnum whitespace-nowrap px-4 py-3 font-semibold text-togo-blue">
                        {formatMinutes(e.durationMinutes)}
                      </td>
                    )}
                    {isVisible("phase") && (
                      <td className="px-4 py-3">
                        <PhaseBadge phase={e.phase || ""} />
                      </td>
                    )}
                    {isVisible("note") && (
                      <td className="px-4 py-3 text-togo-muted">
                        {e.note ? (
                          // One short line, ending in "…", so every row is the
                          // same height and the other columns keep their room.
                          // The full text is on hover, and in the row's own modal.
                          <span className="block max-w-[220px] truncate" title={e.note}>
                            {e.note}
                          </span>
                        ) : (
                          <span className="text-togo-faint">—</span>
                        )}
                      </td>
                    )}
                    <td className="w-10 py-3 pl-1 pr-3 text-right">
                      {editable && (
                        <button
                          type="button"
                          onClick={(ev) => {
                            // The row itself opens the edit form.
                            ev.stopPropagation();
                            setDeleting(e);
                          }}
                          onKeyDown={(ev) => ev.stopPropagation()}
                          title="Delete"
                          aria-label={`Delete ${formatMinutes(e.durationMinutes)} entry by ${e.user.name}`}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-togo-faint transition-colors hover:bg-[var(--status-blocked-bg)] hover:text-[var(--status-blocked-fg)]"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
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
      />

      <StartTimerModal
        open={startModalOpen}
        onClose={() => setStartModalOpen(false)}
        onStart={(project, phase, workDone, workType) => {
          start(project, phase, workDone, workType);
          setStartModalOpen(false);
        }}
        lockProject={projectName}
      />

      {currentUser?.isSuperAdmin && (
        <TimeImportModal
          open={importModalOpen}
          onClose={() => setImportModalOpen(false)}
          onImported={loadEntries}
          projectName={projectName}
          currentUser={currentUser}
          members={members}
        />
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Delete Time Entry"
        description={
          deleting
            ? `Delete ${deleting.user.name}'s ${formatMinutes(deleting.durationMinutes)} on ${formatDateShort(deleting.date)}? This can't be undone.`
            : ""
        }
        confirmLabel="Delete"
        danger
        loading={deleteBusy}
        onConfirm={handleDelete}
        onCancel={() => setDeleting(null)}
      />

      {canLogWork && currentUser && (
        <TimeEntryModal
          open={logModalOpen}
          onClose={() => setLogModalOpen(false)}
          onSaved={loadEntries}
          currentUser={currentUser}
          members={members}
          editingEntry={editingEntry}
          defaultDate={toDateInputValue(new Date())}
          lockProject={projectName}
        />
      )}
    </Section>
  );
}
