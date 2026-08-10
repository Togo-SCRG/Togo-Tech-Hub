"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Input, Label } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { BulletTextarea } from "@/components/ui/BulletTextarea";
import { useToast } from "@/components/ui/Toast";

/**
 * Create a task up front — the counterpart to CreateProjectModal.
 *
 * Deliberately much shorter than the project version, and that's the point: a
 * task has no team to assign, no timeline to set, no PRD to attach and no hour
 * cap to budget. A name and a note about what it covers is the whole of it.
 */
export function CreateTaskModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setDescription("");
    setError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Task name is required.");
      return;
    }

    setSaving(true);
    setError(null);

    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), description }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);

    if (!res.ok) {
      setError(data.error || "Couldn't create that task. Please try again.");
      return;
    }

    toast.success(`Task “${name.trim()}” created.`);
    reset();
    onClose();
    router.refresh();
  }

  return (
    <Modal open={open} onClose={handleClose} title="New task">
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-xs text-togo-muted">
          For work that isn&apos;t a project — meetings, onboarding, support, admin and one-off requests. Log time and
          updates against it the same way, but it stays out of Projects.
        </p>

        <div>
          <Label htmlFor="task-name" required>
            Task name
          </Label>
          <Input
            id="task-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Weekly team meeting"
            maxLength={120}
            autoFocus
            required
          />
        </div>

        <div>
          <Label htmlFor="task-description" hint="Press Enter for a new bullet">
            Description
          </Label>
          <BulletTextarea
            rows={3}
            value={description}
            onChange={setDescription}
            placeholder="What does this cover, and when does it apply?"
          />
        </div>

        {error && (
          <p role="alert" className="text-xs text-[var(--status-blocked-fg)]">
            {error}
          </p>
        )}

        <div className="flex items-center gap-3 border-t border-togo-border pt-3">
          <Button type="submit" size="sm" disabled={saving || !name.trim()}>
            {saving ? "Creating..." : "Create task"}
          </Button>
          <button
            type="button"
            onClick={handleClose}
            disabled={saving}
            className="text-xs text-togo-faint transition-colors hover:text-togo-muted disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
