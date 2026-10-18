"use client";

import { useState } from "react";
import { Calendar, Timer } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { LinkifiedText } from "@/components/ui/LinkifiedText";
import { UpdateDetailModal } from "@/components/tracker/UpdateDetailModal";
import { formatDate, formatDateShort, formatMinutes, statusHex } from "@/lib/utils";
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

  return (
    <section className="overflow-hidden rounded-md border border-togo-border bg-togo-surface">
      <div className="flex items-center gap-2 border-b border-togo-border px-4 py-3">
        <h2 className="text-sm font-bold text-togo-white">Activity &amp; history</h2>
        <span className="tnum rounded bg-togo-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-togo-muted">
          {total}
        </span>
      </div>

      {events.length === 0 ? (
        <p className="px-4 py-5 text-xs text-togo-muted">
          Nothing logged against this {subject} yet. Updates and tracked time both show up here.
        </p>
      ) : (
        /* Five rows tall, then it scrolls. 520px let a busy project's feed run
           far past the panels beside it; capping it keeps the sidebar a
           predictable length whatever the project's history looks like. */
        <ul className="max-h-[350px] divide-y divide-togo-border overflow-y-auto">
          {events.map((e) => (
            <li key={`${e.kind}-${e.id}`}>
              {/* Spans styled as blocks rather than <p>: a button may only
                  contain inline content. */}
              <button
                type="button"
                onClick={() => setSelected(e)}
                title={e.kind === "update" ? "View the full update" : "View the time entry"}
                className="flex w-full gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-[var(--togo-hover)] focus-visible:bg-[var(--togo-hover)] focus-visible:outline-none"
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
                      <span className="text-togo-muted">
                        {STATUS_VERB[e.status || ""] || "updated"} this {subject}
                      </span>
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
