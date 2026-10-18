"use client";

import { useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, FileText, Plus, Sparkles, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Input, Label, Select, Textarea } from "@/components/ui/Input";
import { DateField } from "@/components/ui/DateField";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { DocumentDropzone } from "@/components/documents/DocumentDropzone";
import { MAX_DOCUMENT_BYTES } from "@/lib/projectDocs";
import {
  PAYMENT_LABEL_SUGGESTIONS,
  PAYMENT_PRESETS,
  PROPOSAL_STATUSES,
  STANDARD_PHASES,
  estimatedGoLive,
  formatMoney,
  formatWeeks,
  pricingSentence,
  scheduleGap,
  scheduleTotal,
  totalWeeks,
} from "@/lib/proposals";
import { cn, formatBytes, formatDate } from "@/lib/utils";
import type { Proposal, ProposalStatus } from "@/types";

interface ContactRow {
  name: string;
  email: string;
}
interface PaymentRow {
  label: string;
  amount: string;
}
interface PhaseRow {
  name: string;
  weeks: string;
}

const BLANK_CONTACT: ContactRow = { name: "", email: "" };

function parseAmount(raw: string): number | null {
  if (!raw.trim()) return null;
  const n = Number(raw.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Create a proposal, or edit everything about it but its status.
 *
 * Status is set here on create only — afterwards it's changed from the
 * proposal's own page, where each change is recorded on its timeline.
 * Documents likewise: picked here for a new proposal and uploaded once it
 * exists, managed from the Documents section after that.
 */
export function ProposalFormModal({
  open,
  onClose,
  editing,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  /** Present to edit; absent to create. */
  editing?: Proposal | null;
  onSaved?: (proposal: Proposal) => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const labelListId = useId();

  const [title, setTitle] = useState(editing?.title ?? "");
  const [clientName, setClientName] = useState(editing?.clientName ?? "");
  const [status, setStatus] = useState<ProposalStatus>("Draft");
  const [summary, setSummary] = useState(editing?.summary ?? "");

  const [value, setValue] = useState(editing?.value != null ? String(editing.value) : "");
  const [payments, setPayments] = useState<PaymentRow[]>(
    editing?.paymentSchedule.map((m) => ({ label: m.label, amount: String(m.amount) })) ?? []
  );

  const [buildStart, setBuildStart] = useState(editing?.buildStart ?? "");
  const [phases, setPhases] = useState<PhaseRow[]>(
    editing?.buildPhases.map((p) => ({ name: p.name, weeks: String(p.weeks) })) ?? []
  );

  const [contacts, setContacts] = useState<ContactRow[]>(
    editing?.contacts.length
      ? editing.contacts.map((c) => ({ name: c.name, email: c.email ?? "" }))
      : [{ ...BLANK_CONTACT }]
  );

  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = parseAmount(value);

  // What the terms will read as on the proposal, updating as you type.
  const preview = useMemo(() => {
    const schedule = payments
      .map((p) => ({ label: p.label.trim(), amount: parseAmount(p.amount) }))
      .filter((p): p is { label: string; amount: number } => !!p.label && p.amount !== null);
    return {
      schedule,
      sentence: pricingSentence({ value: total, currency: "USD", paymentSchedule: schedule }),
      scheduled: scheduleTotal(schedule),
      gap: scheduleGap(total, schedule),
    };
  }, [payments, total]);

  const phaseList = phases
    .map((p) => ({ name: p.name.trim(), weeks: Number(p.weeks) }))
    .filter((p) => p.name && Number.isFinite(p.weeks));
  const weeks = totalWeeks(phaseList);
  const goLive = estimatedGoLive(buildStart || null, phaseList);

  function addFiles(picked: File[]) {
    const tooBig = picked.filter((f) => f.size > MAX_DOCUMENT_BYTES);
    if (tooBig.length > 0) {
      toast.error(`${tooBig.map((f) => `“${f.name}”`).join(", ")} ${tooBig.length === 1 ? "is" : "are"} over 20 MB.`);
    }
    setFiles((prev) => [...prev, ...picked.filter((f) => f.size <= MAX_DOCUMENT_BYTES)]);
  }

  function update<T>(setter: React.Dispatch<React.SetStateAction<T[]>>, index: number, patch: Partial<T>) {
    setter((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("A proposal needs a title.");
      return;
    }
    setSaving(true);
    setError(null);

    const fields = {
      title,
      clientName,
      summary,
      value: value.trim() === "" ? null : value,
      paymentSchedule: payments.map((p) => ({ label: p.label, amount: p.amount })),
      buildStart: buildStart || null,
      buildPhases: phases.map((p) => ({ name: p.name, weeks: p.weeks })),
      contacts,
      ...(editing ? {} : { status }),
    };

    const res = await fetch(editing ? `/api/proposals/${editing.id}` : "/api/proposals", {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setError(data.error || "Couldn't save the proposal.");
      setSaving(false);
      return;
    }

    const proposal = data.proposal as Proposal;
    if (!editing && files.length > 0) {
      // Loaded only when there's something to upload — it brings the browser
      // Supabase client along.
      const { uploadProposalDocument } = await import("@/lib/uploadDocument");
      const results = await Promise.allSettled(files.map((f) => uploadProposalDocument(proposal.id, f)));
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed > 0) {
        toast.error(`${failed} of ${files.length} documents couldn't be uploaded — add them from the proposal's page.`);
      }
    }

    setSaving(false);
    toast.success(editing ? "Proposal updated." : `“${proposal.title}” created.`);
    onSaved?.(proposal);
    onClose();
    if (!editing) router.push(`/proposals/${proposal.id}`);
  }

  const removeButton = (onClick: () => void, label: string) => (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="shrink-0 self-center rounded p-1 text-togo-faint transition-colors hover:text-[var(--status-blocked-fg)]"
    >
      <X size={15} />
    </button>
  );

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Edit proposal" : "New proposal"} className="max-w-3xl">
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* ── Basics ─────────────────────────────────────────────── */}
        <FormSection title="Basics">
          <div>
            <Label htmlFor="proposal-title">Title</Label>
            <Input
              id="proposal-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Freight portal rebuild — phase 1"
              autoFocus
              required
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="proposal-client" hint="Company or organisation">
                Client
              </Label>
              <Input id="proposal-client" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="e.g. Acme Logistics" />
            </div>
            {!editing && (
              <div>
                <Label htmlFor="proposal-status">Starting status</Label>
                <Select id="proposal-status" value={status} onChange={(e) => setStatus(e.target.value as ProposalStatus)}>
                  {PROPOSAL_STATUSES.map((s) => (
                    <option key={s.status} value={s.status}>
                      {s.label} — {s.hint}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>
          <div>
            <Label htmlFor="proposal-summary" hint="Optional">
              Summary
            </Label>
            <Textarea
              id="proposal-summary"
              rows={3}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="What's being proposed — scope, deliverables, anything the team should know"
            />
          </div>
        </FormSection>

        {/* ── Pricing & payments ─────────────────────────────────── */}
        <FormSection title="Pricing & payments" hint="A fixed price, paid in the instalments below">
          <div className="sm:w-1/2 sm:pr-2">
            <Label htmlFor="proposal-value" hint="Fixed price, USD">
              Total price
            </Label>
            <Input
              id="proposal-value"
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="e.g. 18000"
            />
          </div>

          <div>
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <Label className="!mb-0">Payment schedule</Label>
              {/* Presets need a total to split. */}
              <div className="flex flex-wrap gap-1.5">
                {PAYMENT_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    disabled={total === null || total <= 0}
                    onClick={() =>
                      setPayments(preset.build(total || 0).map((m) => ({ label: m.label, amount: String(m.amount) })))
                    }
                    title={total ? `Fill in: ${preset.label}` : "Enter the total first"}
                    className="inline-flex items-center gap-1 rounded border border-togo-border px-2 py-0.5 text-[11px] font-medium text-togo-muted transition-colors hover:border-togo-blue hover:text-togo-blue disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Sparkles size={11} /> {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <datalist id={labelListId}>
              {PAYMENT_LABEL_SUGGESTIONS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>

            {payments.length > 0 && (
              <div className="space-y-2">
                {payments.map((row, i) => (
                  <div key={i} className="flex gap-2">
                    <Input
                      value={row.label}
                      onChange={(e) => update(setPayments, i, { label: e.target.value })}
                      placeholder="When — e.g. Before the build"
                      list={labelListId}
                      aria-label={`Payment ${i + 1} — when it's due`}
                      className="flex-1"
                    />
                    <Input
                      value={row.amount}
                      onChange={(e) => update(setPayments, i, { amount: e.target.value })}
                      inputMode="decimal"
                      placeholder="Amount"
                      aria-label={`Payment ${i + 1} — amount`}
                      className="w-32"
                    />
                    {removeButton(() => setPayments((rows) => rows.filter((_, j) => j !== i)), `Remove payment ${i + 1}`)}
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => setPayments((rows) => [...rows, { label: "", amount: "" }])}
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-togo-blue hover:underline"
            >
              <Plus size={13} /> Add a payment
            </button>

            {preview.gap !== null ? (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-[var(--status-hold-fg)]">
                <AlertTriangle size={13} />
                Payments add up to {formatMoney(preview.scheduled)} — {formatMoney(Math.abs(preview.gap))}{" "}
                {preview.gap < 0 ? "short of" : "over"} the {formatMoney(total)} total.
              </p>
            ) : preview.schedule.length > 0 && total !== null ? (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-[var(--status-completed-fg)]">
                <CheckCircle2 size={13} /> Adds up to the {formatMoney(total)} total.
              </p>
            ) : null}
          </div>

          {preview.sentence && (
            <div className="rounded-md border border-togo-border bg-togo-surface-2/40 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wider text-togo-faint">Reads as</p>
              <p className="mt-0.5 text-sm text-togo-white">{preview.sentence}</p>
            </div>
          )}
        </FormSection>

        {/* ── Build timeline ─────────────────────────────────────── */}
        <FormSection title="Build timeline">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="proposal-build-start" hint="Optional — gives each phase real dates">
                Planned build start
              </Label>
              <DateField id="proposal-build-start" value={buildStart} onChange={setBuildStart} />
            </div>
            <div className="flex items-end">
              {phaseList.length > 0 && (
                <p className="text-sm text-togo-muted">
                  <span className="font-semibold text-togo-white">{formatWeeks(weeks)}</span> in total
                  {goLive && (
                    <>
                      {" "}
                      · go-live around <span className="font-semibold text-togo-white">{formatDate(goLive)}</span>
                    </>
                  )}
                </p>
              )}
            </div>
          </div>

          {phases.length === 0 ? (
            <button
              type="button"
              onClick={() => setPhases(STANDARD_PHASES.map((p) => ({ name: p.name, weeks: String(p.weeks) })))}
              className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-togo-border px-3 py-2 text-xs font-medium text-togo-muted transition-colors hover:border-togo-blue hover:text-togo-blue"
            >
              <Sparkles size={13} /> Start from a standard timeline — Discovery, Build, Testing & UAT, Go-live
            </button>
          ) : (
            <div className="space-y-2">
              {phases.map((row, i) => (
                <div key={i} className="flex gap-2">
                  <span className="tnum flex w-6 shrink-0 items-center justify-center text-xs font-semibold text-togo-faint">
                    {i + 1}
                  </span>
                  <Input
                    value={row.name}
                    onChange={(e) => update(setPhases, i, { name: e.target.value })}
                    placeholder="Phase — e.g. Build"
                    aria-label={`Phase ${i + 1} — name`}
                    className="flex-1"
                  />
                  <div className="relative w-28">
                    <Input
                      value={row.weeks}
                      onChange={(e) => update(setPhases, i, { weeks: e.target.value })}
                      inputMode="decimal"
                      placeholder="0"
                      aria-label={`Phase ${i + 1} — length in weeks`}
                      className="pr-12"
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-togo-faint">weeks</span>
                  </div>
                  {removeButton(() => setPhases((rows) => rows.filter((_, j) => j !== i)), `Remove phase ${i + 1}`)}
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={() => setPhases((rows) => [...rows, { name: "", weeks: "" }])}
            className="inline-flex items-center gap-1 text-xs font-medium text-togo-blue hover:underline"
          >
            <Plus size={13} /> Add a phase
          </button>
        </FormSection>

        {/* ── Contacts ───────────────────────────────────────────── */}
        <FormSection title="Contacts" hint="The people on the client side — add as many as you need">
          <div className="space-y-2">
            {contacts.map((row, i) => (
              <div key={i} className="flex gap-2">
                <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
                  <Input
                    value={row.name}
                    onChange={(e) => update(setContacts, i, { name: e.target.value })}
                    placeholder="Name"
                    aria-label={`Contact ${i + 1} — name`}
                  />
                  <Input
                    type="email"
                    value={row.email}
                    onChange={(e) => update(setContacts, i, { email: e.target.value })}
                    placeholder="Email"
                    aria-label={`Contact ${i + 1} — email`}
                  />
                </div>
                {removeButton(() => setContacts((rows) => rows.filter((_, j) => j !== i)), `Remove contact ${i + 1}`)}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setContacts((rows) => [...rows, { ...BLANK_CONTACT }])}
            className="inline-flex items-center gap-1 text-xs font-medium text-togo-blue hover:underline"
          >
            <Plus size={13} /> Add a contact
          </button>
        </FormSection>

        {/* ── Documents (create only) ────────────────────────────── */}
        {!editing && (
          <FormSection title="Documents" hint="Optional — more can be added from the proposal's page">
            {files.length > 0 && (
              <ul className="divide-y divide-togo-border overflow-hidden rounded-md border border-togo-border">
                {files.map((file, i) => (
                  <li key={`${file.name}-${i}`} className="flex items-center gap-2.5 px-3 py-2">
                    <FileText size={15} className="shrink-0 text-togo-blue" />
                    <span className="min-w-0 flex-1 truncate text-sm text-togo-white" title={file.name}>
                      {file.name}
                    </span>
                    <span className="tnum shrink-0 text-xs text-togo-faint">{formatBytes(file.size)}</span>
                    {removeButton(() => setFiles((prev) => prev.filter((_, j) => j !== i)), `Remove ${file.name}`)}
                  </li>
                ))}
              </ul>
            )}
            <DocumentDropzone onFiles={addFiles} compact={files.length > 0} disabled={saving} />
          </FormSection>
        )}

        {error && (
          <p role="alert" className="text-sm text-[var(--status-blocked-fg)]">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-3 border-t border-togo-border pt-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving
              ? files.length > 0 && !editing
                ? "Creating & uploading..."
                : "Saving..."
              : editing
                ? "Save changes"
                : "Create proposal"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function FormSection({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <fieldset className={cn("space-y-3 border-t border-togo-border pt-4 first:border-t-0 first:pt-0")}>
      <legend className="sr-only">{title}</legend>
      <div>
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-togo-blue">{title}</h3>
        {hint && <p className="mt-0.5 text-xs text-togo-faint">{hint}</p>}
      </div>
      {children}
    </fieldset>
  );
}
