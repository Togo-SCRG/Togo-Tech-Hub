"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Building2,
  CalendarRange,
  Check,
  CircleDollarSign,
  FolderKanban,
  FolderPlus,
  Globe,
  Mail,
  MessageSquare,
  Server,
  Paperclip,
  Pencil,
  PlusCircle,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { BulletTextarea } from "@/components/ui/BulletTextarea";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { IntentLink } from "@/components/ui/IntentLink";
import { Select } from "@/components/ui/Input";
import { LinkifiedText } from "@/components/ui/LinkifiedText";
import { Section } from "@/components/ui/Section";
import { useToast } from "@/components/ui/Toast";
import { DocumentsPanel, useDocuments, type DocumentsAdapter } from "@/components/documents/DocumentsPanel";
import { ProposalStatusBadge, ProposalStatusSelect } from "@/components/proposals/ProposalStatusBadge";
import { ProposalFormModal } from "@/components/proposals/ProposalFormModal";
import {
  NOTE_CATEGORIES,
  PROPOSAL_STAGES,
  estimatedGoLive,
  noteCategoryLabel,
  statusLabel,
  formatMoney,
  formatWeeks,
  phaseSchedule,
  pricingSentence,
  scheduleGap,
  scheduleTotal,
  totalWeeks,
} from "@/lib/proposals";
import { cn, formatDate, formatDateLong, timeAgo } from "@/lib/utils";
import type { DocumentItem, NoteCategory, PersonRef, Proposal, ProposalActivity, ProposalStatus } from "@/types";

/**
 * One proposal: where it stands, what it's worth, its files, and its history.
 *
 * Proposal and activity come from the server render. Saves update local state
 * at once for feedback, and the page re-renders behind them (RefreshAfterSave),
 * which is when the timeline picks up the entries the database's triggers wrote.
 */
export function ProposalDetail({
  initialProposal,
  initialDocuments,
  activity,
  canManage,
  canCreateProject,
  currentUserId,
}: {
  initialProposal: Proposal;
  initialDocuments: DocumentItem[];
  activity: ProposalActivity[];
  canManage: boolean;
  /** Holds project.create — for turning a won proposal into a project. */
  canCreateProject: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [proposal, setProposal] = useState(initialProposal);
  const [statusSaving, setStatusSaving] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [copyingDocs, setCopyingDocs] = useState(false);
  const pickerRef = useRef<HTMLInputElement>(null);

  /**
   * Copies this proposal's documents into its project's. Run automatically
   * when the project is created, and offered as a button afterwards — it skips
   * whatever the project already has, so running it again is safe.
   */
  async function copyDocumentsToProject(quietIfNone = false) {
    setCopyingDocs(true);
    const res = await fetch(`/api/proposals/${proposal.id}/copy-to-project`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setCopyingDocs(false);
    if (!res.ok) {
      toast.error(data.error || "Couldn't copy the documents to the project.");
      return;
    }
    const { copied = 0, skipped = 0, failed = [] } = data as { copied?: number; skipped?: number; failed?: { name: string; error: string }[] };
    if (failed.length > 0) {
      toast.error(`${failed.length} document${failed.length === 1 ? "" : "s"} couldn't be copied — ${failed[0].name}: ${failed[0].error}`);
    }
    if (copied > 0) {
      toast.success(`${copied} document${copied === 1 ? "" : "s"} copied to the project.`);
    } else if (failed.length === 0 && !quietIfNone) {
      toast.success(skipped > 0 ? "The project already has all of these documents." : "There are no documents to copy.");
    }
  }

  // A fresh server render (after any save) is the source of truth again.
  useEffect(() => setProposal(initialProposal), [initialProposal]);

  const adapter: DocumentsAdapter = {
    upload: async (file) => (await import("@/lib/uploadDocument")).uploadProposalDocument(proposal.id, file),
    endpoint: (id) => `/api/proposal-documents/${id}`,
  };
  const docs = useDocuments(adapter, initialDocuments);

  async function patch(fields: Record<string, unknown>): Promise<Proposal | null> {
    const res = await fetch(`/api/proposals/${proposal.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error || "Couldn't save that change.");
      return null;
    }
    setProposal(data.proposal);
    return data.proposal;
  }

  async function changeStatus(status: ProposalStatus) {
    const previous = proposal.status;
    setProposal((p) => ({ ...p, status }));
    setStatusSaving(true);
    const saved = await patch({ status });
    setStatusSaving(false);
    if (!saved) setProposal((p) => ({ ...p, status: previous }));
    else toast.success(`Moved to ${statusLabel(status)}.`);
  }

  async function confirmDelete() {
    setDeleting(true);
    const res = await fetch(`/api/proposals/${proposal.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success(`“${proposal.title}” deleted.`);
      router.push("/proposals");
      return;
    }
    const data = await res.json().catch(() => ({}));
    toast.error(data.error || "Couldn't delete the proposal.");
    setDeleting(false);
    setDeleteOpen(false);
  }

  /**
   * Won → a project. If a project with this name already exists it's linked
   * rather than created: creating would overwrite that project's overview with
   * this proposal's summary.
   */
  async function createProject() {
    setCreatingProject(true);
    const name = proposal.title.trim();
    try {
      const existing = await fetch("/api/projects").then((r) => r.json()).catch(() => ({}));
      const match = ((existing.projects as string[] | undefined) || []).find((n) => n.toLowerCase() === name.toLowerCase());
      let projectName = match;
      if (!projectName) {
        const res = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project: name,
            overview: proposal.summary || "",
            // Whoever turns it into a project starts on its team.
            memberIds: [currentUserId],
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(data.error || "Couldn't create the project.");
          return;
        }
        projectName = data.project as string;
      }
      if (await patch({ project: projectName })) {
        toast.success(match ? `Linked to the existing project “${projectName}”.` : `Project “${projectName}” created.`);
        // The proposal's files belong with the work now, so they go along.
        if (docs.documents.length > 0) await copyDocumentsToProject(true);
      }
    } finally {
      setCreatingProject(false);
    }
  }

  // Two sections from one stream: what people wrote, and what happened.
  const notes = activity.filter((a) => a.kind === "note");
  const history = activity.filter((a) => a.kind !== "note");

  const weeks = totalWeeks(proposal.buildPhases);
  const goLive = estimatedGoLive(proposal.buildStart, proposal.buildPhases);
  const facts: { label: string; value: React.ReactNode }[] = [
    { label: "Fixed price", value: formatMoney(proposal.value, proposal.currency) },
    { label: "Build", value: proposal.buildPhases.length ? formatWeeks(weeks) : "—" },
    { label: goLive ? "Go-live (est.)" : "Sent", value: goLive ? formatDate(goLive) : proposal.sentAt ? formatDate(proposal.sentAt) : "—" },
    // Stored as decided_at; it's the day the proposal closed, won or lost.
    { label: "Closed", value: proposal.decidedAt ? formatDate(proposal.decidedAt) : "—" },
  ];

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-4">
        {/* Header */}
        <header className="rounded-md border border-togo-border bg-togo-surface p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl font-bold leading-tight text-togo-white [overflow-wrap:anywhere]">{proposal.title}</h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-togo-muted">
                <span className="inline-flex items-center gap-1.5">
                  <Building2 size={14} className="text-togo-faint" />
                  {proposal.clientName || "No client set"}
                </span>
                {proposal.contacts.length > 0 && (
                  <span className="inline-flex items-center gap-1.5">
                    <Users size={14} className="text-togo-faint" />
                    {proposal.contacts.length === 1
                      ? proposal.contacts[0].name
                      : `${proposal.contacts[0].name} + ${proposal.contacts.length - 1} more`}
                  </span>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {canManage ? (
                <ProposalStatusSelect value={proposal.status} onChange={changeStatus} disabled={statusSaving} />
              ) : (
                <ProposalStatusBadge status={proposal.status} className="px-3 py-1 text-sm" />
              )}
              {canManage && (
                <Button size="sm" variant="secondary" onClick={() => setEditOpen(true)}>
                  <Pencil size={13} /> Edit
                </Button>
              )}
            </div>
          </div>

          <StageTracker proposal={proposal} />

          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-togo-border pt-3 sm:grid-cols-4">
            {facts.map((f) => (
              <div key={f.label} className="min-w-0">
                <dt className="text-[10px] uppercase tracking-wider text-togo-faint">{f.label}</dt>
                <dd className="tnum mt-0.5 truncate text-sm font-bold text-togo-white">{f.value}</dd>
              </div>
            ))}
          </dl>
        </header>

        <PricingSection proposal={proposal} canManage={canManage} />
        <TimelineSection proposal={proposal} canManage={canManage} />

        <Section title="Summary" icon={MessageSquare}>
          {proposal.summary ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-togo-white [overflow-wrap:anywhere]">
              <LinkifiedText text={proposal.summary} />
            </p>
          ) : (
            <p className="text-sm italic text-togo-faint">
              {canManage ? "No summary yet — add the scope and deliverables with Edit." : "No summary yet."}
            </p>
          )}
        </Section>

        <Section
          title="Documents"
          icon={Paperclip}
          count={docs.documents.length || undefined}
          action={
            canManage ? (
              <>
                <Button size="sm" variant="secondary" onClick={() => pickerRef.current?.click()}>
                  <Upload size={13} /> {docs.uploading ? "Uploading…" : "Upload"}
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
            ) : undefined
          }
        >
          <DocumentsPanel ready notReadyMessage="" canEdit={canManage} state={docs} />
        </Section>

        {canManage && (
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--status-blocked-border)] bg-togo-surface px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-togo-white">Delete this proposal</p>
              <p className="text-xs text-togo-faint">Removes it, its documents and its history for good.</p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setDeleteOpen(true)}
              className="border-[var(--status-blocked-fg)] text-[var(--status-blocked-fg)] hover:bg-[var(--status-blocked-bg)]"
            >
              <Trash2 size={14} /> Delete
            </Button>
          </section>
        )}
      </div>

      <aside className="space-y-4 lg:sticky lg:top-20">
        {(proposal.project || (proposal.status === "Won" && canManage && canCreateProject)) && (
          <section className="rounded-md border border-[var(--status-completed-border)] bg-[var(--status-completed-bg)] p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-[var(--status-completed-fg)]">
              {proposal.project ? "Became a project" : "Won — next step"}
            </p>
            {proposal.project ? (
              <>
                <IntentLink
                  href={`/projects/${encodeURIComponent(proposal.project)}`}
                  className="mt-2 flex items-center gap-2 text-sm font-semibold text-togo-white hover:text-togo-blue"
                >
                  <FolderKanban size={15} /> {proposal.project}
                </IntentLink>
                {/* For proposals linked before documents were copied across, or
                    files added since. Skips what the project already has. */}
                {canManage && docs.documents.length > 0 && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="mt-3"
                    onClick={() => copyDocumentsToProject()}
                    disabled={copyingDocs}
                  >
                    <Paperclip size={13} /> {copyingDocs ? "Copying…" : "Copy documents to project"}
                  </Button>
                )}
              </>
            ) : (
              <>
                <p className="mt-1 text-xs text-togo-muted">
                  Start the project with this proposal&apos;s title and summary, with you on its team — and its documents
                  copied into the project.
                </p>
                <Button size="sm" className="mt-3" onClick={createProject} disabled={creatingProject}>
                  <FolderPlus size={14} /> {creatingProject ? "Creating…" : "Create project"}
                </Button>
              </>
            )}
          </section>
        )}

        <ContactsSection proposal={proposal} canManage={canManage} />

        <NotesSection proposalId={proposal.id} notes={notes} canManage={canManage} />

        <ActivitySection activity={history} createdBy={proposal.createdBy} />
      </aside>

      {editOpen && (
        <ProposalFormModal
          open
          onClose={() => setEditOpen(false)}
          editing={proposal}
          onSaved={setProposal}
        />
      )}

      <ConfirmDialog
        open={deleteOpen}
        title="Delete proposal"
        description={`Delete “${proposal.title}”? Its ${docs.documents.length} document${docs.documents.length === 1 ? "" : "s"} and its history go with it. This can't be undone.`}
        confirmLabel="Delete"
        danger
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  );
}

const emptyText = (canManage: boolean, what: string) =>
  canManage ? `No ${what} yet — add it with Edit.` : `No ${what} yet.`;

/**
 * The terms, led by the one-line version the client reads in the proposal
 * itself ("$18,000 fixed — $9,000 before the build, $9,000 at go-live
 * acceptance."), then the schedule it summarises.
 */
function PricingSection({ proposal, canManage }: { proposal: Proposal; canManage: boolean }) {
  const sentence = pricingSentence(proposal);
  const schedule = proposal.paymentSchedule;
  const scheduled = scheduleTotal(schedule);
  // The payments should cover the fixed price exactly.
  const mismatch = scheduleGap(proposal.value, schedule);
  const showShare = !!proposal.value;

  return (
    <Section title="Pricing & payments" icon={CircleDollarSign}>
      {!sentence ? (
        <p className="text-sm italic text-togo-faint">{emptyText(canManage, "pricing")}</p>
      ) : (
        <div className="space-y-3">
          <p className="text-base font-semibold leading-relaxed text-togo-white">{sentence}</p>
          {schedule.length > 0 && (
            <ol className="divide-y divide-togo-border overflow-hidden rounded-md border border-togo-border">
              {schedule.map((m, i) => (
                <li key={i} className="flex items-center gap-3 px-3 py-2">
                  <span className="tnum flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-togo-blue/10 text-[11px] font-bold text-togo-blue">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 text-sm text-togo-white">{m.label}</span>
                  {showShare && (
                    <span className="tnum shrink-0 text-xs text-togo-faint">
                      {Math.round((m.amount / (proposal.value as number)) * 100)}%
                    </span>
                  )}
                  <span className="tnum w-24 shrink-0 text-right text-sm font-semibold text-togo-white">
                    {formatMoney(m.amount, proposal.currency)}
                  </span>
                </li>
              ))}
            </ol>
          )}
          {mismatch !== null && (
            <p className="text-xs text-[var(--status-hold-fg)]">
              The payments add up to {formatMoney(scheduled)} — {formatMoney(Math.abs(mismatch))}{" "}
              {mismatch < 0 ? "short of" : "over"} the {formatMoney(proposal.value)} price.
            </p>
          )}
        </div>
      )}
    </Section>
  );
}

// Successive phases in stepped shades of the brand blue, so neighbours are
// told apart without introducing colours that mean something elsewhere.
const PHASE_SHADES = ["bg-togo-blue", "bg-togo-blue/70", "bg-togo-blue/45", "bg-togo-blue/25"];

/** The build as a proportional bar, then each phase with its length and — given a start date — its dates. */
function TimelineSection({ proposal, canManage }: { proposal: Proposal; canManage: boolean }) {
  const phases = phaseSchedule(proposal.buildStart, proposal.buildPhases);
  const weeks = totalWeeks(proposal.buildPhases);
  const goLive = estimatedGoLive(proposal.buildStart, proposal.buildPhases);

  return (
    <Section title="Build timeline" icon={CalendarRange}>
      {phases.length === 0 ? (
        <p className="text-sm italic text-togo-faint">{emptyText(canManage, "build timeline")}</p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-togo-muted">
            <span className="font-semibold text-togo-white">{formatWeeks(weeks)}</span>
            {proposal.buildStart ? (
              <>
                {" "}
                · starts {formatDate(proposal.buildStart)}
                {goLive && (
                  <>
                    {" "}
                    · go-live around <span className="font-semibold text-togo-white">{formatDate(goLive)}</span>
                  </>
                )}
              </>
            ) : (
              <span className="text-togo-faint"> · no start date yet, so lengths only</span>
            )}
          </p>

          {/* Each segment's width is its share of the build; a zero-length
              phase (a go-live day) still gets a sliver so it's visible. */}
          <div className="flex h-3 gap-0.5 overflow-hidden rounded-full" aria-hidden>
            {phases.map((p, i) => (
              <span
                key={i}
                title={`${p.name} — ${formatWeeks(p.weeks)}`}
                className={cn("h-full min-w-[6px]", PHASE_SHADES[i % PHASE_SHADES.length])}
                style={{ flexGrow: Math.max(p.weeks, 0.15) }}
              />
            ))}
          </div>

          <ol className="divide-y divide-togo-border overflow-hidden rounded-md border border-togo-border">
            {phases.map((p, i) => (
              <li key={i} className="flex items-center gap-3 px-3 py-2">
                <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", PHASE_SHADES[i % PHASE_SHADES.length])} aria-hidden />
                <span className="min-w-0 flex-1 text-sm text-togo-white">{p.name}</span>
                {p.start && p.end && (
                  <span className="tnum hidden shrink-0 text-xs text-togo-faint sm:inline">
                    {p.start === p.end ? formatDate(p.start) : `${formatDate(p.start)} – ${formatDate(p.end)}`}
                  </span>
                )}
                <span className="tnum w-20 shrink-0 text-right text-xs font-semibold text-togo-muted">
                  {p.weeks === 0 ? "Milestone" : formatWeeks(p.weeks)}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </Section>
  );
}

/** Everyone on the client side, with one-tap email and call. */
function ContactsSection({ proposal, canManage }: { proposal: Proposal; canManage: boolean }) {
  const contacts = proposal.contacts;
  return (
    <Section title="Contacts" icon={Users} count={contacts.length || undefined}>
      {contacts.length === 0 ? (
        <p className="text-sm italic text-togo-faint">{emptyText(canManage, "contacts")}</p>
      ) : (
        <ul className="space-y-3">
          {contacts.map((c, i) => (
            <li key={`${c.name}-${i}`} className="flex gap-2.5">
              <Avatar name={c.name} avatarUrl={null} size="sm" className="shrink-0" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-togo-white">{c.name}</p>
                {c.email && (
                  <a href={`mailto:${c.email}`} className="flex items-center gap-1 truncate text-xs text-togo-blue hover:underline">
                    <Mail size={11} className="shrink-0" /> {c.email}
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/**
 * Draft → In Review → Sent → Negotiating → decision, with the current stage
 * marked. On Hold sits off the path, so it's shown as a note over wherever the
 * proposal had got to.
 */
function StageTracker({ proposal }: { proposal: Proposal }) {
  const decided = proposal.status === "Won" || proposal.status === "Lost";
  const onHold = proposal.status === "On Hold";
  // How far along: a decision completes the path; a paused proposal had at
  // least reached Sent if it has a sent date.
  const reached = decided
    ? PROPOSAL_STAGES.length
    : onHold
      ? proposal.sentAt
        ? PROPOSAL_STAGES.indexOf("Sent")
        : 0
      : PROPOSAL_STAGES.indexOf(proposal.status);

  // The last step is "Closed" until it is — then it says how: "Closed – Won".
  const steps = [...PROPOSAL_STAGES.map((s) => s as string), decided ? statusLabel(proposal.status) : "Closed"];

  return (
    <div className="mt-4">
      <ol className="flex items-center gap-1.5" aria-label="Proposal stage">
        {steps.map((label, i) => {
          const isFinal = i === steps.length - 1;
          const done = i < reached || (isFinal && decided);
          const current = !decided && !onHold && i === reached;
          const finalTone =
            isFinal && decided
              ? proposal.status === "Won"
                ? "border-[var(--status-completed-border)] bg-[var(--status-completed-bg)] text-[var(--status-completed-fg)]"
                : "border-[var(--status-blocked-border)] bg-[var(--status-blocked-bg)] text-[var(--status-blocked-fg)]"
              : null;
          return (
            <li key={label} className="flex min-w-0 flex-1 items-center gap-1.5">
              <span
                className={cn(
                  "flex min-w-0 flex-1 items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-[11px] font-semibold",
                  finalTone ??
                    (current
                      ? "border-togo-blue bg-togo-blue text-white"
                      : done
                        ? "border-togo-blue/40 bg-togo-blue/10 text-togo-blue"
                        : "border-togo-border bg-togo-surface-2/40 text-togo-faint")
                )}
                aria-current={current ? "step" : undefined}
              >
                {done && !finalTone && <Check size={11} className="shrink-0" />}
                <span className="truncate">{label}</span>
              </span>
              {!isFinal && <ArrowRight size={12} className="hidden shrink-0 text-togo-faint sm:block" />}
            </li>
          );
        })}
      </ol>
      {onHold && (
        <p className="mt-2 text-xs font-medium text-[var(--status-hold-fg)]">
          On hold — paused{proposal.sentAt ? " after it was sent" : ""}. Pick a status to move it on again.
        </p>
      )}
    </div>
  );
}

const CATEGORY_ICON: Record<NoteCategory, typeof MessageSquare> = {
  side_note: MessageSquare,
  client_portal: Globe,
  system_link: Server,
};

/**
 * Notes: what people wrote, each filed as a side note, the client portal, or a
 * system link. The last two are what the Proposals list shows as the
 * proposal's links. Kept apart from the automatic history, where notes used to
 * get lost between status changes and uploads. Links are clickable once saved.
 */
function NotesSection({
  proposalId,
  notes,
  canManage,
}: {
  proposalId: string;
  notes: ProposalActivity[];
  canManage: boolean;
}) {
  const toast = useToast();
  const [note, setNote] = useState("");
  const [category, setCategory] = useState<NoteCategory>("side_note");
  const [filter, setFilter] = useState<NoteCategory | "all">("all");
  const [saving, setSaving] = useState(false);
  // Notes just written or edited, shown until the refreshed server render
  // includes them.
  const [justAdded, setJustAdded] = useState<ProposalActivity[]>([]);
  const [edited, setEdited] = useState<Record<string, ProposalActivity>>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<ProposalActivity | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [editCategory, setEditCategory] = useState<NoteCategory>("side_note");
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    setJustAdded([]);
    setEdited({});
    setRemoved(new Set());
  }, [notes]);

  function startEdit(n: ProposalActivity) {
    setEditBody(n.detail || "");
    setEditCategory(n.category ?? "side_note");
    setEditingId(n.id);
  }

  async function saveEdit(id: string) {
    const body = editBody.trim();
    if (!body) return;
    setSavingEdit(true);
    const res = await fetch(`/api/proposals/${proposalId}/notes?noteId=${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, category: editCategory }),
    });
    const data = await res.json().catch(() => ({}));
    setSavingEdit(false);
    if (!res.ok) {
      toast.error(data.error || "Couldn't save the note.");
      return;
    }
    setEdited((prev) => ({ ...prev, [id]: data.activity }));
    // A just-added note lives in justAdded; keep that copy current too.
    setJustAdded((prev) => prev.map((n) => (n.id === id ? data.activity : n)));
    setEditingId(null);
    toast.success("Note updated.");
  }

  async function addNote() {
    const body = note.trim();
    if (!body) return;
    setSaving(true);
    const res = await fetch(`/api/proposals/${proposalId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, category }),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      toast.error(data.error || "Couldn't add the note.");
      return;
    }
    setJustAdded((prev) => [data.activity, ...prev]);
    setNote("");
    // Back to the everyday kind, so the next quick note isn't filed as a link.
    setCategory("side_note");
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const res = await fetch(`/api/proposals/${proposalId}/notes?noteId=${encodeURIComponent(deleteTarget.id)}`, {
      method: "DELETE",
    });
    setDeleting(false);
    if (res.ok) {
      setRemoved((prev) => new Set(prev).add(deleteTarget.id));
      toast.success("Note deleted.");
    } else {
      const data = await res.json().catch(() => ({}));
      toast.error(data.error || "Couldn't delete the note.");
    }
    setDeleteTarget(null);
  }

  const entries = [...justAdded.filter((a) => !notes.some((b) => b.id === a.id)), ...notes]
    .filter((a) => !removed.has(a.id))
    .map((a) => edited[a.id] ?? a);
  const countFor = (c: NoteCategory) => entries.filter((n) => (n.category ?? "side_note") === c).length;
  const shown = filter === "all" ? entries : entries.filter((n) => (n.category ?? "side_note") === filter);
  const current = NOTE_CATEGORIES.find((c) => c.value === category)!;

  return (
    <Section title="Notes" icon={MessageSquare} count={entries.length || undefined}>
      <div className="space-y-3">
        {canManage && (
          <div className="space-y-2">
            <Select
              value={category}
              onChange={(e) => setCategory(e.target.value as NoteCategory)}
              aria-label="Note category"
              className="h-8 py-1 text-xs"
            >
              {NOTE_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
            <BulletTextarea rows={3} value={note} onChange={setNote} placeholder={current.placeholder} />
            <div className="flex items-center gap-3">
              <Button size="sm" onClick={addNote} disabled={saving || !note.trim()}>
                {saving ? "Adding…" : "Add"}
              </Button>
              <span className="text-[11px] text-togo-faint">
                {current.needsLink ? "Shown as a link on the Proposals list." : "Links become clickable once saved."}
              </span>
            </div>
          </div>
        )}

        {/* Filter by kind — only worth showing once there's more than one kind. */}
        {new Set(entries.map((n) => n.category ?? "side_note")).size > 1 && (
          <div role="group" aria-label="Show notes" className="flex flex-wrap gap-1">
            {[{ value: "all" as const, label: "All", count: entries.length }, ...NOTE_CATEGORIES.map((c) => ({ value: c.value, label: c.plural, count: countFor(c.value) }))]
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

        {shown.length === 0 ? (
          <p className="text-sm italic text-togo-faint">No notes yet.</p>
        ) : (
          <ul className="space-y-2">
            {shown.map((n) => {
              const kind = n.category ?? "side_note";
              const KindIcon = CATEGORY_ICON[kind];
              return (
              <li key={n.id} className="group rounded-md border border-togo-border bg-togo-surface-2/30 p-3">
                {editingId === n.id ? (
                  /* Inline, in place of the note, so it's edited where it's read. */
                  <div className="space-y-2">
                    <Select
                      value={editCategory}
                      onChange={(e) => setEditCategory(e.target.value as NoteCategory)}
                      aria-label="Note category"
                      className="h-8 py-1 text-xs"
                    >
                      {NOTE_CATEGORIES.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </Select>
                    <BulletTextarea rows={3} value={editBody} onChange={setEditBody} />
                    <div className="flex items-center gap-3">
                      <Button size="sm" onClick={() => saveEdit(n.id)} disabled={savingEdit || !editBody.trim()}>
                        {savingEdit ? "Saving…" : "Save"}
                      </Button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        disabled={savingEdit}
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
                        kind === "side_note" ? "bg-togo-surface-2 text-togo-muted" : "bg-togo-blue/10 text-togo-blue"
                      )}
                    >
                      <KindIcon size={10} /> {noteCategoryLabel(kind)}
                    </span>
                    {/* overflow-wrap:anywhere so a long pasted URL wraps instead of
                        running past the card. */}
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-togo-white [overflow-wrap:anywhere]">
                      <LinkifiedText text={n.detail || ""} />
                    </p>
                    <div className="mt-2 flex items-center gap-2 text-[11px] text-togo-faint">
                      {n.actor ? (
                        <>
                          <Avatar name={n.actor.name} avatarUrl={n.actor.avatarUrl} size="sm" className="!h-5 !w-5 !text-[9px]" />
                          <span className="font-medium text-togo-muted">{n.actor.name}</span>
                        </>
                      ) : (
                        <span>Someone</span>
                      )}
                      <span title={formatDateLong(n.createdAt)}>
                        · {timeAgo(n.createdAt)}
                        {n.editedAt && <span title={`Edited ${formatDateLong(n.editedAt)}`}> · edited</span>}
                      </span>
                      {canManage && (
                        // Always shown on touch screens, which have no hover.
                        <div className="ml-auto flex items-center gap-0.5 transition sm:opacity-0 sm:focus-within:opacity-100 sm:group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={() => startEdit(n)}
                            title="Edit note"
                            aria-label="Edit note"
                            className="rounded p-1 text-togo-faint transition-colors hover:text-togo-blue"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(n)}
                            title="Delete note"
                            aria-label="Delete note"
                            className="rounded p-1 text-togo-faint transition-colors hover:text-[var(--status-blocked-fg)]"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </li>
              );
            })}
          </ul>
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

const KIND_ICON = {
  created: PlusCircle,
  status: ArrowRight,
  updated: Pencil,
  note: MessageSquare,
  document_added: Paperclip,
  document_removed: Trash2,
} as const;

/** Activity: the automatic history — creation, status changes, edits, uploads — newest first. */
function ActivitySection({ activity, createdBy }: { activity: ProposalActivity[]; createdBy: PersonRef | null }) {
  return (
    <section className="overflow-hidden rounded-md border border-togo-border bg-togo-surface">
      <div className="flex items-center gap-2 border-b border-togo-border px-4 py-3">
        <h2 className="text-sm font-bold text-togo-white">Activity</h2>
        <span className="tnum rounded bg-togo-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-togo-muted">
          {activity.length}
        </span>
      </div>

      {activity.length === 0 ? (
        <p className="px-4 py-5 text-xs text-togo-muted">
          Nothing yet. Status changes, edits and uploads are recorded here automatically
          {createdBy ? `, starting from when ${createdBy.name} created it.` : "."}
        </p>
      ) : (
        <ul className="max-h-[560px] divide-y divide-togo-border overflow-y-auto">
          {activity.map((a) => {
            const Icon = KIND_ICON[a.kind] ?? Pencil;
            const who = a.actor?.name ?? "Someone";
            return (
              <li key={a.id} className="flex gap-2.5 px-4 py-2.5">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-togo-surface-2 text-togo-faint">
                  <Icon size={12} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs leading-snug text-togo-white">
                    <span className="font-semibold">{who}</span>{" "}
                    {a.kind === "created" && (
                      <span className="text-togo-muted">
                        created this proposal
                        {a.toStatus ? (
                          <>
                            {" "}
                            as <ProposalStatusBadge status={a.toStatus as ProposalStatus} className="align-middle" />
                          </>
                        ) : null}
                      </span>
                    )}
                    {a.kind === "status" && (
                      <span className="text-togo-muted">
                        moved it{" "}
                        {a.fromStatus && (
                          <>
                            from <ProposalStatusBadge status={a.fromStatus as ProposalStatus} className="align-middle" />{" "}
                          </>
                        )}
                        to <ProposalStatusBadge status={a.toStatus as ProposalStatus} className="align-middle" />
                      </span>
                    )}
                    {a.kind === "updated" && <span className="text-togo-muted">updated the {a.detail}</span>}
                    {a.kind === "document_added" && (
                      <span className="text-togo-muted">
                        added <span className="text-togo-white">{a.detail}</span>
                      </span>
                    )}
                    {a.kind === "document_removed" && (
                      <span className="text-togo-muted">
                        removed <span className="line-through">{a.detail}</span>
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-[10px] text-togo-faint" title={formatDateLong(a.createdAt)}>
                    {timeAgo(a.createdAt)}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
