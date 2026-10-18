import type { SupabaseClient } from "@supabase/supabase-js";
import { findLinks } from "@/components/ui/LinkifiedText";
import { isNoteCategory } from "@/lib/noteCategories";
import type {
  BuildPhase,
  DocumentItem,
  PaymentMilestone,
  PersonRef,
  Proposal,
  ProposalActivity,
  ProposalContact,
  ProposalLinks,
  ProposalStatus,
} from "@/types";

/**
 * Proposals (migrations 045, 046): statuses and their colours, pricing and
 * build-timeline maths, and reading proposals out of the database. Free of
 * server-only imports — the client components use the helpers, the server
 * pages the fetchers.
 */

export const PROPOSAL_FILES_BUCKET = "proposal-files";

export const MIGRATION_045_MISSING =
  "Proposals need a database update — run migrations 045 to 048 in the Supabase SQL Editor.";

// ---------------------------------------------------------------------------
// Statuses
// ---------------------------------------------------------------------------

interface StatusInfo {
  status: ProposalStatus;
  /**
   * What people read. The two outcomes read as "Closed – Won" / "Closed –
   * Lost": "Decision" and a bare "Won" made it unclear the proposal was
   * finished. The stored values stay Won and Lost.
   */
  label: string;
  /** What the status means, for the status picker. */
  hint: string;
  /** Badge colours — the same tints the project statuses use, so the app reads as one system. */
  tone: string;
  /** Still in play: counted in the pipeline. */
  open: boolean;
}

export const PROPOSAL_STATUSES: StatusInfo[] = [
  {
    status: "Draft",
    label: "Draft",
    hint: "Being written",
    tone: "bg-togo-surface-2 text-togo-muted border-togo-border",
    open: true,
  },
  {
    status: "In Review",
    label: "In Review",
    hint: "Checked internally before it goes out",
    tone: "bg-[var(--status-review-bg)] text-[var(--status-review-fg)] border-[var(--status-review-border)]",
    open: true,
  },
  {
    status: "Sent",
    label: "Sent",
    hint: "With the client, awaiting a response",
    tone: "bg-[var(--status-progress-bg)] text-[#0797DF] border-[var(--status-progress-border)]",
    open: true,
  },
  {
    status: "Negotiating",
    label: "Negotiating",
    hint: "Terms, scope or price under discussion",
    tone: "bg-cyan-50 text-cyan-700 border-cyan-600/40 dark:bg-cyan-950/40 dark:text-cyan-300 dark:border-cyan-400/40",
    open: true,
  },
  {
    status: "On Hold",
    label: "On Hold",
    hint: "Paused — by us or the client",
    tone: "bg-[var(--status-hold-bg)] text-[var(--status-hold-fg)] border-[var(--status-hold-border)]",
    open: true,
  },
  {
    status: "Won",
    label: "Closed – Won",
    hint: "Accepted — the work is ours",
    tone: "bg-[var(--status-completed-bg)] text-[var(--status-completed-fg)] border-[var(--status-completed-border)]",
    open: false,
  },
  {
    status: "Lost",
    label: "Closed – Lost",
    hint: "Declined, or went elsewhere",
    tone: "bg-[var(--status-blocked-bg)] text-[var(--status-blocked-fg)] border-[var(--status-blocked-border)]",
    open: false,
  },
];

const BY_STATUS = new Map(PROPOSAL_STATUSES.map((s) => [s.status, s]));

export function isProposalStatus(value: unknown): value is ProposalStatus {
  return typeof value === "string" && BY_STATUS.has(value as ProposalStatus);
}

export function proposalTone(status: string): string | undefined {
  return BY_STATUS.get(status as ProposalStatus)?.tone;
}

/** How a status reads on screen — "Closed – Won" for Won. */
export function statusLabel(status: string): string {
  return BY_STATUS.get(status as ProposalStatus)?.label ?? status;
}

export function isClosedProposal(status: ProposalStatus): boolean {
  return status === "Won" || status === "Lost";
}

// Note categories (047) are shared with project side notes (050) — one
// definition, in lib/noteCategories.ts.
export { NOTE_CATEGORIES, isNoteCategory, noteCategoryLabel } from "@/lib/noteCategories";

export function isOpenProposal(status: ProposalStatus): boolean {
  return BY_STATUS.get(status)?.open ?? false;
}

/** The main path a proposal moves along; On Hold sits off it. */
export const PROPOSAL_STAGES: ProposalStatus[] = ["Draft", "In Review", "Sent", "Negotiating"];

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

// Every proposal is a fixed price. The database's pricing_model column (046)
// also allows time & materials and retainer, but the team only quotes fixed,
// so the app neither offers nor shows the others — and saves always write
// "fixed", which normalises anything entered before.
export const PRICING_MODEL = "fixed";

/** Whole dollars: these are quotes and estimates, and cents only add noise to a pipeline. */
export function formatMoney(value: number | null | undefined, currency = "USD"): string {
  if (value === null || value === undefined) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${currency} ${Math.round(value).toLocaleString("en-US")}`;
  }
}

/** The price as it's quoted: "$18,000 fixed". */
export function formatPrice(p: Pick<Proposal, "value" | "currency">): string {
  return p.value === null ? "—" : `${formatMoney(p.value, p.currency)} fixed`;
}

export function scheduleTotal(schedule: PaymentMilestone[]): number {
  return schedule.reduce((sum, m) => sum + (Number.isFinite(m.amount) ? m.amount : 0), 0);
}

/**
 * A label as it reads mid-sentence: "Before the build" → "before the build".
 * Left alone when it opens on an acronym or name ("UAT sign-off", "Kickoff
 * with ACME"), where lowercasing would mangle it.
 */
function inSentence(label: string): string {
  const t = label.trim();
  return /^[A-Z][a-z]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t;
}

/**
 * The terms in one line, the way they're written in the proposal itself:
 * "$18,000 fixed — $9,000 before the build, $9,000 at go-live acceptance."
 * Null when there's no price to state.
 */
export function pricingSentence(p: Pick<Proposal, "value" | "currency" | "paymentSchedule">): string | null {
  if (p.value === null && p.paymentSchedule.length === 0) return null;
  const head = p.value !== null ? formatPrice(p) : formatMoney(scheduleTotal(p.paymentSchedule), p.currency);
  if (p.paymentSchedule.length === 0) return `${head}.`;
  const parts = p.paymentSchedule.map((m) => `${formatMoney(m.amount, p.currency)} ${inSentence(m.label)}`);
  return `${head} — ${parts.join(", ")}.`;
}

/** Ready-made schedules, the first being the common half-up-front, half-at-go-live split. */
export const PAYMENT_PRESETS: { label: string; build: (total: number) => PaymentMilestone[] }[] = [
  {
    label: "50 / 50 — before the build, at go-live",
    build: (total) => {
      const first = Math.round(total / 2);
      return [
        { label: "Before the build", amount: first },
        { label: "At go-live acceptance", amount: total - first },
      ];
    },
  },
  {
    label: "Single payment at go-live",
    build: (total) => [{ label: "At go-live acceptance", amount: total }],
  },
  {
    label: "Thirds — signing, mid-build, go-live",
    build: (total) => {
      const third = Math.round(total / 3);
      return [
        { label: "On signing", amount: third },
        { label: "At the midpoint of the build", amount: third },
        { label: "At go-live acceptance", amount: total - third * 2 },
      ];
    },
  },
];

/** Suggestions for a payment's label, offered as the field's autocomplete. */
export const PAYMENT_LABEL_SUGGESTIONS = [
  "On signing",
  "Before the build",
  "At the midpoint of the build",
  "At go-live acceptance",
  "30 days after go-live",
];

/**
 * How far a fixed price's payments are from the price: positive when they
 * overshoot, negative when short, null when they match or there's nothing to
 * compare. Under a dollar is rounding, not a mismatch.
 */
export function scheduleGap(value: number | null, schedule: PaymentMilestone[]): number | null {
  if (value === null || schedule.length === 0) return null;
  const gap = scheduleTotal(schedule) - value;
  return Math.abs(gap) >= 1 ? gap : null;
}

// ---------------------------------------------------------------------------
// Build timeline
// ---------------------------------------------------------------------------

export const STANDARD_PHASES: BuildPhase[] = [
  { name: "Discovery", weeks: 1 },
  { name: "Build", weeks: 4 },
  { name: "Testing & UAT", weeks: 1 },
  { name: "Go-live", weeks: 0.5 },
];

export function totalWeeks(phases: BuildPhase[]): number {
  return phases.reduce((sum, p) => sum + (Number.isFinite(p.weeks) ? p.weeks : 0), 0);
}

/** "6 weeks", "1 week", "2.5 weeks". */
export function formatWeeks(weeks: number): string {
  const n = Math.round(weeks * 10) / 10;
  return `${n} ${n === 1 ? "week" : "weeks"}`;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Math.round(days));
  return d.toISOString().slice(0, 10);
}

/**
 * Each phase with its dates, laid end to end from the planned start. Without a
 * start date there are no dates, only lengths. Each phase ends the day before
 * the next one starts; a zero-length phase is a single day.
 */
export function phaseSchedule(
  start: string | null,
  phases: BuildPhase[]
): { name: string; weeks: number; start: string | null; end: string | null }[] {
  let offsetDays = 0;
  return phases.map((p) => {
    const days = Math.max(0, p.weeks * 7);
    const from = start ? addDays(start, offsetDays) : null;
    const to = start ? addDays(start, offsetDays + Math.max(days, 1) - 1) : null;
    offsetDays += days;
    return { name: p.name, weeks: p.weeks, start: from, end: to };
  });
}

/** When the build should finish: the last phase's end. */
export function estimatedGoLive(start: string | null, phases: BuildPhase[]): string | null {
  if (!start || phases.length === 0) return null;
  return phaseSchedule(start, phases).at(-1)?.end ?? null;
}

// ---------------------------------------------------------------------------
// Reading from the database
// ---------------------------------------------------------------------------

// One literal, not concatenated: the Supabase client types a select by parsing
// its string, which only works on a literal. The profile join names its
// foreign key (045) because proposals has two (owner_id, still in the table
// though the app no longer uses it, and created_by).
export const PROPOSAL_SELECT =
  "id, title, client_name, contacts, value, currency, payment_schedule, status, build_start, build_phases, sent_at, decided_at, summary, project, created_at, updated_at, creator:profiles!proposals_created_by_fkey(id, name, avatar_url), proposal_documents(count)";

export const PROPOSAL_DOCUMENT_SELECT = "id, name, size_bytes, content_type, created_at, profiles(name)";
/** Everything, including when a note was edited (048). */
export const PROPOSAL_ACTIVITY_SELECT =
  "id, kind, note_category, edited_at, from_status, to_status, detail, created_at, profiles(name, avatar_url)";
/**
 * Without edited_at — for writing a new note (never edited yet) so adding one
 * doesn't depend on 048 having been run, and as the read fallback before it.
 */
export const PROPOSAL_ACTIVITY_SELECT_047 =
  "id, kind, note_category, from_status, to_status, detail, created_at, profiles(name, avatar_url)";
/** Before 047 too — notes then read as side notes. */
const PROPOSAL_ACTIVITY_SELECT_PRE_047 = "id, kind, from_status, to_status, detail, created_at, profiles(name, avatar_url)";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

function person(raw: unknown): PersonRef | null {
  const p = raw as { id?: string; name?: string; avatar_url?: string | null } | null;
  return p?.id && p.name ? { id: p.id, name: p.name, avatarUrl: p.avatar_url ?? null } : null;
}

/** A jsonb list, read defensively: anything malformed is dropped, not trusted. */
function list<T>(raw: unknown, read: (item: Row) => T | null): T[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const parsed = read(item as Row);
    return parsed ? [parsed] : [];
  });
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

export function toProposal(row: Row): Proposal {
  const count = Array.isArray(row.proposal_documents) ? row.proposal_documents[0]?.count : undefined;
  return {
    id: row.id,
    title: row.title,
    clientName: row.client_name ?? null,
    // Name and email only — any role or phone saved before is ignored, and
    // dropped on the next save.
    contacts: list<ProposalContact>(row.contacts, (c) => (str(c.name) ? { name: str(c.name)!, email: str(c.email) } : null)),
    value: row.value === null || row.value === undefined ? null : Number(row.value),
    currency: row.currency || "USD",
    paymentSchedule: list<PaymentMilestone>(row.payment_schedule, (m) =>
      str(m.label) && Number.isFinite(Number(m.amount)) ? { label: str(m.label)!, amount: Number(m.amount) } : null
    ),
    status: row.status,
    buildStart: row.build_start ?? null,
    buildPhases: list<BuildPhase>(row.build_phases, (p) =>
      str(p.name) && Number.isFinite(Number(p.weeks)) ? { name: str(p.name)!, weeks: Number(p.weeks) } : null
    ),
    sentAt: row.sent_at ?? null,
    decidedAt: row.decided_at ?? null,
    summary: row.summary ?? null,
    project: row.project ?? null,
    createdBy: person(row.creator),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    documentCount: typeof count === "number" ? count : 0,
  };
}

export function toProposalDocument(row: Row): DocumentItem {
  const uploader = row.profiles as { name?: string } | null;
  return {
    id: row.id,
    name: row.name,
    size: row.size_bytes ?? null,
    contentType: row.content_type ?? null,
    uploadedAt: row.created_at,
    uploadedBy: uploader?.name ?? null,
  };
}

export function toProposalActivity(row: Row): ProposalActivity {
  const actor = row.profiles as { name?: string; avatar_url?: string | null } | null;
  return {
    id: row.id,
    kind: row.kind,
    category: row.kind === "note" ? (isNoteCategory(row.note_category) ? row.note_category : "side_note") : null,
    editedAt: row.edited_at ?? null,
    fromStatus: row.from_status ?? null,
    toStatus: row.to_status ?? null,
    detail: row.detail ?? null,
    actor: actor?.name ? { name: actor.name, avatarUrl: actor.avatar_url ?? null } : null,
    createdAt: row.created_at,
  };
}

/**
 * The schema isn't there yet: a missing table (42P01 / PGRST205, before 045),
 * a missing relationship (PGRST200), or a missing column (42703, before 046).
 */
export function isProposalsMissing(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  if (["42P01", "PGRST205", "PGRST200", "42703"].includes(error.code || "")) return true;
  return /proposal/i.test(error.message || "") && /does not exist|could not find/i.test(error.message || "");
}

export async function fetchProposals(
  supabase: SupabaseClient
): Promise<{ ready: boolean; proposals: Proposal[] }> {
  const { data, error } = await supabase.from("proposals").select(PROPOSAL_SELECT).order("updated_at", { ascending: false });
  if (error) {
    if (!isProposalsMissing(error)) console.error(`[proposals] list failed: ${error.code} ${error.message}`);
    return { ready: !isProposalsMissing(error), proposals: [] };
  }
  return { ready: true, proposals: (data || []).map(toProposal) };
}

export async function fetchProposal(
  supabase: SupabaseClient,
  id: string
): Promise<{ proposal: Proposal; documents: DocumentItem[]; activity: ProposalActivity[] } | null> {
  const activityQuery = (select: string) =>
    supabase
      .from("proposal_activity")
      .select(select)
      .eq("proposal_id", id)
      .order("created_at", { ascending: false })
      .limit(200);

  const [proposalResult, documentsResult, firstActivity] = await Promise.all([
    supabase.from("proposals").select(PROPOSAL_SELECT).eq("id", id).maybeSingle(),
    supabase
      .from("proposal_documents")
      .select(PROPOSAL_DOCUMENT_SELECT)
      .eq("proposal_id", id)
      .order("created_at", { ascending: false }),
    activityQuery(PROPOSAL_ACTIVITY_SELECT),
  ]);
  if (!proposalResult.data) return null;

  // A column a later migration adds (048's edited_at, 047's category) that
  // isn't there yet fails the whole select — which would hide every note.
  // Step back through older selects rather than lose them.
  let activityResult = firstActivity;
  for (const fallback of [PROPOSAL_ACTIVITY_SELECT_047, PROPOSAL_ACTIVITY_SELECT_PRE_047]) {
    if (!activityResult.error || !isProposalsMissing(activityResult.error)) break;
    activityResult = await activityQuery(fallback);
  }

  return {
    proposal: toProposal(proposalResult.data),
    documents: (documentsResult.data || []).map(toProposalDocument),
    activity: ((activityResult.data || []) as unknown as Row[]).map(toProposalActivity),
  };
}

/**
 * Every proposal's client-portal and system links, keyed by proposal, for the
 * list page — pulled out of its link notes with the same rules that make links
 * clickable in the notes themselves. Newest first, each address once. Empty
 * (rather than failing) before 047.
 */
export async function fetchProposalLinks(supabase: SupabaseClient): Promise<Record<string, ProposalLinks>> {
  const { data, error } = await supabase
    .from("proposal_activity")
    .select("proposal_id, note_category, detail")
    .eq("kind", "note")
    .in("note_category", ["client_portal", "system_link"])
    .order("created_at", { ascending: false });
  if (error) return {};

  const byProposal: Record<string, ProposalLinks> = {};
  for (const row of data || []) {
    const entry = (byProposal[row.proposal_id as string] ??= { portal: [], system: [] });
    const bucket = row.note_category === "client_portal" ? entry.portal : entry.system;
    for (const link of findLinks((row.detail as string) || "")) {
      if (!bucket.includes(link.href)) bucket.push(link.href);
    }
  }
  return byProposal;
}

/** Storage key for a proposal's file: its own folder, then a collision-proof, sanitised name. */
export function proposalStoragePath(proposalId: string, fileName: string): string {
  const safeName = fileName.normalize("NFKD").replace(/[^\w.\-() ]+/g, "_").slice(-120) || "file";
  const tag = Math.random().toString(36).slice(2, 10);
  return `${proposalId}/${Date.now()}-${tag}-${safeName}`;
}

// ---------------------------------------------------------------------------
// Validating a form
// ---------------------------------------------------------------------------

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function money(raw: unknown): number | null | "invalid" {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0 || n > 1e12) return "invalid";
  return Math.round(n * 100) / 100;
}

/**
 * A proposal form's fields, checked and mapped to columns. `partial` for an
 * edit, where anything left out stays as it is; a create needs a title.
 * Blank text becomes null rather than an empty string, so "not set" has one
 * representation, and blank rows in the lists are dropped.
 */
export function parseProposalFields(
  body: Record<string, unknown>,
  { partial }: { partial: boolean }
): { fields: Record<string, unknown> } | { error: string } {
  const fields: Record<string, unknown> = {};
  const has = (key: string) => body[key] !== undefined;
  const text = (key: string) => {
    const v = body[key];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };

  if (has("title") || !partial) {
    const title = text("title");
    if (!title) return { error: "A proposal needs a title." };
    if (title.length > 200) return { error: "Keep the title under 200 characters." };
    fields.title = title;
  }
  for (const [key, column] of [
    ["clientName", "client_name"],
    ["summary", "summary"],
    ["project", "project"],
  ] as const) {
    if (has(key)) fields[column] = text(key);
  }

  if (has("value")) {
    const v = money(body.value);
    if (v === "invalid") return { error: "The price must be a positive amount." };
    fields.value = v;
    // Written alongside the price, so a proposal saved before pricing became
    // fixed-only is brought in line.
    fields.pricing_model = PRICING_MODEL;
  }
  if (has("status")) {
    if (!isProposalStatus(body.status)) return { error: "Unknown status." };
    fields.status = body.status;
  }

  if (has("contacts")) {
    if (!Array.isArray(body.contacts)) return { error: "Contacts must be a list." };
    const contacts: ProposalContact[] = [];
    for (const raw of body.contacts as Row[]) {
      const name = str(raw?.name);
      const email = str(raw?.email);
      if (!name && !email) continue; // a blank row
      if (!name) return { error: "Each contact needs a name." };
      if (email && !EMAIL.test(email)) return { error: `${name}'s email doesn't look right.` };
      contacts.push({ name: name.slice(0, 120), email });
    }
    if (contacts.length > 25) return { error: "That's a lot of contacts — keep it to 25." };
    fields.contacts = contacts;
  }

  if (has("paymentSchedule")) {
    if (!Array.isArray(body.paymentSchedule)) return { error: "The payment schedule must be a list." };
    const schedule: PaymentMilestone[] = [];
    for (const raw of body.paymentSchedule as Row[]) {
      const label = str(raw?.label);
      const amount = money(raw?.amount);
      if (!label && amount === null) continue; // a blank row
      if (!label) return { error: "Each payment needs a label — when it's due, e.g. “Before the build”." };
      if (amount === null || amount === "invalid") return { error: `“${label}” needs a positive amount.` };
      schedule.push({ label: label.slice(0, 160), amount });
    }
    if (schedule.length > 20) return { error: "Keep the payment schedule to 20 payments." };
    fields.payment_schedule = schedule;
  }

  if (has("buildStart")) {
    const start = body.buildStart;
    if (start !== null && start !== "" && (typeof start !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(start))) {
      return { error: "The build start isn't a valid date." };
    }
    fields.build_start = start || null;
  }

  if (has("buildPhases")) {
    if (!Array.isArray(body.buildPhases)) return { error: "The build timeline must be a list." };
    const phases: BuildPhase[] = [];
    for (const raw of body.buildPhases as Row[]) {
      const name = str(raw?.name);
      const weeksRaw = raw?.weeks;
      const blankWeeks = weeksRaw === null || weeksRaw === undefined || weeksRaw === "";
      if (!name && blankWeeks) continue; // a blank row
      if (!name) return { error: "Each phase needs a name." };
      const weeks = Number(weeksRaw);
      if (blankWeeks || !Number.isFinite(weeks) || weeks < 0 || weeks > 520) {
        return { error: `“${name}” needs a length in weeks (0 or more).` };
      }
      phases.push({ name: name.slice(0, 120), weeks: Math.round(weeks * 10) / 10 });
    }
    if (phases.length > 30) return { error: "Keep the timeline to 30 phases." };
    fields.build_phases = phases;
  }

  return { fields };
}
