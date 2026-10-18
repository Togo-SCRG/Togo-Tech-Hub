"use client";

import { useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Download,
  ExternalLink,
  Eye,
  FileText,
  FolderKanban,
  Globe,
  Handshake,
  Layers,
  Library,
  Link2,
  Loader2,
  MessageSquare,
  Pencil,
  Pin,
  Plus,
  SearchX,
  Server,
  Trash2,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";
import { LINK_CATEGORY_ICON } from "@/components/resources/linkIcons";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { FilterPills } from "@/components/ui/FilterPills";
import { IntentLink } from "@/components/ui/IntentLink";
import { Pagination } from "@/components/ui/Pagination";
import { SearchInput } from "@/components/ui/SearchInput";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import { useToast } from "@/components/ui/Toast";
import { DocumentDropzone } from "@/components/documents/DocumentDropzone";
import { DocumentPreviewModal } from "@/components/documents/DocumentPreviewModal";
import { iconFor } from "@/components/documents/DocumentsPanel";
import { LinkFormModal } from "@/components/resources/LinkFormModal";
import { LINK_CATEGORIES, displayUrl, linkCategoryLabel, sourcedLinkKindLabel } from "@/lib/resources";
import { cn, formatBytes, formatDateLong } from "@/lib/utils";
import { usePagination } from "@/lib/usePagination";
import type { HubFile, ResourceLink, SourcedLink } from "@/types";

export type ResourcesTab = "files" | "links";

/** What the viewer may do — mirrors the database's rules, which still decide. */
export interface ResourcesViewer {
  id: string;
  isAdmin: boolean;
  /** Holds project.docs.edit; the database also wants them on the project (or manage-all). */
  canEditProjectDocs: boolean;
  canManageProposals: boolean;
}

const SOURCE_LABEL: Record<HubFile["source"], string> = {
  library: "Library",
  project: "Project",
  proposal: "Proposal",
};

const SOURCE_ICON: Record<HubFile["source"], LucideIcon> = {
  library: Library,
  project: FolderKanban,
  proposal: Handshake,
};

const KIND_ICON: Record<SourcedLink["kind"], LucideIcon> = {
  client_portal: Globe,
  system_link: Server,
  side_note: MessageSquare,
  overview: FileText,
};

const iconButton =
  "inline-flex h-8 w-8 items-center justify-center rounded-md text-togo-muted transition-colors hover:bg-togo-surface-2 hover:text-togo-blue disabled:opacity-40";
const deleteButton = cn(iconButton, "hover:text-[var(--status-blocked-fg)]");

const fileKey = (f: HubFile) => `${f.source}:${f.id}`;
const sourcedKey = (s: SourcedLink) => `src:${s.source}|${s.sourceKey}|${s.kind}|${s.href}`;
const libraryKey = (l: ResourceLink) => `lib:${l.id}`;

/** The strip that appears while anything is ticked: what's selected, and what can be done to it all. */
function BulkBar({ count, onClear, children }: { count: number; onClear: () => void; children: React.ReactNode }) {
  if (count === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-togo-blue/30 bg-togo-blue/[0.06] px-4 py-2.5">
      <span className="tnum text-xs font-semibold text-togo-blue">{count} selected</span>
      {children}
      <button
        type="button"
        onClick={onClear}
        className="ml-auto flex items-center gap-1 text-xs font-medium text-togo-muted transition-colors hover:text-togo-blue"
      >
        <X size={14} /> Clear selection
      </button>
    </div>
  );
}

/**
 * Resources: everything the team keeps, in one place — every file in the hub
 * (the library's own, and every project's and proposal's), and a labelled
 * directory of links, gathered from the library and from every project's and
 * proposal's notes. Togo's official website sits above both.
 */
export function ResourcesView({
  initialTab,
  initialLinks,
  sourcedLinks: initialSourced,
  initialFiles,
  ready,
  me,
}: {
  initialTab: ResourcesTab;
  initialLinks: ResourceLink[];
  /** Every link in project and proposal notes, overviews and summaries — proposals only with access. */
  sourcedLinks: SourcedLink[];
  initialFiles: HubFile[];
  /** False until migration 049 has been run. */
  ready: boolean;
  me: ResourcesViewer;
}) {
  const [tab, setTab] = useState<ResourcesTab>(initialTab);
  const [links, setLinks] = useState(initialLinks);
  const [sourced, setSourced] = useState(initialSourced);
  const [files, setFiles] = useState(initialFiles);
  // Lifted here so the official website's Edit, above the tabs, opens the same form.
  const [form, setForm] = useState<{ editing?: ResourceLink; official?: boolean } | null>(null);

  if (!ready) {
    return (
      <EmptyState
        icon={Library}
        title="Resources need a one-time database update"
        description="Run migration 049 (supabase/migrations/049_resources.sql) in the Supabase SQL Editor, then reload this page."
      />
    );
  }

  const official = links.find((l) => l.isOfficial) ?? null;

  function saved(link: ResourceLink) {
    setLinks((prev) => {
      // Becoming the official website takes the title from whichever had it.
      const rest = prev.filter((l) => l.id !== link.id).map((l) => (link.isOfficial ? { ...l, isOfficial: false } : l));
      return [link, ...rest].sort((a, b) => a.label.localeCompare(b.label));
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-togo-white">Resources</h2>
        <SegmentedTabs
          label="Resources"
          value={tab}
          onChange={(v) => setTab(v as ResourcesTab)}
          tabs={[
            { label: "Files", value: "files", count: files.length },
            { label: "Links", value: "links", count: links.filter((l) => !l.isOfficial).length + sourced.length },
          ]}
        />
      </div>

      {/* The official website, above both tabs, so it's there whichever one is open. */}
      {official ? (
        <div className="flex flex-wrap items-center gap-4 rounded-md border border-togo-blue/40 bg-togo-blue/[0.06] p-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-togo-blue text-white">
            <Globe size={22} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-togo-blue">Official website</p>
            <a
              href={official.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block truncate text-base font-bold text-togo-white hover:text-togo-blue"
            >
              {official.label}
            </a>
            <p className="truncate text-xs text-togo-muted">{displayUrl(official.url)}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <a href={official.url} target="_blank" rel="noopener noreferrer">
              <Button size="sm">
                <ExternalLink size={14} /> Visit
              </Button>
            </a>
            {me.isAdmin && (
              <button type="button" onClick={() => setForm({ editing: official })} title="Edit" aria-label="Edit the official website" className={iconButton}>
                <Pencil size={15} />
              </button>
            )}
          </div>
        </div>
      ) : (
        me.isAdmin && (
          <button
            type="button"
            onClick={() => setForm({ official: true })}
            className="flex w-full items-center gap-3 rounded-md border border-dashed border-togo-border p-4 text-left transition-colors hover:border-togo-blue"
          >
            <Globe size={20} className="shrink-0 text-togo-faint" />
            <span>
              <span className="block text-sm font-semibold text-togo-white">Add Togo&apos;s official website</span>
              <span className="block text-xs text-togo-faint">It&apos;s featured here and at the top of everyone&apos;s dashboard.</span>
            </span>
          </button>
        )
      )}

      {tab === "files" ? (
        <FilesTab files={files} setFiles={setFiles} me={me} />
      ) : (
        <LinksTab
          links={links}
          setLinks={setLinks}
          sourced={sourced}
          setSourced={setSourced}
          me={me}
          onAdd={() => setForm({})}
          onEdit={(l) => setForm({ editing: l })}
        />
      )}

      {form && (
        <LinkFormModal
          open
          onClose={() => setForm(null)}
          editing={form.editing}
          presetOfficial={form.official}
          canSetOfficial={me.isAdmin}
          onSaved={saved}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

type LinkItem = { kind: "library"; link: ResourceLink } | { kind: "sourced"; link: SourcedLink };

function LinksTab({
  links,
  setLinks,
  sourced,
  setSourced,
  me,
  onAdd,
  onEdit,
}: {
  links: ResourceLink[];
  setLinks: React.Dispatch<React.SetStateAction<ResourceLink[]>>;
  sourced: SourcedLink[];
  setSourced: React.Dispatch<React.SetStateAction<SourcedLink[]>>;
  me: ResourcesViewer;
  onAdd: () => void;
  onEdit: (link: ResourceLink) => void;
}) {
  const toast = useToast();
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<LinkItem[] | null>(null);
  const [busy, setBusy] = useState(false);

  const canDeleteLibrary = (l: ResourceLink) => me.isAdmin || l.createdBy?.id === me.id;
  const canRemoveSourced = (s: SourcedLink) => (s.source === "project" ? me.canEditProjectDocs : me.canManageProposals);

  const q = search.trim().toLowerCase();
  const matches = (text: string) => !q || text.toLowerCase().includes(q);
  // The official website lives above the tabs, not in the list.
  const others = links.filter(
    (l) => !l.isOfficial && matches(`${l.label} ${l.url} ${l.description ?? ""} ${linkCategoryLabel(l.category)}`)
  );
  const gathered = sourced.filter((s) => matches(`${s.sourceName} ${sourcedLinkKindLabel(s)} ${s.href}`));
  const fromProjects = gathered.filter((s) => s.source === "project");
  const fromProposals = gathered.filter((s) => s.source === "proposal");

  const counts: Record<string, number> = {
    all: others.length + gathered.length,
    projects: fromProjects.length,
    proposals: fromProposals.length,
  };
  for (const c of LINK_CATEGORIES) counts[c.value] = others.filter((l) => l.category === c.value).length;

  const pills = [
    { label: "All", value: "all" },
    ...LINK_CATEGORIES.filter((c) => counts[c.value] > 0 || filter === c.value).map((c) => ({ label: c.label, value: c.value })),
    ...(sourced.some((s) => s.source === "project") ? [{ label: "From projects", value: "projects" }] : []),
    ...(sourced.some((s) => s.source === "proposal") ? [{ label: "From proposals", value: "proposals" }] : []),
  ];

  const fromSources = filter === "projects" || filter === "proposals";
  const shownLinks = filter === "all" ? others : fromSources ? [] : others.filter((l) => l.category === filter);
  const shownProjectLinks = filter === "all" || filter === "projects" ? fromProjects : [];
  const shownProposalLinks = filter === "all" || filter === "proposals" ? fromProposals : [];
  // Nine cards a page: three full rows of the grid at its widest.
  const libraryPages = usePagination(shownLinks, 9);

  // Everything on screen that this viewer could delete — what "Select all" means.
  const selectable: LinkItem[] = [
    ...shownLinks.filter(canDeleteLibrary).map((link) => ({ kind: "library" as const, link })),
    ...[...shownProjectLinks, ...shownProposalLinks].filter(canRemoveSourced).map((link) => ({ kind: "sourced" as const, link })),
  ];
  const keyOf = (item: LinkItem) => (item.kind === "library" ? libraryKey(item.link) : sourcedKey(item.link));
  const allSelected = selectable.length > 0 && selectable.every((i) => selected.has(keyOf(i)));
  const someSelected = selectable.some((i) => selected.has(keyOf(i)));
  const selectedItems = selectable.filter((i) => selected.has(keyOf(i)));

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(selectable.map(keyOf)));
  }

  async function removeItems(items: LinkItem[]) {
    setBusy(true);
    let removed = 0;
    let firstError: string | null = null;
    for (const item of items) {
      const res =
        item.kind === "library"
          ? await fetch(`/api/resource-links/${item.link.id}`, { method: "DELETE" })
          : await fetch("/api/resources/remove-link", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                source: item.link.source,
                sourceKey: item.link.sourceKey,
                kind: item.link.kind,
                href: item.link.href,
              }),
            });
      if (res.ok) {
        removed++;
        if (item.kind === "library") setLinks((prev) => prev.filter((l) => l.id !== item.link.id));
        else setSourced((prev) => prev.filter((s) => sourcedKey(s) !== sourcedKey(item.link)));
      } else if (!firstError) {
        const data = await res.json().catch(() => ({}));
        firstError = data.error || "Couldn't remove that link.";
      }
    }
    setBusy(false);
    setConfirm(null);
    setSelected(new Set());
    if (removed > 0) toast.success(removed === 1 ? "Link removed." : `${removed} links removed.`);
    if (firstError) toast.error(`${items.length - removed} couldn't be removed — ${firstError}`);
  }

  const nothing = shownLinks.length === 0 && shownProjectLinks.length === 0 && shownProposalLinks.length === 0;
  const noLinksAtAll = links.filter((l) => !l.isOfficial).length === 0 && sourced.length === 0;
  const confirmHasSourced = confirm?.some((i) => i.kind === "sourced");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <FilterPills pills={pills} value={filter} onChange={setFilter} counts={counts} label="Filter links" />
        <div className="ml-auto flex items-center gap-2">
          <SearchInput value={search} onChange={setSearch} placeholder="Search links..." />
          <Button size="sm" onClick={onAdd}>
            <Plus size={14} /> Add link
          </Button>
        </div>
      </div>

      {selectable.length > 0 && (
        <div className="flex items-center gap-2 px-1">
          <Checkbox checked={allSelected} indeterminate={someSelected} onChange={toggleAll} label="Select all links shown" />
          <span className="text-xs text-togo-muted">Select all</span>
        </div>
      )}

      <BulkBar count={selectedItems.length} onClear={() => setSelected(new Set())}>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => setConfirm(selectedItems)}
          className="border-[var(--status-blocked-fg)] text-[var(--status-blocked-fg)] hover:bg-[var(--status-blocked-bg)]"
        >
          <Trash2 size={14} /> Delete
        </Button>
      </BulkBar>

      {nothing ? (
        <EmptyState
          icon={noLinksAtAll ? Link2 : SearchX}
          title={noLinksAtAll ? "No links yet" : "No links match"}
          description={
            noLinksAtAll
              ? "Keep the team's tools, systems and docs here, each with a label — and every link written in a project's or proposal's notes shows up here too."
              : "Try a different search or category."
          }
        />
      ) : (
        <>
          {shownLinks.length > 0 && (
            <div className="space-y-2">
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {libraryPages.paged.map((l) => {
                  const Icon = LINK_CATEGORY_ICON[l.category];
                  const mine = canDeleteLibrary(l);
                  const key = libraryKey(l);
                  return (
                    <li
                      key={l.id}
                      className={cn(
                        "relative flex flex-col rounded-md border bg-togo-surface p-4 transition-colors hover:border-togo-blue",
                        selected.has(key) ? "border-togo-blue" : "border-togo-border"
                      )}
                    >
                      <div className="flex items-start gap-3">
                        {mine && (
                          <Checkbox checked={selected.has(key)} onChange={() => toggle(key)} label={`Select ${l.label}`} className="mt-2.5" />
                        )}
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-togo-blue-muted text-togo-blue">
                          <Icon size={17} />
                        </div>
                        <div className={cn("min-w-0 flex-1", mine && "pr-16")}>
                          <a
                            href={l.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={l.url}
                            className="block truncate text-sm font-bold text-togo-white hover:text-togo-blue"
                          >
                            {l.label}
                          </a>
                          <a
                            href={l.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={l.url}
                            className="block truncate text-xs text-togo-blue hover:underline"
                          >
                            {displayUrl(l.url)}
                          </a>
                        </div>
                      </div>
                      {l.description && <p className="mt-2 line-clamp-2 text-xs leading-snug text-togo-muted">{l.description}</p>}
                      <div className="mt-auto flex items-center gap-2 pt-3 text-[11px] text-togo-faint">
                        <span className="rounded bg-togo-surface-2 px-1.5 py-0.5 font-medium text-togo-muted">
                          {linkCategoryLabel(l.category)}
                        </span>
                        {l.pinned && (
                          <span className="inline-flex items-center gap-0.5" title="Pinned to the dashboard">
                            <Pin size={11} /> Pinned
                          </span>
                        )}
                        {l.createdBy && <span className="ml-auto truncate">by {l.createdBy.name}</span>}
                      </div>
                      {mine && (
                        <div className="absolute right-2 top-2 flex items-center gap-0.5">
                          <button type="button" onClick={() => onEdit(l)} title="Edit" aria-label={`Edit ${l.label}`} className={iconButton}>
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirm([{ kind: "library", link: l }])}
                            title="Delete"
                            aria-label={`Delete ${l.label}`}
                            className={deleteButton}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              {/* No page-size picker: its sizes (10, 15…) would leave a ragged
                  last row in a three-column grid. */}
              <Pagination
                page={libraryPages.page}
                totalPages={libraryPages.totalPages}
                totalItems={libraryPages.totalItems}
                pageSize={libraryPages.pageSize}
                onPageChange={libraryPages.setPage}
                className="px-1"
              />
            </div>
          )}

          <SourcedLinksSection
            title="From projects"
            hint="Links written in project notes and overviews"
            icon={FolderKanban}
            links={shownProjectLinks}
            openLabel="Open project"
            canRemove={canRemoveSourced}
            selected={selected}
            onToggle={toggle}
            onRemove={(s) => setConfirm([{ kind: "sourced", link: s }])}
          />
          <SourcedLinksSection
            title="From proposals"
            hint="Links written in proposal notes and summaries"
            icon={Handshake}
            links={shownProposalLinks}
            openLabel="Open proposal"
            canRemove={canRemoveSourced}
            selected={selected}
            onToggle={toggle}
            onRemove={(s) => setConfirm([{ kind: "sourced", link: s }])}
          />
        </>
      )}

      <ConfirmDialog
        open={!!confirm}
        title={confirm && confirm.length > 1 ? `Delete ${confirm.length} links` : "Delete link"}
        description={
          confirmHasSourced
            ? "Links from a project or proposal are taken out of the note, overview or summary they were written in — a note that held nothing but the link is deleted. This can't be undone."
            : "Remove from Resources? The site itself isn't affected."
        }
        confirmLabel="Delete"
        danger
        loading={busy}
        onConfirm={() => confirm && removeItems(confirm)}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

/**
 * Links gathered from projects or proposals, each labelled with where it was
 * written — "Sparks Snow — Client portal" — and a way back to it. Deleting one
 * takes it out of that note, overview or summary.
 */
function SourcedLinksSection({
  title,
  hint,
  icon: SectionIcon,
  links,
  openLabel,
  canRemove,
  selected,
  onToggle,
  onRemove,
}: {
  title: string;
  hint: string;
  icon: LucideIcon;
  links: SourcedLink[];
  openLabel: string;
  canRemove: (s: SourcedLink) => boolean;
  selected: Set<string>;
  onToggle: (key: string) => void;
  onRemove: (s: SourcedLink) => void;
}) {
  const { page, setPage, pageSize, setPageSize, totalPages, totalItems, paged } = usePagination(links);
  if (links.length === 0) return null;
  return (
    <section className="overflow-hidden rounded-md border border-togo-border bg-togo-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-togo-border px-4 py-3">
        <SectionIcon size={14} className="text-togo-blue" />
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-togo-blue">{title}</h3>
        <span className="tnum rounded bg-togo-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-togo-muted">{links.length}</span>
        <span className="text-xs text-togo-faint">{hint}</span>
      </div>
      <ul className="divide-y divide-togo-border">
        {paged.map((l) => {
          const Icon = KIND_ICON[l.kind];
          const label = `${l.sourceName} — ${sourcedLinkKindLabel(l)}`;
          const key = sourcedKey(l);
          const removable = canRemove(l);
          return (
            <li key={key} className={cn("flex items-center gap-3 px-4 py-2.5", selected.has(key) && "bg-togo-blue/[0.04]")}>
              {removable ? (
                <Checkbox checked={selected.has(key)} onChange={() => onToggle(key)} label={`Select ${label}`} />
              ) : (
                <span className="inline-block w-4" aria-hidden />
              )}
              <Icon size={15} className="shrink-0 text-togo-faint" aria-hidden />
              {/* The link leads — it's what you came for — and where it was
                  written sits under it. */}
              <div className="min-w-0 flex-1">
                <a
                  href={l.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`${label}: ${l.href}`}
                  className="block truncate text-sm font-semibold text-togo-white hover:text-togo-blue"
                >
                  {displayUrl(l.href)}
                </a>
                <span className="block truncate text-[11px] text-togo-faint">{label}</span>
              </div>
              <IntentLink href={l.sourceHref} className="shrink-0 text-[11px] text-togo-faint hover:text-togo-blue">
                {openLabel}
              </IntentLink>
              {removable && (
                <button type="button" onClick={() => onRemove(l)} title="Delete" aria-label={`Delete ${label}`} className={deleteButton}>
                  <Trash2 size={14} />
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <Pagination
        page={page}
        totalPages={totalPages}
        totalItems={totalItems}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        className="border-t border-togo-border px-4 py-3"
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

interface PendingUpload {
  key: string;
  name: string;
  error?: string;
}

/**
 * Starts a download without leaving the page or opening tabs: a hidden frame
 * loads the file's ?download=1 link, which answers with the file itself.
 * Staggered by the caller — browsers drop downloads that start in a burst.
 */
function downloadInBackground(url: string) {
  const frame = document.createElement("iframe");
  frame.style.display = "none";
  frame.src = url;
  document.body.appendChild(frame);
  window.setTimeout(() => frame.remove(), 60_000);
}

function FilesTab({
  files,
  setFiles,
  me,
}: {
  files: HubFile[];
  setFiles: React.Dispatch<React.SetStateAction<HubFile[]>>;
  me: ResourcesViewer;
}) {
  const toast = useToast();
  const [source, setSource] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const [preview, setPreview] = useState<{ name: string; url: string } | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<HubFile[] | null>(null);
  const [busy, setBusy] = useState(false);
  const pickerRef = useRef<HTMLInputElement>(null);

  // Each file is removable where it lives: a library file by whoever uploaded
  // it (or an admin), a project's or a proposal's by those who manage it.
  const canDelete = (f: HubFile) =>
    f.source === "library"
      ? me.isAdmin || f.uploadedById === me.id
      : f.source === "project"
        ? me.canEditProjectDocs
        : me.canManageProposals;

  const q = search.trim().toLowerCase();
  const searched = useMemo(
    () => files.filter((f) => !q || `${f.name} ${f.sourceName ?? ""} ${f.uploadedBy ?? ""}`.toLowerCase().includes(q)),
    [files, q]
  );
  const counts: Record<string, number> = {
    all: searched.length,
    project: searched.filter((f) => f.source === "project").length,
    proposal: searched.filter((f) => f.source === "proposal").length,
  };
  // Library files show under All; they don't get a filter of their own.
  const pills = [
    { label: "All", value: "all" },
    { label: "Projects", value: "project" },
    ...(files.some((f) => f.source === "proposal") ? [{ label: "Proposals", value: "proposal" }] : []),
  ];
  const shown = source === "all" ? searched : searched.filter((f) => f.source === source);
  const { page, setPage, pageSize, setPageSize, totalPages, totalItems, paged } = usePagination(shown);

  // The header box selects the page on screen; the bulk bar then offers the
  // rest of what the filter and search match. Picks on other pages stay picked.
  const allSelected = paged.length > 0 && paged.every((f) => selected.has(fileKey(f)));
  const someSelected = paged.some((f) => selected.has(fileKey(f)));
  const selectedFiles = shown.filter((f) => selected.has(fileKey(f)));
  const everythingSelected = selectedFiles.length === shown.length;
  const deletable = selectedFiles.filter(canDelete);

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const f of paged) {
        if (allSelected) next.delete(fileKey(f));
        else next.add(fileKey(f));
      }
      return next;
    });
  }

  function downloadSelected() {
    selectedFiles.forEach((f, i) => window.setTimeout(() => downloadInBackground(`${f.endpoint}?download=1`), i * 400));
    toast.success(
      selectedFiles.length === 1
        ? `Downloading “${selectedFiles[0].name}”.`
        : `Downloading ${selectedFiles.length} files — your browser may ask to allow multiple downloads.`
    );
  }

  async function upload(picked: File[]) {
    const batch = picked.map((file) => ({ file, key: `${Date.now()}-${Math.random().toString(36).slice(2)}` }));
    setPending((prev) => [...batch.map(({ file, key }) => ({ key, name: file.name })), ...prev]);

    let uploadLibraryFile: typeof import("@/lib/uploadDocument").uploadLibraryFile;
    try {
      // Loaded on first upload: it brings the browser Supabase client along.
      ({ uploadLibraryFile } = await import("@/lib/uploadDocument"));
    } catch {
      const keys = new Set(batch.map((b) => b.key));
      setPending((prev) => prev.map((p) => (keys.has(p.key) ? { ...p, error: "Couldn't start the upload — check your connection." } : p)));
      return;
    }

    const results = await Promise.all(
      batch.map(async ({ file, key }) => {
        try {
          const doc = await uploadLibraryFile(file);
          setFiles((prev) => [
            {
              id: doc.id,
              name: doc.name,
              size: doc.size,
              uploadedAt: doc.uploadedAt,
              uploadedBy: doc.uploadedBy,
              uploadedById: me.id,
              source: "library",
              sourceName: null,
              sourceHref: null,
              endpoint: `/api/resource-files/${doc.id}`,
            },
            ...prev,
          ]);
          setPending((prev) => prev.filter((p) => p.key !== key));
          return true;
        } catch (e) {
          const message = e instanceof Error ? e.message : `“${file.name}” couldn't be uploaded.`;
          setPending((prev) => prev.map((p) => (p.key === key ? { ...p, error: message } : p)));
          return false;
        }
      })
    );
    const ok = results.filter(Boolean).length;
    if (ok > 0) toast.success(ok === 1 && picked.length === 1 ? `“${picked[0].name}” added to the library.` : `${ok} of ${picked.length} files added.`);
    if (ok < picked.length) toast.error(`${picked.length - ok} couldn't be uploaded — see the list for why.`);
  }

  async function openPreview(f: HubFile) {
    setOpening(fileKey(f));
    const res = await fetch(f.endpoint);
    const data = await res.json().catch(() => ({}));
    setOpening(null);
    if (res.ok && data.url) setPreview({ name: f.name, url: data.url });
    else toast.error(data.error || "Couldn't open that file.");
  }

  async function deleteFiles(targets: HubFile[]) {
    setBusy(true);
    let removed = 0;
    let firstError: string | null = null;
    for (const f of targets) {
      const res = await fetch(f.endpoint, { method: "DELETE" });
      if (res.ok) {
        removed++;
        setFiles((prev) => prev.filter((x) => fileKey(x) !== fileKey(f)));
      } else if (!firstError) {
        const data = await res.json().catch(() => ({}));
        firstError = `${f.name}: ${data.error || "couldn't be removed"}`;
      }
    }
    setBusy(false);
    setConfirm(null);
    setSelected(new Set());
    if (removed > 0) toast.success(removed === 1 ? `“${targets[0].name}” deleted.` : `${removed} files deleted.`);
    if (firstError) toast.error(`${targets.length - removed} couldn't be deleted — ${firstError}`);
  }

  const confirmNotLibrary = confirm?.some((f) => f.source !== "library");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <FilterPills pills={pills} value={source} onChange={setSource} counts={counts} label="Filter files by where they're kept" />
        <div className="ml-auto flex items-center gap-2">
          <SearchInput value={search} onChange={setSearch} placeholder="Search files..." />
          <Button size="sm" onClick={() => pickerRef.current?.click()}>
            <Upload size={14} /> Upload
          </Button>
          <input
            ref={pickerRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const picked = Array.from(e.target.files || []);
              e.target.value = "";
              if (picked.length > 0) upload(picked);
            }}
          />
        </div>
      </div>

      <BulkBar count={selectedFiles.length} onClear={() => setSelected(new Set())}>
        {allSelected && !everythingSelected && (
          <button
            type="button"
            onClick={() => setSelected(new Set(shown.map(fileKey)))}
            className="text-xs font-semibold text-togo-blue hover:underline"
          >
            Select all {shown.length}
          </button>
        )}
        <Button size="sm" variant="secondary" onClick={downloadSelected} disabled={busy}>
          <Download size={14} /> Download
        </Button>
        {deletable.length > 0 && (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => setConfirm(deletable)}
            className="border-[var(--status-blocked-fg)] text-[var(--status-blocked-fg)] hover:bg-[var(--status-blocked-bg)]"
          >
            <Trash2 size={14} /> Delete{deletable.length < selectedFiles.length ? ` ${deletable.length}` : ""}
          </Button>
        )}
        {deletable.length < selectedFiles.length && (
          <span className="text-[11px] text-togo-faint">
            {selectedFiles.length - deletable.length} you can&apos;t delete
          </span>
        )}
      </BulkBar>

      {pending.length > 0 && (
        <ul className="divide-y divide-togo-border overflow-hidden rounded-md border border-togo-border bg-togo-surface">
          {pending.map((p) => (
            <li key={p.key} className="flex items-center gap-3 px-4 py-2.5">
              {p.error ? (
                <AlertCircle size={16} className="shrink-0 text-[var(--status-blocked-fg)]" />
              ) : (
                <Loader2 size={16} className="shrink-0 animate-spin text-togo-faint" />
              )}
              <span className="min-w-0 flex-1 truncate text-sm text-togo-white">{p.name}</span>
              <span className={cn("shrink-0 text-xs", p.error ? "text-[var(--status-blocked-fg)]" : "text-togo-faint")}>
                {p.error ?? "Uploading…"}
              </span>
              {p.error && (
                <button
                  type="button"
                  onClick={() => setPending((prev) => prev.filter((x) => x.key !== p.key))}
                  title="Dismiss"
                  aria-label="Dismiss"
                  className={iconButton}
                >
                  <X size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {files.length === 0 ? (
        <div className="space-y-3">
          <EmptyState
            icon={Layers}
            title="No files yet"
            description="Every file uploaded to a project or proposal shows up here, alongside the team's own — templates, brand assets, handbooks."
          />
          <DocumentDropzone onFiles={upload} />
        </div>
      ) : shown.length === 0 ? (
        <EmptyState icon={SearchX} title="No files match" description="Try a different search or source." />
      ) : (
        <div className="overflow-hidden rounded-md border border-togo-border bg-togo-surface">
          <div className="border-b border-togo-border p-3">
            <DocumentDropzone onFiles={upload} compact />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-togo-border text-left">
                  <th scope="col" className="w-10 px-3 py-2.5">
                    <Checkbox checked={allSelected} indeterminate={someSelected} onChange={toggleAll} label="Select all files on this page" />
                  </th>
                  <th scope="col" className="section-label px-4 py-2.5">File</th>
                  <th scope="col" className="section-label w-56 px-4 py-2.5">Kept in</th>
                  <th scope="col" className="section-label w-24 px-4 py-2.5">Size</th>
                  <th scope="col" className="section-label w-48 px-4 py-2.5">Added</th>
                  <th scope="col" className="w-28 px-4 py-2.5">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-togo-border">
                {paged.map((f) => {
                  const Icon = iconFor(f.name);
                  const SourceIcon = SOURCE_ICON[f.source];
                  const key = fileKey(f);
                  return (
                    <tr key={key} className={cn("transition-colors hover:bg-[var(--togo-hover)]", selected.has(key) && "bg-togo-blue/[0.04]")}>
                      <td className="px-3 py-2.5">
                        <Checkbox checked={selected.has(key)} onChange={() => toggle(key)} label={`Select ${f.name}`} />
                      </td>
                      <td className="px-4 py-2.5">
                        <button type="button" onClick={() => openPreview(f)} className="flex min-w-0 max-w-full items-center gap-2.5 text-left">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-togo-blue-muted text-togo-blue">
                            <Icon size={16} />
                          </span>
                          <span className="truncate font-semibold text-togo-white hover:text-togo-blue" title={f.name}>
                            {f.name}
                          </span>
                        </button>
                      </td>
                      <td className="px-4 py-2.5">
                        {f.sourceHref ? (
                          <IntentLink
                            href={f.sourceHref}
                            className="flex min-w-0 items-center gap-1.5 text-xs text-togo-muted hover:text-togo-blue"
                            title={`${SOURCE_LABEL[f.source]}: ${f.sourceName}`}
                          >
                            <SourceIcon size={13} className="shrink-0 text-togo-faint" />
                            <span className="truncate">{f.sourceName}</span>
                          </IntentLink>
                        ) : (
                          <span className="flex items-center gap-1.5 text-xs text-togo-muted">
                            <SourceIcon size={13} className="shrink-0 text-togo-faint" /> Library
                          </span>
                        )}
                      </td>
                      <td className="tnum whitespace-nowrap px-4 py-2.5 text-xs text-togo-muted">
                        {f.size != null ? formatBytes(f.size) : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-togo-faint">
                        <span className="block">{formatDateLong(f.uploadedAt)}</span>
                        {f.uploadedBy && <span className="block truncate">by {f.uploadedBy}</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-0.5">
                          <button
                            type="button"
                            onClick={() => openPreview(f)}
                            disabled={opening === key}
                            title="Preview"
                            aria-label={`Preview ${f.name}`}
                            className={iconButton}
                          >
                            {opening === key ? <Loader2 size={15} className="animate-spin" /> : <Eye size={15} />}
                          </button>
                          <a href={`${f.endpoint}?download=1`} title="Download" aria-label={`Download ${f.name}`} className={iconButton}>
                            <Download size={15} />
                          </a>
                          {canDelete(f) ? (
                            <button
                              type="button"
                              onClick={() => setConfirm([f])}
                              title="Delete"
                              aria-label={`Delete ${f.name}`}
                              className={deleteButton}
                            >
                              <Trash2 size={15} />
                            </button>
                          ) : (
                            <span className="inline-block h-8 w-8" aria-hidden />
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            totalPages={totalPages}
            totalItems={totalItems}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            className="border-t border-togo-border px-4 py-3"
          />
        </div>
      )}

      <ConfirmDialog
        open={!!confirm}
        title={confirm && confirm.length > 1 ? `Delete ${confirm.length} files` : "Delete file"}
        description={
          confirm && confirm.length === 1
            ? `Delete “${confirm[0].name}”${confirm[0].source !== "library" ? ` from ${confirm[0].sourceName}` : ""}? It's removed from storage and can't be recovered.`
            : `Delete these ${confirm?.length ?? 0} files?${confirmNotLibrary ? " Project and proposal files are removed from those pages too." : ""} They're removed from storage and can't be recovered.`
        }
        confirmLabel="Delete"
        danger
        loading={busy}
        onConfirm={() => confirm && deleteFiles(confirm)}
        onCancel={() => setConfirm(null)}
      />

      {preview && <DocumentPreviewModal open onClose={() => setPreview(null)} fileName={preview.name} fileUrl={preview.url} />}
    </div>
  );
}
