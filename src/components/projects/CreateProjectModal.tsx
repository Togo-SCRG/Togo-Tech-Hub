"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, FileText, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { DatePicker, formatPickedDate } from "@/components/ui/DatePicker";
import { PopoverPortal } from "@/components/ui/PopoverPortal";
import { Input, Textarea, Label } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { DocumentDropzone } from "@/components/documents/DocumentDropzone";
import { useToast } from "@/components/ui/Toast";
import { MAX_DOCUMENT_BYTES } from "@/lib/projectDocs";
import { cn, formatBytes } from "@/lib/utils";
import type { MemberItem } from "@/types";

interface Props {
  open: boolean;
  onClose: () => void;
  members: MemberItem[];
}

export function CreateProjectModal({ open, onClose, members }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [overview, setOverview] = useState("");
  const [timeline, setTimeline] = useState("");
  const [timelinePickerOpen, setTimelinePickerOpen] = useState(false);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [documents, setDocuments] = useState<File[]>([]);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleMember(id: string) {
    setMemberIds((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]));
  }

  function reset() {
    setTitle("");
    setOverview("");
    setTimeline("");
    setTimelinePickerOpen(false);
    setDocuments([]);
    setMemberIds([]);
    setError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  // Held until the project exists — a document needs a project to belong to.
  // Oversized files are turned away here rather than failing after creation.
  function addDocuments(files: File[]) {
    const tooBig = files.filter((f) => f.size > MAX_DOCUMENT_BYTES);
    if (tooBig.length > 0) {
      toast.error(`${tooBig.map((f) => `“${f.name}”`).join(", ")} ${tooBig.length === 1 ? "is" : "are"} over 20 MB.`);
    }
    setDocuments((prev) => [...prev, ...files.filter((f) => f.size <= MAX_DOCUMENT_BYTES)]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("Project title is required.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: title.trim(), overview, timeline: timeline.trim(), memberIds }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to create project.");
        setSaving(false);
        return;
      }

      const data = await res.json();

      // The project exists now, so a failed upload is reported rather than
      // undoing it — the files can be added again from the Documents tab.
      if (documents.length > 0) {
        // Loaded only when there's something to upload — see ProjectDocuments.
        const { uploadProjectDocument } = await import("@/lib/uploadDocument");
        const results = await Promise.allSettled(documents.map((file) => uploadProjectDocument(data.project, file)));
        const failed = results.filter((r) => r.status === "rejected").length;
        if (failed > 0) {
          toast.error(
            `${failed} of ${documents.length} documents couldn't be uploaded — add them from the project's Documents tab.`
          );
        }
      }

      toast.success(`"${data.project}" was created.`);
      reset();
      onClose();
      router.push(`/projects/${encodeURIComponent(data.project)}`);
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="Create Project" className="max-w-3xl">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div>
              <Label>Project Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. QuikSkope V3" autoFocus required />
            </div>

            <div>
              <Label>Overview</Label>
              <Textarea
                rows={3}
                value={overview}
                onChange={(e) => setOverview(e.target.value)}
                placeholder="What is this project, in a few sentences?"
              />
            </div>

            <div ref={timelineRef} className="relative">
              <Label htmlFor="create-project-timeline" hint="Optional">
                Timeline
              </Label>
              {/* Type anything ("End of Q3", "6 weeks") or pick a date — the
                  calendar writes a formatted date into this same field, so
                  there's one value and no mode to switch between. */}
              <div className="flex items-center gap-2">
                <Input
                  id="create-project-timeline"
                  value={timeline}
                  onChange={(e) => setTimeline(e.target.value)}
                  placeholder="e.g. End of Q3, 6 weeks, Aug 15"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setTimelinePickerOpen((o) => !o)}
                  aria-expanded={timelinePickerOpen}
                  title="Pick a date"
                  aria-label="Pick a date"
                  className="shrink-0 px-2.5"
                >
                  <CalendarDays size={16} />
                </Button>
              </div>

              {/* Portaled for the same reason as the one on the projects table:
                  the modal is `overflow-y-auto`, which clips an absolutely
                  positioned panel instead of letting it float. */}
              <PopoverPortal
                anchorRef={timelineRef}
                open={timelinePickerOpen}
                onClose={() => setTimelinePickerOpen(false)}
                width={280}
                height={400}
                align="right"
              >
                <DatePicker
                  onSelect={(date) => {
                    setTimeline(formatPickedDate(date));
                    setTimelinePickerOpen(false);
                  }}
                  onCancel={() => setTimelinePickerOpen(false)}
                />
              </PopoverPortal>
            </div>

            <div>
              <Label hint="Optional">Documents</Label>
              {documents.length > 0 && (
                <ul className="mb-2 divide-y divide-togo-border overflow-hidden rounded-md border border-togo-border">
                  {documents.map((file, i) => (
                    <li key={`${file.name}-${i}`} className="flex items-center gap-2.5 px-3 py-2">
                      <FileText size={15} className="shrink-0 text-togo-blue" />
                      <span className="min-w-0 flex-1 truncate text-sm text-togo-white" title={file.name}>
                        {file.name}
                      </span>
                      <span className="tnum shrink-0 text-xs text-togo-faint">{formatBytes(file.size)}</span>
                      <button
                        type="button"
                        onClick={() => setDocuments((prev) => prev.filter((_, j) => j !== i))}
                        disabled={saving}
                        title="Remove"
                        aria-label={`Remove ${file.name}`}
                        className="shrink-0 rounded p-0.5 text-togo-faint transition-colors hover:text-[var(--status-blocked-fg)]"
                      >
                        <X size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <DocumentDropzone onFiles={addDocuments} compact={documents.length > 0} disabled={saving} />
            </div>
          </div>

          <div>
            <Label>Who's Involved / Assigned To</Label>
            {members.length === 0 ? (
              <p className="text-xs text-togo-faint">No members to assign.</p>
            ) : (
              <div className="flex flex-wrap gap-2 max-h-80 overflow-y-auto p-1">
                {members.map((m) => {
                  const selected = memberIds.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => toggleMember(m.id)}
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
        </div>

        {error && <p className="text-sm text-[#EF4444]">{error}</p>}

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="secondary" onClick={handleClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? (documents.length > 0 ? "Creating & uploading..." : "Creating...") : "Create Project"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
