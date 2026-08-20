"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarClock, CalendarDays, Pencil } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { DatePicker, formatPickedDate } from "@/components/ui/DatePicker";
import { useToast } from "@/components/ui/Toast";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { can } from "@/lib/capabilities";
import { daysOverdue, isTimelineOverdue } from "@/lib/timeline";

/**
 * The project's target timeline, edited in place from the project header.
 *
 * Free text *and* a calendar: you can type "End of Q3" or "2 sprints", or pick
 * a concrete day. Both land in the same text value, so there's one thing to
 * store and no mode to switch between.
 *
 * There is no Save/Cancel pair — picking a date commits it, and typed text
 * commits on Enter or as soon as you click away. Escape still abandons an edit,
 * which is the only thing the discarded X button did that a click-away doesn't.
 */
export function ProjectTimelineField({
  projectName,
  initialTimeline,
  status,
  isProjectMember,
}: {
  projectName: string;
  initialTimeline: string;
  status: string;
  /** On the project — assigned, or has logged an update or time against it. */
  isProjectMember: boolean;
}) {
  const toast = useToast();
  const { currentUser } = useCurrentUser();
  const [timeline, setTimeline] = useState(initialTimeline);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialTimeline);
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);

  // Mirrors the trigger: the capability, plus the row-scoped rule that a tier
  // without "manage every project" only gets the ones they're on.
  const caps = currentUser?.capabilities;
  const canEdit =
    can(caps, "project.timeline.edit") && (can(caps, "project.manage.all") || isProjectMember);
  const overdue = isTimelineOverdue(timeline, status);
  const lateBy = overdue ? daysOverdue(timeline) : 0;

  // Close only the calendar on an outside click — clicking away from the whole
  // editor shouldn't silently discard a half-typed value.
  useEffect(() => {
    if (!pickerOpen) return;
    function onOutside(e: MouseEvent) {
      if (editorRef.current && !editorRef.current.contains(e.target as Node)) setPickerOpen(false);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [pickerOpen]);

  async function save(next = draft) {
    const value = next.trim();
    setSaving(true);
    const res = await fetch("/api/project-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project: projectName, timeline: value }),
    });
    setSaving(false);

    if (res.ok) {
      const had = !!timeline;
      setTimeline(value);
      setEditing(false);
      setPickerOpen(false);
      // Clearing the field is a distinct outcome from setting one, and the
      // result ("Not set") looks the same as a failed save without this.
      toast.success(value ? `Timeline ${had ? "updated" : "set"}.` : "Timeline cleared.");
    } else {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error || "Couldn't save the timeline. Please try again.");
    }
  }

  function cancel() {
    setDraft(timeline);
    setEditing(false);
    setPickerOpen(false);
  }

  /**
   * Clicking away commits, rather than needing a tick button.
   *
   * Focus moving *within* the editor is not a click-away — the calendar button
   * and the day grid both live inside `editorRef`, so tabbing or clicking onto
   * them must not close the editor out from under the user. An unchanged draft
   * closes silently: no request, and no "Timeline updated" toast for an edit
   * that didn't edit anything.
   */
  function commitOnBlur(e: React.FocusEvent<HTMLInputElement>) {
    // Saving already: pressing Enter disables the input, which drops focus and
    // fires this handler while the PATCH from that Enter is still in flight.
    // Without this guard that lands as a second identical save.
    if (saving) return;
    const movingTo = e.relatedTarget as Node | null;
    if (movingTo && editorRef.current?.contains(movingTo)) return;
    if (pickerOpen) return;
    if (draft.trim() === timeline.trim()) {
      setEditing(false);
      return;
    }
    save();
  }

  if (editing) {
    return (
      <div ref={editorRef} className="relative flex items-center gap-1.5">
        <CalendarClock size={13} className="shrink-0 text-togo-faint" />
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            }
            if (e.key === "Escape") cancel();
          }}
          onBlur={commitOnBlur}
          placeholder="e.g. End of Q3, or pick a date"
          autoFocus
          disabled={saving}
          className="h-7 w-56 py-1 text-xs"
        />

        <button
          type="button"
          onClick={() => setPickerOpen((o) => !o)}
          aria-expanded={pickerOpen}
          title="Pick a date"
          aria-label="Pick a date"
          className="rounded p-1 text-togo-faint transition-colors hover:text-togo-blue"
        >
          <CalendarDays size={14} />
        </button>

        {pickerOpen && (
          <div className="animate-fade-in absolute left-0 top-9 z-40">
            <DatePicker
              onSelect={(date) => {
                // Picking a day is a complete answer on its own, so it saves
                // rather than staging text behind a second click. Passed
                // straight to save() because setDraft won't have landed yet.
                const picked = formatPickedDate(date);
                setDraft(picked);
                setPickerOpen(false);
                save(picked);
              }}
              onCancel={() => setPickerOpen(false)}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <CalendarClock size={13} className="shrink-0 text-togo-faint" />
      <span className="text-[10px] uppercase tracking-wider text-togo-faint">Timeline</span>
      <span
        className={
          overdue
            ? "text-sm font-bold text-[var(--status-blocked-fg)]"
            : timeline
            ? "text-sm font-bold text-togo-white"
            : "text-sm italic text-togo-faint"
        }
      >
        {timeline || "Not set"}
      </span>
      {overdue && (
        <span className="inline-flex items-center gap-1 rounded-full border border-[var(--status-blocked-border)] bg-[var(--status-blocked-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--status-blocked-fg)]">
          Overdue by {lateBy} {lateBy === 1 ? "day" : "days"}
        </span>
      )}
      {canEdit && (
        <button
          onClick={() => {
            setDraft(timeline);
            setEditing(true);
          }}
          title="Edit timeline"
          aria-label="Edit timeline"
          className="rounded p-1 text-togo-faint transition-colors hover:text-togo-blue"
        >
          <Pencil size={12} />
        </button>
      )}
    </div>
  );
}
