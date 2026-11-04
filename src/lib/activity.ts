import { normaliseWorkType } from "@/lib/workType";
import type { DailyUpdateItem } from "@/types";

/**
 * One row of a project's or task's "Activity & history" feed — a daily update
 * or a block of logged time.
 *
 * Built here rather than in each page so the project and task pages can't drift
 * apart on what a row carries, and kept out of the feed component itself because
 * that's a client module: the server pages couldn't call builders exported
 * from it.
 */
export interface ActivityEvent {
  id: string;
  kind: "update" | "time";
  userId: string | null;
  userName: string;
  avatarUrl: string | null;
  date: string;
  /** Sort key — falls back to `date` when the row has no timestamp. */
  at: string;
  status?: string;
  /** The row's one-line summary: the update (or its blocker), or the time note. */
  text?: string | null;
  /** Time logged — on a time event, or on an update logged together with its time. */
  minutes?: number;
  /** On an update: the time entries folded into it (logged in the same save). */
  timeEntryIds?: string[];
  phase?: string | null;
  /** The whole update, for the preview a row opens. Update events only. */
  update?: DailyUpdateItem;
}

type ProfileJoin = { id?: string; name?: string; avatar_url?: string | null; role?: string | null } | null;

/** The embedded `profiles(...)` join; typed loosely by the client, so read through one cast. */
function profileOf(row: { profiles?: unknown }): ProfileJoin {
  return (row.profiles as ProfileJoin) ?? null;
}

// Rows arrive untyped (the Supabase client has no generated schema here), so
// they're accepted as loose records and read field by field.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/** A daily_updates row, joined to `profiles(id, name, avatar_url, role)`. */
export function updateActivity(row: Row): ActivityEvent {
  const profile = profileOf(row);
  const userName = profile?.name || "Someone";
  return {
    id: row.id,
    kind: "update",
    userId: row.user_id ?? null,
    userName,
    avatarUrl: profile?.avatar_url ?? null,
    date: row.date,
    at: row.created_at || row.date,
    status: row.status,
    text: row.update || row.blockers || null,
    update: {
      id: row.id,
      userId: row.user_id,
      user: {
        id: profile?.id ?? row.user_id,
        name: userName,
        avatarUrl: profile?.avatar_url ?? null,
        role: profile?.role ?? "",
      },
      date: row.date,
      project: row.project,
      workType: normaliseWorkType(row.work_type),
      update: row.update ?? "",
      whatsLeft: row.whats_left ?? null,
      timeline: row.timeline ?? null,
      blockers: row.blockers ?? null,
      status: row.status,
      createdAt: row.created_at ?? row.date,
      updatedAt: row.updated_at ?? row.created_at ?? row.date,
    },
  };
}

/** A time_entries row, joined to `profiles(name, avatar_url)`. */
export function timeActivity(row: Row): ActivityEvent {
  const profile = profileOf(row);
  return {
    id: row.id,
    kind: "time",
    userId: row.user_id ?? null,
    userName: profile?.name || "Someone",
    avatarUrl: profile?.avatar_url ?? null,
    date: row.date,
    at: row.created_at || row.date,
    minutes: row.duration_minutes,
    phase: row.phase || null,
    text: row.note || null,
  };
}

/** How far apart an update and its time entry can be saved and still count as one. */
const LOGGED_TOGETHER_MS = 5 * 60 * 1000;

const sameText = (a?: string | null, b?: string | null) => (a ?? "").trim() === (b ?? "").trim();

/**
 * Folds each time entry that the Log Update form saved alongside an update
 * into that update, so one save is one history row: same person, same day,
 * same text (the form uses the update as the entry's note), written within a
 * few minutes. Time logged separately — from the project's time tracker, or
 * an update and time logged at different moments — stays its own row.
 */
function mergeLoggedTogether(events: ActivityEvent[]): ActivityEvent[] {
  const updates = events.filter((e) => e.kind === "update");
  const paired = new Set<ActivityEvent>();
  const absorbed = new Set<ActivityEvent>();

  for (const time of events) {
    if (time.kind !== "time" || !time.userId) continue;
    const match = updates.find(
      (u) =>
        !paired.has(u) &&
        u.userId === time.userId &&
        u.date === time.date &&
        sameText(u.update?.update, time.text) &&
        Math.abs(Date.parse(u.at) - Date.parse(time.at)) <= LOGGED_TOGETHER_MS
    );
    if (!match) continue;
    paired.add(match);
    absorbed.add(time);
    match.minutes = (match.minutes ?? 0) + (time.minutes ?? 0);
    match.timeEntryIds = [...(match.timeEntryIds ?? []), time.id];
  }

  return events.filter((e) => !absorbed.has(e));
}

/**
 * Newest first, by when the row was written rather than the day it's for —
 * with an update and the time logged in the same save shown as one row.
 */
export function sortActivity(events: ActivityEvent[]): ActivityEvent[] {
  return mergeLoggedTogether(events).sort((a, b) => b.at.localeCompare(a.at));
}
