"use client";

import { useState } from "react";
import { Globe, MessageSquare, NotebookPen, Pencil, Plus, Server, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { BulletTextarea } from "@/components/ui/BulletTextarea";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { LinkifiedText } from "@/components/ui/LinkifiedText";
import { Select } from "@/components/ui/Input";
import { Section } from "@/components/ui/Section";
import { useToast } from "@/components/ui/Toast";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { can } from "@/lib/capabilities";
import { NOTE_CATEGORIES, noteCategoryLabel } from "@/lib/noteCategories";
import { cn, formatDateLong, timeAgo } from "@/lib/utils";
import type { NoteCategory, ProjectSideNote } from "@/types";

/** Newest first, then the rest behind "Show all". */
const COLLAPSED_COUNT = 5;

const CATEGORY_ICON: Record<NoteCategory, typeof MessageSquare> = {
  side_note: MessageSquare,
  client_portal: Globe,
  system_link: Server,
};

/** The category picker, shared by the add and edit forms. */
function CategorySelect({ value, onChange }: { value: NoteCategory; onChange: (c: NoteCategory) => void }) {
  return (
    <Select
      value={value}
      onChange={(e) => onChange(e.target.value as NoteCategory)}
      aria-label="Note category"
      className="h-8 w-auto py-1 text-xs"
    >
      {NOTE_CATEGORIES.map((c) => (
        <option key={c.value} value={c.value}>
          {c.label}
        </option>
      ))}
    </Select>
  );
}

/**
 * A project's notes — any number, each filed as a side note, the client portal,
 * or a system link (050), the same three kinds proposals use. The last two are
 * what the Projects list shows as the project's links, and like every link in
 * the hub's notes they're gathered into Resources › Links.
 *
 * Distinct from the overview, which describes what the project *is*. This is
 * the running commentary — how the client likes to be contacted, which
 * environment is fragile, what was decided on a call.
 */
export function ProjectSideNotes({
  projectName,
  initialNotes,
  ready,
  legacyNote = "",
  isProjectMember,
}: {
  projectName: string;
  initialNotes: ProjectSideNote[];
  /** False until migration 044 has been run. */
  ready: boolean;
  /** The single pre-044 note — shown read-only until the migration copies it across. */
  legacyNote?: string;
  /** On this project — assigned, or has logged an update or time against it. */
  isProjectMember: boolean;
}) {
  const toast = useToast();
  const { currentUser, loaded } = useCurrentUser();
  const [notes, setNotes] = useState<ProjectSideNote[]>(() =>
    ready || !legacyNote.trim()
      ? initialNotes
      : [{ id: "legacy", body: legacyNote.trim(), category: "side_note", author: null, createdAt: "", updatedAt: "" }]
  );
  const [adding, setAdding] = useState(false);
  const [newBody, setNewBody] = useState("");
  const [newCategory, setNewCategory] = useState<NoteCategory>("side_note");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [editCategory, setEditCategory] = useState<NoteCategory>("side_note");
  const [filter, setFilter] = useState<NoteCategory | "all">("all");
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProjectSideNote | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showAll, setShowAll] = useState(false);

  // Same rule as the overview and documents: the capability, plus either
  // "manage every project" or being on this one (migration 044 enforces it).
  const caps = currentUser?.capabilities;
  const canEdit = can(caps, "project.docs.edit") && (can(caps, "project.manage.all") || isProjectMember);

  async function addNote() {
    const body = newBody.trim();
    if (!body) return;
    setSaving(true);
    const res = await fetch("/api/project-side-notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project: projectName, body, category: newCategory }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (res.ok) {
      setNotes((prev) => [data.note, ...prev]);
      setNewBody("");
      setNewCategory("side_note");
      setAdding(false);
      toast.success("Note added.");
    } else {
      toast.error(data.error || "Couldn't add the note. Please try again.");
    }
  }

  async function saveEdit(id: string) {
    const body = editBody.trim();
    if (!body) return;
    setSaving(true);
    const res = await fetch(`/api/project-side-notes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, category: editCategory }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (res.ok) {
      setNotes((prev) => prev.map((n) => (n.id === id ? data.note : n)));
      setEditingId(null);
      toast.success("Note updated.");
    } else {
      toast.error(data.error || "Couldn't save the note. Please try again.");
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const res = await fetch(`/api/project-side-notes/${deleteTarget.id}`, { method: "DELETE" });
    setDeleting(false);
    if (res.ok) {
      setNotes((prev) => prev.filter((n) => n.id !== deleteTarget.id));
      toast.success("Note deleted.");
    } else {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error || "Couldn't delete the note.");
    }
    setDeleteTarget(null);
  }

  // Nothing written and nothing this viewer could add — stay out of the way.
  if (notes.length === 0 && (!loaded || !canEdit)) return null;

  const filtered = filter === "all" ? notes : notes.filter((n) => n.category === filter);
  const visible = showAll ? filtered : filtered.slice(0, COLLAPSED_COUNT);
  const hidden = filtered.length - visible.length;
  const newInfo = NOTE_CATEGORIES.find((c) => c.value === newCategory)!;
  const kinds = new Set(notes.map((n) => n.category));

  return (
    <Section
      title="Notes"
      icon={NotebookPen}
      count={notes.length > 0 ? notes.length : undefined}
      action={
        canEdit && !adding ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setNewBody("");
              setNewCategory("side_note");
              setAdding(true);
            }}
          >
            <Plus size={13} /> Add note
          </Button>
        ) : undefined
      }
      bodyClassName="p-4"
    >
      <div className="space-y-3">
        {adding && (
          <div className="space-y-3 rounded-md border border-togo-blue/40 bg-togo-blue/[0.04] p-3">
            <CategorySelect value={newCategory} onChange={setNewCategory} />
            <BulletTextarea rows={3} value={newBody} onChange={setNewBody} placeholder={newInfo.placeholder} />
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm" onClick={addNote} disabled={saving || !newBody.trim()}>
                {saving ? "Saving..." : "Add"}
              </Button>
              <button
                type="button"
                onClick={() => setAdding(false)}
                disabled={saving}
                className="text-xs text-togo-faint transition-colors hover:text-togo-muted disabled:opacity-50"
              >
                Cancel
              </button>
              <span className="text-[11px] text-togo-faint">
                {newInfo.needsLink ? "Shown as a link on the Projects list and in Resources." : "Links become clickable once saved."}
              </span>
            </div>
          </div>
        )}

        {/* Filter by kind — only worth showing once there's more than one. */}
        {kinds.size > 1 && (
          <div role="group" aria-label="Show notes" className="flex flex-wrap gap-1">
            {[
              { value: "all" as const, label: "All", count: notes.length },
              ...NOTE_CATEGORIES.map((c) => ({ value: c.value, label: c.plural, count: notes.filter((n) => n.category === c.value).length })),
            ]
              .filter((o) => o.value === "all" || o.count > 0)
              .map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setFilter(o.value)}
                  aria-pressed={filter === o.value}
                  className={cn(
                    "rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
                    filter === o.value ? "bg-togo-blue text-white" : "bg-togo-surface-2 text-togo-muted hover:text-togo-white"
                  )}
                >
                  {o.label} <span className="tnum opacity-75">{o.count}</span>
                </button>
              ))}
          </div>
        )}

        {notes.length === 0 && !adding && (
          <p className="text-sm italic text-togo-faint">
            No notes yet — decisions, quirks, the client portal and system links go here.
          </p>
        )}

        {visible.length > 0 && (
          <ul className="space-y-2">
            {visible.map((note) => {
              const isLegacy = note.id === "legacy";
              const editing = editingId === note.id;
              const KindIcon = CATEGORY_ICON[note.category];
              // A minute's grace: the insert and its own timestamp default can
              // differ by a few milliseconds without anyone having edited it.
              const edited =
                !!note.createdAt && new Date(note.updatedAt).getTime() - new Date(note.createdAt).getTime() > 60_000;
              return (
                <li key={note.id} className="group rounded-md border border-togo-border bg-togo-surface-2/30 p-3">
                  {editing ? (
                    <div className="space-y-3">
                      <CategorySelect value={editCategory} onChange={setEditCategory} />
                      <BulletTextarea rows={3} value={editBody} onChange={setEditBody} />
                      <div className="flex items-center gap-3">
                        <Button size="sm" onClick={() => saveEdit(note.id)} disabled={saving || !editBody.trim()}>
                          {saving ? "Saving..." : "Save"}
                        </Button>
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          disabled={saving}
                          className="text-xs text-togo-faint transition-colors hover:text-togo-muted disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <span
                        className={cn(
                          "mb-1.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                          note.category === "side_note" ? "bg-togo-surface-2 text-togo-muted" : "bg-togo-blue/10 text-togo-blue"
                        )}
                      >
                        <KindIcon size={10} /> {noteCategoryLabel(note.category)}
                      </span>
                      {/* overflow-wrap:anywhere so a long unbroken string —
                          usually a pasted URL — wraps instead of running past
                          the card. */}
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-togo-white [overflow-wrap:anywhere]">
                        <LinkifiedText text={note.body} />
                      </p>
                    </>
                  )}

                  {!editing && (
                    <div className="mt-2 flex items-center gap-2 text-[11px] text-togo-faint">
                      {note.author ? (
                        <>
                          <Avatar
                            name={note.author.name}
                            avatarUrl={note.author.avatarUrl}
                            size="sm"
                            className="!h-5 !w-5 !text-[9px]"
                          />
                          <span className="font-medium text-togo-muted">{note.author.name}</span>
                        </>
                      ) : (
                        <span>{isLegacy ? "Earlier note" : "Unknown author"}</span>
                      )}
                      {note.createdAt && (
                        <span title={formatDateLong(note.createdAt)}>
                          · {timeAgo(note.createdAt)}
                          {edited ? " · edited" : ""}
                        </span>
                      )}

                      {canEdit && !isLegacy && (
                        // Always shown on touch screens, which have no hover.
                        <div className="ml-auto flex items-center gap-0.5 transition-opacity sm:opacity-0 sm:focus-within:opacity-100 sm:group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={() => {
                              setEditBody(note.body);
                              setEditCategory(note.category);
                              setEditingId(note.id);
                            }}
                            title="Edit note"
                            aria-label="Edit note"
                            className="rounded p-1 text-togo-faint transition-colors hover:text-togo-blue"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(note)}
                            title="Delete note"
                            aria-label="Delete note"
                            className="rounded p-1 text-togo-faint transition-colors hover:text-[var(--status-blocked-fg)]"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {(hidden > 0 || (showAll && filtered.length > COLLAPSED_COUNT)) && (
          <button
            type="button"
            onClick={() => setShowAll((s) => !s)}
            className="text-xs font-medium text-togo-blue transition-colors hover:underline"
          >
            {showAll ? "Show fewer" : `Show all ${filtered.length} notes`}
          </button>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete note"
        description="Delete this note? This can't be undone."
        confirmLabel="Delete"
        danger
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </Section>
  );
}
