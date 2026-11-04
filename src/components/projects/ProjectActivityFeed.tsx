"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Calendar, Timer, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { can } from "@/lib/capabilities";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { LinkifiedText } from "@/components/ui/LinkifiedText";
import { UpdateDetailModal } from "@/components/tracker/UpdateDetailModal";
import { cn, formatDate, formatDateShort, formatMinutes, statusHex } from "@/lib/utils";
import type { ActivityEvent } from "@/lib/activity";

export type { ActivityEvent } from "@/lib/activity";

const STATUS_VERB: Record<string, string> = {
  Completed: "completed work on",
  "In Progress": "is working on",
  Review: "sent for review",
  "On Hold": "paused",
  Blocked: "flagged a blocker on",
  "Not Started": "planned",
};

/**
 * Combined history of daily updates and logged time, newest first. Reading
 * these two streams separately made it hard to reconstruct what actually
 * happened on a given day.
 *
 * Each row is a summary cut to two lines, so it opens the full entry: an update
 * in the same read-only view the Daily Updates page uses, or the time entry with
 * its whole note.
 */
export function ProjectActivityFeed({
  events,
  total,
  subject = "project",
}: {
  events: ActivityEvent[];
  total: number;
  /** What the entries are attached to, so the same feed reads correctly on a task. */
  subject?: "project" | "task";
}) {
  const [selected, setSelected] = useState<ActivityEvent | null>(null);
  const close = () => setSelected(null);
  const { currentUser } = useCurrentUser();
  const toast = useToast();
  const router = useRouter();
  const [deleting, setDeleting] = useState<ActivityEvent | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  // Hidden at once on delete; the refresh then brings the server's list and count.
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  // Fresh events from the server already leave the deleted rows out.
  useEffect(() => setRemoved(new Set()), [events]);
  const keyOf = (e: ActivityEvent) => `${e.kind}-${e.id}`;
  const shown = events.filter((e) => !removed.has(keyOf(e)));

  // The same rules as Daily Updates and the time table: your own rows, or
  // anyone's with "log for others". An update logged with its time needs both.
  function canDelete(e: ActivityEvent) {
    const caps = currentUser?.capabilities;
    if (!currentUser) return false;
    const ownsIt = e.userId === currentUser.id || can(caps, "work.update.others");
    if (!ownsIt) return false;
    if (e.kind === "time") return can(caps, "work.time.track");
    return can(caps, "work.update.log") && (!e.timeEntryIds?.length || can(caps, "work.time.track"));
  }

  async function handleDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    const urls =
      deleting.kind === "time"
        ? [`/api/time-entries/${deleting.id}`]
        : [`/api/updates/${deleting.id}`, ...(deleting.timeEntryIds ?? []).map((id) => `/api/time-entries/${id}`)];
    let firstError: string | null = null;
    for (const url of urls) {
      const res = await fetch(url, { method: "DELETE" });
      if (!res.ok && !firstError) firstError = (await res.json().catch(() => ({}))).error || "Couldn't delete that.";
    }
    setDeleteBusy(false);
    const target = deleting;
    setDeleting(null);
    if (firstError) {
      toast.error(firstError);
    } else {
      setRemoved((prev) => new Set(prev).add(keyOf(target)));
      toast.success("Activity deleted.");
    }
    router.refresh();
  }

  return (
    <section className="overflow-hidden rounded-md border border-togo-border bg-togo-surface">
      <div className="flex items-center gap-2 border-b border-togo-border px-4 py-3">
        <h2 className="text-sm font-bold text-togo-white">Activity &amp; history</h2>
        <span className="tnum rounded bg-togo-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-togo-muted">
          {total - removed.size}
        </span>
      </div>

      {shown.length === 0 ? (
        <p className="px-4 py-5 text-xs text-togo-muted">
          Nothing logged against this {subject} yet. Updates and tracked time both show up here.
        </p>
      ) : (
        /* Five rows tall, then it scrolls. 520px let a busy project's feed run
           far past the panels beside it; capping it keeps the sidebar a
           predictable length whatever the project's history looks like. */
        <ul className="max-h-[350px] divide-y divide-togo-border overflow-y-auto">
          {shown.map((e) => (
            <li key={keyOf(e)} className="relative">
              {/* Spans styled as blocks rather than <p>: a button may only
                  contain inline content. The delete button sits beside it, not
                  inside — a button can't hold another. */}
              <button
                type="button"
                onClick={() => setSelected(e)}
                title={e.kind === "update" ? "View the full update" : "View the time entry"}
                className={cn(
                  "flex w-full gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-[var(--togo-hover)] focus-visible:bg-[var(--togo-hover)] focus-visible:outline-none",
                  canDelete(e) && "pr-10"
                )}
              >
                <span
                  className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: e.kind === "time" ? "var(--togo-blue)" : statusHex(e.status || "") }}
                  aria-hidden
                />
                <span className="block min-w-0 flex-1">
                  <span className="block text-xs leading-snug text-togo-white">
                    <span className="font-semibold">{e.userName}</span>{" "}
                    {e.kind === "time" ? (
                      <>
                        logged{" "}
                        <span className="tnum font-semibold text-togo-blue">{formatMinutes(e.minutes || 0)}</span>
                        {e.phase ? <span className="text-togo-muted"> on {e.phase}</span> : null}
                      </>
                    ) : (
                      <>
                        <span className="text-togo-muted">
                          {STATUS_VERB[e.status || ""] || "updated"} this {subject}
                        </span>
                        {/* Time logged in the same save as this update. */}
                        {e.minutes ? (
                          <>
                            <span className="text-togo-faint"> · </span>
                            <span className="tnum font-semibold text-togo-blue">{formatMinutes(e.minutes)}</span>
                          </>
                        ) : null}
                      </>
                    )}
                  </span>
                  {e.text && (
                    <span className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-togo-muted [overflow-wrap:anywhere]">
                      {e.text}
                    </span>
                  )}
                  <span className="tnum mt-0.5 block text-[10px] text-togo-faint">{formatDateShort(e.date)}</span>
                </span>
              </button>
              {canDelete(e) && (
                <button
                  type="button"
                  onClick={() => setDeleting(e)}
                  title="Delete"
                  aria-label={`Delete this ${e.kind === "time" ? "time entry" : "update"} by ${e.userName}`}
                  className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded text-togo-faint transition-colors hover:bg-[var(--status-blocked-bg)] hover:text-[var(--status-blocked-fg)]"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {total > events.length && (
        <p className="border-t border-togo-border px-4 py-2.5 text-[10px] text-togo-faint">
          Showing the {events.length} most recent of {total} events.
        </p>
      )}

      <UpdateDetailModal
        open={selected?.kind === "update"}
        onClose={close}
        update={selected?.kind === "update" ? selected.update ?? null : null}
      />
      {selected?.kind === "time" && <TimeEntryDetail event={selected} onClose={close} />}

      <ConfirmDialog
        open={!!deleting}
        title="Delete activity"
        description={
          deleting?.kind === "time"
            ? `Delete ${deleting.userName}'s ${formatMinutes(deleting.minutes || 0)} time entry? This can't be undone.`
            : deleting?.timeEntryIds?.length
              ? `Delete ${deleting.userName}'s update and the ${formatMinutes(deleting.minutes || 0)} logged with it? This can't be undone.`
              : `Delete ${deleting?.userName ?? "this"}'s update? This can't be undone.`
        }
        confirmLabel="Delete"
        danger
        loading={deleteBusy}
        onConfirm={handleDelete}
        onCancel={() => setDeleting(null)}
      />
    </section>
  );
}

/** A logged block of time, read-only — the feed row only has room for the start of its note. */
function TimeEntryDetail({ event, onClose }: { event: ActivityEvent; onClose: () => void }) {
  const note = event.text?.trim();

  return (
    <Modal open onClose={onClose} title="Time entry" className="max-w-lg">
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <Avatar name={event.userName} avatarUrl={event.avatarUrl} size="md" className="shrink-0" />
          <p className="min-w-0 flex-1 truncate text-sm font-bold text-togo-white">{event.userName}</p>
          <span className="tnum text-lg font-bold text-togo-blue">{formatMinutes(event.minutes || 0)}</span>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-md border border-togo-border bg-togo-surface-2/40 px-3 py-2.5">
          <span className="flex items-center gap-1.5 text-xs text-togo-muted">
            <Calendar size={13} className="shrink-0 text-togo-faint" />
            {formatDate(event.date)}
          </span>
          {event.phase && (
            <span className="flex items-center gap-1.5 text-xs text-togo-white">
              <Timer size={13} className="shrink-0 text-togo-faint" />
              {event.phase}
            </span>
          )}
        </div>

        <div>
          <p className="mb-1 text-[10px] uppercase tracking-wider text-togo-faint">Note</p>
          {note ? (
            <p className="whitespace-pre-line text-sm leading-relaxed text-togo-white [overflow-wrap:anywhere]">
              <LinkifiedText text={note} />
            </p>
          ) : (
            <p className="text-sm italic text-togo-faint">Nothing recorded</p>
          )}
        </div>

        <div className="flex justify-end pt-1">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
