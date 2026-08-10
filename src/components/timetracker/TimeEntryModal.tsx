"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DateField } from "@/components/ui/DateField";
import { Input, Select, Label } from "@/components/ui/Input";
import { BulletTextarea } from "@/components/ui/BulletTextarea";
import { WorkTypeToggle } from "@/components/ui/WorkTypeToggle";
import { normaliseWorkType, type WorkType } from "@/lib/workType";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { toDateInputValue } from "@/lib/utils";
import { can } from "@/lib/capabilities";
import type { CurrentUser, MemberItem, TimeEntryItem } from "@/types";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  currentUser: CurrentUser;
  members: MemberItem[];
  editingEntry: TimeEntryItem | null;
  defaultDate: string;
  defaultProject?: string;
  lockProject?: string;
  /**
   * Fixes the entry to a project or a task and hides the toggle. Used by the
   * "New task" button, where the choice was already made by which button was
   * pressed.
   */
  lockWorkType?: WorkType;
}

export function TimeEntryModal({
  open,
  onClose,
  onSaved,
  currentUser,
  members,
  editingEntry,
  defaultDate,
  defaultProject,
  lockProject,
  lockWorkType,
}: Props) {
  const toast = useToast();
  const [userId, setUserId] = useState(currentUser.id);
  const [project, setProject] = useState("");
  const [phase, setPhase] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [hours, setHours] = useState("0");
  const [minutes, setMinutes] = useState("0");
  const [note, setNote] = useState("");
  const [workType, setWorkType] = useState<WorkType>("project");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  useEffect(() => {
    if (editingEntry) {
      setUserId(editingEntry.userId);
      setProject(editingEntry.project);
      setPhase(editingEntry.phase || "");
      setDate(toDateInputValue(editingEntry.date));
      setHours(String(Math.floor(editingEntry.durationMinutes / 60)));
      setMinutes(String(editingEntry.durationMinutes % 60));
      setNote(editingEntry.note || "");
      setWorkType(normaliseWorkType(editingEntry.workType));
    } else {
      setUserId(currentUser.id);
      setProject(lockProject || defaultProject || "");
      setPhase("");
      setDate(defaultDate);
      setHours("0");
      setMinutes("0");
      setNote("");
      // A form opened from a project page is project work by definition; one
      // opened by "New task" is a task.
      setWorkType(lockWorkType ?? "project");
    }
    setError(null);
  }, [editingEntry, open, currentUser.id, defaultDate, defaultProject, lockProject, lockWorkType]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const durationMinutes = Number(hours) * 60 + Number(minutes);
    if (!project.trim()) {
      setError(`${workType === "task" ? "Task" : "Project"} is required.`);
      return;
    }
    if (!durationMinutes || durationMinutes <= 0) {
      setError("Duration must be greater than zero.");
      return;
    }

    setSaving(true);
    const payload = { userId, project, workType, phase, date, durationMinutes, note };

    try {
      const res = editingEntry
        ? await fetch(`/api/time-entries/${editingEntry.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch(`/api/time-entries`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to save time entry.");
        setSaving(false);
        return;
      }

      toast.success(editingEntry ? "Time entry saved." : "Time entry logged.");
      onSaved();
      onClose();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!editingEntry) return;
    setSaving(true);
    const res = await fetch(`/api/time-entries/${editingEntry.id}`, { method: "DELETE" });
    if (res.ok) {
      setDeleteConfirmOpen(false);
      toast.success("Time entry deleted.");
      onSaved();
      onClose();
    } else {
      const data = await res.json();
      setError(data.error || "Failed to delete time entry.");
      setDeleteConfirmOpen(false);
    }
    setSaving(false);
  }

  // Matches migration 034: logging time for someone else needs the same
  // permission as logging their updates, not merely being an admin.
  const canPickMember = can(currentUser.capabilities, "work.update.others") && !editingEntry;

  return (
    <Modal open={open} onClose={onClose} title={editingEntry ? "Edit Time Entry" : "Log Time Entry"}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {canPickMember && (
          <div>
            <Label>Member</Label>
            <Select value={userId} onChange={(e) => setUserId(e.target.value)}>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </div>
        )}

        {/* Hidden when the form is opened from a project page, or by a button
            that already said which kind this is — offering the choice again
            would be a control that can't change anything. */}
        {!lockProject && !lockWorkType && (
          <div>
            <Label>Logged against</Label>
            <WorkTypeToggle value={workType} onChange={setWorkType} />
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>{workType === "task" ? "Task" : "Project"}</Label>
            <Input
              value={project}
              onChange={(e) => setProject(e.target.value)}
              placeholder={workType === "task" ? "e.g. Meetings" : "e.g. QuikSkope V2"}
              disabled={!!lockProject}
              required
            />
          </div>
          <div>
            <Label>Phase (optional)</Label>
            <Input value={phase} onChange={(e) => setPhase(e.target.value)} placeholder="e.g. Bug fix" />
          </div>
        </div>

        <div>
          {/* Same control as the Update field on the log-update form: a session
              is usually several things done, not one sentence. Draggable to
              expand, since an imported day's work can run long. */}
          <Label hint="Press Enter for a new bullet">What Was Done</Label>
          <BulletTextarea
            rows={3}
            value={note}
            onChange={setNote}
            placeholder="Describe the work done during this time"
          />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <Label>Date</Label>
            <DateField value={date} onChange={setDate} required />
          </div>
          <div>
            <Label>Hours</Label>
            <Input type="number" min={0} value={hours} onChange={(e) => setHours(e.target.value)} />
          </div>
          <div>
            <Label>Minutes</Label>
            <Input type="number" min={0} max={59} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          </div>
        </div>

        {error && <p className="text-sm text-[#EF4444]">{error}</p>}

        <div className="flex items-center justify-between pt-2">
          <div>
            {editingEntry && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setDeleteConfirmOpen(true)}
                disabled={saving}
                className="border-[#EF4444] text-[#EF4444] hover:bg-[#EF4444]/10"
              >
                Delete
              </Button>
            )}
          </div>
          <div className="flex gap-3">
            <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </form>

      <ConfirmDialog
        open={deleteConfirmOpen}
        title="Delete Time Entry"
        description={`Are you sure you want to delete this${
          editingEntry ? ` "${editingEntry.project}"` : ""
        } time entry? This can't be undone.`}
        confirmLabel="Delete"
        danger
        loading={saving}
        onConfirm={handleDelete}
        onCancel={() => setDeleteConfirmOpen(false)}
      />
    </Modal>
  );
}
