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
  prd: string | null;
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
