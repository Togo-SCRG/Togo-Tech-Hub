"use client";

import { useState } from "react";
import { NotebookPen, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { BulletTextarea } from "@/components/ui/BulletTextarea";
import { Section } from "@/components/ui/Section";
import { useToast } from "@/components/ui/Toast";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { can } from "@/lib/capabilities";

/**
 * A task's description, edited in place.
 *
 * The task equivalent of a project's overview — and the only piece of writing a
 * task has, since it carries no PRD, timeline or side notes. Gated on
 * `project.create`, matching who may create a task in the first place.
 */
export function TaskDescription({
  taskName,
  initialDescription,
}: {
  taskName: string;
  initialDescription: string;
}) {
  const toast = useToast();
  const { currentUser, loaded } = useCurrentUser();
  const [description, setDescription] = useState(initialDescription);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const canEdit = can(currentUser?.capabilities, "project.create");

  async function save() {
    const value = draft.trim();
    setSaving(true);
    const res = await fetch(`/api/tasks/${encodeURIComponent(taskName)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: value }),
    });
    setSaving(false);

    if (res.ok) {
      const had = !!description;
      setDescription(value);
      setEditing(false);
      toast.success(value ? `Description ${had ? "updated" : "added"}.` : "Description cleared.");
    } else {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error || "Couldn't save the description. Please try again.");
    }
  }

  if (!description && (!loaded || !canEdit)) return null;

  return (
    <Section
      title="Description"
      icon={NotebookPen}
      action={
        canEdit && !editing ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setDraft(description);
              setEditing(true);
            }}
          >
            {description ? <Pencil size={13} /> : <Plus size={13} />}
            {description ? "Edit" : "Add description"}
          </Button>
        ) : undefined
      }
      bodyClassName="p-4"
    >
      {editing ? (
        <div className="space-y-3">
          <BulletTextarea
            rows={4}
            value={draft}
            onChange={setDraft}
            placeholder="What does this task cover, and when does it apply?"
          />
          <div className="flex items-center gap-3">
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={saving}
              className="text-xs text-togo-faint transition-colors hover:text-togo-muted disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : description ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-togo-white">{description}</p>
      ) : (
        <p className="text-sm italic text-togo-faint">
          No description yet — a line about what this covers saves everyone guessing.
        </p>
      )}
    </Section>
  );
}
