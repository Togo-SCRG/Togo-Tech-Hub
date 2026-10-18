"use client";

import { useRef, useState } from "react";
import { Pencil, Plus, Upload } from "lucide-react";
import { Textarea } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { LinkifiedText } from "@/components/ui/LinkifiedText";
import { DocumentsPanel, useDocuments, type DocumentsAdapter } from "@/components/documents/DocumentsPanel";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { can } from "@/lib/capabilities";
import type { ProjectDocument } from "@/types";

type Tab = "overview" | "documents";

/**
 * What a project is and the files that go with it, as two tabs: the overview,
 * and its documents — any number of uploaded files, which replaced the single
 * PRD (one file or pasted text) the second tab used to hold.
 */
export function ProjectDocs({
  projectName,
  initialOverview = "",
  legacyRequirements = "",
  initialDocuments,
  documentsReady,
  isProjectMember,
}: {
  projectName: string;
  initialOverview?: string;
  /**
   * Requirements pasted into the old PRD tab. Shown under the overview, and
   * folded into it the next time the overview is edited, so the text isn't
   * lost but doesn't need a tab of its own any more.
   */
  legacyRequirements?: string;
  initialDocuments: ProjectDocument[];
  /** False until migration 044 has been run. */
  documentsReady: boolean;
  /** On this project — assigned, or has logged an update or time against it. */
  isProjectMember: boolean;
}) {
  const { currentUser, loaded } = useCurrentUser();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("overview");
  const adapter: DocumentsAdapter = {
    // Loaded on first upload: it brings the browser Supabase client (~65 kB),
    // which the project page otherwise has no use for.
    upload: async (file) => (await import("@/lib/uploadDocument")).uploadProjectDocument(projectName, file),
    endpoint: (id) => `/api/project-documents/${id}`,
  };
  const docs = useDocuments(adapter, initialDocuments);
  const pickerRef = useRef<HTMLInputElement>(null);

  // Seeded from the server render so the text is there on first paint.
  const [overview, setOverview] = useState(initialOverview);
  const [requirements, setRequirements] = useState(legacyRequirements.trim());

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The capability, plus either "manage every project" or being on this one. A
  // tier without manage.all — a plain user — is a viewer on projects they
  // aren't part of. The database applies the same rule (036/039, 044).
  const caps = currentUser?.capabilities;
  const canEdit = can(caps, "project.docs.edit") && (can(caps, "project.manage.all") || isProjectMember);

  function startEditing() {
    setTab("overview");
    setDraft([overview.trim(), requirements ? `Requirements:\n${requirements}` : ""].filter(Boolean).join("\n\n"));
    setError(null);
    setEditing(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await fetch("/api/project-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      // Clearing the old PRD text in the same save: the draft already holds it.
      body: JSON.stringify({ project: projectName, overview: draft, ...(requirements ? { prd: null } : {}) }),
    });
    if (res.ok) {
      const had = !!overview;
      setOverview(draft);
      setRequirements("");
      setEditing(false);
      toast.success(`Overview ${had ? "updated" : "added"}.`);
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Failed to save. Please try again.");
    }
    setSaving(false);
  }

  const hasOverview = !!overview || !!requirements;
  const documentCount = docs.documents.length;

  // Nothing to show and nothing this viewer could add — stay out of the way.
  if (!hasOverview && documentCount === 0 && (!loaded || !canEdit)) return null;

  const TABS: { key: Tab; label: string }[] = [
    { key: "overview", label: "Overview & Requirements" },
    { key: "documents", label: "Documents" },
  ];

  return (
    <section className="overflow-hidden rounded-md border border-togo-border bg-togo-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-togo-border px-4">
        <div role="tablist" aria-label="Project documents" className="flex">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => {
                setTab(t.key);
                setEditing(false);
              }}
              className={cn(
                "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-3 text-sm font-semibold transition-colors",
                tab === t.key ? "border-togo-blue text-togo-white" : "border-transparent text-togo-muted hover:text-togo-white"
              )}
            >
              {t.label}
              {t.key === "overview"
                ? hasOverview && <span className="h-1.5 w-1.5 rounded-full bg-togo-blue" aria-label="has content" />
                : documentCount > 0 && (
                    <span className="tnum rounded bg-togo-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-togo-muted">
                      {documentCount}
                    </span>
                  )}
            </button>
          ))}
        </div>

        {canEdit && tab === "overview" && !editing && (
          <Button size="sm" variant="secondary" className="ml-auto my-2" onClick={startEditing}>
            {hasOverview ? <Pencil size={13} /> : <Plus size={13} />}
            {hasOverview ? "Edit overview" : "Add overview"}
          </Button>
        )}
        {canEdit && tab === "documents" && documentsReady && (
          <>
            <Button size="sm" variant="secondary" className="ml-auto my-2" onClick={() => pickerRef.current?.click()}>
              <Upload size={13} />
              {docs.uploading ? "Uploading…" : "Upload"}
            </Button>
            <input
              ref={pickerRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                e.target.value = "";
                if (files.length > 0) docs.upload(files);
              }}
            />
          </>
        )}
      </div>

      <div className="p-4">
        {tab === "documents" ? (
          <DocumentsPanel
            ready={documentsReady}
            notReadyMessage="Documents need a one-time database update before they can be used — run migration 044 in Supabase."
            canEdit={canEdit}
            state={docs}
          />
        ) : editing ? (
          <form onSubmit={handleSave} className="space-y-3">
            <Textarea
              rows={requirements ? 8 : 4}
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="What is this project, and what does it need to do?"
            />
            <div className="flex items-center gap-3">
              <Button type="submit" size="sm" disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </Button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setError(null);
                }}
                className="text-xs text-togo-faint transition-colors hover:text-togo-muted"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : hasOverview ? (
          <div className="space-y-4">
            {overview && (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-togo-white [overflow-wrap:anywhere]">
                <LinkifiedText text={overview} />
              </p>
            )}
            {requirements && (
              <div>
                <p className="mb-1 text-[10px] uppercase tracking-wider text-togo-faint">Requirements</p>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-togo-muted [overflow-wrap:anywhere]">
                  <LinkifiedText text={requirements} />
                </p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm italic text-togo-faint">
            {canEdit
              ? "No overview yet — a couple of sentences here saves everyone asking what this project is."
              : "No overview added yet."}
          </p>
        )}

        {error && (
          <p role="alert" className="mt-3 text-xs text-[var(--status-blocked-fg)]">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
