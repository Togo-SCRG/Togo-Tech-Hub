import { formatDateShort, formatMinutes, statusHex } from "@/lib/utils";

export interface ActivityEvent {
  id: string;
  kind: "update" | "time";
  userName: string;
  date: string;
  /** Sort key — falls back to `date` when the row has no timestamp. */
  at: string;
  status?: string;
  text?: string | null;
  minutes?: number;
  phase?: string | null;
}

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
            <li
              key={`${e.kind}-${e.id}`}
              className="flex gap-2.5 px-4 py-2.5 transition-colors hover:bg-[var(--togo-hover)]"
            >
              <span
                className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: e.kind === "time" ? "var(--togo-blue)" : statusHex(e.status || "") }}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs leading-snug text-togo-white">
                  <span className="font-semibold">{e.userName}</span>{" "}
                  {e.kind === "time" ? (
                    <>
                      logged <span className="tnum font-semibold text-togo-blue">{formatMinutes(e.minutes || 0)}</span>
                      {e.phase ? <span className="text-togo-muted"> on {e.phase}</span> : null}
                    </>
                  ) : (
                    <span className="text-togo-muted">
                      {STATUS_VERB[e.status || ""] || "updated"} this {subject}
                    </span>
                  )}
                </p>
                {e.text && <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-togo-muted">{e.text}</p>}
                <p className="tnum mt-0.5 text-[10px] text-togo-faint">{formatDateShort(e.date)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {total > events.length && (
        <p className="border-t border-togo-border px-4 py-2.5 text-[10px] text-togo-faint">
          Showing the {events.length} most recent of {total} events.
        </p>
      )}
    </section>
  );
}
