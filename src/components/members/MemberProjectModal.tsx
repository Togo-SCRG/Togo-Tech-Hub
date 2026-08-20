"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Input, Select, Label } from "@/components/ui/Input";
import { Combobox } from "@/components/ui/Combobox";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { useToast } from "@/components/ui/Toast";
import { STATUS_OPTIONS, cn } from "@/lib/utils";
import type { MemberItem, MemberProjectItem } from "@/types";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  // Fixed when adding/editing from a specific profile page. Omitted when an
  // admin assigns a project from the Members list — in that case the modal
  // shows an "Assign To" picker instead.
  ownerId?: string;
  members: MemberItem[];
  editingProject: MemberProjectItem | null;
  existingProjects?: string[];
}

export function MemberProjectModal({
  open,
  onClose,
  onSaved,
  ownerId,
  members,
  editingProject,
  existingProjects = [],
}: Props) {
  const toast = useToast();
  const [selectedOwnerId, setSelectedOwnerId] = useState(ownerId || "");
  const [project, setProject] = useState("");
  const [status, setStatus] = useState("In Progress");
  const [role, setRole] = useState("");
  const [partnerIds, setPartnerIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const effectiveOwnerId = editingProject ? editingProject.userId : ownerId || selectedOwnerId;
  const showOwnerPicker = !ownerId && !editingProject;
  const potentialPartners = members.filter((m) => m.id !== effectiveOwnerId);

  useEffect(() => {
    if (editingProject) {
      setProject(editingProject.project);
      // The project's status, matching the badge on the card this modal
      // opened from.
      setStatus(editingProject.projectStatus || editingProject.status);
      setRole(editingProject.role || "");
      setPartnerIds(editingProject.partnerIds);
    } else {
      setSelectedOwnerId(ownerId || "");
      setProject("");
      setStatus("In Progress");
      setRole("");
      setPartnerIds([]);
    }
    setError(null);
  }, [editingProject, open, ownerId]);

  function togglePartner(id: string) {
    setPartnerIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (showOwnerPicker && !selectedOwnerId) {
      setError("Choose who to assign this project to.");
      return;
    }
    if (!project.trim()) {
      setError("Project is required.");
      return;
    }

    setSaving(true);
    const payload = { userId: effectiveOwnerId, project, status, role, partnerIds };

    try {
      const res = editingProject
        ? await fetch(`/api/member-projects/${editingProject.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch(`/api/member-projects`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to save project.");
        setSaving(false);
        return;
      }

      // The Status field on this form is the project's status, which lives in
      // project_settings — the same place the card's badge reads from. Written
      // after the row above so a brand new project has its member_projects entry
      // first, which is what the database's "are you on this project" check for
      // setting a status looks at.
      //
      // Not fatal if it's refused: the assignment itself saved, and the status
      // is the one part of this form somebody without rights to the project may
      // not be allowed to change.
      await fetch("/api/project-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: project.trim(), status }),
      }).catch(() => {});

      toast.success(editingProject ? "Project updated." : "Project added.");
      onSaved();
      onClose();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!editingProject) return;
    setSaving(true);
    const res = await fetch(`/api/member-projects/${editingProject.id}`, { method: "DELETE" });
    if (res.ok) {
      setDeleteConfirmOpen(false);
      toast.success("Project removed.");
      onSaved();
      onClose();
    } else {
      const data = await res.json();
      setError(data.error || "Failed to delete project.");
      setDeleteConfirmOpen(false);
    }
    setSaving(false);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editingProject ? "Edit Project" : showOwnerPicker ? "Assign Project" : "Add Project"}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {showOwnerPicker && (
          <div>
            <Label>Assign To</Label>
            <Select value={selectedOwnerId} onChange={(e) => setSelectedOwnerId(e.target.value)} required>
              <option value="" disabled>
                Select a member
              </option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Project</Label>
            <Combobox
              value={project}
              onChange={setProject}
              options={existingProjects}
              placeholder="e.g. QuikSkope V2"
              required
            />
          </div>
          <div>
            <Label>Status</Label>
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div>
          <Label>Role</Label>
          <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. Lead Developer" />
        </div>

        <div>
          <Label>Co-developers (optional)</Label>
          {potentialPartners.length === 0 ? (
            <p className="text-xs text-togo-faint">No other members to add.</p>
          ) : (
            <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto p-1">
              {potentialPartners.map((m) => {
                const selected = partnerIds.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => togglePartner(m.id)}
                    className={cn(
                      "flex items-center gap-2 pl-1.5 pr-3 py-1 rounded-full border text-sm transition-colors",
                      selected
                        ? "border-togo-blue bg-togo-blue-muted text-togo-blue"
                        : "border-togo-border text-togo-muted hover:border-togo-blue"
                    )}
                  >
                    <Avatar name={m.name} avatarUrl={m.avatarUrl} size="sm" />
                    {m.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {error && <p className="text-sm text-[#EF4444]">{error}</p>}

        <div className="flex items-center justify-between pt-2">
          <div>
            {editingProject && (
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
        title="Delete Project"
        description={`Are you sure you want to remove "${editingProject?.project}" from this profile? This can't be undone.`}
        confirmLabel="Delete"
        danger
        loading={saving}
        onConfirm={handleDelete}
        onCancel={() => setDeleteConfirmOpen(false)}
      />
    </Modal>
  );
}
