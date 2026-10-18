"use client";

import { useState } from "react";
import {
  AlertCircle,
  Download,
  Eye,
  FileArchive,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  Loader2,
  Presentation,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { DocumentDropzone } from "@/components/documents/DocumentDropzone";
import { DocumentPreviewModal } from "@/components/documents/DocumentPreviewModal";
import { cn, formatBytes, formatDateLong } from "@/lib/utils";
import type { DocumentItem } from "@/types";

/**
 * Where a document list keeps its files. Projects and proposals store theirs in
 * different tables and buckets, behind different permissions; this is the only
 * part that differs, so the list, uploads and previews are shared.
 */
export interface DocumentsAdapter {
  /** Uploads one file and returns it as stored. Throws a message ready to show. */
  upload: (file: File) => Promise<DocumentItem>;
  /**
   * One document's API route: GET returns `{ url }` for the preview, GET with
   * `?download=1` redirects to the file, DELETE removes it.
   */
  endpoint: (id: string) => string;
}

interface PendingUpload {
  key: string;
  name: string;
  /** Set once the upload has failed; the row stays until dismissed so the reason can be read. */
  error?: string;
}

/**
 * A document list and everything that changes it. A hook rather than state
 * inside the panel, so the card around it can show the count and own an
 * Upload button in its header.
 */
export function useDocuments(adapter: DocumentsAdapter, initial: DocumentItem[]) {
  const toast = useToast();
  const [documents, setDocuments] = useState(initial);
  const [pending, setPending] = useState<PendingUpload[]>([]);

  async function upload(files: File[]) {
    const batch = files.map((file) => ({ file, key: `${Date.now()}-${Math.random().toString(36).slice(2)}` }));
    setPending((prev) => [...batch.map(({ file, key }) => ({ key, name: file.name })), ...prev]);

    // All at once: each file is its own request straight to Storage, so one
    // slow or failed file doesn't hold up or sink the rest.
    const results = await Promise.all(
      batch.map(async ({ file, key }) => {
        try {
          const doc = await adapter.upload(file);
          setDocuments((prev) => [doc, ...prev]);
          setPending((prev) => prev.filter((p) => p.key !== key));
          return true;
        } catch (e) {
          const message = e instanceof Error ? e.message : `“${file.name}” couldn't be uploaded.`;
          setPending((prev) => prev.map((p) => (p.key === key ? { ...p, error: message } : p)));
          return false;
        }
      })
    );

    const uploaded = results.filter(Boolean).length;
    if (uploaded > 0) {
      toast.success(
        uploaded === 1 && files.length === 1 ? `“${files[0].name}” uploaded.` : `${uploaded} of ${files.length} documents uploaded.`
      );
    }
    if (uploaded < files.length) {
      const failed = files.length - uploaded;
      toast.error(`${failed} ${failed === 1 ? "file" : "files"} couldn't be uploaded — see the list for why.`);
    }
  }

  async function remove(doc: DocumentItem): Promise<boolean> {
    const res = await fetch(adapter.endpoint(doc.id), { method: "DELETE" });
    if (res.ok) {
      setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
      toast.success(`“${doc.name}” removed.`);
      return true;
    }
    const data = await res.json().catch(() => ({}));
    toast.error(data.error || "Couldn't remove that document.");
    return false;
  }

  function dismiss(key: string) {
    setPending((prev) => prev.filter((p) => p.key !== key));
  }

  return {
    adapter,
    documents,
    pending,
    uploading: pending.some((p) => !p.error),
    upload,
    remove,
    dismiss,
  };
}

const ICONS: [string[], LucideIcon][] = [
  [["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "heic"], FileImage],
  [["xls", "xlsx", "csv", "ods", "numbers"], FileSpreadsheet],
  [["ppt", "pptx", "key", "odp"], Presentation],
  [["zip", "rar", "7z", "tar", "gz"], FileArchive],
  [["html", "htm", "json", "xml", "yml", "yaml", "js", "ts", "sql"], FileCode],
];

/** A file-type icon from the name's extension. Shared with the Resources file list. */
export function iconFor(fileName: string): LucideIcon {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  return ICONS.find(([exts]) => exts.includes(ext))?.[1] ?? FileText;
}

const iconButton =
  "inline-flex h-8 w-8 items-center justify-center rounded-md text-togo-muted transition-colors hover:bg-togo-surface-2 hover:text-togo-blue disabled:opacity-40";

/** The list, uploads in flight, and the drop target. */
export function DocumentsPanel({
  ready,
  notReadyMessage,
  canEdit,
  state,
}: {
  /** False until the migration behind this list has been run. */
  ready: boolean;
  notReadyMessage: string;
  canEdit: boolean;
  state: ReturnType<typeof useDocuments>;
}) {
  const { adapter, documents, pending, upload, remove, dismiss } = state;
  const [preview, setPreview] = useState<{ name: string; url: string } | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<DocumentItem | null>(null);
  const [removing, setRemoving] = useState(false);
  const toast = useToast();

  if (!ready) {
    return (
      <p className="flex items-start gap-2 rounded-md border border-togo-border bg-togo-surface-2/40 px-3 py-2.5 text-sm text-togo-muted">
        <AlertCircle size={15} className="mt-0.5 shrink-0 text-togo-faint" />
        {notReadyMessage}
      </p>
    );
  }

  // The link is signed when asked for, so it's always fresh however long the
  // page has been open.
  async function openPreview(doc: DocumentItem) {
    setOpening(doc.id);
    const res = await fetch(adapter.endpoint(doc.id));
    const data = await res.json().catch(() => ({}));
    setOpening(null);
    if (res.ok && data.url) setPreview({ name: doc.name, url: data.url });
    else toast.error(data.error || "Couldn't open that document.");
  }

  async function confirmRemove() {
    if (!removeTarget) return;
    setRemoving(true);
    await remove(removeTarget);
    setRemoving(false);
    setRemoveTarget(null);
  }

  const empty = documents.length === 0 && pending.length === 0;

  return (
    <div className="space-y-3">
      {empty && !canEdit && <p className="text-sm italic text-togo-faint">No documents attached yet.</p>}

      {!empty && (
        <ul className="divide-y divide-togo-border overflow-hidden rounded-md border border-togo-border">
          {pending.map((p) => (
            <li key={p.key} className="flex items-center gap-3 px-3 py-2.5">
              <div
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
                  p.error ? "bg-[var(--status-blocked-bg)] text-[var(--status-blocked-fg)]" : "bg-togo-surface-2 text-togo-faint"
                )}
              >
                {p.error ? <AlertCircle size={18} /> : <Loader2 size={18} className="animate-spin" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-togo-white" title={p.name}>
                  {p.name}
                </p>
                <p className={cn("text-xs", p.error ? "text-[var(--status-blocked-fg)]" : "text-togo-faint")}>
                  {p.error ?? "Uploading…"}
                </p>
              </div>
              {p.error && (
                <button type="button" onClick={() => dismiss(p.key)} title="Dismiss" aria-label="Dismiss" className={iconButton}>
                  <X size={15} />
                </button>
              )}
            </li>
          ))}

          {documents.map((doc) => {
            const Icon = iconFor(doc.name);
            const meta = [
              doc.size != null ? formatBytes(doc.size) : null,
              formatDateLong(doc.uploadedAt),
              doc.uploadedBy ? `by ${doc.uploadedBy}` : null,
            ].filter(Boolean);
            return (
              <li key={doc.id} className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-[var(--togo-hover)]">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-togo-blue-muted text-togo-blue">
                  <Icon size={18} />
                </div>
                {/* The name opens the preview — the obvious thing to click. */}
                <button
                  type="button"
                  onClick={() => openPreview(doc)}
                  disabled={opening === doc.id}
                  className="min-w-0 flex-1 text-left"
                >
                  <span
                    className="block truncate text-sm font-semibold text-togo-white transition-colors hover:text-togo-blue"
                    title={doc.name}
                  >
                    {doc.name}
                  </span>
                  <span className="block truncate text-xs text-togo-faint">{meta.join(" · ")}</span>
                </button>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => openPreview(doc)}
                    disabled={opening === doc.id}
                    title="Preview"
                    aria-label={`Preview ${doc.name}`}
                    className={iconButton}
                  >
                    {opening === doc.id ? <Loader2 size={15} className="animate-spin" /> : <Eye size={15} />}
                  </button>
                  {/* A plain link: the route redirects to a signed link that saves
                      the file under its original name. */}
                  <a
                    href={`${adapter.endpoint(doc.id)}?download=1`}
                    title="Download"
                    aria-label={`Download ${doc.name}`}
                    className={iconButton}
                  >
                    <Download size={15} />
                  </a>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => setRemoveTarget(doc)}
                      title="Remove"
                      aria-label={`Remove ${doc.name}`}
                      className={cn(iconButton, "hover:text-[var(--status-blocked-fg)]")}
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Stays usable mid-upload: each file is independent, so adding more
          while others are still going is fine. */}
      {canEdit && <DocumentDropzone onFiles={upload} compact={!empty} />}

      <ConfirmDialog
        open={!!removeTarget}
        title="Remove document"
        description={`Remove “${removeTarget?.name ?? "this document"}”? The file is deleted from storage and can't be recovered — you'd need to upload it again.`}
        confirmLabel="Remove"
        danger
        loading={removing}
        onConfirm={confirmRemove}
        onCancel={() => setRemoveTarget(null)}
      />

      {preview && (
        <DocumentPreviewModal open onClose={() => setPreview(null)} fileName={preview.name} fileUrl={preview.url} />
      )}
    </div>
  );
}
