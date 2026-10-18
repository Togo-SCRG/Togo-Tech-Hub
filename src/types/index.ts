import type { WorkType } from "@/lib/workType";

export type AccessLevel = "super_admin" | "admin" | "client" | "user";

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
  role: string;
  isAdmin: boolean;
  accessLevel: AccessLevel;
  isSuperAdmin: boolean;
  /** Read-only observer — sees everything, changes nothing but their own account. */
  isClient: boolean;
  /** Convenience for the many "show this control?" checks: everyone but a client. */
  canEdit: boolean;
  /** Capabilities granted to this user's tier by the permission matrix. */
  capabilities: string[];
  /**
   * Set while a super admin is previewing another tier ("View as"). Everything
   * above then describes that tier, not them; they are a super admin underneath.
   */
  viewingAs?: AccessLevel | null;
  /**
   * Access to Proposals (migration 045): granted per person, not per tier. The
   * super admin is always a manager; null means the feature doesn't exist for
   * this person.
   */
  proposalRole?: ProposalRole | null;
}

export type ProposalRole = "viewer" | "manager";

export type ProposalStatus = "Draft" | "In Review" | "Sent" | "Negotiating" | "On Hold" | "Won" | "Lost";

export interface PersonRef {
  id: string;
  name: string;
  avatarUrl: string | null;
}

/** Someone on the client side (046). Only the name is required. */
export interface ProposalContact {
  name: string;
  email?: string;
}

/** One payment in the schedule — "$9,000 before the build". */
export interface PaymentMilestone {
  label: string;
  amount: number;
}

/** One stage of the build, in weeks. */
export interface BuildPhase {
  name: string;
  weeks: number;
}

export interface Proposal {
  id: string;
  title: string;
  clientName: string | null;
  contacts: ProposalContact[];
  /** The fixed price. */
  value: number | null;
  currency: string;
  paymentSchedule: PaymentMilestone[];
  status: ProposalStatus;
  /** ISO date (YYYY-MM-DD) the build is planned to start, if known. */
  buildStart: string | null;
  buildPhases: BuildPhase[];
  sentAt: string | null;
  decidedAt: string | null;
  summary: string | null;
  /** The project a won proposal became, by name. */
  project: string | null;
  createdBy: PersonRef | null;
  createdAt: string;
  updatedAt: string;
  documentCount: number;
}

export type NoteCategory = "side_note" | "client_portal" | "system_link";

/** A proposal's client-portal and system links, pulled from its link notes for the list page. */
export interface ProposalLinks {
  portal: string[];
  system: string[];
}

export interface ProposalActivity {
  id: string;
  kind: "created" | "status" | "updated" | "note" | "document_added" | "document_removed";
  /** Notes only (047); null on everything else, and on notes read before 047 ran. */
  category: NoteCategory | null;
  /** When a note was last edited (048); null if never. */
  editedAt: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  detail: string | null;
  actor: { name: string; avatarUrl: string | null } | null;
  createdAt: string;
}

/** One person on the Proposals access list. */
export interface ProposalAccessEntry {
  userId: string;
  name: string;
  avatarUrl: string | null;
  role: ProposalRole;
}

export interface UpdateUser {
  id: string;
  name: string;
  avatarUrl?: string | null;
  role: string;
}

export interface DailyUpdateItem {
  id: string;
  userId: string;
  user: UpdateUser;
  date: string;
  /** The project or task name — which of the two is decided by `workType`. */
  project: string;
  workType?: WorkType;
  update: string;
  whatsLeft?: string | null;
  timeline?: string | null;
  blockers?: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface TimeEntryItem {
  id: string;
  userId: string;
  user: UpdateUser;
  /** The project or task name — which of the two is decided by `workType`. */
  project: string;
  workType?: WorkType;
  phase?: string | null;
  date: string;
  durationMinutes: number;
  note?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSettings {
  project: string;
  weeklyHourCap: number | null;
  overview: string | null;
  /** Pasted requirements from the retired PRD tab; folded into the overview on its next edit. */
  prd: string | null;
}

/** One of a person's projects as the Team page lists it. */
export interface MemberProjectSummary {
  name: string;
  /** The project's own status where it has one, else this person's — as everywhere else in the app. */
  status: string;
}

/** A stored file — a project's or a proposal's. The download link is fetched on demand. */
export type DocumentItem = ProjectDocument;

export type ResourceLinkCategory = "company" | "tool" | "system" | "docs" | "client" | "other";

/** A labelled link in the Resources library (migration 049). */
export interface ResourceLink {
  id: string;
  label: string;
  url: string;
  category: ResourceLinkCategory;
  description: string | null;
  /** The company's official website — at most one, shown first on the dashboard. */
  isOfficial: boolean;
  /** Shown in the dashboard's Quick links. */
  pinned: boolean;
  createdBy: { id: string; name: string } | null;
  createdAt: string;
}

/**
 * A link found in a project's or proposal's notes, or in its overview or
 * summary — gathered into Resources › Links, labelled with where it came from.
 */
export interface SourcedLink {
  href: string;
  /** The note's category, or "overview" for a project overview / proposal summary. */
  kind: NoteCategory | "overview";
  source: "project" | "proposal";
  /** The project's name or the proposal's title. */
  sourceName: string;
  sourceHref: string;
  /** What it's stored against: the project's name, or the proposal's id. */
  sourceKey: string;
  /** The note it was written in; null for an overview or summary. */
  noteId: string | null;
}

/** Any file in the hub, wherever it's kept — for the Resources file list. */
export interface HubFile {
  id: string;
  name: string;
  size: number | null;
  uploadedAt: string;
  uploadedBy: string | null;
  uploadedById: string | null;
  /** Where it lives: the Resources library itself, a project, or a proposal. */
  source: "library" | "project" | "proposal";
  /** The project's or proposal's name; null for library files. */
  sourceName: string | null;
  sourceHref: string | null;
  /** Its API route: GET → { url } for the preview, ?download=1 to download, DELETE to remove. */
  endpoint: string;
}

/** A file attached to a project (migration 044). The download link is fetched on demand. */
export interface ProjectDocument {
  id: string;
  name: string;
  size: number | null;
  contentType: string | null;
  uploadedAt: string;
  uploadedBy: string | null;
}

/** One of a project's side notes (migration 044; categorised by 050). */
export interface ProjectSideNote {
  id: string;
  body: string;
  category: NoteCategory;
  author: { name: string; avatarUrl: string | null } | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemberProjectItem {
  id: string;
  userId: string;
  project: string;
  /** This person's own status for the project. Superseded for display by
   *  `projectStatus` — see /api/member-projects. */
  status: string;
  /**
   * The project's overall status, from project_settings — the same value the
   * project's own page and the Projects list show. Null when the project has no
   * settings row yet.
   */
  projectStatus?: string | null;
  role?: string | null;
  partnerIds: string[];
  createdAt: string;
  updatedAt: string;
}

// Client stakeholders are real login accounts at the "admin" access level —
// this is just the shape the Members page needs to render their card.
export interface ClientItem {
  id: string;
  name: string;
  role: string;
  email: string;
  avatarUrl?: string | null;
}

export interface MemberItem {
  id: string;
  name: string;
  email?: string | null;
  /** Contact number, shown on client stakeholder profiles. */
  phone?: string | null;
  avatarUrl?: string | null;
  role: string;
  accessLevel?: AccessLevel;
  bio?: string | null;
  skills?: string | null;
  githubUrl?: string | null;
  updates?: DailyUpdateItem[];
}
