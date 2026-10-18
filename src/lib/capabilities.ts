import type { AccessLevel } from "@/types";

/**
 * The capability catalogue — the rows of the permission matrix.
 *
 * Kept in step with the seed in migration 032 by hand: the database is the
 * enforcement, this is the label and the grouping the super admin sees. A
 * capability listed here with no rows in the table simply reads as "off for
 * everyone", which is the safe direction to fail.
 */
export type Capability =
  | "project.create"
  | "project.delete"
  | "project.docs.edit"
  | "project.hourcap.edit"
  | "project.name.edit"
  | "project.status.edit"
  | "project.timeline.edit"
  | "project.manage.all"
  | "project.assign"
  | "project.unassign"
  | "work.update.log"
  | "work.update.others"
  | "work.time.track"
  | "blocker.manage"
  | "tracker.view.all"
  | "team.member.add"
  | "team.client.add"
  | "member.delete";

export interface CapabilityInfo {
  key: Capability;
  group: string;
  label: string;
  /** Shown under the label — what turning it on actually allows. */
  hint: string;
}

export const CAPABILITIES: CapabilityInfo[] = [
  {
    key: "project.create",
    group: "Projects",
    label: "Create a project",
    hint: "Start a new project and assign its first team",
  },
  {
    key: "project.delete",
    group: "Projects",
    label: "Delete a project",
    hint: "Permanently removes its updates, tracked time and assignments",
  },
  {
    key: "project.docs.edit",
    group: "Projects",
    label: "Edit overview, documents & notes",
    hint: "Including uploading and removing documents, and adding or editing side notes",
  },
  {
    key: "project.hourcap.edit",
    group: "Projects",
    label: "Set the weekly hour cap",
    hint: "The budget a project's pace is measured against",
  },
  {
    key: "project.name.edit",
    group: "Projects",
    label: "Rename a project",
    hint: "Limited to projects they're on, unless they can manage every project",
  },
  {
    key: "project.status.edit",
    group: "Projects",
    label: "Change project status",
    hint: "Limited to projects they're on, unless they can manage every project",
  },
  {
    key: "project.timeline.edit",
    group: "Projects",
    label: "Change project timeline",
    hint: "Limited to projects they're on, unless they can manage every project",
  },
  {
    key: "project.manage.all",
    group: "Projects",
    label: "Manage every project",
    hint: "Lifts the 'must be on this project' limit from name, status, timeline and docs",
  },
  {
    key: "project.assign",
    group: "Team",
    label: "Assign people to projects",
    hint: "Add someone to a project's team",
  },
  {
    key: "project.unassign",
    group: "Team",
    label: "Remove people from projects",
    hint: "Anyone can always remove themselves",
  },
  {
    key: "work.update.log",
    group: "Work log",
    label: "Log daily updates",
    hint: "Their own work. Logging for someone else is the separate permission below",
  },
  {
    key: "work.update.others",
    group: "Work log",
    label: "Log updates for other people",
    hint: "Adds a second button for logging on someone else's behalf, and allows editing their updates",
  },
  {
    key: "work.time.track",
    group: "Work log",
    label: "Track time",
    hint: "The timer and manual time entries",
  },
  {
    key: "blocker.manage",
    group: "Work log",
    label: "Raise & resolve blockers",
    hint: "Possible without being able to log updates",
  },
  {
    key: "tracker.view.all",
    group: "Work log",
    label: "See everyone's tasks",
    hint: "Off means the tracker shows only their own work",
  },
  {
    key: "team.member.add",
    group: "People",
    label: "Add team members",
    hint: "Create an account for someone on the team",
  },
  {
    key: "team.client.add",
    group: "People",
    label: "Add clients",
    hint: "Create a client account",
  },
  {
    key: "member.delete",
    group: "People",
    label: "Delete accounts",
    hint: "Removes the person and everything they logged",
  },
];

export const CAPABILITY_GROUPS = ["Projects", "Team", "Work log", "People"] as const;

/**
 * The super admin is deliberately not editable in the matrix — they always
 * hold every capability. Without that there'd be a set of checkboxes that
 * locks you out of the page containing those checkboxes.
 */
export const FIXED_LEVEL: AccessLevel = "super_admin";

export function can(capabilities: string[] | undefined, capability: Capability): boolean {
  return !!capabilities?.includes(capability);
}
